import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { fixtureDefinitions, getFixture, getOriginalSource, getReferenceSource, scenarioDefinitions } from "../engine/catalog.js";
import { FixtureHost } from "../engine/host.js";
import { approveTemporalContract, validateTemporalContract } from "../engine/contract-interpreter.js";
import { createFixtureTemporalContract, runFixtureTemporal } from "../engine/temporal-fixture.js";
import { validateCandidateSource } from "../engine/safety.js";
import { checkAuthoredPreservation, AUTHORED_PRESERVATION_VERSION } from "../engine/authored-preservation.js";
import { qualifyRepositoryWorker } from "../engine/repository-worker.js";
import { compileSchedule, reduceSchedule } from "../engine/event-scheduler.js";
import type { CompiledSchedule, ScheduleReduction, TemporalAction, TemporalContract, TemporalExecution } from "../shared/temporal.js";
import type { CompilerBootstrap, CompilerCapture, CompilerDraft, CompilerObligation, CompilerPreservationCheck, CompilerRepair, CompilerSchedule, CompilerSession, CompilerTraceEvent, CompilerVariant } from "../shared/compiler.js";
import type { GenerationFailure } from "../shared/types.js";
import { Store, AppError, id, now, sha256 } from "./store.js";
import { RepairProvider } from "./provider.js";
import { draftWithModel, localizeAndPatch, proposeScheduleWithModel } from "./journey-model.js";
import { GenerationOutputError, retainedFailureFeedback } from "./generation-output.js";

export const compilerSchedules: CompilerBootstrap["schedules"] = [
  { id: "baseline", label: "Complete the task", description: "Choose the requested date and independently read the stored appointment." },
  { id: "cancel-pending", label: "Cancel while it is checking", description: "Hold the actual availability response, press Escape, then release the same response." },
  { id: "modal-boundary", label: "Keep my place in the calendar", description: "Use Tab and Shift+Tab across both modal boundaries, then close it." },
];
const scheduleIds = compilerSchedules.map(item => item.id);
const activeStatuses = new Set(["capturing", "drafting", "repairing", "verifying"]);
const reviewSchema = z.object({
  expectedDigest: z.string().regex(/^[a-f0-9]{64}$/), maintainer: z.string().trim().min(2).max(120),
  interactionReviewer: z.string().trim().min(2).max(120), acknowledgeInferred: z.literal(true),
  reviewProvenance: z.enum(["operator-attested", "automated-development"]).default("operator-attested"),
}).strict();
const sourceObservationSchema = z.object({ sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
  details: z.string().trim().min(8).max(5000), observer: z.string().trim().min(2).max(120),
  provenance: z.enum(["automated-development", "operator-attested"]) }).strict();
const capabilities = "Authored component adapter only: one default-exported React JSX SlotControl module, 100–24000 characters. Preserve compatibility with the host interface. Exact supplied props are value:string, onChange:(date:string)=>void, choices:Array<{date:string,label:string,day:string,weekday:string,unavailable:boolean}>, locale:'en'|'de', longLabels:boolean, delayMs:number, and checkAvailability:(date:string)=>Promise<{available:boolean,reason?:string}>. The original component does not consume all supplied props; the patch may consume them. checkAvailability invokes the protected application's real availability service; there is no candidate-owned service or booking store. Only react imports. No package changes, network APIs, document/window/global access, storage, eval, new expressions, classes or loop statements. Local useRef focus and direct descendant querySelector/querySelectorAll with a static selector on a useRef .current are supported. Ref computed indices must be local numeric identifiers. Existing data-testid/data-date bindings are approved API. These are host interface and execution capabilities, not a solution recipe.";

function traceEvents(execution: TemporalExecution, captureId: string): CompilerTraceEvent[] {
  return execution.trace.map(event => ({
    id: `${captureId}:${event.sequence}`, sequence: event.sequence, atMs: event.elapsedMs,
    kind: event.kind === "requestFailed" || event.kind === "error" || event.kind === "event" ? "dom" : event.kind === "input" ? "action" : event.kind,
    label: event.label, detail: event.data ? JSON.stringify(event.data) : event.target ?? "Observed browser event.",
    provenance: event.provenance,
    ...(event.target ? { binding: event.target } : {}), ...(event.requestId ? { correlationId: event.requestId } : {}),
  }));
}
function suiteDigest(draft: CompilerDraft) {
  return sha256(JSON.stringify(scheduleIds.map(schedule => ({ schedule, digest: draft.contractsBySchedule[schedule].digest }))));
}
function defaultContracts(task: string, revision: number): Record<CompilerSchedule, TemporalContract> {
  return Object.fromEntries(scheduleIds.map(scheduleId => {
    const contract = createFixtureTemporalContract({ scheduleId, choiceDate: "2026-11-16" });
    return [scheduleId, approveTemporalContract({ ...contract, revision, title: task }, {
      actor: "Passage development probe author", role: "operator", evidenceClass: "authored-development", approvedAt: now(),
    })];
  })) as Record<CompilerSchedule, TemporalContract>;
}
function observedDraftObligations(contracts: Record<CompilerSchedule, TemporalContract>, captures: CompilerCapture[]): CompilerObligation[] {
  return scheduleIds.flatMap(scheduleId => contracts[scheduleId].assertions.map(assertion => {
    const capture = [...captures].reverse().find(item => item.scheduleId === scheduleId) ?? captures.at(-1)!;
    const nearby = capture.trace.filter(event => event.kind === "assertion" && event.label === assertion.label);
    const evidence = nearby;
    return { id: `${scheduleId}:${assertion.id}`, text: assertion.label, origin: "inferred" as const,
      evidenceRefs: evidence.map(event => event.id), assertionIds: [assertion.id] };
  }));
}

