import { randomUUID } from "node:crypto";
import { chromium, type Page, type Locator } from "@playwright/test";
import type {
  AssertionId,
  CheckResult,
  InteractionContract,
  Observation,
  Scenario,
  VerificationResult,
} from "../shared/types.js";
import { FixtureHost, type FixtureBuild } from "./host.js";
import { chromiumExecutable } from "./browser.js";
import { getFixture } from "./catalog.js";

export interface VerificationRequest {
  build: FixtureBuild;
  contract: InteractionContract;
  scenario: Scenario;
  kind: "baseline" | "candidate" | "challenge";
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}

async function focused(locator: Locator) {
  return locator
    .evaluate((element) => element === element.ownerDocument.activeElement)
    .catch(() => false);
}
async function tabTo(
  page: Page,
  locator: Locator,
  maxTabs = 36,
): Promise<boolean> {
  const seen = new Map<string, number>();
  for (let index = 0; index < maxTabs; index += 1) {
    if ((await locator.count()) && (await focused(locator))) return true;
    await page.keyboard.press("Tab");
    const key = await page.evaluate(() => {
      const element = document.activeElement;
      return element
        ? `${element.tagName}:${element.getAttribute("data-testid") ?? ""}:${element.getAttribute("data-date") ?? ""}:${element.textContent?.slice(0, 35) ?? ""}`
        : "none";
    });
    seen.set(key, (seen.get(key) ?? 0) + 1);
    if ((seen.get(key) ?? 0) > 2) break;
  }
  return (await locator.count()) > 0 && focused(locator);
}

async function optionActive(locator: Locator): Promise<boolean> {
  return locator
    .evaluate((element) => {
      const active = element.ownerDocument.activeElement;
      return (
        active === element ||
        (!!element.id &&
          active?.getAttribute("aria-activedescendant") === element.id)
      );
    })
    .catch(() => false);
}

// A legitimate grid/listbox may have one Tab stop and move its active option with
// arrows. Exercise those actual keys instead of programmatically focusing a cell.
async function reachOption(page: Page, locator: Locator): Promise<boolean> {
  const seen = new Map<string, number>();
  for (let index = 0; index < 30; index += 1) {
    if (await optionActive(locator)) return true;
    const location = await page.evaluate(() => {
      const active = document.activeElement;
      return {
        key: active
          ? `${active.tagName}:${active.id}:${active.getAttribute("data-date")}:${active.getAttribute("data-testid")}`
          : "none",
        composite:
          !!active &&
          (active.hasAttribute("data-date") ||
            active.hasAttribute("aria-activedescendant")),
      };
    });
    if (location.composite && !seen.has(location.key)) {
      for (const key of [
        "Home",
        ...Array(12).fill("ArrowRight"),
        "Home",
        ...Array(12).fill("ArrowDown"),
      ]) {
        await page.keyboard.press(key);
        if (await optionActive(locator)) return true;
      }
    }
    seen.set(location.key, (seen.get(location.key) ?? 0) + 1);
    if ((seen.get(location.key) ?? 0) > 2) break;
    await page.keyboard.press("Tab");
  }
  return optionActive(locator);
}

