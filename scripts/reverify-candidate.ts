import { mkdir, writeFile } from "node:fs/promises";
import { FixtureEngine, scenarioDefinitions } from "../engine/index.js";
import type { RepairRun } from "../shared/types.js";

const runId = process.argv[2];
const scenarioId = process.argv[3] ?? "baseline";
if (!/^repair_[a-f0-9-]{36}$/.test(runId ?? ""))
  throw new Error("Supply a local repair run ID.");
const response = await fetch(`http://127.0.0.1:4102/v1/repairs/${runId}`);
if (!response.ok) throw new Error("The requested local run is unavailable.");
const run = (await response.json()) as RepairRun;
const candidate = run.candidates.at(-1);
if (!candidate) throw new Error("The requested run has no retained candidate.");
const scenario = scenarioDefinitions.find((item) => item.id === scenarioId);
if (!scenario) throw new Error("Unknown scenario.");
const engine = new FixtureEngine({
  previewPort: Number(process.env.VERIFY_PREVIEW_PORT ?? 4194),
  artifactRoot: ".passage/revalidation",
});
await engine.start();
try {
  const build = await engine.prepareBuild({
    fixtureId: run.fixtureId,
    source: candidate.source,
  });
  if (build.digest !== candidate.digest)
    throw new Error("The retained candidate failed its source digest check.");
  const result = await engine.verify({
    build,
    contract: run.contract,
    scenario,
    kind: "candidate",
    onProgress: (message) => console.log(message),
  });
  const audit = {
    auditOnly: true,
    originalRunId: runId,
    originalRunStatus: run.status,
    candidateRevision: candidate.revision,
    candidateDigest: candidate.digest,
    generationReceipt: candidate.receipt,
    priorVerification: candidate.verification,
    newVerification: result,
    note: "Re-execution of the exact retained source. No model call and no mutation of historical run acceptance.",
  };
  await mkdir(".passage/reports", { recursive: true });
  const path = `.passage/reports/revalidation-${runId}-${result.verifierVersion ?? "unversioned"}-${scenarioId}-${Date.now()}.json`;
  await writeFile(path, JSON.stringify(audit, null, 2));
  console.log(
    JSON.stringify({
      passed: result.passed,
      verifierVersion: result.verifierVersion,
      checks: result.checks.map((item) => `${item.id}:${item.status}`),
      sourceDigest: candidate.digest,
      scenario: scenario.id,
      outcome: result.outcome?.date ?? null,
      report: path,
    }),
  );
  if (!result.passed) process.exitCode = 1;
} finally {
  await engine.close();
}
