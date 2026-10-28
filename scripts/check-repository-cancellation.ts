/** Opt-in integration check: a real fixed-dependency worker, no inference or browser execution. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { applyRepositoryPatch, buildRepository, repositoryRuntime, stopRepositoryPreview, type RepositorySnapshot } from "../engine/repository-worker.js";

const exec = promisify(execFile);
const input = process.argv[2];
if (!input) throw new Error("Usage: tsx scripts/check-repository-cancellation.ts path/to/known-snapshot.json [receipt.json]");
const original = JSON.parse(await readFile(input, "utf8")) as RepositorySnapshot;
// Large valid comments exercise actual input/build startup without changing application behavior.
const padding = `\n/*${"synthetic cancellation integration input ".repeat(9500)}*/\n`;
const snapshot = applyRepositoryPatch(original, Object.fromEntries(original.files.filter(file => /\.[cm]?[jt]sx?$/.test(file.path))
  .map(file => [file.path, file.content + padding])));
const runtime = await repositoryRuntime(), controller = new AbortController();
let settled = false, container: string | undefined, runningObserved = false;
const startedAt = new Date().toISOString();
const build = buildRepository({ snapshot, signal: controller.signal }).then(
  value => { settled = true; return { accepted: true as const, buildId: value.id }; },
  error => { settled = true; return { accepted: false as const, error: error instanceof Error ? error.message : String(error) }; },
);
try {
  const deadline = Date.now() + 15000;
  while (!settled && Date.now() < deadline && !runningObserved) {
    // Observe only a Docker child of this check's own process, never another task's container.
    const listing = (await exec("ps", ["-axo", "pid=,ppid=,args="], { timeout: 3000, maxBuffer: 2 * 1024 * 1024 })).stdout;
    for (const line of listing.split("\n")) {
      const child = /^\s*\d+\s+(\d+)\s+(.+)$/.exec(line);
      if (Number(child?.[1]) !== process.pid) continue;
      const own = /\bstart --attach --interactive (passage-repo-[a-f0-9-]+)(?:\s|$)/.exec(child![2]);
      if (!own) continue;
      container = own[1];
      const state = await exec("docker", ["--context", runtime.context, "inspect", container, "--format", "{{.State.Running}}"], { timeout: 3000 }).catch(() => null);
      if (state?.stdout.trim() === "true") { runningObserved = true; controller.abort(new Error("Integration check cancelled after observing its own running container.")); break; }
    }
    if (!runningObserved && !settled) await new Promise(resolve => setTimeout(resolve, 15));
  }
  if (!runningObserved) controller.abort(new Error("Running phase was not observed; the cancellation check is inconclusive."));
  const result = await build;
  const remaining = container ? (await exec("docker", ["--context", runtime.context, "ps", "-a", "--filter", `name=^/${container}$`, "--format", "{{.ID}}"], { timeout: 3000 })).stdout.trim() : "not-observed";
  const passed = runningObserved && !result.accepted && remaining === "";
  const receipt = { schema: "passage.repository-cancellation-check.v1", startedAt, completedAt: new Date().toISOString(),
    evidenceClass: "synthetic-integration", sourceDigest: snapshot.sourceDigest, runtime, runningObserved,
    acceptedLateResult: result.accepted, remainingContainer: remaining || null, result, passed,
    limitations: ["One real cancellation during a fixed worker build; not a hostile-code isolation audit or application acceptance."] };
  if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify(receipt, null, 2));
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  if (!passed) process.exitCode = 1;
} finally { controller.abort(); await build; await stopRepositoryPreview(); }
