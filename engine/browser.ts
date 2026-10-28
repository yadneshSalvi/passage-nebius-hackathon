import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";

export async function chromiumExecutable(): Promise<string | undefined> {
  const configured = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (configured && existsSync(configured)) return configured;
  const pinned = chromium.executablePath();
  if (existsSync(pinned)) return undefined;
  const root =
    process.platform === "darwin"
      ? join(homedir(), "Library/Caches/ms-playwright")
      : join(homedir(), ".cache/ms-playwright");
  const directories = (await readdir(root).catch(() => []))
    .filter((name) => name.startsWith("chromium_headless_shell-"))
    .sort((a, b) => Number(b.split("-").at(-1)) - Number(a.split("-").at(-1)));
  for (const directory of directories) {
    for (const suffix of [
      "chrome-headless-shell-mac-arm64/chrome-headless-shell",
      "chrome-headless-shell-mac-x64/chrome-headless-shell",
      "chrome-linux/headless_shell",
      "chrome-headless-shell-linux64/chrome-headless-shell",
    ]) {
      const path = join(root, directory, suffix);
      if (existsSync(path)) return path;
    }
  }
  return undefined;
}
