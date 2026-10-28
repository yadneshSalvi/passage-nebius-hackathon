import { constants } from "node:fs";
import { mkdir, mkdtemp, open, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import {
  FixtureEngine,
  createContract,
  digest,
  getFixture,
  scenarioDefinitions,
  validateCandidateSource,
} from "../engine/index.js";

// This command deliberately imports only the fixture engine, not the API,
// provider configuration, environment-file loader, or persisted run database.
const args = process.argv.slice(2);
if (args.length < 2 || args.length > 4)
  throw new Error(
    "Usage: npm run verify:source -- <fixture-id> <source.jsx> [scenario-id] [expected-sha256]",
  );
const [fixtureId, sourcePath, scenarioId = "baseline", expectedDigest] = args;
getFixture(fixtureId);
const scenario = scenarioDefinitions.find((item) => item.id === scenarioId);
if (!scenario) throw new Error("Unknown public scenario ID.");
if (expectedDigest && !/^[a-f0-9]{64}$/.test(expectedDigest))
  throw new Error(
    "The optional expected SHA-256 must be 64 lowercase hex digits.",
  );

// A 24,000-character component needs at most 96,000 UTF-8 bytes. Read a bounded
// regular file through one handle, rejecting oversized, special and symlink inputs.
const maxBytes = 96_000;
const handle = await open(
  resolve(sourcePath),
  constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
);
let source: string;
try {
  const stat = await handle.stat();
  if (!stat.isFile() || stat.size > maxBytes)
    throw new Error(
      "Source must be a regular file no larger than 96,000 bytes.",
    );
  const bytes = Buffer.alloc(maxBytes + 1);
  let total = 0;
  for (;;) {
    const { bytesRead } = await handle.read(
      bytes,
      total,
      bytes.length - total,
      total,
    );
    total += bytesRead;
    if (!bytesRead || total === bytes.length) break;
  }
  if (total > maxBytes)
    throw new Error("Source exceeds the bounded component file size.");
  source = new TextDecoder("utf-8", { fatal: true }).decode(
    bytes.subarray(0, total),
  );
} finally {
  await handle.close();
}
const sourceDigest = digest(source);
if (expectedDigest && sourceDigest !== expectedDigest)
  throw new Error("Source SHA-256 does not match the expected digest.");
const safety = validateCandidateSource(source);
if (!safety.valid)
  throw new Error(`Source validation rejected: ${safety.errors.join(" ")}`);

const parent = resolve(".passage/source-replays");
await mkdir(parent, { recursive: true });
const artifactRoot = await mkdtemp(join(parent, `${fixtureId}-`));
const engine = new FixtureEngine({ previewPort: 0, artifactRoot });
const contract = createContract(fixtureId);
const cancellation = new AbortController();
const interrupt = () =>
  cancellation.abort(new Error("Source replay cancelled."));
process.once("SIGINT", interrupt);
const signal = AbortSignal.any([
  cancellation.signal,
  AbortSignal.timeout(90_000),
]);
await engine.start();
try {
  const build = await engine.prepareBuild({ fixtureId, source });
  const verification = await engine.verify({
    build,
    contract,
    scenario,
    kind: "candidate",
    signal,
    onProgress: (message) => console.log(message),
  });
  const report = {
    schema: "passage-source-replay-v1",
    createdAt: new Date().toISOString(),
    inferencePerformed: false,
    sourceFile: basename(sourcePath),
    sourceDigest,
    expectedDigest: expectedDigest ?? null,
    contractMode: "fresh-protected-default",
    note: "A new protected default contract is used, not a historical custom contract. Contract IDs/timestamps and toolchain-dependent build identities may differ from the original receipt. This audit does not rewrite historical acceptance.",
    contract,
    build,
    verification,
    localArtifacts: verification.artifacts.map((artifact) => ({
      ...artifact,
      path: join("artifacts", basename(new URL(artifact.url).pathname)),
    })),
  };
  const reportPath = join(artifactRoot, "report.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
    flag: "wx",
  });
  console.log(
    JSON.stringify({
      passed: verification.passed,
      verifierVersion: verification.verifierVersion,
      sourceDigest,
      scenario: verification.scenario.id,
      checks: verification.checks.map((item) => `${item.id}:${item.status}`),
      outcome: verification.outcome?.date ?? null,
      inferencePerformed: false,
      report: reportPath,
    }),
  );
  if (!verification.passed) process.exitCode = 1;
} finally {
  process.removeListener("SIGINT", interrupt);
  await engine.close();
}
