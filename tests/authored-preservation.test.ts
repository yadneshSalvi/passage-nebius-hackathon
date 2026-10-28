import { describe, expect, it, vi } from "vitest";
import { chromium, type Browser } from "@playwright/test";
import { FixtureHost, type FixtureSession } from "../engine/host.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkAuthoredPreservation } from "../engine/authored-preservation.js";
import {
  digest,
  getReferenceSource,
  scenarioDefinitions,
} from "../engine/catalog.js";

// Exact, frozen public candidate 23 bytes, SHA-256 verified below.
// Provenance: .passage/root-candidate23-manual/guard-at-start.json, exported
// 2026-10-28T14:15:19.601Z. Its recorded fifteen scoped keyboard checks passed.
// The additional pointer-booking and Close-control checks below intentionally
// fail that same source without changing its historical accepted record.
// Embedded here so the regression needs no running server or ignored artifact.
const candidate23 = [
  "import React, { useState, useRef, useEffect } from 'react';",
  "",
  "export default function SlotControl({ value, onChange, choices, locale, checkAvailability, delayMs = 0, longLabels }) {",
  "  const [open, setOpen] = useState(false);",
  "  const pendingDateRef = useRef(null);",
  "  const gridRef = useRef(null);",
  "  const triggerRef = useRef(null);",
  "  const focusGuardRef = useRef(0);",
  "  const selected = choices.find((choice) => choice.date === value);",
  "",
  "  // Focus first available cell when modal opens",
  "  useEffect(() => {",
  "    if (!open) return;",
  "    const guard = ++focusGuardRef.current;",
  "    if (!gridRef.current) return;",
  "    const firstAvailable = gridRef.current.querySelector('[data-date]:not(.unavailable)');",
  "    if (firstAvailable) {",
  "      firstAvailable.focus();",
  "    }",
  "  }, [open]);",
  "",
  "  const handleModalKeyDown = (e) => {",
  "    if (e.key === 'Escape') {",
  "      if (pendingDateRef.current) {",
  "        pendingDateRef.current = null;",
  "      }",
  "      ++focusGuardRef.current;",
  "      setOpen(false);",
  "      triggerRef.current?.focus();",
  "      return;",
  "    }",
  "",
  "    if (e.key === 'Tab' && e.shiftKey) {",
  "      if (!gridRef.current) return;",
  "      const cells = Array.from(gridRef.current.querySelectorAll('[data-date]:not(.unavailable)'));",
  "      if (cells.length === 0) return;",
  "      const activeElement = gridRef.current.querySelector('[data-date]:focus');",
  "      if (!activeElement) return;",
  "      e.preventDefault();",
  "      const currentIndex = cells.indexOf(activeElement);",
  "      if (currentIndex === -1) return;",
  "      const prevIndex = (currentIndex - 1 + cells.length) % cells.length;",
  "      cells[prevIndex]?.focus();",
  "      return;",
  "    }",
  "",
  "    if (e.key === 'Tab') {",
  "      if (!gridRef.current) return;",
  "      const cells = Array.from(gridRef.current.querySelectorAll('[data-date]:not(.unavailable)'));",
  "      if (cells.length === 0) return;",
  "      const activeElement = gridRef.current.querySelector('[data-date]:focus');",
  "      if (!activeElement) return;",
  "      e.preventDefault();",
  "      const currentIndex = cells.indexOf(activeElement);",
  "      if (currentIndex === -1) return;",
  "      const nextIndex = (currentIndex + 1) % cells.length;",
  "      cells[nextIndex]?.focus();",
  "      return;",
  "    }",
  "",
  "    if (!gridRef.current) return;",
  "    const cells = Array.from(gridRef.current.querySelectorAll('[data-date]:not(.unavailable)'));",
  "    if (cells.length === 0) return;",
  "",
  "    const activeElement = gridRef.current.querySelector('[data-date]:focus');",
  "    const currentIndex = cells.indexOf(activeElement);",
  "    if (currentIndex === -1) return;",
  "",
  "    const colCount = 7;",
  "    let nextIndex = currentIndex;",
  "",
  "    if (e.key === 'ArrowRight') {",
  "      e.preventDefault();",
  "      nextIndex = (currentIndex + 1) % cells.length;",
  "    } else if (e.key === 'ArrowLeft') {",
  "      e.preventDefault();",
  "      nextIndex = (currentIndex - 1 + cells.length) % cells.length;",
  "    } else if (e.key === 'ArrowDown') {",
  "      e.preventDefault();",
  "      nextIndex = Math.min(currentIndex + colCount, cells.length - 1);",
  "    } else if (e.key === 'ArrowUp') {",
  "      e.preventDefault();",
  "      nextIndex = Math.max(currentIndex - colCount, 0);",
  "    } else if (e.key === 'Enter' || e.key === ' ') {",
  "      e.preventDefault();",
  "      const dateCell = cells[currentIndex];",
  "      if (dateCell && !pendingDateRef.current) {",
  "        const date = dateCell.getAttribute('data-date');",
  "        const choice = choices.find(c => c.date === date);",
  "        if (choice && !choice.unavailable) {",
  "          pendingDateRef.current = date;",
  "          const guard = focusGuardRef.current;",
  "          checkAvailability(date).then((result) => {",
  "            if (guard !== focusGuardRef.current) return;",
  "            if (result.available) {",
  "              onChange(date);",
  "              pendingDateRef.current = null;",
  "              setOpen(false);",
  "              triggerRef.current?.focus();",
  "            } else {",
  "              pendingDateRef.current = null;",
  "            }",
  "          });",
  "        }",
  "      }",
  "      return;",
  "    } else {",
  "      return;",
  "    }",
  "",
  "    cells[nextIndex]?.focus();",
  "  };",
  "",
  "  return (",
  '    <div className="slot-control">',
  "      <span className=\"field-label\" id=\"date-label\">{locale === 'de' ? 'Termin auswählen' : 'Appointment date'}</span>",
  "      <button",
  '        type="button"',
  '        className="picker-trigger"',
  '        data-testid="slot-trigger"',
  '        aria-haspopup="dialog"',
  "        aria-expanded={open}",
  '        aria-labelledby="date-label selected-date-label"',
  "        onClick={() => setOpen(!open)}",
  "        ref={triggerRef}",
  "      >",
  "        <span id=\"selected-date-label\">{selected ? selected.label : locale === 'de' ? 'Datum auswählen' : 'Choose a date'}</span><span aria-hidden=\"true\">⌄</span>",
  "      </button>",
  "      {open && (",
  "        <div",
  '          className="picker-panel"',
  '          data-testid="slot-panel"',
  '          role="dialog"',
  '          aria-modal="true"',
  '          aria-labelledby="calendar-title"',
  "          onKeyDown={handleModalKeyDown}",
  "        >",
  '          <div className="picker-heading">',
  "            <h3 id=\"calendar-title\">{locale === 'de' ? 'November 2026' : 'November 2026'}</h3>",
  '            <button type="button" className="icon-button" aria-label="Close calendar" onClick={() => { if (pendingDateRef.current) pendingDateRef.current = null; ++focusGuardRef.current; setOpen(false); triggerRef.current?.focus(); }}>×</button>',
  "          </div>",
  '          <div className="calendar-week" aria-hidden="true"><span>MO</span><span>TU</span><span>WE</span><span>TH</span><span>FR</span><span>SA</span><span>SU</span></div>',
  '          <div className="calendar-grid" ref={gridRef}>',
  "            {choices.map((choice) => (",
  "              <div",
  "                key={choice.date}",
  "                className={`calendar-day ${choice.unavailable ? 'unavailable' : ''}`}",
  "                data-date={choice.date}",
  '                role="button"',
  "                aria-label={choice.label}",
  "                aria-disabled={choice.unavailable}",
  "                tabIndex={choice.unavailable ? -1 : 0}",
  "              >",
  "                <span>{choice.day}</span>",
  '                <span className="availability-dot" />',
  "              </div>",
  "            ))}",
  "          </div>",
  "          <p className=\"picker-hint\">{locale === 'de' ? 'Alle Termine in Ihrer Ortszeit.' : 'All appointments in your local time.'}</p>",
  "        </div>",
  "      )}",
  "    </div>",
  "  );",
  "}",
].join("\n");
const candidate23Digest =
  "8f0771b929e44146364b506fbaf26317803e31139553de854835b85f4a76f5fd";

