import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FixtureEngine,
  createContract,
  getOriginalSource,
  getReferenceSource,
  scenarioDefinitions,
} from "../engine/index.js";

describe("independent real-browser and business verifier", () => {
  let root: string;
  let engine: FixtureEngine;
  const fixtureId = "northstar-appointments";
  const contract = createContract(fixtureId);
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "passage-verifier-"));
    engine = new FixtureEngine({ previewPort: 0, artifactRoot: root });
    await engine.start();
  });
  afterAll(async () => {
    await engine.close();
    await rm(root, { recursive: true, force: true });
  });
  it("actually reproduces the inaccessible original and stores no successful outcome", async () => {
    const build = await engine.prepareBuild({
      fixtureId,
      source: await getOriginalSource(fixtureId),
    });
    const result = await engine.verify({
      build,
      contract,
      scenario: scenarioDefinitions[0],
      kind: "baseline",
    });
    expect(result.passed).toBe(false);
    expect(
      result.checks.find((check) => check.id === "selection_keyboard_operable")
        ?.status,
    ).toBe("failed");
    expect(result.outcome).toBeNull();
    expect(result.observations.some((item) => item.kind === "focus")).toBe(
      true,
    );
    expect(
      result.artifacts.every((item) => /^[a-f0-9]{64}$/.test(item.digest)),
    ).toBe(true);
  });
  it("runs a separately compiled repair and persists the selected date under combined conditions", async () => {
    const build = await engine.prepareBuild({
      fixtureId,
      source: await getReferenceSource(fixtureId),
    });
    const result = await engine.verify({
      build,
      contract,
      scenario: scenarioDefinitions.find(
        (scenario) => scenario.id === "combined",
      )!,
      kind: "challenge",
    });
    expect(result.passed).toBe(true);
    expect(result.checks).toHaveLength(9);
    expect(result.outcome?.date).toBe("2026-11-17");
    expect(result.outcome?.sourceDigest).toBe(build.digest);
    expect(result.contractDigest).toBe(contract.digest);
    expect(result.scenario.locale).toBe("de");
  });
  it("rejects a plausible keyboard repair that silently saves a different valid date", async () => {
    const source = (await getReferenceSource(fixtureId)).replace(
      "onChange(choice.date)",
      "onChange('2026-11-18')",
    );
    const build = await engine.prepareBuild({ fixtureId, source });
    const result = await engine.verify({
      build,
      contract,
      scenario: scenarioDefinitions[0],
      kind: "candidate",
    });
    expect(result.passed).toBe(false);
    expect(result.outcome?.date).toBe("2026-11-18");
    expect(
      result.checks.find((check) => check.id === "correct_outcome_persisted")
        ?.status,
    ).toBe("failed");
  });
  it("rejects a component that commits a date merely by opening the picker", async () => {
    const source = (await getReferenceSource(fixtureId)).replace(
      "onClick={() => setOpen(!open)}",
      "onClick={() => { onChange(choices.find(choice => !choice.unavailable).date); setOpen(!open); }}",
    );
    const build = await engine.prepareBuild({ fixtureId, source });
    const result = await engine.verify({
      build,
      contract,
      scenario: scenarioDefinitions[0],
      kind: "candidate",
    });
    expect(result.verifierVersion).toBe("passage-browser-v3");
    expect(result.passed).toBe(false);
    expect(result.outcome?.date).toBe("2026-11-16");
    expect(
      result.checks.find((check) => check.id === "dialog_escape")?.status,
    ).toBe("failed");
    expect(
      result.checks.find((check) => check.id === "selection_keyboard_operable")
        ?.status,
    ).toBe("failed");
  });
  it("rejects a focus-only commitment even when opening and Escape preserve the original value", async () => {
    const source = (await getReferenceSource(fixtureId))
      .replace(
        "selectedIndex >= 0 ? selectedIndex : choices.findIndex((choice) => !choice.unavailable)",
        "selectedIndex >= 0 ? selectedIndex : 2",
      )
      .replace(
        "aria-pressed={value === choice.date}",
        "aria-pressed={value === choice.date} onFocus={() => { if (choice.date === choices.find(item => !item.unavailable).date) onChange(choice.date); }}",
      );
    const build = await engine.prepareBuild({ fixtureId, source });
    const result = await engine.verify({
      build,
      contract,
      scenario: scenarioDefinitions[0],
      kind: "candidate",
    });
    expect(result.passed).toBe(false);
    expect(result.outcome?.date).toBe("2026-11-16");
    expect(
      result.checks.find((check) => check.id === "dialog_escape")?.status,
    ).toBe("passed");
    expect(
      result.checks.find((check) => check.id === "selection_keyboard_operable")
        ?.status,
    ).toBe("failed");
    expect(
      result.observations.some(
        (item) => item.label === "Date committed before activation",
      ),
    ).toBe(true);
  });
  it("never starts a browser or publishes success for an already cancelled verification", async () => {
    const build = await engine.prepareBuild({
      fixtureId,
      source: await getReferenceSource(fixtureId),
    });
    await expect(
      engine.verify({
        build,
        contract,
        scenario: scenarioDefinitions[0],
        kind: "candidate",
        signal: AbortSignal.abort(new DOMException("Cancelled", "AbortError")),
      }),
    ).rejects.toThrow(/Cancelled/);
  });
  it("supports a genuine roving-tabindex grid using actual arrow navigation", async () => {
    const source = (await getReferenceSource(fixtureId))
      .replace(
        "selectedIndex >= 0 ? selectedIndex : choices.findIndex((choice) => !choice.unavailable)",
        "selectedIndex >= 0 ? selectedIndex : 2",
      )
      .replace(
        "aria-pressed={value === choice.date}",
        "aria-pressed={value === choice.date} tabIndex={index === 2 ? 0 : -1}",
      );
    const build = await engine.prepareBuild({ fixtureId, source });
    const result = await engine.verify({
      build,
      contract,
      scenario: scenarioDefinitions[0],
      kind: "candidate",
    });
    expect(result.passed).toBe(true);
    expect(result.outcome?.date).toBe("2026-11-16");
  });
  it("executes a legitimate local-ref DOM query for focus without granting global DOM access", async () => {
    const source = (await getReferenceSource(fixtureId))
      .replace(
        "const closeRef = useRef(null);",
        "const closeRef = useRef(null); const panelRef = useRef(null);",
      )
      .replace(
        "optionRefs.current[index]?.focus();",
        "panelRef.current?.querySelector('button[data-date]:not(:disabled)')?.focus();",
      )
      .replace(
        'id="calendar-panel" className=',
        'ref={panelRef} id="calendar-panel" className=',
      );
    const build = await engine.prepareBuild({ fixtureId, source });
    const result = await engine.verify({
      build,
      contract,
      scenario: scenarioDefinitions[0],
      kind: "candidate",
    });
    expect(result.passed).toBe(true);
    expect(result.outcome?.date).toBe("2026-11-16");
  });
  it("waits for valid asynchronous selection even in the date-picker family", async () => {
    const source = (await getReferenceSource(fixtureId))
      .replace(
        "{ value, onChange, choices, locale }",
        "{ value, onChange, choices, locale, checkAvailability }",
      )
      .replace(
        "onClick={() => { onChange(choice.date); close(); }}",
        "onClick={async () => { const result = await checkAvailability(choice.date); if (result.available) { onChange(choice.date); close(); } }}",
      );
    const build = await engine.prepareBuild({ fixtureId, source });
    const result = await engine.verify({
      build,
      contract,
      scenario: scenarioDefinitions.find(
        (scenario) => scenario.id === "late-validation",
      )!,
      kind: "challenge",
    });
    expect(result.passed).toBe(true);
    expect(result.outcome?.date).toBe("2026-11-16");
  });
  it("rejects an async-flow repair that removes the availability check instead of recovering", async () => {
    const asyncId = "civic-assistance";
    const source = (await getReferenceSource(asyncId)).replace(
      /async function choose\(choice\) \{[\s\S]*?\n  \}\n  return/,
      "async function choose(choice) { onChange(choice.date); close(); }\n  return",
    );
    const build = await engine.prepareBuild({ fixtureId: asyncId, source });
    const result = await engine.verify({
      build,
      contract: createContract(asyncId),
      scenario: scenarioDefinitions[0],
      kind: "candidate",
    });
    expect(result.passed).toBe(false);
    expect(result.outcome).toBeNull();
    expect(
      result.checks.find((check) => check.id === "correct_outcome_persisted")
        ?.status,
    ).toBe("failed");
  });
});
