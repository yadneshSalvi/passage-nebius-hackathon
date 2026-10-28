import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  FixtureEngine,
  fixtureDefinitions,
  scenarioDefinitions,
  createContract,
  getOriginalSource,
  getReferenceSource,
} from "../engine/index.js";

const requested = process.argv[2];
const scenarioId = process.argv[3] ?? "baseline";
const selected = requested
  ? fixtureDefinitions.filter((fixture) => fixture.id === requested)
  : fixtureDefinitions;
if (!selected.length) throw new Error("Unknown fixture ID.");
const scenario = scenarioDefinitions.find((item) => item.id === scenarioId);
if (!scenario) throw new Error("Unknown scenario ID.");
const engine = new FixtureEngine({
  previewPort: Number(process.env.VERIFY_PREVIEW_PORT ?? 4193),
  artifactRoot: ".passage/verification",
});
await engine.start();
const results = [];
let failed = false;
try {
  for (const fixture of selected) {
    const contract = createContract(fixture.id);
    for (const mode of ["original", "reference"] as const) {
      const source =
        mode === "original"
          ? await getOriginalSource(fixture.id)
          : await getReferenceSource(fixture.id);
      const build = await engine.prepareBuild({
        fixtureId: fixture.id,
        source,
      });
      const result = await engine.verify({
        build,
        contract,
        scenario,
        kind: mode === "original" ? "baseline" : "candidate",
        onProgress: (message) =>
          console.log(`${fixture.id} / ${mode}: ${message}`),
      });
      results.push({ fixtureId: fixture.id, mode, result });
      const expected = mode === "reference";
      if (result.passed !== expected) failed = true;
      console.log(
        JSON.stringify({
          fixture: fixture.id,
          mode,
          actual: result.status,
          expected: expected ? "passed" : "failed",
          checks: result.checks.map((check) => `${check.id}:${check.status}`),
          outcome: result.outcome?.date ?? null,
          browser: result.browserVersion,
        }),
      );
    }
  }
  await mkdir(".passage/reports", { recursive: true });
  const verifierVersion = results[0]?.result.verifierVersion ?? "unversioned";
  const output = resolve(
    `.passage/reports/fixtures-${requested ?? "all"}-${scenarioId}-${verifierVersion}-${Date.now()}.json`,
  );
  await writeFile(
    output,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        verifierVersion,
        results,
        humanValidation: "not performed",
        heldOutEvaluation: "not performed",
      },
      null,
      2,
    ),
  );
  console.log(`Actual verification report: ${output}`);
} finally {
  await engine.close();
}
if (failed) process.exitCode = 1;
