import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type Response,
} from "@playwright/test";
import { FixtureHost, type FixtureBuild, type FixtureSession } from "./host.js";
import { chromiumExecutable } from "./browser.js";
import { digest, getFixture, scenarioDefinitions } from "./catalog.js";
import { validateCandidateSource } from "./safety.js";
import { recordTrace, type TraceRecorder } from "./trace-recorder.js";
import type { BackendOutcome, Scenario } from "../shared/types.js";
import type { TemporalTraceEvent } from "../shared/temporal.js";

export const AUTHORED_PRESERVATION_VERSION =
  "passage-authored-preservation-v2-cancellation";
export type PreservationKind = "pointer-booking" | "close-control-keyboard";
export interface PreservationCheck {
  id: string;
  label: string;
  status: "passed" | "failed" | "not-run";
  expected: string;
  actual: string;
}
export interface NativeFocusObservation {
  step: number;
  closeFocused: boolean;
  triggerFocused: boolean;
  testId: string | null;
  date: string | null;
  label: string | null;
  text: string;
}
export interface AuthoredPreservationRun {
  id: string;
  kind: PreservationKind;
  status: "passed" | "failed" | "error" | "cancelled";
  passed: boolean;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  identity: {
    sourceDigest: string;
    buildId: string;
    bundleDigest: string;
    toolchainDigest: string;
    fixtureId: string;
    sessionId: string;
    browser: string;
    browserVersion: string;
  };
  scenario: Scenario;
  intendedDate: string;
  attendee: string;
  checks: PreservationCheck[];
  trace: TemporalTraceEvent[];
  focus: NativeFocusObservation[];
  selectedValueBefore: string;
  selectedValueAfter: string | null;
  service: {
    availabilityChecks: number;
    validatedDates: string[];
    outcomeCount: number;
    outcomes: BackendOutcome[];
  };
  error?: string;
  cleanup?: {
    browserDisconnected: boolean;
    contextClosed: boolean;
    traceStopped: boolean;
    error?: string;
  };
  limitations: string[];
}
export interface AuthoredPreservationReport {
  schema: "passage-authored-preservation/v1";
  verifierVersion: typeof AUTHORED_PRESERVATION_VERSION;
  startedAt: string;
  completedAt: string;
  passed: boolean;
  cancelled?: boolean;
  cleanupError?: string;
  expectedRunCount: number;
  completedRunCount: number;
  source: { digest: string; content: string; fixtureId: string };
  build: FixtureBuild;
  bounds: { actionTimeoutMs: number; maxTabPresses: number };
  runs: AuthoredPreservationRun[];
  limitations: string[];
}
const limitations = [
  "Additional authored-fixture preservation checks; historical frozen-contract acceptance is unchanged.",
  "Each check uses a fresh Chromium process, browser context, and protected fictional service session.",
  "Focus acceptance uses Playwright utility-world locator queries and native :focus, never page-main-world activeElement getters.",
  "Finite pointer and forward-Tab paths are not exhaustive accessibility, actual AT, participant, or formal-verification evidence.",
  "Trace page instrumentation is lower-trust context; acceptance comes from controller actions, native locator state and the protected FixtureHost.",
];
const definitions: Record<
  PreservationKind,
  { id: string; label: string; expected: string }[]
