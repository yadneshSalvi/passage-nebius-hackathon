import { defineConfig } from "@playwright/test";
import { chromiumExecutable } from "./engine/browser.js";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:4101",
    browserName: "chromium",
    headless: true,
    viewport: { width: 1440, height: 1000 },
    contextOptions: { reducedMotion: "reduce" },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: { executablePath: await chromiumExecutable() },
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:4101",
    timeout: 120000,
    reuseExistingServer: !process.env.CI,
    env: { PASSAGE_ALLOW_LIVE: "false" },
  },
});
