import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";

test("a judge can reproduce, apply an explicit reference repair, challenge, and export real evidence", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Try a blocked journey" }).click();
  await expect(
    page.getByRole("heading", { name: "What should someone be able to do?" }),
  ).toBeVisible();
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Start the journey", exact: true })
    .click();
  await expect(page).toHaveURL(/\/repairs\/repair_/);
  const runId = new URL(page.url()).pathname.split("/")[2];
  await expect(
    page.getByRole("button", { name: "Generate repair", exact: true }),
  ).toBeEnabled({ timeout: 45000 });
  const before = await (await request.get(`/v1/repairs/${runId}`)).json();
  expect(before.baseline.passed).toBe(false);
  expect(before.baseline.outcome).toBeNull();
  await page.locator("#repair-mode").selectOption("offline");
  await page
    .getByRole("button", { name: "Generate repair", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Challenge this repair", exact: true }),
  ).toBeVisible({ timeout: 45000 });
  const after = await (await request.get(`/v1/repairs/${runId}`)).json();
  const candidate = after.candidates.find(
    (item: { id: string }) => item.id === after.activeCandidateId,
  );
  expect(candidate.receipt.live).toBe(false);
  expect(candidate.receipt.provider).toBe("offline-fixture");
  expect(candidate.verification.passed).toBe(true);
  expect(candidate.verification.outcome.sourceDigest).toBe(candidate.digest);
  expect(candidate.digest).not.toBe(before.baseline.sourceDigest);
  await page
    .getByRole("link", { name: "Challenge this repair", exact: true })
    .click();
  await page.getByRole("radio", { name: /All at once/ }).check();
  await page
    .getByRole("button", { name: "Run this challenge", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await (await request.get(`/v1/repairs/${runId}`)).json()).challenges
          .length,
      { timeout: 45000 },
    )
    .toBe(1);
  const challenged = await (await request.get(`/v1/repairs/${runId}`)).json();
  expect(challenged.challenges[0].passed).toBe(true);
  expect(challenged.challenges[0].scenario.id).toBe("combined");
  await page.goto(`/evidence/${runId}`);
  await expect(
    page.getByText("Human validation pending", { exact: true }).first(),
  ).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download manifest only" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/evidence\.json$/);
  const exported = await (
    await request.get(`/v1/repairs/${runId}/export`)
  ).json();
  expect(exported.humanValidation).toBe("pending");
  expect(exported.automatedSummary.total).toBe(9);
  expect(exported.automatedSummary.challengesPassed).toBe(1);
  const bundleDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download repair bundle", exact: true })
    .click();
  const bundle = await bundleDownload;
  const files = unzipSync(await readFile((await bundle.path())!));
  expect(Object.keys(files).some((name) => name.endsWith(".png"))).toBe(true);
  expect(files["SHA256SUMS"]).toBeDefined();
  const portable = JSON.parse(strFromU8(files["manifest.json"]));
  expect(portable.portable.privateCaptureContentIncluded).toBe(false);
  expect(portable.run.humanObservations).toEqual([]);
  expect(portable.run.baseline.screenshotUrl).toMatch(/^artifacts\//);
});

test("the studio has responsive layouts and no serious automated accessibility violations", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: "Try a blocked journey" }),
  ).toBeVisible();
  for (const width of [390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    results.violations.filter((item) =>
      ["critical", "serious"].includes(item.impact ?? ""),
    ),
  ).toEqual([]);
  await page.goto("/settings");
  const highContrast = page.getByRole("checkbox", { name: /High contrast/ });
  await highContrast.check();
  await page.getByRole("button", { name: /Save preferences/ }).click();
  await expect(
    page.getByText("Preferences saved.", { exact: false }),
  ).toBeVisible();
  await highContrast.uncheck();
  await page.getByRole("button", { name: /Save preferences/ }).click();
});
