import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { zipSync, strToU8 } from "fflate";
import { createHash } from "node:crypto";
export async function buildRepositoryGuardBundle(guard: unknown): Promise<Buffer> {
  const root = new URL("../", import.meta.url);
  const paths = ["package.json", "package-lock.json", "tsconfig.json", "scripts/verify-repository-guard.ts",
    "engine/repository-worker.ts", "engine/browser.ts", "engine/contract-interpreter.ts", "engine/trace-recorder.ts", "engine/event-scheduler.ts", "shared/temporal.ts",
    "scripts/repository-worker-setup.sh", "scripts/repository-worker-image/Dockerfile", "scripts/repository-worker-image/build.mjs",
    "scripts/repository-worker-image/package.json", "scripts/repository-worker-image/package-lock.json"];
  const files: Record<string, Uint8Array> = {};
  for (const [path, bytes] of await Promise.all(paths.map(async path => [path, new Uint8Array(await readFile(fileURLToPath(new URL(path, root))))] as const))) files[path] = bytes;
  const packageValue = JSON.parse(Buffer.from(files["package.json"]).toString("utf8"));
  packageValue.scripts = { "verify:repository-guard": "tsx scripts/verify-repository-guard.ts" };
  files["package.json"] = strToU8(JSON.stringify(packageValue, null, 2));
  files["guard.json"] = strToU8(JSON.stringify(guard, null, 2));
  for (const notice of (guard as { sourceNotices?: { name: string; content: string }[] }).sourceNotices ?? []) {
    if (!/^[A-Za-z0-9_.-]+$/.test(notice.name)) throw new Error("Unsafe source notice name.");
    files[`licenses/${notice.name}`] = strToU8(notice.content);
  }
  files["README.md"] = strToU8(`# Passage repository regression guard\n\nThe frozen typed contract is outside the repository patch scope. The package contains exact source, patch and evidence history; it contains no provider credentials or original database.\n\nUse Node.js22+, npm, Playwright Chromium and an explicit Linux Docker context running inside your approved disposable boundary. The worker uses a fixed locked dependency catalog, no repository scripts, no host mounts, no network at build time, bounded resources and an unprivileged user.\n\n\`\`\`sh\nnpm ci --ignore-scripts\nnpx playwright install chromium\nPASSAGE_REPOSITORY_CONTEXT=YOUR_DOCKER_CONTEXT sh scripts/repository-worker-setup.sh\nnpm run verify:repository-guard -- --guard guard.json\n# Or recheck a later immutable source manifest:\nnpm run verify:repository-guard -- --guard guard.json --snapshot next-snapshot.json\n\`\`\`\n\nA changed application adapter requires a new reviewed contract. The exit code is zero only when every required check runs and passes. This portable entry point has no protected outcome observer; an outcome assertion errors instead of being skipped. Browser UI success alone is not business completion. Uploaded manifests are self-consistent source identities. Local Git-blob inspection establishes local commit bytes and a configured remote; public upstream ancestry requires separate upstream verification. Review provenance and any limitations remain in guard.json.\n`);
  files["SHA256SUMS"] = strToU8(Object.entries(files).map(([path, bytes]) => `${createHash("sha256").update(bytes).digest("hex")}  ${path}`).join("\n") + "\n");
  return Buffer.from(zipSync(files, { level: 6 }));
}
