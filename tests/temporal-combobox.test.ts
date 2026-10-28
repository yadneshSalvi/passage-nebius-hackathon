import { test, expect } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FixtureHost } from "../engine/host.js";
import { approveTemporalContract } from "../engine/contract-interpreter.js";
import { runFixtureTemporal } from "../engine/temporal-fixture.js";
import { fixtureDefinitions, getReferenceSource, scenarioDefinitions } from "../engine/catalog.js";

test("the stronger developer-reviewed combobox contract distinguishes arrow navigation from the historical nine-check acceptance", async () => {
  const root = await mkdtemp(join(tmpdir(), "passage-combobox-temporal-")), host = new FixtureHost({ previewPort: 0, artifactRoot: root });
  try {
    await host.start();
    const fixture = fixtureDefinitions.find(item => item.family === "combobox")!;
    const contract = approveTemporalContract({ version: "passage-temporal/v1", id: "combobox-arrow-development", revision: 1, title: "Explore the next option without committing it",
      bindings: { trigger: { kind: "testId", value: "slot-trigger" }, panel: { kind: "testId", value: "slot-panel" }, next: { kind: "css", value: '[data-date="2026-11-17"]' }, value: { kind: "testId", value: "selected-date", read: "value" } },
      actions: [{ id: "reach", label: "Reach combobox from initial keyboard origin", kind: "press", key: "Tab" }, { id: "open", label: "Open options", kind: "press", key: "Enter", binding: "trigger" }, { id: "visible", label: "Wait for options", kind: "waitFor", binding: "panel", state: "visible" }, { id: "next", label: "Explore next option with ArrowDown", kind: "press", key: "ArrowDown" }, { id: "cancel", label: "Cancel without selection", kind: "press", key: "Escape" }, { id: "closed", label: "Wait for closure", kind: "waitFor", binding: "panel", state: "hidden" }],
      assertions: [{ id: "arrow-explores", label: "ArrowDown focuses the next available option", kind: "focusWithin", binding: "next", after: "next", required: true }, { id: "exploration-preserves", label: "Exploration does not commit a date", kind: "valuePreserved", binding: "value", since: "initial", after: "next", required: true }, { id: "restore", label: "Escape restores context", kind: "closedFocusRestored", panel: "panel", trigger: "trigger", after: "closed", required: true }],
      allowedEvents: [], bounds: { maxActions: 20, maxDurationMs: 12000, actionTimeoutMs: 2000 } },
      { actor: "Automated development contract reviewer", role: "operator", evidenceClass: "authored-development", approvedAt: "2026-10-28T00:00:00.000Z" });
    const historic = await readFile(new URL("../docs/samples/combobox/SessionCombobox.jsx", import.meta.url), "utf8");
    const originalBuild = await host.prepareBuild({ fixtureId: fixture.id, source: historic });
    const original = await runFixtureTemporal({ host, build: originalBuild, contract, scenario: scenarioDefinitions[0] });
    expect(original.status).toBe("failed"); expect(original.failureSignature).toBe("arrow-explores:focus-escaped");
    const referenceBuild = await host.prepareBuild({ fixtureId: fixture.id, source: await getReferenceSource(fixture.id) });
    const reference = await runFixtureTemporal({ host, build: referenceBuild, contract, scenario: scenarioDefinitions[0] });
    expect(reference.passed).toBe(true);
  } finally { await host.close(); await rm(root, { recursive: true, force: true }); }
}, 30000);