describe("additional authored interaction preservation", () => {
  it("refuses to overwrite a historical guard with a new report", async () => {
    const directory = await mkdtemp(join(tmpdir(), "preservation-input-"));
    const guard = join(directory, "guard.json");
    const original = '{"historical":"unchanged"}\n';
    try {
      await writeFile(guard, original);
      await expect(
        promisify(execFile)(
          process.execPath,
          [
            "--import",
            "tsx",
            "scripts/check-authored-preservation.ts",
            "--guard",
            guard,
            "--output",
            guard,
          ],
          { timeout: 10000 },
        ),
      ).rejects.toMatchObject({
        code: 2,
        stderr: expect.stringContaining(
          "Refusing to overwrite a source or historical guard input.",
        ),
      });
      expect(await readFile(guard, "utf8")).toBe(original);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it.each(["baseline", "combined"])(
    "reference preserves pointer booking and actual Close reachability: %s",
    async (scenarioId) => {
      const scenario = scenarioDefinitions.find(
        (item) => item.id === scenarioId,
      )!;
      const report = await checkAuthoredPreservation({
        source: await getReferenceSource("northstar-appointments"),
        scenarios: [scenario],
      });
      expect(report.passed).toBe(true);
      expect(report.runs).toHaveLength(2);
      expect(
        new Set(report.runs.map((run) => run.identity.sessionId)).size,
      ).toBe(2);
      const pointer = report.runs.find(
        (run) => run.kind === "pointer-booking",
      )!;
      expect(pointer.status).toBe("passed");
      expect(pointer.service.availabilityChecks).toBe(1);
      expect(pointer.service.validatedDates).toContain(pointer.intendedDate);
      expect(pointer.service.outcomeCount).toBe(1);
      expect(pointer.service.outcomes[0]).toMatchObject({
        date: pointer.intendedDate,
        attendee: pointer.attendee,
        sourceDigest: report.source.digest,
        sessionId: pointer.identity.sessionId,
        service: "northstar-appointments",
      });
      const close = report.runs.find(
        (run) => run.kind === "close-control-keyboard",
      )!;
      expect(close.status).toBe("passed");
      expect(close.focus.some((observation) => observation.closeFocused)).toBe(
        true,
      );
      expect(
        close.checks.find((check) => check.id === "close-restores-trigger")
          ?.status,
      ).toBe("passed");
      expect(close.selectedValueAfter).toBe(close.selectedValueBefore);
      expect(close.service.outcomeCount).toBe(0);
      expect(pointer.identity.browserVersion).not.toBe("");
      if (scenarioId === "combined") {
        expect(pointer.scenario).toMatchObject({
          locale: "de",
          delayedValidationMs: 900,
          longLabels: true,
          unavailableFirst: true,
        });
        expect(pointer.intendedDate).toBe("2026-11-17");
      }
    },
  );

  it.each(["baseline", "combined"])(
    "exact historically accepted candidate 23 fails the additional preservation paths: %s",
    async (scenarioId) => {
      expect(digest(candidate23)).toBe(candidate23Digest);
      const scenario = scenarioDefinitions.find(
        (item) => item.id === scenarioId,
      )!;
      const report = await checkAuthoredPreservation({
        source: candidate23,
        scenarios: [scenario],
      });
      expect(report.source.digest).toBe(candidate23Digest);
      expect(report.passed).toBe(false);
      expect(report.runs.every((run) => run.status === "failed")).toBe(true);
      const pointer = report.runs.find(
        (run) => run.kind === "pointer-booking",
      )!;
      expect(
        pointer.checks.find(
          (check) => check.id === "availability-request-response",
        )?.status,
      ).toBe("failed");
      expect(pointer.service.availabilityChecks).toBe(0);
      expect(pointer.selectedValueAfter).toBe("");
      expect(pointer.service.outcomeCount).toBe(0);
      const close = report.runs.find(
        (run) => run.kind === "close-control-keyboard",
      )!;
      expect(
        close.checks.find((check) => check.id === "close-reachable-by-tab")
          ?.status,
      ).toBe("failed");
      expect(close.focus.at(-1)?.step).toBe(report.bounds.maxTabPresses);
      expect(
        close.focus.every((observation) => !observation.closeFocused),
      ).toBe(true);
      expect(close.service.outcomeCount).toBe(0);
      expect(
        new Set(report.runs.map((run) => run.identity.sessionId)).size,
      ).toBe(2);
      expect(
        report.runs.every((run) =>
          run.trace.some((event) => event.provenance === "controller"),
        ),
      ).toBe(true);
    },
  );

  it("rejects unsupported source before browser execution", async () => {
    await expect(
      checkAuthoredPreservation({
        source:
          "import fs from 'node:fs'; export default function SlotControl(){ return <div/>; }",
      }),
    ).rejects.toThrow(/Source guard rejected/);
  });

  it("throws before build when already cancelled and launches no browser", async () => {
    const source = await getReferenceSource("northstar-appointments");
    const controller = new AbortController();
    controller.abort(new Error("Cancelled before build"));
    const launch = vi.spyOn(chromium, "launch");
    try {
      await expect(
        checkAuthoredPreservation({ source, signal: controller.signal }),
      ).rejects.toThrow("Cancelled before build");
      expect(launch).not.toHaveBeenCalled();
    } finally {
      launch.mockRestore();
    }
  });

  it("closes a real pending availability run immediately and retains completed evidence", async () => {
    const controller = new AbortController();
    const browsers: Browser[] = [];
    const sessions: { host: FixtureHost; session: FixtureSession }[] = [];
    const originalLaunch = chromium.launch.bind(chromium);
    const originalCreate = FixtureHost.prototype.createSession;
    let release!: () => void;
    const deliveryGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(FixtureHost.prototype, "createSession").mockImplementation(
      async function (this: FixtureHost, build, scenario) {
        const session = await originalCreate.call(this, build, scenario);
        sessions.push({ host: this, session });
        return session;
      },
    );
    vi.spyOn(chromium, "launch").mockImplementation(async (options) => {
      const browser = await originalLaunch(options);
      browsers.push(browser);
      if (browsers.length === 3) {
        const originalContext = browser.newContext.bind(browser);
        vi.spyOn(browser, "newContext").mockImplementation(
          async (contextOptions) => {
            const context = await originalContext(contextOptions);
            // Hold delivery of the REAL protected response. No availability or outcome is fabricated.
            await context.route("**/availability", async (route) => {
              try {
                const response = await route.fetch();
                await deliveryGate;
                await route.fulfill({ response });
              } catch {
                await route.abort().catch(() => undefined);
              }
            });
            return context;
          },
        );
      }
      return browser;
    });
    const source = await getReferenceSource("northstar-appointments");
    const checking = checkAuthoredPreservation({
      source,
      signal: controller.signal,
    });
    void checking.catch(() => undefined);
    try {
      await expect
        .poll(
          async () => {
            const pending = sessions.find(
              (item) => item.session.scenario.id === "combined",
            );
            return pending
              ? (await pending.host.getSession(pending.session.id))
                  .availabilityChecks
              : 0;
          },
          { timeout: 15000, interval: 20 },
        )
        .toBe(1);
      controller.abort(new Error("Cancelled during protected availability"));
      // This must happen independently of the held response and the 3s action timeout.
      await expect
        .poll(() => browsers[2]?.isConnected(), { timeout: 1500, interval: 20 })
        .toBe(false);
      const report = await checking;
      expect(report.verifierVersion).toBe(
        "passage-authored-preservation-v2-cancellation",
      );
      expect(report.passed).toBe(false);
      expect(report.cancelled).toBe(true);
      expect(report.expectedRunCount).toBe(4);
      expect(report.completedRunCount).toBe(2);
      expect(report.runs).toHaveLength(3);
      expect(
        report.runs
          .slice(0, 2)
          .every((run) => run.passed && run.trace.length > 0),
      ).toBe(true);
      const interrupted = report.runs[2];
      expect(interrupted.status).toBe("cancelled");
      expect(interrupted.passed).toBe(false);
      expect(interrupted.service.availabilityChecks).toBe(1);
      expect(interrupted.service.outcomeCount).toBe(0);
      expect(
        interrupted.trace.some(
          (event) =>
            event.kind === "request" && event.label.includes("availability"),
        ),
      ).toBe(true);
      expect(interrupted.cleanup).toMatchObject({
        browserDisconnected: true,
        contextClosed: true,
        traceStopped: true,
      });
      expect(browsers.every((browser) => !browser.isConnected())).toBe(true);
      release();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      expect(report.passed).toBe(false);
      expect(interrupted.service.outcomeCount).toBe(0);
    } finally {
      controller.abort();
      release();
      await checking.catch(() => undefined);
      vi.restoreAllMocks();
      await Promise.allSettled(browsers.map((browser) => browser.close()));
    }
  });

  it("does not accept successful assertions when browser cleanup fails", async () => {
    const browsers: Browser[] = [];
    const originalLaunch = chromium.launch.bind(chromium);
    vi.spyOn(chromium, "launch").mockImplementation(async (options) => {
      const browser = await originalLaunch(options);
      browsers.push(browser);
      if (browsers.length === 1)
        vi.spyOn(browser, "close").mockRejectedValue(
          new Error("Injected close failure"),
        );
      return browser;
    });
    try {
      const report = await checkAuthoredPreservation({
        source: await getReferenceSource("northstar-appointments"),
        scenarios: [scenarioDefinitions[0]],
      });
      expect(report.passed).toBe(false);
      const failedCleanup = report.runs[0];
      expect(
        failedCleanup.checks.every((check) => check.status === "passed"),
      ).toBe(true);
      expect(failedCleanup.status).toBe("error");
      expect(failedCleanup.passed).toBe(false);
      expect(failedCleanup.cleanup?.browserDisconnected).toBe(false);
      expect(failedCleanup.error).toContain("Injected close failure");
    } finally {
      vi.restoreAllMocks();
      await Promise.allSettled(browsers.map((browser) => browser.close()));
    }
  });
});
