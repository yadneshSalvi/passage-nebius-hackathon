import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { digest, scenarioDefinitions } from "../engine/catalog.js";
import { checkAuthoredPreservation } from "../engine/authored-preservation.js";
import { validateTemporalContract } from "../engine/contract-interpreter.js";
import type { TemporalContract } from "../shared/temporal.js";

const args = process.argv.slice(2);
const allowed = new Set([
  "--source",
  "--guard",
  "--output",
  "--scenario",
  "--fixture",
]);
function argument(name: string) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  if (!args[index + 1] || args[index + 1].startsWith("--"))
    throw new Error(`${name} needs a value.`);
  return args[index + 1];
}
if (args.includes("--help")) {
  process.stdout.write(
    "Usage: npx tsx scripts/check-authored-preservation.ts (--source SlotControl.jsx | --guard guard.json) [--scenario baseline|combined|all] [--fixture northstar-appointments] [--output report.json]\n\nRuns additional pointer-booking and native-Tab Close-control preservation checks. No inference, API server or repository scripts are used. Historical guard acceptance is unchanged.\n",
  );
} else {
  try {
    for (let index = 0; index < args.length; index += 2)
      if (!allowed.has(args[index]))
        throw new Error(`Unknown option ${args[index]}. Use --help.`);
    const sourcePath = argument("--source"),
      guardPath = argument("--guard");
    const outputPath = argument("--output");
    if (!sourcePath && !guardPath)
      throw new Error("Provide --source or --guard. Use --help.");
    if (
      outputPath &&
      [sourcePath, guardPath].some(
        (path) => path && resolve(path) === resolve(outputPath),
      )
    )
      throw new Error(
        "Refusing to overwrite a source or historical guard input.",
      );
    let fixtureId = argument("--fixture") ?? "northstar-appointments";
    let source: string | undefined;
    let guardDigest: string | undefined;
    let frozenContractDigests: Record<string, string> | undefined;
    if (guardPath) {
      const raw = await readFile(resolve(guardPath), "utf8");
      guardDigest = digest(raw);
      const guard = JSON.parse(raw) as {
        schema: string;
        scope: string;
        fixtureId: string;
        contractsBySchedule?: Record<string, TemporalContract>;
        patches?: { source: string; afterDigest: string }[];
      };
      if (
        guard.schema !== "passage-journey-guard/v1" ||
        guard.scope !== "authored-fixture"
      )
        throw new Error(
          "Use an authored-fixture guard; arbitrary repository imports are not supported.",
        );
      fixtureId = argument("--fixture") ?? guard.fixtureId;
      if (
        Object.keys(guard.contractsBySchedule ?? {}).length !== 3 ||
        ["baseline", "cancel-pending", "modal-boundary"].some(
          (name) => !Object.hasOwn(guard.contractsBySchedule ?? {}, name),
        )
      )
        throw new Error(
          "The authored guard must retain all three frozen temporal schedules.",
        );
      Object.values(guard.contractsBySchedule ?? {}).forEach(
        validateTemporalContract,
      );
      frozenContractDigests = Object.fromEntries(
        Object.entries(guard.contractsBySchedule ?? {}).map(
          ([key, contract]) => [key, contract.digest],
        ),
      );
      const patch = guard.patches?.at(-1);
      if (patch) {
        if (
          typeof patch.source !== "string" ||
          digest(patch.source) !== patch.afterDigest
        )
          throw new Error(
            "The selected guard source does not match its recorded digest.",
          );
        source = patch.source;
      }
    }
    if (sourcePath) source = await readFile(resolve(sourcePath), "utf8");
    if (!source)
      throw new Error(
        "This guard has no accepted source patch. Supply --source explicitly.",
      );
    const selection = argument("--scenario") ?? "all";
    if (!["baseline", "combined", "all"].includes(selection))
      throw new Error("--scenario must be baseline, combined, or all.");
    const scenarios = scenarioDefinitions.filter((item) =>
      selection === "all"
        ? ["baseline", "combined"].includes(item.id)
        : item.id === selection,
    );
    const report = await checkAuthoredPreservation({
      source,
      fixtureId,
      scenarios,
    });
    const payload = {
      ...report,
      input: {
        kind: sourcePath ? "source-file" : "accepted-guard-source",
        ...(guardDigest
          ? {
              guardDigest,
              frozenContractDigests,
              historicalAcceptance:
                "Unchanged; these additional preservation checks do not rewrite the frozen-contract record.",
            }
          : {}),
      },
    };
    const output = {
      ...payload,
      integrity: {
        algorithm: "sha256",
        contentDigest: digest(JSON.stringify(payload)),
        traceDigests: report.runs.map((run) => ({
          runId: run.id,
          digest: digest(JSON.stringify(run.trace)),
        })),
      },
    };
    const json = `${JSON.stringify(output, null, 2)}\n`;
    if (outputPath) {
      await mkdir(dirname(resolve(outputPath)), { recursive: true });
      await writeFile(resolve(outputPath), json);
    }
    process.stdout.write(json);
    process.exitCode = report.passed ? 0 : 1;
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({ schema: "passage-authored-preservation-error/v1", error: error instanceof Error ? error.message : String(error) })}\n`,
    );
    process.exitCode = 2;
  }
}
