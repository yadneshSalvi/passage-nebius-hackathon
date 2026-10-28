import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { chromiumExecutable } from "../engine/browser.js";
import { applyRepositoryPatch, buildRepository, startRepositoryPreview, stopRepositoryPreview, validateRepositorySnapshot, type RepositorySnapshot } from "../engine/repository-worker.js";
import { executeContract, validateTemporalContract } from "../engine/contract-interpreter.js";
import type { TemporalContract } from "../shared/temporal.js";

const args = process.argv.slice(2);
const argument = (name: string) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const guard = JSON.parse(await readFile(resolve(argument("--guard") ?? "guard.json"), "utf8")) as {
  schema: string; source: RepositorySnapshot; contract: TemporalContract; patches: { path: string; source: string }[];
};
if (guard.schema !== "passage-repository-guard/v1") throw new Error("Expected an exported immutable repository journey guard.");
validateRepositorySnapshot(guard.source); validateTemporalContract(guard.contract);
const nextPath = argument("--snapshot");
const snapshot = nextPath ? JSON.parse(await readFile(resolve(nextPath), "utf8")) as RepositorySnapshot : applyRepositoryPatch(guard.source, Object.fromEntries(guard.patches.map(patch => [patch.path, patch.source])));
validateRepositorySnapshot(snapshot);
const boundary = (value: RepositorySnapshot) => JSON.stringify({
  repositoryUrl: value.repositoryUrl, entryPoint: value.entryPoint, rootElementId: value.rootElementId,
  rootElementClass: value.rootElementClass ?? "", bootstrap: value.bootstrap
    ? [value.bootstrap.source, value.bootstrap.description, value.bootstrap.sha256] : null,
  moduleAliases: Object.entries(value.moduleAliases ?? {}).sort(([a], [b]) => a.localeCompare(b)),
});
if (boundary(snapshot) !== boundary(guard.source)) throw new Error("Later revision changed the protected adapter boundary; a new reviewed guard is required.");
if (guard.contract.allowedEvents.length) throw new Error("This portable static adapter cannot execute application event drivers.");
await startRepositoryPreview(0);
const build = await buildRepository({ snapshot });
const browser = await chromium.launch({ headless: true, executablePath: await chromiumExecutable() });
const context = await browser.newContext({ serviceWorkers: "block", acceptDownloads: false, reducedMotion: "reduce" });
try {
  const origin = new URL(build.previewUrl).origin;
  await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort("blockedbyclient"));
  const page = await context.newPage();
  await page.goto(build.previewUrl, { waitUntil: "domcontentloaded", timeout: 12000 });
  const execution = await executeContract({ page, contract: guard.contract,
    identity: { sourceDigest: build.sourceDigest, buildId: build.id, sessionId: "portable-guard", adapter: "external-react-static-v1" } });
  process.stdout.write(`${JSON.stringify({ schema: "passage-repository-guard-replay/v1", build, execution, businessOutcome: "not-configured", limitations: ["No protected observer was supplied. Any outcome assertion errors rather than silently passing.", "This checks the supplied manifest; self-declared revision identity does not prove upstream source ancestry."] }, null, 2)}\n`);
  process.exitCode = execution.passed ? 0 : 1;
} finally { await context.close(); await browser.close(); await stopRepositoryPreview(); }