> = {
  "pointer-booking": [
    {
      id: "pointer-opens-dialog",
      label: "Pointer opens the calendar",
      expected: "The original date trigger opens the actual calendar.",
    },
    {
      id: "enabled-intended-choice",
      label: "Intended date is enabled",
      expected: "The protected scenario supplies an enabled intended date.",
    },
    {
      id: "availability-request-response",
      label: "Pointer activation checks real availability",
      expected:
        "A real successful availability request and available response match the explicit date.",
    },
    {
      id: "pointer-selection-committed",
      label: "Pointer commits the intended choice",
      expected: "The selected-date value matches the explicit available date.",
    },
    {
      id: "pointer-confirmation",
      label: "Pointer confirmation stores an appointment",
      expected:
        "The fictional attendee and date reach the protected appointment endpoint.",
    },
    {
      id: "exact-single-outcome",
      label: "Exactly one correct protected outcome",
      expected:
        "One stored result matches session, source, service, explicit date and fictional attendee.",
    },
  ],
  "close-control-keyboard": [
    {
      id: "keyboard-opens-dialog",
      label: "Keyboard opens the calendar",
      expected:
        "Native Tab reaches the trigger; Enter opens the actual calendar.",
    },
    {
      id: "close-reachable-by-tab",
      label: "Native Tab reaches the Close control",
      expected:
        "The actual Close calendar button receives native focus within the declared Tab bound.",
    },
    {
      id: "close-activated-with-enter",
      label: "Enter activates the Close control",
      expected: "Pressing Enter with actual Close focus closes the calendar.",
    },
    {
      id: "close-restores-trigger",
      label: "Close restores native trigger focus",
      expected: "The surviving original trigger has browser-native focus.",
    },
    {
      id: "close-preserves-value",
      label: "Closing preserves the prior selection",
      expected:
        "Opening, tabbing and closing do not commit or change a selection.",
    },
    {
      id: "close-does-not-book",
      label: "Closing stores no booking",
      expected: "The protected service has no appointment outcome.",
    },
  ],
};
class ObservedBarrier extends Error {}
const deadline = async (
  condition: () => Promise<boolean>,
  milliseconds: number,
) => {
  const until = Date.now() + milliseconds;
  do {
    if (await condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  } while (Date.now() < until);
  return false;
};
interface StopResult {
  ok: boolean;
  error?: string;
}
async function stopWithin(
  operation: () => Promise<unknown>,
  milliseconds: number,
): Promise<StopResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve()
        .then(operation)
        .then(
          () => ({ ok: true }),
          (error) => ({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        ),
      new Promise<StopResult>((resolve) => {
        timer = setTimeout(
          () =>
            resolve({
              ok: false,
              error: `Cleanup exceeded ${milliseconds}ms.`,
            }),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function nativeFocused(page: Page, target: Locator) {
  return (await target.and(page.locator(":focus")).count()) === 1;
}
async function nativeFocus(
  page: Page,
  trigger: Locator,
  close: Locator,
  step: number,
): Promise<NativeFocusObservation> {
  const focused = page.locator(":focus").first();
  const exists = (await focused.count()) === 1;
  return {
    step,
    closeFocused: await nativeFocused(page, close),
    triggerFocused: await nativeFocused(page, trigger),
    testId: exists ? await focused.getAttribute("data-testid") : null,
    date: exists ? await focused.getAttribute("data-date") : null,
    label: exists ? await focused.getAttribute("aria-label") : null,
    text: exists
      ? (await focused.innerText().catch(() => "")).slice(0, 500)
      : "",
  };
}
async function responseAt(
  page: Page,
  url: string,
  date: string,
  timeout: number,
): Promise<Response | null> {
  const started = Date.now();
  // Observe a new request after this action boundary; a response belonging to
  // an earlier open/focus request cannot stand in for this activation.
  const request = await page
    .waitForRequest(
      (candidate) => {
        if (candidate.url() !== url || candidate.method() !== "POST")
          return false;
        try {
          return candidate.postDataJSON()?.date === date;
        } catch {
          return false;
        }
      },
      { timeout },
    )
    .catch(() => null);
  if (!request) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      request.response().catch(() => null),
      new Promise<null>((resolve) => {
        timer = setTimeout(
          () => resolve(null),
          Math.max(1, timeout - (Date.now() - started)),
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function snapshotService(
  session: FixtureSession,
): AuthoredPreservationRun["service"] {
  return {
    availabilityChecks: session.availabilityChecks,
    validatedDates: [...session.validatedDates],
    outcomeCount: session.outcome ? 1 : 0,
    outcomes: session.outcome ? [structuredClone(session.outcome)] : [],
  };
}

async function runCheck(
  host: FixtureHost,
  build: FixtureBuild,
  scenario: Scenario,
  kind: PreservationKind,
  actionTimeoutMs: number,
  maxTabPresses: number,
  signal?: AbortSignal,
): Promise<AuthoredPreservationRun> {
  signal?.throwIfAborted();
  const started = Date.now();
  const id = randomUUID();
  const session = await host.createSession(build, scenario);
  const choice = session.choices.find((item) => !item.unavailable);
  if (!choice)
    throw new Error(
      "The protected authored scenario has no available intended date.",
    );
  const result: AuthoredPreservationRun = {
    id,
    kind,
    status: "error",
    passed: false,
    startedAt: new Date().toISOString(),
    completedAt: "",
    durationMs: 0,
    identity: {
      sourceDigest: build.digest,
      buildId: build.id,
      bundleDigest: build.bundleDigest,
      toolchainDigest: build.toolchainDigest,
      fixtureId: build.fixtureId,
      sessionId: session.id,
      browser: "Chromium",
      browserVersion: "",
    },
    scenario: structuredClone(session.scenario),
    intendedDate: choice.date,
    attendee: "Preservation Pointer",
    checks: [],
    trace: [],
    focus: [],
    selectedValueBefore: "",
    selectedValueAfter: null,
    service: snapshotService(session),
    limitations: [
      ...limitations,
      `Close reachability is bounded to ${maxTabPresses} native forward Tab presses.`,
    ],
  };
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let recorder: TraceRecorder | undefined;
  let contextClosing: Promise<StopResult> | undefined;
  let browserClosing: Promise<StopResult> | undefined;
  const beginStop = () => {
    if (context && !contextClosing)
      contextClosing = stopWithin(() => context!.close(), 2000);
    if (browser && !browserClosing)
      browserClosing = stopWithin(() => browser!.close(), 3000);
  };
  const checkCancellation = () => {
    if (signal?.aborted) {
      beginStop();
      signal.throwIfAborted();
    }
  };
  const abort = () => {
    recorder?.record({
      kind: "error",
      label: "Preservation run cancelled",
      data: {
        reason:
          signal?.reason instanceof Error
            ? signal.reason.message
            : String(signal?.reason ?? "Cancelled"),
      },
    });
    // Start both closures independently of any awaited page action or response.
    beginStop();
  };
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const check = (
    checkId: string,
    passed: boolean,
    actual: string,
    stop = true,
  ) => {
    checkCancellation();
    const definition = definitions[kind].find((item) => item.id === checkId)!;
    result.checks.push({
      ...definition,
      status: passed ? "passed" : "failed",
      actual,
    });
    recorder?.record({
      kind: "assertion",
      label: definition.label,
      actionId: checkId,
      data: {
        status: passed ? "passed" : "failed",
        expected: definition.expected,
        actual,
      },
    });
    if (!passed && stop) throw new ObservedBarrier(actual);
  };
  try {
    checkCancellation();
    const executablePath = await chromiumExecutable();
    checkCancellation();
    browser = await chromium.launch({
      headless: true,
      executablePath,
      timeout: 20000,
    });
    checkCancellation();
    result.identity.browserVersion = browser.version();
    context = await browser.newContext({
      serviceWorkers: "block",
      acceptDownloads: false,
      reducedMotion: "reduce",
    });
    checkCancellation();
    const page = await context.newPage();
    checkCancellation();
    page.setDefaultTimeout(actionTimeoutMs);
    recorder = await recordTrace(page, {
      executionId: id,
      sourceDigest: build.digest,
      buildId: build.id,
      sessionId: session.id,
      contractDigest: AUTHORED_PRESERVATION_VERSION,
      adapter: "authored-preservation",
    });
    await page.goto(`${host.origin}/s/${session.id}`, {
      waitUntil: "domcontentloaded",
      timeout: 12000,
    });
    const trigger = page.getByTestId("slot-trigger");
    const panel = page.getByTestId("slot-panel");
    const value = page.getByTestId("selected-date");
    await trigger.waitFor({ state: "visible" });
    result.selectedValueBefore = await value.inputValue();
    if (kind === "pointer-booking") {
      recorder.record({
        kind: "action",
        label: "Pointer-click the date trigger",
        actionId: "pointer-opens-dialog",
      });
      await trigger.click();
      check(
        "pointer-opens-dialog",
        await deadline(() => panel.isVisible(), actionTimeoutMs),
        "Calendar visibility after pointer activation.",
      );
      const target = panel.locator(`[data-date="${choice.date}"]`);
      check(
        "enabled-intended-choice",
        (await target.count()) === 1 && (await target.isEnabled()),
        `Protected intended date ${choice.date}; unavailable=${choice.unavailable}.`,
      );
      const availability = responseAt(
        page,
        `${host.origin}/s/${session.id}/availability`,
        choice.date,
        Math.max(actionTimeoutMs, scenario.delayedValidationMs + 2000),
      );
      recorder.record({
        kind: "action",
        label: `Pointer-click the enabled intended date ${choice.date}`,
        actionId: "availability-request-response",
      });
      await target.click();
      const response = await availability;
      const body: unknown = response
        ? await response.json().catch(() => null)
        : null;
      const observed = await host.getSession(session.id);
      check(
        "availability-request-response",
        Boolean(
          response?.ok() &&
            body &&
            typeof body === "object" &&
            "available" in body &&
            body.available === true &&
            observed.availabilityChecks > 0 &&
            observed.validatedDates.includes(choice.date),
        ),
        `HTTP ${response?.status() ?? "no response"}; availabilityChecks=${observed.availabilityChecks}; selectedValue=${await value.inputValue()}; response=${JSON.stringify(body)}.`,
      );
      const selected = await deadline(
        async () => (await value.inputValue()) === choice.date,
        actionTimeoutMs,
      );
      check(
        "pointer-selection-committed",
        selected,
        `Expected ${choice.date}; observed ${await value.inputValue()}.`,
      );
      await page.getByTestId("attendee-input").fill(result.attendee);
      const booking = responseAt(
        page,
        `${host.origin}/s/${session.id}/appointments`,
        choice.date,
        Math.max(actionTimeoutMs, scenario.delayedValidationMs + 2000),
      );
      recorder.record({
        kind: "action",
        label: "Pointer-click confirmation with the fictional attendee",
        actionId: "pointer-confirmation",
      });
      await page.getByTestId("confirm-appointment").click();
      const booked = await booking;
      const bookingBody = booked ? await booked.json().catch(() => null) : null;
      check(
        "pointer-confirmation",
        Boolean(booked?.ok()),
        `Appointment HTTP ${booked?.status() ?? "no response"}; response=${JSON.stringify(bookingBody)}.`,
      );
      const stored = await host.getSession(session.id);
      const outcome = stored.outcome;
      check(
        "exact-single-outcome",
        Boolean(
          outcome &&
            outcome.sessionId === session.id &&
            outcome.sourceDigest === build.digest &&
            outcome.service === build.fixtureId &&
            outcome.date === choice.date &&
            outcome.attendee === result.attendee &&
            bookingBody?.appointment?.id === outcome.id,
        ),
        JSON.stringify(snapshotService(stored)),
      );
    } else {
      const close = panel.getByRole("button", {
        name: /^(?:Close(?: calendar)?|Kalender schließen)$/i,
      });
      recorder.record({
        kind: "action",
        label: "Native Tab to the original trigger, then Enter",
        actionId: "keyboard-opens-dialog",
      });
      await page.keyboard.press("Tab");
      const triggerFocused = await nativeFocused(page, trigger);
      if (!triggerFocused)
        check(
          "keyboard-opens-dialog",
          false,
          "Native Tab did not focus the actual trigger.",
        );
      await page.keyboard.press("Enter");
      check(
        "keyboard-opens-dialog",
        await deadline(() => panel.isVisible(), actionTimeoutMs),
        "Native Tab reached the trigger; Enter must open the actual calendar.",
      );
      let observation = await nativeFocus(page, trigger, close, 0);
      result.focus.push(observation);
      for (
        let step = 1;
        !observation.closeFocused && step <= maxTabPresses;
        step++
      ) {
        recorder.record({
          kind: "action",
          label: `Native Tab toward the Close calendar control (${step})`,
          actionId: "close-reachable-by-tab",
        });
        await page.keyboard.press("Tab");
        observation = await nativeFocus(page, trigger, close, step);
        result.focus.push(observation);
        recorder.record({
          kind: "focus",
          label: "Browser-native focus after Tab",
          actionId: "close-reachable-by-tab",
          data: { ...observation },
        });
      }
      check(
        "close-reachable-by-tab",
        observation.closeFocused,
        `Close native focus=${observation.closeFocused}; Tab presses=${observation.step}; last native focus=${JSON.stringify(observation)}.`,
      );
      recorder.record({
        kind: "action",
        label: "Activate the actually focused Close control with Enter",
        actionId: "close-activated-with-enter",
      });
      await page.keyboard.press("Enter");
      check(
        "close-activated-with-enter",
        await deadline(async () => !(await panel.isVisible()), actionTimeoutMs),
        "Calendar must become hidden after Enter on its Close control.",
      );
      check(
        "close-restores-trigger",
        await nativeFocused(page, trigger),
        "Original trigger native :focus state.",
      );
      check(
        "close-preserves-value",
        (await value.inputValue()) === result.selectedValueBefore,
        `Before=${result.selectedValueBefore}; after=${await value.inputValue()}.`,
      );
      const stored = await host.getSession(session.id);
      check(
        "close-does-not-book",
        stored.outcome === null,
        JSON.stringify(snapshotService(stored)),
      );
    }
    checkCancellation();
    result.status = "passed";
    result.passed = true;
  } catch (error) {
    result.passed = false;
    result.status = signal?.aborted
      ? "cancelled"
      : error instanceof ObservedBarrier ||
          (error instanceof Error && error.name === "TimeoutError")
        ? "failed"
        : "error";
    result.error = error instanceof Error ? error.message : String(error);
    recorder?.record({ kind: "error", label: result.error });
  } finally {
    if (browser?.isConnected()) {
      const page = browser.contexts()[0]?.pages()[0];
      if (page && !page.isClosed())
        result.selectedValueAfter = await page
          .getByTestId("selected-date")
          .inputValue({ timeout: 500 })
          .catch(() => null);
    }
    result.service = snapshotService(await host.getSession(session.id));
    for (const definition of definitions[kind])
      if (!result.checks.some((item) => item.id === definition.id))
        result.checks.push({
          ...definition,
          status: "not-run",
          actual:
            "Dependent path was not executed after the recorded barrier or environment error.",
        });
    let traceStopped = true;
    let traceError: string | undefined;
    if (recorder) {
      const stopped = await stopWithin(() => recorder!.stop(), 1000);
      traceStopped = stopped.ok;
      traceError = stopped.error;
      if (!traceStopped)
        result.limitations.push(
          "Trace cleanup did not complete; retained events end at the captured boundary.",
        );
      result.trace = [...recorder.events];
    }
    beginStop();
    const [closedContext, closedBrowser] = await Promise.all([
      contextClosing ?? Promise.resolve<StopResult>({ ok: true }),
      browserClosing ?? Promise.resolve<StopResult>({ ok: true }),
    ]);
    const browserDisconnected = !browser || !browser.isConnected();
    const contextClosed = !context || closedContext.ok || browserDisconnected;
    const cleanupErrors = [
      traceStopped ? undefined : (traceError ?? "Trace did not stop."),
      contextClosed
        ? undefined
        : (closedContext.error ?? "Context remained open."),
      browserDisconnected
        ? undefined
        : (closedBrowser.error ?? "Browser remained connected."),
    ].filter((error): error is string => Boolean(error));
    result.cleanup = {
      browserDisconnected,
      contextClosed,
      traceStopped,
      ...(cleanupErrors.length ? { error: cleanupErrors.join(" ") } : {}),
    };
    if (signal?.aborted) {
      result.status = "cancelled";
      result.passed = false;
      result.error ??=
        signal.reason instanceof Error
          ? signal.reason.message
          : String(signal.reason ?? "Preservation run cancelled.");
    } else if (cleanupErrors.length || !browserDisconnected || !contextClosed) {
      result.status = "error";
      result.passed = false;
      result.error = [
        result.error,
        "Preservation cleanup failed.",
        ...cleanupErrors,
        closedBrowser.error,
        closedContext.error,
      ]
        .filter(Boolean)
        .join(" ");
    }
    signal?.removeEventListener("abort", abort);
    result.completedAt = new Date().toISOString();
    result.durationMs = Date.now() - started;
  }
  return result;
}

export async function checkAuthoredPreservation(input: {
  source: string;
  fixtureId?: string;
  scenarios?: Scenario[];
  actionTimeoutMs?: number;
  maxTabPresses?: number;
  signal?: AbortSignal;
}): Promise<AuthoredPreservationReport> {
  input.signal?.throwIfAborted();
  const fixtureId = input.fixtureId ?? "northstar-appointments";
  if (getFixture(fixtureId).family !== "date-picker")
    throw new Error(
      "Preservation checks support the bounded authored date-picker adapter only.",
    );
  if (Buffer.byteLength(input.source) > 64000)
    throw new Error("The bounded authored source must be at most 64 KB.");
  const safety = validateCandidateSource(input.source);
  if (!safety.valid)
    throw new Error(`Source guard rejected: ${safety.errors.join(" ")}`);
  const actionTimeoutMs = input.actionTimeoutMs ?? 3000,
    maxTabPresses = input.maxTabPresses ?? 24;
  if (
    !Number.isInteger(actionTimeoutMs) ||
    actionTimeoutMs < 500 ||
    actionTimeoutMs > 10000 ||
    !Number.isInteger(maxTabPresses) ||
    maxTabPresses < 1 ||
    maxTabPresses > 64
  )
    throw new Error("Invalid bounded preservation-check limits.");
  const scenarios =
    input.scenarios ??
    scenarioDefinitions.filter(
      (item) => item.id === "baseline" || item.id === "combined",
    );
  if (!scenarios.length || scenarios.length > 6)
    throw new Error("Select 1–6 explicit authored scenarios.");
  const root = await mkdtemp(join(tmpdir(), "passage-preservation-"));
  const host = new FixtureHost({ previewPort: 0, artifactRoot: root });
  const startedAt = new Date().toISOString();
  let report: AuthoredPreservationReport | undefined;
  try {
    await host.start();
    input.signal?.throwIfAborted();
    const build = await host.prepareBuild({ fixtureId, source: input.source });
    const runs: AuthoredPreservationRun[] = [];
    const expectedRunCount = scenarios.length * 2;
    runLoop: for (const scenario of scenarios) {
      for (const kind of [
        "pointer-booking",
        "close-control-keyboard",
      ] as const) {
        if (input.signal?.aborted) break runLoop;
        try {
          runs.push(
            await runCheck(
              host,
              build,
              scenario,
              kind,
              actionTimeoutMs,
              maxTabPresses,
              input.signal,
            ),
          );
        } catch (error) {
          if (input.signal?.aborted) break runLoop;
          throw error;
        }
        if (input.signal?.aborted) break runLoop;
      }
    }
    const cancelled = Boolean(
      input.signal?.aborted || runs.some((run) => run.status === "cancelled"),
    );
    report = {
      schema: "passage-authored-preservation/v1",
      verifierVersion: AUTHORED_PRESERVATION_VERSION,
      startedAt,
      completedAt: new Date().toISOString(),
      passed:
        !cancelled &&
        runs.length === expectedRunCount &&
        runs.every((run) => run.passed),
      cancelled,
      expectedRunCount,
      completedRunCount: runs.filter((run) => run.status !== "cancelled")
        .length,
      source: {
        digest: digest(input.source),
        content: input.source,
        fixtureId,
      },
      build,
      bounds: { actionTimeoutMs, maxTabPresses },
      runs,
      limitations: [...limitations],
    };
    return report;
  } finally {
    const hostClosed = await stopWithin(() => host.close(), 2000);
    const removed = await stopWithin(
      () => rm(root, { recursive: true, force: true }),
      2000,
    );
    if (report) {
      // A cancellation during final host cleanup must not return an earlier green snapshot.
      if (input.signal?.aborted) {
        report.cancelled = true;
        report.passed = false;
      }
      if (!hostClosed.ok || !removed.ok) {
        report.passed = false;
        report.cleanupError = [hostClosed.error, removed.error]
          .filter(Boolean)
          .join(" ");
        report.limitations.push(
          `Report cleanup failed: ${report.cleanupError}`,
        );
      }
      report.completedAt = new Date().toISOString();
    }
  }
}