/** New compiler records never rewrite a legacy run or its nine-check acceptance. */
export class JourneyService {
  readonly host: FixtureHost;
  private jobs = new Map<string, { controller: AbortController; done: Promise<void> }>();
  private tail: Promise<void> = Promise.resolve();
  private storyPromise?: Promise<CompilerBootstrap["story"]>;
  constructor(readonly store: Store, readonly provider: RepairProvider) {
    this.host = new FixtureHost({ previewPort: 0, artifactRoot: join(store.root, "compiler-engine") });
  }
  async start() {
    await this.host.start();
    for (const session of this.store.list<CompilerSession>("compiler-session")) if (activeStatuses.has(session.status)) {
      session.status = "error";
      session.error = { code: "WORKER_RESTARTED", message: "The compiler worker restarted. Completed observations are preserved; unfinished work was not accepted." };
      this.save(session);
    }
  }
  async close() {
    for (const job of this.jobs.values()) job.controller.abort(new Error("Compiler worker closing."));
    await Promise.allSettled([...this.jobs.values()].map(job => job.done));
    await this.host.close();
  }
  sessions() { return this.store.list<CompilerSession>("compiler-session").slice(0, 40); }
  session(sessionId: string) {
    const session = this.store.get<CompilerSession>("compiler-session", sessionId);
    if (!session) throw new AppError("COMPILER_SESSION_NOT_FOUND", "This compiler session does not exist.", 404);
    return session;
  }
  async preview(sessionId: string, captureId: string) {
    const session = this.session(sessionId);
    const capture = [...session.captures, ...session.verifications].find(item => item.id === captureId);
    if (!capture) throw new AppError("CAPTURE_NOT_FOUND", "This journey capture does not exist.", 404);
    const saved = await this.host.getSession(capture.execution.identity.sessionId);
    if (saved.buildId !== capture.buildId || saved.sourceDigest !== capture.sourceDigest)
      throw new AppError("CAPTURE_IDENTITY_MISMATCH", "The preview does not match the captured build and source.", 409);
    // Resolve the current listening origin without rewriting the historical receipt URL.
    return `${this.host.origin}/s/${saved.id}`;
  }
  private save(session: CompilerSession) {
    session.updatedAt = now(); this.store.put("compiler-session", session.id, session); return session;
  }
  async story(): Promise<CompilerBootstrap["story"]> {
    if (!this.storyPromise) this.storyPromise = (async () => {
      const fixture = fixtureDefinitions.find(item => item.family === "date-picker")!;
      const build = await this.host.prepareBuild({ fixtureId: fixture.id, source: await getOriginalSource(fixture.id) });
      const recorded = this.store.runs().find(run => run.fixtureId === fixture.id && run.candidates.some(candidate => candidate.status === "accepted" && candidate.verification?.passed));
      // /preview creates a fresh fictional service session on every visit. No recording begins here.
      return { fixtureId: fixture.id, originalPreviewUrl: build.previewUrl, recordedRunId: recorded?.id ?? null };
    })().catch(error => { this.storyPromise = undefined; throw error; });
    return this.storyPromise;
  }
  async bootstrap(): Promise<CompilerBootstrap> {
    const sessions = this.sessions();
    const qualification = await qualifyRepositoryWorker();
    return { fixtures: fixtureDefinitions.filter(item => item.family === "date-picker"), sessions,
      adapters: [
        { id: "authored-component", name: "Authored React journey", status: "ready", scope: "Fictional date-picker tasks with a protected local appointment service.", detail: "Actual browser actions and stored outcomes; original and reference builds have separate source identities." },
        { id: "external-react", name: "External React repository", status: qualification.status, scope: "Immutable source revision in a disposable build worker.", detail: qualification.status === "ready" ? "Disposable Linux worker qualified. Fixed React dependencies, no host mounts, no build network or provider credentials. Import a reviewed public-source manifest in the repository workspace." : qualification.reason },
      ], schedules: compilerSchedules, provider: this.provider.status(),
      recordedSessionId: sessions.find(session => session.review && session.repairs.some(repair => repair.status === "accepted" && repair.contractDigest === session.review!.contractDigest))?.id ?? null,
      story: await this.story(),
      limitations: ["Compiler drafts require operator review. No independent accessibility review or contract-quality study is claimed.", "Automated browser evidence is separate from actual AT and participant outcomes.", "Historic nine-check results retain their original scope and are not temporal acceptance."] };
  }
  create(input: { fixtureId: string; task?: string; captureConsent: true }): CompilerSession {
    const fixture = getFixture(input.fixtureId);
    if (fixture.family !== "date-picker") throw new AppError("COMPILER_ADAPTER_UNSUPPORTED", "The first compiler adapter supports date-picker journeys. Other authored families remain available in the original repair studio.", 422);
    const session: CompilerSession = { id: id("journey-compiler"), fixtureId: fixture.id, title: fixture.name,
      task: input.task?.trim() || fixture.task, createdAt: now(), updatedAt: now(), status: "ready", scope: "authored-fixture", captureConsent: true,
      captures: [], drafts: [], draft: null, review: null, verifications: [], repairs: [], revisions: [], error: null,
      assistiveEvidence: { status: "not-captured", evidenceClass: "none", participantCount: 0,
        note: "No actual screen-reader output or participant session has been captured for this journey. Browser focus is not speech." } };
    return this.save(session);
  }
  private startJob(sessionId: string, status: CompilerSession["status"], work: (signal: AbortSignal) => Promise<void>) {
    if (this.jobs.has(sessionId)) throw new AppError("COMPILER_BUSY", "This journey already has work in progress. Its observations remain visible.", 409);
    const session = this.session(sessionId); session.status = status; session.error = null; this.save(session);
    const controller = new AbortController();
    const done = this.tail.then(async () => {
      controller.signal.throwIfAborted(); await work(controller.signal);
    }).then(() => {
      const latest = this.session(sessionId); latest.status = latest.review ? "approved" : latest.draft ? "review" : "ready"; this.save(latest);
    }).catch(error => {
      const latest = this.session(sessionId); latest.status = "error";
      if (error instanceof GenerationOutputError) this.store.put("compiler-generation-failure", error.failure.id, error.failure);
      latest.error = { code: controller.signal.aborted ? "CANCELLED" : error instanceof AppError ? error.code : "COMPILER_OPERATION_FAILED",
        message: controller.signal.aborted ? "The operation was cancelled. Completed evidence remains available." : error instanceof Error ? error.message.slice(0, 2000) : "Compiler work could not finish." };
      const repair = latest.repairs.at(-1);
      if (repair && ["localizing", "generating", "verifying"].includes(repair.status)) { repair.status = "error"; repair.error = latest.error.message; repair.errorCode = latest.error.code; }
      this.save(latest);
    }).finally(() => { this.jobs.delete(sessionId); });
    this.jobs.set(sessionId, { controller, done }); this.tail = done;
    return session;
  }
  cancel(sessionId: string) {
    const job = this.jobs.get(sessionId);
    if (!job) throw new AppError("NO_ACTIVE_COMPILER_JOB", "This journey has no running operation.", 409);
    job.controller.abort(new Error("Cancelled by operator.")); return this.session(sessionId);
  }
  async wait(sessionId: string) { await this.jobs.get(sessionId)?.done; return this.session(sessionId); }
  private async source(session: CompilerSession, variant: CompilerVariant) {
    if (variant === "original") return getOriginalSource(session.fixtureId);
    if (variant === "reference") return getReferenceSource(session.fixtureId);
    const patch = [...session.repairs].reverse().find(repair => repair.patches.length)?.patches[0];
    if (!patch) throw new AppError("NO_COMPILER_CANDIDATE", "Generate a candidate before running its contract.", 409);
    if (sha256(patch.source) !== patch.afterDigest) throw new AppError("CANDIDATE_INTEGRITY_FAILED", "Candidate source no longer matches its recorded digest.", 409);
    return patch.source;
  }
  private approved(session: CompilerSession, scheduleId: CompilerSchedule) {
    if (!session.draft || !session.review || session.review.draftDigest !== session.draft.digest || session.review.contractDigest !== suiteDigest(session.draft)) throw new AppError("CONTRACT_REVIEW_REQUIRED", "Approve this exact draft before repairing or verifying it.", 409);
    return approveTemporalContract(session.draft.contractsBySchedule[scheduleId], { actor: session.review.interactionReviewer,
      role: "operator", approvedAt: session.review.approvedAt, evidenceClass: "authored-development" });
  }
  private async execute(session: CompilerSession, variant: CompilerVariant, scheduleId: CompilerSchedule, contract: TemporalContract, signal: AbortSignal, sourceOverride?: string, actions?: TemporalAction[]): Promise<CompilerCapture> {
    const source = sourceOverride ?? await this.source(session, variant);
    const safety = validateCandidateSource(source);
    if (!safety.valid) throw new AppError("SOURCE_REJECTED", safety.errors.join(" "), 422);
    const build = await this.host.prepareBuild({ fixtureId: session.fixtureId, source });
    signal.throwIfAborted();
    const execution = await runFixtureTemporal({ host: this.host, build, scenario: scenarioDefinitions[0], contract, actions, signal });
    const captureId = id("capture");
    const trace = traceEvents(execution, captureId);
    const fixtureSession = await this.host.getSession(execution.identity.sessionId);
    const checks: CompilerCapture["checks"] = execution.checks.map(check => ({ ...check, status: check.status === "not-run" ? "inconclusive" : check.status }));
    const result: CompilerCapture = { id: captureId, createdAt: now(), variant, scheduleId,
      sourceDigest: build.digest, buildId: build.id, previewUrl: `${this.host.origin}/s/${fixtureSession.id}`,
      trace, checks, status: execution.status === "cancelled" ? "inconclusive" : execution.status,
      outcome: fixtureSession.outcome ? { ...fixtureSession.outcome } : null, execution, contractDigest: contract.digest,
      limitations: execution.limitations };
    if (execution.failureSignature) {
      const eventIds = new Set(execution.checks.filter(check => check.status === "failed").map(check => check.actionId));
      const keyEvents = trace.filter((event, index) => event.kind === "assertion" && checks.some(check => check.status === "failed" && check.label === event.label) || eventIds.has(execution.trace[index]?.actionId ?? ""));
      result.counterexample = { summary: checks.filter(check => check.status === "failed").map(check => check.actual).join(" "), events: keyEvents, attempts: 0, minimal: false };
    }
    return result;
  }
  capture(sessionId: string, input: { variant: CompilerVariant; scheduleId: CompilerSchedule }) {
    return this.startJob(sessionId, "capturing", async signal => {
      const session = this.session(sessionId);
      const contract = defaultContracts(session.task, 1)[input.scheduleId];
      const capture = await this.execute(session, input.variant, input.scheduleId, contract, signal);
      const latest = this.session(sessionId); latest.captures.push(capture); this.save(latest);
    });
  }
  draft(sessionId: string, input: { mode: "observed" | "live"; reviewNotes?: string }) {
    const session = this.session(sessionId);
    if (!session.captures.some(capture => capture.trace.length)) throw new AppError("OBSERVATION_REQUIRED", "Record an actual attempt before drafting its requirements.", 409);
    if (input.mode === "live") this.provider.assertAvailable();
    return this.startJob(sessionId, "drafting", async signal => {
      const current = this.session(sessionId), version = current.drafts.length + 1;
      let contracts = defaultContracts(current.task, version);
      const generated = input.mode === "live" ? await draftWithModel({ provider: this.provider, runId: current.id,
        task: current.task, captures: current.captures, contracts: Object.values(contracts), signal, reviewNotes: input.reviewNotes }) : null;
      if (generated) contracts = Object.fromEntries(scheduleIds.map(schedule => [schedule, generated.contracts.find(contract => contract.id === contracts[schedule].id)!])) as Record<CompilerSchedule, TemporalContract>;
      const draft: CompilerDraft = { id: id("contract-draft"), version, digest: "", createdAt: now(), method: input.mode,
        summary: generated?.summary ?? "Observed actions are linked to bounded development requirements. Each requirement remains inferred until the operator confirms its intent and bindings.",
        obligations: generated?.obligations ?? observedDraftObligations(contracts, current.captures),
        ambiguities: generated?.ambiguities ?? ["Confirm that 16 November 2026 is the intended fictional date and that cancellation must preserve the previous choice.", "Confirm that the calendar is modal and that closing it should return focus to its trigger.", "Actual AT usability and independent human review remain unverified."],
        contract: contracts.baseline, contractsBySchedule: contracts, ...(generated ? { receipt: generated.receipt } : {}) };
      draft.digest = sha256(JSON.stringify({ version, task: current.task, obligations: draft.obligations, ambiguities: draft.ambiguities,
        contracts: scheduleIds.map(schedule => ({ schedule, digest: contracts[schedule].digest })), captureIds: current.captures.map(capture => capture.id) }));
      const latest = this.session(sessionId); latest.drafts.push(draft); latest.draft = draft; latest.review = null; this.save(latest);
    });
  }
  review(sessionId: string, raw: unknown) {
    const input = reviewSchema.parse(raw), session = this.session(sessionId);
    if (this.jobs.has(sessionId)) throw new AppError("COMPILER_BUSY", "Wait for the active operation before approving requirements.", 409);
    if (!session.draft || session.draft.digest !== input.expectedDigest) throw new AppError("STALE_CONTRACT_DRAFT", "The draft changed. Review the current version before approving it.", 409);
    Object.values(session.draft.contractsBySchedule).forEach(validateTemporalContract);
    session.review = { id: id("contract-review"), draftDigest: session.draft.digest, contractDigest: suiteDigest(session.draft), approvedAt: now(),
      maintainer: input.maintainer, interactionReviewer: input.interactionReviewer, acknowledgeInferred: true,
      evidenceClass: input.reviewProvenance === "automated-development" ? "automated-development-review" : "operator-attested-review", reviewProvenance: input.reviewProvenance, independentlyReviewed: false };
    session.status = "approved"; session.error = null; return this.save(session);
  }
  verify(sessionId: string, input: { variant: CompilerVariant; scheduleId: CompilerSchedule }) {
    this.approved(this.session(sessionId), input.scheduleId);
    return this.startJob(sessionId, "verifying", async signal => {
      const session = this.session(sessionId), contract = this.approved(session, input.scheduleId);
      const result = await this.execute(session, input.variant, input.scheduleId, contract, signal);
      const latest = this.session(sessionId); latest.verifications.push(result); this.save(latest);
    });
  }
  reduce(sessionId: string, captureId: string) {
    const session = this.session(sessionId), result = [...session.captures, ...session.verifications].find(capture => capture.id === captureId);
    if (!result || result.execution.status !== "failed" || !result.execution.failureSignature) throw new AppError("REDUCTION_REQUIRES_FAILURE", "Select an actual failed temporal assertion to minimize its schedule.", 409);
    return this.startJob(sessionId, "verifying", async signal => {
      const current = this.session(sessionId);
      const contract = current.review && current.draft?.contractsBySchedule[result.scheduleId].digest === result.contractDigest ? this.approved(current, result.scheduleId) : defaultContracts(current.task, 1)[result.scheduleId];
      if (contract.digest !== result.contractDigest) throw new AppError("CONTRACT_VERSION_MISMATCH", "The failed execution belongs to a different immutable contract. Use its retained guard for reduction.", 409);
      const build = await this.host.getBuild(result.buildId);
      const probe = this.store.get<{ proposal: CompiledSchedule }>("public-probe", captureId);
      const schedule = probe?.proposal ?? { id: result.scheduleId, label: result.scheduleId, steps: contract.actions.map(action => action.id) };
      const legacyKey = `${sessionId}:${captureId}`, legacy = this.store.get<ScheduleReduction>("schedule-reduction", legacyKey);
      if (legacy) {
        const legacyId = `legacy-reduction_${sha256(JSON.stringify({ legacyKey, legacy }))}`;
        if (!this.store.get("compiler-reduction", legacyId)) this.store.put("compiler-reduction", legacyId, {
          schema: "passage.reduction-run/v1", id: legacyId, sessionId, captureId, sourceDigest: result.sourceDigest,
          contractDigest: contract.digest, status: "completed", provenance: "preserved-legacy-record", importedAt: now(),
          originalRecordedAt: null, legacyStorageKey: legacyKey, result: legacy, previousCounterexample: result.counterexample ?? null,
          limitation: "Legacy storage retained counts and its final execution; rejected trial traces and the original reduction timestamp were not recorded." });
      }
      const reductionId = id("reduction-run"), startedAt = now(), replayIds: string[] = [];
      const identity = { schema: "passage.reduction-run/v1", id: reductionId, sessionId, captureId,
        sourceDigest: result.sourceDigest, buildId: result.buildId, contractDigest: contract.digest, startedAt,
        provenance: "automated-development", independentlyReviewed: false };
      this.store.put("compiler-reduction-started", reductionId, { ...identity, status: "started" });
      try {
        const reduced = await reduceSchedule({ contract, schedule, initial: result.execution, maxAttempts: 24, signal,
          onReplay: replay => { const replayId = id("reduction-replay"); replayIds.push(replayId);
            this.store.put("compiler-reduction-replay", replayId, { id: replayId, reductionId, sessionId, captureId,
              sourceDigest: result.sourceDigest, contractDigest: contract.digest, recordedAt: now(), replay }); },
          execute: compiled => runFixtureTemporal({ host: this.host, build, scenario: scenarioDefinitions[0], contract, actions: compiled.actions, signal }) });
        this.store.transaction(() => {
          this.store.put("compiler-reduction", reductionId, { ...identity, status: "completed", completedAt: now(), replayIds, result: reduced });
          const latest = this.session(sessionId), stored = [...latest.captures, ...latest.verifications].find(capture => capture.id === captureId)!;
          stored.counterexample = { summary: reduced.minimized.map(actionId => contract.actions.find(action => action.id === actionId)!.label).join(" → "),
            events: traceEvents(reduced.execution, `${captureId}-${reductionId}`), attempts: reduced.attempts, minimal: false,
            reductionId, originalSteps: reduced.original, minimizedSteps: reduced.minimized, acceptedRemovals: reduced.acceptedRemovals,
            search: reduced.search, historyCount: this.store.list<{ sessionId: string; captureId: string }>("compiler-reduction").filter(run => run.sessionId === sessionId && run.captureId === captureId).length };
          this.save(latest);
        });
      } catch (error) {
        this.store.transaction(() => {
          this.store.put("compiler-reduction", reductionId, { ...identity, status: "error", completedAt: now(), replayIds,
            error: error instanceof Error ? error.message.slice(0, 1500) : "The bounded reduction did not finish." });
          const latest = this.session(sessionId), stored = [...latest.captures, ...latest.verifications].find(capture => capture.id === captureId);
          if (stored?.counterexample) {
            stored.counterexample.historyCount = this.store.list<{ sessionId: string; captureId: string }>("compiler-reduction")
              .filter(run => run.sessionId === sessionId && run.captureId === captureId).length;
            this.save(latest);
          }
        });
        throw error;
      }
    });
  }
  probe(sessionId: string, input: { variant: CompilerVariant; scheduleId: CompilerSchedule; label: string; steps: string[] }) {
    const session = this.session(sessionId), contract = this.approved(session, input.scheduleId);
    const proposal = compileSchedule(contract, { id: id("public-probe"), label: input.label, steps: input.steps });
    return this.startJob(sessionId, "verifying", async signal => {
      const current = this.session(sessionId);
      if (this.approved(current, input.scheduleId).digest !== proposal.contractDigest) throw new AppError("STALE_PROBE", "Review the current contract before running this public schedule.", 409);
      const result = await this.execute(current, input.variant, input.scheduleId, contract, signal, undefined, proposal.actions);
      result.scheduleProposal = { id: proposal.id, label: proposal.label, steps: proposal.steps };
      const latest = this.session(sessionId); latest.verifications.push(result); this.save(latest);
      this.store.put("public-probe", result.id, { proposal, resultId: result.id, sourceDigest: result.sourceDigest });
    });
  }
  explore(sessionId: string, input: { variant: CompilerVariant; scheduleId: CompilerSchedule }) {
    const session = this.session(sessionId), contract = this.approved(session, input.scheduleId);
    this.provider.assertAvailable();
    return this.startJob(sessionId, "verifying", async signal => {
      const current = this.session(sessionId), proposalId = id("public-probe");
      const evidence: Record<string, unknown> = { id: proposalId, sessionId, createdAt: now(), contractDigest: contract.digest,
        variant: input.variant, scheduleId: input.scheduleId, status: "proposing", classification: "public-development-probe" };
      const save = () => this.store.put("compiler-exploration", proposalId, evidence);
      save();
      try {
        const sourceDigest = sha256(await this.source(current, input.variant));
        const observations = [...current.captures, ...current.verifications].filter(capture =>
          capture.sourceDigest === sourceDigest && capture.scheduleId === input.scheduleId && capture.contractDigest === contract.digest).slice(-1);
        evidence.sourceDigest = sourceDigest;
        evidence.observationIds = observations.map(capture => capture.id);
        save();
        const generated = await proposeScheduleWithModel({ provider: this.provider, runId: sessionId, proposalId,
          task: current.task, captures: observations, contract, signal,
          onProposal: (proposal, receipt) => { evidence.proposal = proposal; evidence.receipt = receipt; save(); } });
        signal.throwIfAborted();
        if (this.approved(this.session(sessionId), input.scheduleId).digest !== generated.proposal.contractDigest)
          throw new AppError("STALE_PROBE", "The approved contract changed before this event schedule could run.", 409);
        evidence.status = "executing"; save();
        const result = await this.execute(current, input.variant, input.scheduleId, contract, signal, undefined, generated.proposal.actions);
        result.scheduleProposal = { id: generated.proposal.id, label: generated.proposal.label, steps: generated.proposal.steps, receipt: generated.receipt };
        const latest = this.session(sessionId); latest.verifications.push(result); this.save(latest);
        this.store.put("public-probe", result.id, { proposal: generated.proposal, resultId: result.id, sourceDigest: result.sourceDigest });
        evidence.status = "completed"; evidence.resultId = result.id; evidence.executionStatus = result.status;
      } catch (error) {
        evidence.status = "error"; evidence.error = error instanceof Error ? error.message.slice(0, 2000) : "The bounded probe could not finish.";
        throw error;
      } finally { evidence.completedAt = now(); save(); }
    });
  }
  repair(sessionId: string, rawObservation?: unknown) {
    const session = this.session(sessionId); this.approved(session, "baseline"); this.provider.assertAvailable();
    const observation = rawObservation === undefined ? undefined : sourceObservationSchema.parse(rawObservation);
    return this.startJob(sessionId, "repairing", async signal => {
      const current = this.session(sessionId), previous = [...current.repairs].reverse().find(repair => repair.patches.length);
      const source = previous?.patches[0]?.source ?? await getOriginalSource(current.fixtureId);
      if (observation && observation.sourceDigest !== sha256(source))
        throw new AppError("STALE_SOURCE_OBSERVATION", "This observation describes different source bytes. Inspect the current candidate before requesting a repair with additional feedback.", 409);
      const currentSourceAdmission = validateCandidateSource(source);
      const executedCandidates = current.verifications.filter(result => result.variant === "candidate");
      const sameSourceEvidence = executedCandidates.filter(result => result.sourceDigest === sha256(source));
      const candidateEvidence = sameSourceEvidence.length
        ? scheduleIds.flatMap(scheduleId => sameSourceEvidence.filter(result => result.scheduleId === scheduleId).slice(-1))
        : executedCandidates.slice(-3);
      // Diagnose the inspected revision when it has executed. All older captures
      // remain in the session/export, outside this current-source diagnosis.
      const diagnosisEvidence = candidateEvidence.length ? candidateEvidence : current.captures;
      const path = getFixture(current.fixtureId).sourceFile;
      const repair: CompilerRepair = { id: id("journey-repair"), createdAt: now(), contractDigest: current.review!.contractDigest,
        acceptancePolicy: "frozen-suite-and-preservation-v1",
        status: "localizing", summary: "Inspecting the observed transition in the permitted source.", locations: [], patches: [], receipts: [], verificationIds: [],
        ...(observation ? { additionalObservation: { ...observation, id: id("source-observation"), recordedAt: now(), independentlyReviewed: false as const } } : {}) };
      current.repairs.push(repair); this.save(current);
      const generated = await localizeAndPatch({ provider: this.provider, runId: current.id, task: current.task,
        captures: diagnosisEvidence,
        draft: { ...current.draft!, contract: this.approved(current, "baseline") },
        files: [{ path, content: source, digest: sha256(source) }], signal, capabilities, inspectionMode: "only-permitted-file",
        admissionDiagnostics: currentSourceAdmission.valid ? [] : [{ path, sourceDigest: sha256(source), errors: currentSourceAdmission.errors.slice(0, 10) }],
        additionalSourceObservations: current.repairs.flatMap(item => [
          ...(item.additionalObservation ? [item.additionalObservation] : []),
          ...(item.preservationChecks?.flatMap(check => check.sourceObservation ? [check.sourceObservation] : []).slice(-1) ?? []),
        ])
          .filter(item => item.sourceDigest === sha256(source)).slice(-3),
        previousFeedback: { sourceError: previous?.error ? { code: previous.errorCode ?? (session.error?.message === previous.error ? session.error.code : null), message: previous.error } : null,
          currentSourceAdmission: { sourceDigest: sha256(source), valid: currentSourceAdmission.valid, errors: currentSourceAdmission.errors.slice(0, 10) },
          additionalObservedFeedback: repair.additionalObservation ?? null,
          priorSourceObservations: current.repairs.filter(item => item.id !== repair.id && item.additionalObservation).slice(-3).map(item => item.additionalObservation),
          observationScope: { inspectedSourceDigest: sha256(source),
            kind: sameSourceEvidence.length ? "exact-inspected-revision" : candidateEvidence.length ? "earlier-executed-revision" : "original-attempt",
            detail: sameSourceEvidence.length ? "These executions observed the inspected source bytes."
              : "These executions predate the inspected source. They document the task failure, not a proven behavior of the unexecuted revision." },
          candidateChecks: candidateEvidence.map(result => ({ sourceDigest: result.sourceDigest, schedule: result.scheduleId, checks: result.checks, counterexample: result.counterexample })),
          rejectedModelOutputs: this.store.list<GenerationFailure>("compiler-generation-failure")
            .filter(failure => failure.runId === current.id).slice(0, 3).map(failure => retainedFailureFeedback(this.store, failure, sha256(source))) },
        onStage: (stage, data) => { const latest = this.session(sessionId), active = latest.repairs.find(item => item.id === repair.id)!;
          active.status = stage; if (data?.inspection) active.inspection = data.inspection; if (data?.locations) active.locations = data.locations; if (data?.receipt) active.receipts.push(data.receipt); this.save(latest); },
      });
      const latest = this.session(sessionId), active = latest.repairs.find(item => item.id === repair.id)!;
      active.status = "verifying"; active.summary = generated.summary; active.locations = generated.locations; active.patches = generated.patches; active.receipts = generated.receipts; this.save(latest);
      if (generated.patches.length !== 1 || generated.patches[0].path !== path) throw new AppError("PATCH_SCOPE_VIOLATION", "The authored component adapter accepts only its one configured source module.", 422);
      const results: CompilerCapture[] = [];
      for (const scheduleId of scheduleIds) {
        signal.throwIfAborted();
        const fresh = this.session(sessionId);
        const result = await this.execute(fresh, "candidate", scheduleId, this.approved(fresh, scheduleId), signal, generated.patches[0].source);
        results.push(result);
        const updated = this.session(sessionId); updated.verifications.push(result); updated.repairs.find(item => item.id === repair.id)!.verificationIds.push(result.id); this.save(updated);
      }
      const preservation = await this.runPreservation(this.session(sessionId), generated.patches[0].source, signal, { repairId: repair.id, reason: "automatic-acceptance" });
      signal.throwIfAborted();
      const complete = this.session(sessionId); complete.repairs.find(item => item.id === repair.id)!.status = results.every(result => result.status === "passed") && preservation.passed ? "accepted" : "rejected"; this.save(complete);
    });
  }
  private async runPreservation(session: CompilerSession, source: string, signal: AbortSignal,
    owner: { repairId?: string; revisionId?: string; reason: CompilerPreservationCheck["reason"] }): Promise<CompilerPreservationCheck> {
    signal.throwIfAborted();
    const checkId = id("preservation-check"), sourceDigest = sha256(source), createdAt = now();
    const identity = { schema: "passage.compiler-preservation/v1", id: checkId, sessionId: session.id, ...owner,
      sourceDigest, contractDigest: session.review!.contractDigest, createdAt, independentlyReviewed: false };
    this.store.put("compiler-preservation-started", checkId, { ...identity, status: "started" });
    try {
      const report = await checkAuthoredPreservation({ source, fixtureId: session.fixtureId, signal });
      if (report.source.digest !== sourceDigest || report.build.digest !== sourceDigest || report.runs.some(run => run.identity.sourceDigest !== sourceDigest))
        throw new AppError("PRESERVATION_IDENTITY_MISMATCH", "The preservation report does not describe the inspected source. No acceptance was recorded.", 500);
      const expectedRuns = ["baseline:pointer-booking", "baseline:close-control-keyboard", "combined:pointer-booking", "combined:close-control-keyboard"];
      const cancelled = signal.aborted || report.cancelled === true;
      const passed = !cancelled && report.passed && report.runs.length === expectedRuns.length &&
        expectedRuns.every(key => report.runs.filter(run => `${run.scenario.id}:${run.kind}` === key && run.passed).length === 1);
      const artifact = this.store.artifact(Buffer.from(JSON.stringify(report)));
      const summary: CompilerPreservationCheck = { id: checkId, sessionId: session.id, ...owner, createdAt, completedAt: report.completedAt,
        sourceDigest, contractDigest: session.review!.contractDigest, verifierVersion: report.verifierVersion, reportDigest: artifact.digest,
        status: cancelled ? "cancelled" : passed ? "passed" : report.runs.some(run => run.status === "error") ? "error" : "failed", passed,
        runs: report.runs.map(run => ({ id: run.id, kind: run.kind, scenarioId: run.scenario.id, status: run.status, passed: run.passed, checks: run.checks })) };
      if (!cancelled && report.runs.some(run => run.status === "failed")) summary.sourceObservation = {
        id: `source-observation_${checkId}`, sourceDigest, observer: "Passage authored preservation runner", provenance: "automated-development",
        recordedAt: report.completedAt, independentlyReviewed: false,
        details: (`Actual additional preservation report ${artifact.digest}, protocol ${report.verifierVersion}, on these exact source bytes. ` +
          report.runs.map(run => `${run.scenario.id} / ${run.kind}: ${run.status}. ` + run.checks.filter(check => check.status === "failed")
            .map(check => `${check.label}: expected ${check.expected}; observed ${check.actual}.`).join(" ")).join("\n") +
          "\nThese observations are separate from the frozen temporal assertions. Preserve passing behavior while addressing actual failures; environment errors or unexecuted checks are not evidence of a source defect.").slice(0, 5000),
      };
      this.store.transaction(() => {
        this.store.put("compiler-preservation", checkId, { ...identity, completedAt: report.completedAt, status: summary.status, summary, report });
        if (owner.repairId) {
          const latest = this.session(session.id), repair = latest.repairs.find(item => item.id === owner.repairId);
          if (!repair || repair.contractDigest !== summary.contractDigest || repair.patches[0]?.afterDigest !== sourceDigest)
            throw new AppError("STALE_PRESERVATION", "The repair identity changed before preservation evidence could attach.", 409);
          (repair.preservationChecks ??= []).push(summary); this.save(latest);
        }
      });
      // Persist returned partial evidence before cancellation prevents acceptance.
      signal.throwIfAborted();
      return summary;
    } catch (error) {
      if (!this.store.get("compiler-preservation", checkId)) this.store.put("compiler-preservation", checkId, { ...identity,
        completedAt: now(), status: signal.aborted ? "cancelled" : "error", error: error instanceof Error ? error.message.slice(0, 1500) : "Preservation did not complete." });
      throw error;
    }
  }
  preservation(sessionId: string, repairId: string) {
    const session = this.session(sessionId); this.approved(session, "baseline");
    const repair = session.repairs.find(item => item.id === repairId);
    if (!repair || repair.contractDigest !== session.review!.contractDigest || repair.patches.length !== 1)
      throw new AppError("PRESERVATION_REQUIRES_SOURCE", "Select a retained source patch under the current reviewed suite.", 409);
    return this.startJob(sessionId, "verifying", async signal => {
      await this.runPreservation(this.session(sessionId), repair.patches[0].source, signal, { repairId, reason: "later-check" });
    });
  }
  revision(sessionId: string, input: { label: string; classification: "harmless-refactor" | "declared-regression" | "external-revision"; source: string }) {
    const session = this.session(sessionId); this.approved(session, "baseline");
    const safety = validateCandidateSource(input.source); if (!safety.valid) throw new AppError("SOURCE_REJECTED", safety.errors.join(" "), 422);
    return this.startJob(sessionId, "verifying", async signal => {
      const results: CompilerCapture[] = [];
      for (const scheduleId of scheduleIds) {
        const current = this.session(sessionId);
        const result = await this.execute(current, "candidate", scheduleId, this.approved(current, scheduleId), signal, input.source);
        results.push(result); const latest = this.session(sessionId); latest.verifications.push(result); this.save(latest);
      }
      const revisionId = id("revision-check");
      const preservation = await this.runPreservation(this.session(sessionId), input.source, signal, { revisionId, reason: "revision-check" });
      signal.throwIfAborted();
      const latest = this.session(sessionId);
      latest.revisions.push({ id: revisionId, createdAt: now(), label: input.label, classification: input.classification,
        acceptancePolicy: "frozen-suite-and-preservation-v1", preservationCheck: preservation,
        sourceDigest: sha256(input.source), contractDigest: latest.review!.contractDigest, verificationIds: results.map(result => result.id), passed: results.every(result => result.status === "passed") && preservation.passed });
      this.save(latest);
    });
  }
  export(sessionId: string) {
    const session = this.session(sessionId); this.approved(session, "baseline");
    const accepted = session.repairs.filter(repair => repair.status === "accepted" && repair.contractDigest === session.review!.contractDigest).at(-1);
    const latestPreservation = accepted?.preservationChecks?.at(-1);
    const requiresPreservation = accepted?.acceptancePolicy === "frozen-suite-and-preservation-v1" || Boolean(latestPreservation);
    return { schema: "passage-journey-guard/v1", generatedAt: now(), task: session.task, fixtureId: session.fixtureId,
      scope: session.scope, review: session.review, draftDigest: session.draft!.digest,
      acceptancePolicy: requiresPreservation ? "frozen-suite-and-preservation-v1" : "frozen-suite-only",
      preservationPolicy: requiresPreservation ? { required: true, verifierVersion: AUTHORED_PRESERVATION_VERSION, scenarios: ["baseline", "combined"], expectedRuns: 4,
        qualificationRecordId: latestPreservation?.id ?? null, latestQualificationPassed: latestPreservation?.passed ?? false,
        originalRepairAcceptancePolicy: accepted?.acceptancePolicy ?? "frozen-suite-only" } : null,
      contractsBySchedule: Object.fromEntries(scheduleIds.map(schedule => [schedule, this.approved(session, schedule)])),
      patches: accepted?.patches ?? [],
      evidence: { captures: session.captures, verifications: session.verifications, revisions: session.revisions, drafts: session.drafts, repairs: session.repairs,
        explorations: this.store.list<{ sessionId: string }>("compiler-exploration").filter(probe => probe.sessionId === session.id),
        reductionStarts: this.store.list<{ sessionId: string }>("compiler-reduction-started").filter(run => run.sessionId === session.id),
        reductions: this.store.list<{ sessionId: string }>("compiler-reduction").filter(run => run.sessionId === session.id),
        reductionReplays: this.store.list<{ sessionId: string }>("compiler-reduction-replay").filter(run => run.sessionId === session.id),
        preservationStarts: this.store.list<{ sessionId: string }>("compiler-preservation-started").filter(run => run.sessionId === session.id),
        preservationRuns: this.store.list<{ sessionId: string }>("compiler-preservation").filter(run => run.sessionId === session.id),
        generationFailures: this.store.list<{ runId: string }>("compiler-generation-failure").filter(failure => failure.runId === session.id) },
      limitations: ["Operator-attested development review, not independent accessibility acceptance.", "No participant benefit or actual AT qualification is implied.", "Only exact source identities and completed schedules have execution evidence."] };
  }
}
