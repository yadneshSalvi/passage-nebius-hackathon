/** Synthetic model transport; every temporal/preservation result below is an actual fresh browser run. */
import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JourneyService } from "../server/journey-service.js";
import { Store, sha256 } from "../server/store.js";
import type { RepairProvider } from "../server/provider.js";
import type { ModelReceipt } from "../shared/types.js";
import type { CompilerSession } from "../shared/compiler.js";
import { getReferenceSource } from "../engine/catalog.js";
import { AUTHORED_PRESERVATION_VERSION } from "../engine/authored-preservation.js";

let service: JourneyService | undefined, store: Store | undefined, root: string | undefined;
afterEach(async () => { await service?.close(); store?.close(); if (root) await rm(root, { recursive: true, force: true }); });

it("requires separate preservation for new repairs and revisions, retains legacy scope, and exports actual source-bound evidence", async () => {
  root = await mkdtemp(join(tmpdir(), "passage-compiler-preservation-test-")); store = new Store(root);
  const regressionReport = JSON.parse(await readFile(new URL("../docs/upgrade-evidence/authored-candidate-23.preservation.v1.json", import.meta.url), "utf8"));
  const regression = regressionReport.source.content as string;
  expect(sha256(regression)).toBe("8f0771b929e44146364b506fbaf26317803e31139553de854835b85f4a76f5fd");
  const reference = await getReferenceSource("northstar-appointments"), sources = [regression, reference], calls: any[] = [];
  const at = new Date().toISOString();
  const receipt: ModelReceipt = { provider: "offline-fixture", model: "synthetic-unit-transport", requestId: null,
    promptVersion: "synthetic-test-only", temperature: 0, inputTokens: null, outputTokens: null, durationMs: 0, startedAt: at, completedAt: at, live: false };
  const provider = { assertAvailable: vi.fn(), singleSourceOutputAvailable: true,
    completeStructured: vi.fn(async (input: any) => {
      calls.push(input);
      return { receipt, value: input.schema.parse({ locations: [{ lineIds: [input.payload.inspectedFiles[0].sourceLines[0].id], symbol: "Synthetic test fixture",
        reason: "Known test source selected by a synthetic transport; no model-performance claim.", evidenceRefs: [input.payload.citationReferenceKinds.evidenceRefs[0].allowedEventIds[0]] }] }) };
    }),
    completeSingleSource: vi.fn(async () => ({ source: sources.shift()!, receipt: { ...receipt, outputProtocol: "single-source" as const } })),
  } as unknown as RepairProvider;
  service = new JourneyService(store, provider); await service.start();
  const session = service.create({ fixtureId: "northstar-appointments", captureConsent: true });
  service.capture(session.id, { variant: "original", scheduleId: "baseline" }); await service.wait(session.id);
  service.draft(session.id, { mode: "observed" }); const drafted = await service.wait(session.id);
  service.review(session.id, { expectedDigest: drafted.draft!.digest, maintainer: "Synthetic test automation",
    interactionReviewer: "Synthetic test automation", acknowledgeInferred: true, reviewProvenance: "automated-development" });

  service.repair(session.id); const rejected = await service.wait(session.id), first = rejected.repairs[0];
  expect(rejected.error).toBeNull(); expect(first.acceptancePolicy).toBe("frozen-suite-and-preservation-v1");
  expect(first.verificationIds).toHaveLength(3);
  expect(first.verificationIds.every(id => rejected.verifications.find(item => item.id === id)?.status === "passed")).toBe(true);
  const firstReport = JSON.parse(store.readArtifact(first.preservationChecks![0].reportDigest).toString());
  expect(first.status).toBe("rejected"); expect(first.preservationChecks?.[0], JSON.stringify(firstReport.runs.map((run: any) => ({ kind: run.kind, scenario: run.scenario.id, status: run.status, error: run.error, cleanup: run.cleanup })))).toMatchObject({ reason: "automatic-acceptance", status: "failed", passed: false, sourceDigest: sha256(regression) });
  expect(first.preservationChecks?.[0].runs).toHaveLength(4);
  expect(first.preservationChecks?.[0].sourceObservation?.sourceDigest).toBe(sha256(regression));

  service.repair(session.id); const accepted = await service.wait(session.id), second = accepted.repairs[1];
  expect(accepted.error).toBeNull(); expect(second.status).toBe("accepted");
  expect(second.preservationChecks?.[0]).toMatchObject({ passed: true, verifierVersion: AUTHORED_PRESERVATION_VERSION });
  expect(calls[1].payload.additionalSourceObservations).toEqual([first.preservationChecks![0].sourceObservation]);

  // Explicit synthetic old-record fixture: rechecking must not rewrite its original acceptance policy/status.
  const legacy = { ...first, id: "synthetic-historical-frozen-acceptance", status: "accepted" as const,
    summary: "Synthetic historical-scope fixture, not a model success", acceptancePolicy: undefined, preservationChecks: undefined };
  const state = service.session(session.id); state.repairs.unshift(legacy); store.put("compiler-session", session.id, state);
  service.preservation(session.id, legacy.id); const checked = await service.wait(session.id);
  expect(checked.error).toBeNull();
  expect(checked.repairs[0]).toMatchObject({ status: "accepted", preservationChecks: [{ reason: "later-check", passed: false }] });
  expect(checked.repairs[0].acceptancePolicy).toBeUndefined();

  service.revision(session.id, { label: "Exact pointer and Close regression", classification: "declared-regression", source: regression });
  const revised = await service.wait(session.id), revision = revised.revisions.at(-1)!;
  expect(revised.error).toBeNull(); expect(revision.verificationIds.every(id => revised.verifications.find(item => item.id === id)?.status === "passed")).toBe(true);
  expect(revision).toMatchObject({ passed: false, acceptancePolicy: "frozen-suite-and-preservation-v1", preservationCheck: { passed: false, reason: "revision-check" } });
  const guard = service.export(session.id);
  expect(guard.acceptancePolicy).toBe("frozen-suite-and-preservation-v1");
  expect(guard.preservationPolicy).toMatchObject({ required: true, verifierVersion: AUTHORED_PRESERVATION_VERSION, expectedRuns: 4 });
  expect(guard.patches[0].afterDigest).toBe(sha256(reference));
  expect(guard.evidence.preservationStarts).toHaveLength(4); expect(guard.evidence.preservationRuns).toHaveLength(4);
  const stored = store.get<CompilerSession>("compiler-session", session.id)!;
  expect(stored.draft!.digest).toBe(drafted.draft!.digest);
  for (const repair of stored.repairs) for (const check of repair.preservationChecks ?? []) {
    const report = JSON.parse(store.readArtifact(check.reportDigest).toString());
    expect(report.source.digest).toBe(check.sourceDigest); expect(report.runs).toHaveLength(4);
  }
}, 90000);