export async function verifyFixture(
  host: FixtureHost,
  request: VerificationRequest,
): Promise<VerificationResult> {
  request.signal?.throwIfAborted();
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const fixture = getFixture(request.build.fixtureId);
  const session = await host.createSession(request.build, request.scenario);
  const observations: Observation[] = [];
  const checks: CheckResult[] = [];
  const artifacts: VerificationResult["artifacts"] = [];
  const observe = (
    kind: Observation["kind"],
    label: string,
    detail: string,
    evidenceType: Observation["evidenceType"] = "browser",
    focus?: string,
  ) => {
    observations.push({
      sequence: observations.length + 1,
      at: new Date().toISOString(),
      kind,
      label,
      detail,
      focus,
      source: fixture.sourceFile,
      evidenceType,
    });
  };
  const record = (
    id: AssertionId,
    passed: boolean,
    expected: string,
    actual: string,
    since: number,
  ) => {
    const assertion = request.contract.assertions.find(
      (item) => item.id === id,
    );
    if (!assertion?.enabled) return;
    checks.push({
      id,
      label: assertion.label,
      status: passed ? "passed" : "failed",
      expected,
      actual,
      durationMs: Math.max(0, Date.now() - since),
      evidenceType: assertion.evidenceType,
    });
    observe(
      "assertion",
      `${passed ? "Passed" : "Failed"} · ${assertion.label}`,
      actual,
      assertion.evidenceType,
    );
  };
  request.onProgress?.(
    "Starting an isolated Chromium session for the exact source digest.",
  );
  const browser = await chromium.launch({
    headless: true,
    executablePath: await chromiumExecutable(),
    timeout: 20000,
    args: ["--disable-dev-shm-usage"],
  });
  const browserVersion = browser.version();
  const context = await browser.newContext({
    viewport: { width: 1120, height: 920 },
    locale: session.scenario.locale === "de" ? "de-DE" : "en-GB",
    reducedMotion: "reduce",
    serviceWorkers: "block",
    acceptDownloads: false,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(1600);
  page.setDefaultNavigationTimeout(10000);
  let timedOut = false;
  const abort = () => {
    void context.close().catch(() => undefined);
    void browser.close().catch(() => undefined);
  };
  request.signal?.addEventListener("abort", abort, { once: true });
  if (request.signal?.aborted) abort();
  const timeout = setTimeout(() => {
    timedOut = true;
    abort();
  }, 45000);
  const alive = () => {
    request.signal?.throwIfAborted();
    if (timedOut)
      throw new Error(
        "The independent browser verification exceeded its 45-second budget.",
      );
  };
  try {
    alive();
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      return url.origin === host.origin
        ? route.continue()
        : route.abort("blockedbyclient");
    });
    await page.exposeBinding(
      "__passageFocus",
      (_source, payload: { label: string; tag: string }) => {
        observe(
          "focus",
          `Focus · ${payload.label || payload.tag}`,
          "Observed browser focus event; not screen-reader speech.",
          "browser",
          payload.label || payload.tag,
        );
      },
    );
    await page.addInitScript(() => {
      document.addEventListener("focusin", (event) => {
        const node = event.target as HTMLElement;
        const label =
          node.getAttribute("aria-label") ??
          node.getAttribute("data-testid") ??
          node.textContent?.trim().slice(0, 100) ??
          "";
        const bridge = (
          window as unknown as {
            __passageFocus?: (value: { label: string; tag: string }) => void;
          }
        ).__passageFocus;
        bridge?.({ label, tag: node.tagName.toLowerCase() });
      });
    });
    await page.goto(`${host.origin}/s/${session.id}`);
    await page.getByTestId("application-ready").waitFor();
    observe(
      "dom",
      "Original application opened",
      `Rendered build ${request.build.id.slice(0, 12)}; source ${request.build.digest.slice(0, 12)}.`,
    );
    const screenshotBefore = await host.putArtifact(
      "Application before interaction",
      await page.screenshot({ fullPage: true }),
      "image/png",
    );
    artifacts.push(screenshotBefore);
    request.onProgress?.(
      "Checking required fields and unavailable dates against the protected appointment service.",
    );

    // These direct service probes are isolated from the component. The component cannot redefine the oracle.
    let since = Date.now();
    const blank = await host.submitAppointment(session.id, {
      date: session.choices[0].date,
      attendee: "",
    });
    const missingDate = await host.submitAppointment(session.id, {
      date: "",
      attendee: "Alex Morgan",
    });
    const confirm = page.getByTestId("confirm-appointment");
    const submitReachable = await tabTo(page, confirm);
    if (submitReachable) await page.keyboard.press("Enter");
    const requiredErrorVisible = await page
      .getByTestId("validation-error")
      .isVisible()
      .catch(() => false);
    const requiredErrorAnnounced =
      requiredErrorVisible &&
      (await page.getByTestId("validation-error").getAttribute("role")) ===
        "alert";
    record(
      "required_validation_preserved",
      blank.status === 422 &&
        missingDate.status === 422 &&
        !session.outcome &&
        requiredErrorVisible,
      "Empty required name or date is rejected; no appointment is stored.",
      `Service returned ${blank.status}/${missingDate.status}; required-field error ${requiredErrorVisible ? "visible" : "missing"}; stored appointment: ${session.outcome ? "present" : "none"}.`,
      since,
    );
    since = Date.now();
    const unavailable = session.choices.find((choice) => choice.unavailable)!;
    const invalid = await host.submitAppointment(session.id, {
      date: unavailable.date,
      attendee: "Alex Morgan",
    });
    record(
      "unavailable_slot_rejected",
      invalid.status === 422 && !session.outcome,
      "An unavailable date is rejected by the independent service.",
      `Saving ${unavailable.date} returned ${invalid.status}; no booking was created.`,
      since,
    );
    await page.reload();
    await page.getByTestId("slot-trigger").waitFor();
    alive();

    request.onProgress?.(
      "Replaying the actual keyboard journey and observing focus at each transition.",
    );
    since = Date.now();
    const trigger = page.getByTestId("slot-trigger");
    const triggerReachable = await tabTo(page, trigger);
    const triggerName = await trigger.evaluate(
      (element) =>
        element.getAttribute("aria-label") || element.textContent?.trim() || "",
    );
    record(
      "control_keyboard_reachable",
      triggerReachable && !!triggerName,
      "Tab reaches a named appointment control.",
      triggerReachable
        ? `Tab reached “${triggerName.slice(0, 120)}”.`
        : "Tab navigation could not reach the appointment control.",
      since,
    );
    // Opening explores choices; capture the protected value before its handler.
    const valueBeforeOpening = await page
      .getByTestId("selected-date")
      .inputValue();
    if (triggerReachable) {
      observe(
        "action",
        "Open appointment choices",
        "Pressed Enter on the appointment control.",
      );
      await page.keyboard.press("Enter");
    }
    await page
      .getByTestId("slot-panel")
      .waitFor({ state: "visible", timeout: 1000 })
      .catch(() => undefined);
    since = Date.now();
    const valueAfterOpening = await page
      .getByTestId("selected-date")
      .inputValue();
    const openingKeptValue = valueAfterOpening === valueBeforeOpening;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(40);
    const escapeClosed = !(await page
      .getByTestId("slot-panel")
      .isVisible()
      .catch(() => false));
    const escapeReturned = await focused(trigger);
    const escapeKeptValue =
      (await page.getByTestId("selected-date").inputValue()) ===
      valueBeforeOpening;
    record(
      "dialog_escape",
      openingKeptValue && escapeClosed && escapeReturned && escapeKeptValue,
      "Opening does not commit a date; Escape closes the picker, preserves the pre-open value, and returns focus.",
      `Opening ${openingKeptValue ? "preserved the value" : "unexpectedly committed a value"}; picker ${escapeClosed ? "closed" : "remained open"}; focus ${escapeReturned ? "returned to trigger" : "did not return to trigger"}; pre-open value ${escapeKeptValue ? "preserved" : "unexpectedly changed"}.`,
      since,
    );
    // A failed Escape check must not prevent an independent check of selection.
    await page.reload();
    await page.getByTestId("slot-trigger").waitFor();
    await tabTo(page, trigger);
    const selectionValueBeforeOpening = await page
      .getByTestId("selected-date")
      .inputValue();
    await page.keyboard.press("Enter");
    await page
      .getByTestId("slot-panel")
      .waitFor({ state: "visible", timeout: 1000 })
      .catch(() => undefined);

    since = Date.now();
    const selectionOpeningKeptValue =
      (await page.getByTestId("selected-date").inputValue()) ===
      selectionValueBeforeOpening;
    let wanted = session.choices.find((choice) => !choice.unavailable)!;
    let selectedViaKeys = false;
    let committedBeforeActivation = !selectionOpeningKeptValue;
    let recoveryReachable = true;
    let errorAnnounced = requiredErrorAnnounced;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      alive();
      wanted = session.choices.find(
        (choice) =>
          !choice.unavailable && !session.rejectedDates.includes(choice.date),
      )!;
      const option = page.locator(`[data-date="${wanted.date}"]`).first();
      const optionReachable = await reachOption(page, option);
      if (!optionReachable) {
        observe(
          "action",
          "Selection blocked",
          `Keyboard traversal never reached the available date ${wanted.label}.`,
        );
        break;
      }
      const valueBeforeActivation = await page
        .getByTestId("selected-date")
        .inputValue();
      const choiceWasUncommitted = valueBeforeActivation !== wanted.date;
      if (!choiceWasUncommitted) {
        committedBeforeActivation = true;
        observe(
          "business",
          "Date committed before activation",
          `The protected value was already ${wanted.date} before Enter on the available choice.`,
        );
      }
      observe(
        "action",
        "Choose an available date",
        `Pressed Enter on ${wanted.label}.`,
      );
      await page.keyboard.press("Enter");
      if (fixture.family === "modal-wizard") {
        const next = page.getByTestId("wizard-next");
        await next
          .waitFor({ state: "visible", timeout: 1000 })
          .catch(() => undefined);
        recoveryReachable = await tabTo(page, next);
        if (!recoveryReachable) {
          observe(
            "action",
            "Review step blocked",
            "The date was chosen, but the next-step control could not be reached or activated by keyboard.",
          );
          break;
        }
        await page.keyboard.press("Enter");
      }
      if (fixture.family === "async-validation") {
        await page.waitForTimeout(session.scenario.delayedValidationMs + 100);
        const retry = page.getByTestId("retry-selection");
        if (await retry.isVisible().catch(() => false)) {
          errorAnnounced = await page
            .getByRole("alert")
            .isVisible()
            .catch(() => false);
          observe(
            "dom",
            "Late availability error",
            `${errorAnnounced ? "Alert semantics were present" : "Alert semantics were missing"} when the server rejected the appointment.`,
          );
          recoveryReachable = await tabTo(page, retry);
          if (!recoveryReachable) {
            observe(
              "action",
              "Error recovery blocked",
              "The recovery control was visible but keyboard navigation could not activate it.",
            );
            break;
          }
          await page.keyboard.press("Enter");
          await page.waitForTimeout(35);
          continue;
        }
      }
      // A valid handler in any interaction family may await the protected service.
      // Wait for observed state, rather than treating a 35 ms snapshot as failure.
      await page
        .waitForFunction(
          (expectedDate) => {
            const value = document.querySelector<HTMLInputElement>(
              '[data-testid="selected-date"]',
            )?.value;
            return value === expectedDate;
          },
          wanted.date,
          {
            timeout: Math.max(
              1800,
              session.scenario.delayedValidationMs + 1200,
            ),
          },
        )
        .catch(() => undefined);
      const selected = await page.getByTestId("selected-date").inputValue();
      selectedViaKeys = !committedBeforeActivation && selected === wanted.date;
      break;
    }
    const chosenValue = await page.getByTestId("selected-date").inputValue();
    record(
      "selection_keyboard_operable",
      selectedViaKeys && recoveryReachable,
      `Opening preserves the prior value; actual keyboard activation commits the intended available date, ${wanted.date}.`,
      selectedViaKeys
        ? `The keyboard selected ${chosenValue}${fixture.family === "async-validation" ? " after a real server rejection and recovery" : ""}.`
        : committedBeforeActivation
          ? `A date was committed on opening or before the intended keyboard activation. Current value: ${chosenValue || "empty"}.`
          : `Selection did not complete with the keyboard. Current value: ${chosenValue || "empty"}.`,
      since,
    );
    since = Date.now();
    const triggerFocused = await focused(trigger);
    const restored = selectedViaKeys && triggerFocused;
    record(
      "focus_restored",
      restored,
      "After choosing a date, focus returns to its appointment trigger.",
      restored
        ? "The trigger is the actual activeElement after selection."
        : !selectedViaKeys && triggerFocused
          ? "The trigger is focused, but a valid keyboard selection was not established."
          : `Focus did not return after a completed selection${selectedViaKeys ? "" : " because selection remained blocked"}.`,
      since,
    );
    record(
      "error_announced",
      errorAnnounced,
      "Required and late validation errors expose alert/live-region semantics.",
      errorAnnounced
        ? "The observed validation messages had alert semantics. Screen-reader speech has not been recorded."
        : "A visible error lacked alert semantics. Actual screen-reader output has not been recorded.",
      since,
    );
    const screenshotInteraction = await host.putArtifact(
      selectedViaKeys ? "Selection completed" : "Blocked interaction",
      await page.screenshot({ fullPage: true }),
      "image/png",
    );
    artifacts.push(screenshotInteraction);
    const selectionSnapshot = await page.locator("body").ariaSnapshot();
    artifacts.push(
      await host.putArtifact(
        "Selection accessibility snapshot",
        selectionSnapshot,
        "text/plain",
      ),
    );

    request.onProgress?.(
      "Checking the saved appointment against the selected date and confirmation focus.",
    );
    since = Date.now();
    const name = page.getByTestId("attendee-input");
    if (await tabTo(page, name))
      await page.keyboard.type("Alex Morgan", { delay: 3 });
    if (await tabTo(page, confirm)) {
      observe(
        "action",
        "Confirm appointment",
        "Pressed Enter on Confirm appointment after entering the fictional name.",
      );
      await page.keyboard.press("Enter");
    }
    if (chosenValue)
      await page
        .getByTestId("confirmation")
        .waitFor({ timeout: session.scenario.delayedValidationMs + 2500 })
        .catch(() => undefined);
    const saved = (await host.getSession(session.id)).outcome;
    const outcomeMatches =
      !!saved &&
      selectedViaKeys &&
      saved.date === wanted.date &&
      saved.date === chosenValue &&
      saved.attendee === "Alex Morgan" &&
      saved.sourceDigest === request.build.digest;
    record(
      "correct_outcome_persisted",
      outcomeMatches,
      "The protected backend record matches the requested available date, name, and source digest.",
      saved
        ? `Saved ${saved.date} for ${saved.attendee}; record ${saved.id}; ${outcomeMatches ? "all outcome fields match" : "outcome mismatch"}.`
        : "No appointment was saved. The task is incomplete.",
      since,
    );
    if (saved)
      observe(
        "business",
        "Appointment persisted",
        `Record ${saved.id} stores ${saved.date} for ${saved.attendee}.`,
        "backend",
      );
    since = Date.now();
    const confirmationFocused = await focused(
      page.getByTestId("confirmation-heading"),
    );
    record(
      "confirmation_focus",
      outcomeMatches && confirmationFocused,
      "After a real successful save, focus lands on the confirmation heading.",
      confirmationFocused
        ? "The confirmation heading is the actual activeElement."
        : "The confirmation heading did not receive focus.",
      since,
    );
    alive();

    const finalScreenshot = await host.putArtifact(
      "Final application state",
      await page.screenshot({ fullPage: true }),
      "image/png",
    );
    artifacts.push(finalScreenshot);
    const ariaSnapshot = await page.locator("body").ariaSnapshot();
    artifacts.push(
      await host.putArtifact(
        "Final accessibility snapshot",
        ariaSnapshot,
        "text/plain",
      ),
    );
    artifacts.push(
      await host.putArtifact(
        "Observed keyboard and focus trace",
        JSON.stringify(observations, null, 2),
        "application/json",
      ),
    );
    artifacts.push(
      await host.putArtifact(
        "Independent appointment outcome",
        JSON.stringify(
          {
            sessionId: session.id,
            sourceDigest: request.build.digest,
            chosenDate: chosenValue,
            outcome: saved,
          },
          null,
          2,
        ),
        "application/json",
      ),
    );
    artifacts.push(
      await host.putArtifact(
        "Immutable build receipt",
        JSON.stringify(
          {
            buildId: request.build.id,
            sourceDigest: request.build.digest,
            bundleDigest: request.build.bundleDigest,
            cssDigest: request.build.cssDigest,
            toolchainDigest: request.build.toolchainDigest,
            fixtureId: fixture.id,
          },
          null,
          2,
        ),
        "application/json",
      ),
    );
    const passed =
      checks.length > 0 && checks.every((check) => check.status === "passed");
    const result: VerificationResult = {
      verifierVersion: "passage-browser-v3",
      id: randomUUID(),
      fixtureId: fixture.id,
      kind: request.kind,
      sourceDigest: request.build.digest,
      contractDigest: request.contract.digest,
      scenario: session.scenario,
      status: passed ? "passed" : "failed",
      passed,
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      browser: "Chromium",
      browserVersion,
      checks,
      observations,
      outcome: saved,
      previewUrl: `${request.build.previewUrl}?scenario=${request.scenario.id}`,
      buildId: request.build.id,
      screenshotUrl: finalScreenshot.url,
      ariaSnapshot,
      artifacts,
      limitations: [
        "Automated keyboard and DOM evidence only; actual screen-reader output is not recorded.",
        "No consenting participant trial or independent specialist review has been completed.",
        "Authored development fixtures share component ancestry; these scenarios are not a held-out benchmark.",
        "Scoped component adapter only. Arbitrary repository builds require a separate isolated worker.",
      ],
    };
    return result;
  } catch (error) {
    request.signal?.throwIfAborted();
    if (timedOut)
      throw new Error(
        "Browser verification exceeded its 45-second budget. No success was recorded.",
      );
    throw error;
  } finally {
    clearTimeout(timeout);
    request.signal?.removeEventListener("abort", abort);
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}
