import { afterEach, describe, expect, test } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { Store } from "../server/store.js";
import { RepairProvider } from "../server/provider.js";
import { JourneyService } from "../server/journey-service.js";
import { buildJourneyGuardBundle } from "../server/journey-guard.js";
import { temporalContractDigest } from "../engine/contract-interpreter.js";

const resources: { service: JourneyService; store: Store; root: string }[] = [];
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "passage-compiler-test-")), store = new Store(root);
  const service = new JourneyService(store, new RepairProvider(store, { provider: "fireworks", allowLive: false }));
  await service.start(); resources.push({ service, store, root }); return { service, store };
}
afterEach(async () => { for (const { service, store, root } of resources.splice(0)) { await service.close(); store.close(); await rm(root, { recursive: true, force: true }); } });

describe("reviewed journey compiler", () => {
  test("requires captured observations and exact draft review before execution", async () => {
    const { service, store } = await setup();
    const session = service.create({ fixtureId: "northstar-appointments", captureConsent: true });
    expect(() => service.draft(session.id, { mode: "observed" })).toThrow(/Record an actual attempt/);
    expect(() => service.verify(session.id, { variant: "reference", scheduleId: "baseline" })).toThrow(/Approve/);
    service.capture(session.id, { variant: "original", scheduleId: "baseline" });
    const captured = await service.wait(session.id);
    expect(captured.captures).toHaveLength(1);
    expect(captured.captures[0].status).toBe("failed");
    expect(captured.captures[0].outcome).toBeNull();
    expect(captured.captures[0].trace.length).toBeGreaterThan(0);
    const historicalUrl = captured.captures[0].previewUrl;
    const preview = await service.preview(session.id, captured.captures[0].id);
    expect(preview).toBe(`${service.host.origin}/s/${captured.captures[0].execution.identity.sessionId}`);
    expect(store.get<typeof captured>("compiler-session", session.id)!.captures[0].previewUrl).toBe(historicalUrl);
    service.draft(session.id, { mode: "observed" }); const drafted = await service.wait(session.id);
    expect(drafted.draft?.obligations.every(item => item.origin === "inferred")).toBe(true);
    expect(() => service.review(session.id, { expectedDigest: "f".repeat(64), maintainer: "Development operator", interactionReviewer: "Development reviewer", acknowledgeInferred: true })).toThrow(/draft changed/);
    const approved = service.review(session.id, { expectedDigest: drafted.draft!.digest, maintainer: "Development operator", interactionReviewer: "Development reviewer", acknowledgeInferred: true });
    expect(approved.review?.independentlyReviewed).toBe(false);
    const originalDraftDigest = approved.draft!.digest;
    for (const scheduleId of ["baseline", "cancel-pending", "modal-boundary"] as const) {
      service.verify(session.id, { variant: "reference", scheduleId });
      const verified = await service.wait(session.id);
      expect(verified.error).toBeNull();
      expect(verified.verifications.at(-1)?.status).toBe("passed");
    }
    const guard = service.export(session.id);
    expect(Object.values(guard.contractsBySchedule).every(contract => temporalContractDigest(contract) === contract.digest)).toBe(true);
    const zip = unzipSync(await buildJourneyGuardBundle(guard));
    expect(JSON.parse(strFromU8(zip["guard.json"])).draftDigest).toBe(originalDraftDigest);
    expect(Object.keys(zip).some(path => path.includes(".env") || path.includes("runs.db") || path.includes("provider.ts"))).toBe(false);
    expect(strFromU8(zip["README.md"])).toContain("npm ci --ignore-scripts");
    expect(JSON.parse(strFromU8(zip["package.json"])).scripts["verify:preservation"]).toBe("tsx scripts/check-authored-preservation.ts");
    expect(zip["engine/authored-preservation.ts"]).toBeDefined();
    service.draft(session.id, { mode: "observed" }); const revised = await service.wait(session.id);
    expect(revised.review).toBeNull(); expect(revised.drafts).toHaveLength(2);
    expect(revised.drafts[0].digest).toBe(originalDraftDigest);
    expect(revised.verifications).toHaveLength(3);
    expect(() => service.export(session.id)).toThrow(/Approve/);
  }, 45000);

  test("frozen guard rejects the historical cancellation regression and reduces an actual failure", async () => {
    const { service, store } = await setup();
    const session = service.create({ fixtureId: "northstar-appointments", captureConsent: true });
    service.capture(session.id, { variant: "reference", scheduleId: "cancel-pending" }); await service.wait(session.id);
    service.draft(session.id, { mode: "observed" }); const drafted = await service.wait(session.id);
    service.review(session.id, { expectedDigest: drafted.draft!.digest, maintainer: "Development operator", interactionReviewer: "Development reviewer", acknowledgeInferred: true });
    const source = await readFile(new URL("../docs/samples/date-picker/DatePicker.jsx", import.meta.url), "utf8");
    service.revision(session.id, { label: "Exact historical generated source", classification: "declared-regression", source });
    const checked = await service.wait(session.id);
    expect(checked.error).toBeNull(); expect(checked.revisions[0].passed).toBe(false);
    const failure = checked.verifications.find(result => result.scheduleId === "cancel-pending")!;
    expect(failure.execution.failureSignature).toBe("late-response-cannot-commit:value-changed");
    // Synthetic legacy persistence fixture; its old trial count is not new browser evidence.
    const steps = checked.draft!.contractsBySchedule["cancel-pending"].actions.map(action => action.id);
    const legacy = { original: steps, minimized: steps, signature: failure.execution.failureSignature,
      attempts: 2, acceptedRemovals: 0, execution: failure.execution };
    const legacyKey = `${session.id}:${failure.id}`;
    store.put("schedule-reduction", legacyKey, legacy);
    service.reduce(session.id, failure.id); const reduced = await service.wait(session.id);
    expect(reduced.error).toBeNull();
    expect(reduced.verifications.find(result => result.id === failure.id)?.counterexample?.attempts).toBeGreaterThan(0);
    expect(reduced.draft!.digest).toBe(drafted.draft!.digest);
    service.reduce(session.id, failure.id); const repeated = await service.wait(session.id);
    expect(repeated.error).toBeNull();
    expect(store.get("schedule-reduction", legacyKey)).toEqual(legacy);
    const guard = service.export(session.id);
    expect(guard.evidence.reductions).toHaveLength(3);
    expect(guard.evidence.reductionStarts).toHaveLength(2);
    expect(guard.evidence.reductionReplays.length).toBeGreaterThanOrEqual(2);
    expect(guard.evidence.reductions).toEqual(expect.arrayContaining([expect.objectContaining({ provenance: "preserved-legacy-record", result: legacy, originalRecordedAt: null })]));
    const view = repeated.verifications.find(result => result.id === failure.id)!.counterexample!;
    expect(view.historyCount).toBe(3); expect(view.minimal).toBe(false);
    expect(view.search).toMatchObject({ algorithm: "optional-group-ddmin-v2", globalMinimal: false });
  }, 45000);
});
