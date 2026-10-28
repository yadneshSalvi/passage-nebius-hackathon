import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { zipSync, strToU8 } from "fflate";
import { createHash } from "node:crypto";

/** Portable runner contains the frozen guard, trusted runner and exact lockfile; never credentials or private captures. */
export async function buildJourneyGuardBundle(guard: unknown): Promise<Buffer> {
  const root = new URL("../", import.meta.url);
  const paths = ["package.json", "package-lock.json", "tsconfig.json", "scripts/verify-journey-guard.ts", "scripts/check-authored-preservation.ts",
    "engine/host.ts", "engine/catalog.ts", "engine/safety.ts", "engine/browser.ts", "engine/contract-interpreter.ts",
    "engine/event-scheduler.ts", "engine/trace-recorder.ts", "engine/temporal-fixture.ts", "engine/authored-preservation.ts", "shared/types.ts", "shared/temporal.ts",
    "fixtures/host.tsx", "fixtures/host.css"];
  const files: Record<string, Uint8Array> = {};
  const results = await Promise.all(paths.map(async path => [path, new Uint8Array(await readFile(fileURLToPath(new URL(path, root))))] as const));
  for (const [path, content] of results) files[path] = content;
  const packageValue = JSON.parse(Buffer.from(files["package.json"]).toString("utf8"));
  packageValue.scripts = { "verify:guard": "tsx scripts/verify-journey-guard.ts", "verify:preservation": "tsx scripts/check-authored-preservation.ts" };
  files["package.json"] = strToU8(JSON.stringify(packageValue, null, 2));
  files["guard.json"] = strToU8(JSON.stringify(guard, null, 2));
  files["README.md"] = strToU8(`# Passage journey regression guard\n\nThis package replays the same reviewed bounded contracts against a chosen source revision. It does not contact an inference provider or need the original database.\n\nRequirements: Node.js 22 or newer, npm, and Playwright Chromium. From this folder run:\n\n\`\`\`sh\nnpm ci --ignore-scripts\nnpx playwright install chromium\nnpm run verify:guard -- --source /absolute/path/to/SlotControl.jsx\n\`\`\`\n\nIf guard.json contains an accepted generated patch, --source may be omitted. The exit code is zero only when every required gate passes. Historical frozen-suite-only guards retain that scope. A guard declaring frozen-suite-and-preservation-v1 automatically runs both the frozen schedules and its separate preservation policy, and reports their results separately. Results include actual source/build identities and browser traces. A harmless refactor should pass the same guard; a semantic task change requires a new reviewed contract.\n\nAdditional authored preservation checks have their own version and results; they do not rewrite those frozen assertions or historical acceptance. They exercise pointer booking through actual availability and exact protected outcome checks, plus native-Tab reachability and activation of the existing Close control, under baseline and combined conditions. Run both commands when assessing these additional behaviors:\n\n\`\`\`sh\nnpm run verify:preservation -- --guard guard.json --output preservation.json\n# To check a later source revision against both sets:\nnpm run verify:preservation -- --guard guard.json --source /absolute/path/to/SlotControl.jsx --output later-preservation.json\n\`\`\`\n\nScope: trusted authored React components and a fictional protected appointment service. This is not an arbitrary repository sandbox. Operator-attested review and browser checks are not independent accessibility acceptance or participant evidence.\n`);
  files["SHA256SUMS"] = strToU8(Object.entries(files).map(([path, bytes]) => `${createHash("sha256").update(bytes).digest("hex")}  ${path}`).join("\n") + "\n");
  return Buffer.from(zipSync(files, { level: 6 }));
}
