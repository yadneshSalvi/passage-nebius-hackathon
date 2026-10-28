import { readFile, mkdtemp, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { FixtureHost } from "../engine/host.js";
import { runFixtureTemporal } from "../engine/temporal-fixture.js";
import { digest, scenarioDefinitions } from "../engine/catalog.js";
import { AUTHORED_PRESERVATION_VERSION, checkAuthoredPreservation } from "../engine/authored-preservation.js";
import { validateTemporalContract } from "../engine/contract-interpreter.js";
import type { TemporalContract } from "../shared/temporal.js";

const args = process.argv.slice(2);
function argument(name: string) { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; }
const guardPath = resolve(argument("--guard") ?? "guard.json");
const sourcePath = argument("--source");
const guard = JSON.parse(await readFile(guardPath, "utf8")) as {
  schema: string; fixtureId: string; scope: string;
  acceptancePolicy?: string;
  preservationPolicy?: { required: boolean; verifierVersion: string; scenarios: string[]; expectedRuns: number } | null;
  contractsBySchedule: Record<string, TemporalContract>; patches: { source: string; afterDigest: string }[];
};
if (guard.schema !== "passage-journey-guard/v1" || guard.scope !== "authored-fixture") throw new Error("This runner requires an authored-fixture temporal guard. External repositories require their qualified worker and protected outcome adapter.");
const entries = Object.entries(guard.contractsBySchedule);
if (entries.length !== 3 || ["baseline", "cancel-pending", "modal-boundary"].some(id => !Object.hasOwn(guard.contractsBySchedule, id))) throw new Error("The guard must retain all three frozen temporal schedules.");
for (const [, contract] of entries) validateTemporalContract(contract);
const source = sourcePath ? await readFile(resolve(sourcePath), "utf8") : guard.patches.at(-1)?.source;
if (!source) throw new Error("Provide --source path/to/SlotControl.jsx. This guard has no accepted generated patch.");
if (!sourcePath && digest(source) !== guard.patches.at(-1)?.afterDigest) throw new Error("The embedded source differs from its recorded digest. Use an explicit --source for a later revision.");
const requiresPreservation = guard.acceptancePolicy === "frozen-suite-and-preservation-v1";
if (guard.acceptancePolicy && !["frozen-suite-only", "frozen-suite-and-preservation-v1"].includes(guard.acceptancePolicy)) throw new Error("Unsupported guard acceptance policy.");
if (requiresPreservation && (!guard.preservationPolicy?.required || guard.preservationPolicy.verifierVersion !== AUTHORED_PRESERVATION_VERSION ||
    guard.preservationPolicy.expectedRuns !== 4 || JSON.stringify(guard.preservationPolicy.scenarios) !== JSON.stringify(["baseline", "combined"])))
  throw new Error("The required preservation policy does not match this bundled verifier.");
if (!requiresPreservation && guard.preservationPolicy?.required) throw new Error("The guard declares inconsistent acceptance policies.");
const root = await mkdtemp(join(tmpdir(), "passage-guard-"));
const host = new FixtureHost({ previewPort: 0, artifactRoot: root });
try {
  await host.start();
  const build = await host.prepareBuild({ fixtureId: guard.fixtureId, source });
  const results = [];
  for (const [schedule, contract] of entries) {
    const result = await runFixtureTemporal({ host, build, scenario: scenarioDefinitions[0], contract });
    results.push({ schedule, result });
  }
  const temporalPassed = results.every(item => item.result.passed);
  const preservation = requiresPreservation ? await checkAuthoredPreservation({ source, fixtureId: guard.fixtureId }) : null;
  const preservationPassed = preservation ? preservation.passed && preservation.runs.length === 4 && preservation.source.digest === build.digest : null;
  const passed = temporalPassed && (!requiresPreservation || preservationPassed === true);
  process.stdout.write(`${JSON.stringify({ schema: "passage-guard-replay/v1", sourceDigest: build.digest, buildId: build.id,
    acceptancePolicy: guard.acceptancePolicy ?? "frozen-suite-only", temporalPassed, preservationPassed, passed, results, preservation }, null, 2)}\n`);
  process.exitCode = passed ? 0 : 1;
} finally { await host.close(); await rm(root, { recursive: true, force: true }); }
