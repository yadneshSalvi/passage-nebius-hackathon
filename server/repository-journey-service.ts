import { randomUUID } from "node:crypto";
import { createTwoFilesPatch } from "diff";
import { chromium } from "@playwright/test";
import { z } from "zod";
import type { CompilerCapture, CompilerObligation } from "../shared/compiler.js";
import type { RepositoryJourney, RepositoryJourneyBootstrap, RepositoryReplay, RepositoryContractDraft, RepositoryRepairAttempt, PublicRepositorySnapshot } from "../shared/repository-journey.js";
import type { TemporalContract, TemporalContractBody } from "../shared/temporal.js";
import { approveTemporalContract, executeContract, temporalContractBodySchema, validateTemporalContract } from "../engine/contract-interpreter.js";
import { recordTrace } from "../engine/trace-recorder.js";
import { chromiumExecutable } from "../engine/browser.js";
import { applyRepositoryPatch, buildRepository, inspectRepository, qualifyRepositoryWorker, validateRepositorySnapshot, type RepositoryOutcomeObserver, type RepositorySnapshot } from "../engine/repository-worker.js";
import { AppError, Store, id, now, sha256 } from "./store.js";
import { RepairProvider } from "./provider.js";
import { draftWithModel, localizeAndPatch } from "./journey-model.js";
import { GenerationOutputError } from "./generation-output.js";
import { importActualAT } from "./actual-at-evidence.js";
import { sourceNotices } from "./source-notices.js";

const active = new Set(["building", "capturing", "drafting", "repairing", "verifying"]);
const reviewSchema = z.object({ expectedDigest: z.string().regex(/^[a-f0-9]{64}$/), maintainer: z.string().trim().min(2).max(120), interactionReviewer: z.string().trim().min(2).max(120), acknowledgeInferred: z.literal(true), reviewProvenance: z.enum(["operator-attested", "automated-development"]).default("operator-attested") }).strict();
const localGitDetail = "Exact regular blobs in the local Git object database and its configured public remote were checked. This does not authenticate that the commit exists on the public upstream. Protected adapter bootstrap is separately disclosed.";
function currentProvenance(session: RepositoryJourney): RepositoryJourney {
  if (session.sourceProvenance?.kind === "git-blob-inspection") {
    session.sourceProvenance = { ...session.sourceProvenance, verifiedUpstreamBytes: false, localGitBlobsVerified: true, detail: localGitDetail,
      ...(session.sourceProvenance.verifiedUpstreamBytes ? { correction: "The earlier v1 verifiedUpstreamBytes label overstated a local Git check. Source/build bytes and historical execution receipts are unchanged." } : {}) };
  }
  return session;
}
function sameBoundary(a: RepositorySnapshot, b: RepositorySnapshot) {
  const adapter = (value: RepositorySnapshot) => JSON.stringify({
    repositoryUrl: value.repositoryUrl, entryPoint: value.entryPoint, rootElementId: value.rootElementId,
    rootElementClass: value.rootElementClass ?? "", bootstrap: value.bootstrap
      ? [value.bootstrap.source, value.bootstrap.description, value.bootstrap.sha256] : null,
    moduleAliases: Object.entries(value.moduleAliases ?? {}).sort(([a], [b]) => a.localeCompare(b)),
  });
  return adapter(a) === adapter(b);
}
function captureForModel(replay: RepositoryReplay): CompilerCapture {
  return { id: replay.id, createdAt: replay.createdAt, variant: "original", scheduleId: "baseline", sourceDigest: replay.sourceDigest,
    buildId: replay.build.id, previewUrl: replay.build.previewUrl,
    trace: replay.execution.trace.map(event => ({ id: `${replay.id}:${event.sequence}`, sequence: event.sequence, atMs: event.elapsedMs,
      kind: event.kind === "requestFailed" || event.kind === "error" || event.kind === "event" ? "dom" : event.kind === "input" ? "action" : event.kind,
      label: event.label, detail: JSON.stringify(event.data ?? {}), binding: event.target, correlationId: event.requestId, provenance: event.provenance })),
    checks: replay.execution.checks.map(check => ({ ...check, status: check.status === "not-run" ? "inconclusive" : check.status })),
    status: replay.execution.status === "cancelled" ? "inconclusive" : replay.execution.status,
    outcome: replay.protectedOutcome ? { ...replay.protectedOutcome } : null, execution: replay.execution,
    contractDigest: replay.contractDigest, limitations: replay.execution.limitations };
}
export class RepositoryJourneyService {
  private jobs = new Map<string, { controller: AbortController; done: Promise<void> }>();
  private tail: Promise<void> = Promise.resolve();
  constructor(readonly store: Store, readonly provider: RepairProvider, readonly observers: ReadonlyMap<string, RepositoryOutcomeObserver> = new Map()) {}
  start() {
    for (const session of this.sessions()) if (active.has(session.status)) {
      session.status = "error"; session.error = { code: "WORKER_RESTARTED", message: "The repository controller restarted. Completed build and replay receipts are retained; unfinished work was not accepted." }; this.save(session);
    }
  }
  async close() { for (const job of this.jobs.values()) job.controller.abort(new Error("Controller closing.")); await Promise.allSettled([...this.jobs.values()].map(job => job.done)); }
  sessions() { return this.store.list<RepositoryJourney>("repository-journey").slice(0, 40).map(currentProvenance); }
  session(sessionId: string) { const session = this.store.get<RepositoryJourney>("repository-journey", sessionId); if (!session) throw new AppError("REPOSITORY_JOURNEY_NOT_FOUND", "This repository journey does not exist.", 404); return currentProvenance(session); }
  private save(session: RepositoryJourney) { session.updatedAt = now(); this.store.put("repository-journey", session.id, session); return session; }
  async bootstrap(): Promise<RepositoryJourneyBootstrap> {
    return { worker: await qualifyRepositoryWorker(), sessions: this.sessions(), provider: this.provider.status(), limitations: [
      "Supported React source is built with the fixed worker dependency catalog; arbitrary package scripts and plugins are not executed.",
      "Public-source developer cases are not maintainer authorization, a holdout evaluation or participant evidence.",
      "UI checks cannot establish a business outcome. A separately configured protected outcome observer is required for that claim.",
      "Model-generated requirements remain proposals until the exact draft is reviewed. Local review is operator-attested."] };
  }
  async inspect(input: Parameters<typeof inspectRepository>[0]) {
    const snapshot = await inspectRepository(input);
    this.store.put("repository-inspection", snapshot.sourceDigest, { sourceDigest: snapshot.sourceDigest, revision: snapshot.revision, repositoryUrl: snapshot.repositoryUrl, inspectedAt: now() });
    return { snapshot, provenance: { kind: "git-blob-inspection", verifiedUpstreamBytes: false, localGitBlobsVerified: true, detail: localGitDetail } };
  }
  create(input: { label: string; task: string; snapshot: PublicRepositorySnapshot; contract: TemporalContractBody; sourcePermission: "public-source-development"; outcomeObserverId?: string }) {
    validateRepositorySnapshot(input.snapshot);
    const body = temporalContractBodySchema.parse(input.contract) as TemporalContractBody;
    if (body.allowedEvents.length) throw new AppError("UNCONFIGURED_EVENTS", "This static React adapter has no event driver. Configure an application adapter before admitting server event schedules.", 422);
    try {
      validateTemporalContract(approveTemporalContract(body, { actor: "Public-source development probe author", role: "operator", evidenceClass: "authored-development", approvedAt: now() }));
    } catch (error) {
      throw new AppError("INVALID_TEMPORAL_CONTRACT", error instanceof Error ? error.message.slice(0, 1000) : "The temporal contract is invalid.", 422);
    }
    if (input.outcomeObserverId && !this.observers.has(input.outcomeObserverId)) throw new AppError("OUTCOME_OBSERVER_UNAVAILABLE", "The selected protected outcome observer is not registered on this server.", 422);
    const session: RepositoryJourney = { id: id("repository-journey"), createdAt: now(), updatedAt: now(), label: input.label, task: input.task,
      status: "ready", snapshot: structuredClone(input.snapshot), build: null, proposedContract: body,
      draft: null, drafts: [], contract: null, review: null, replays: [], repairs: [], sourcePermission: input.sourcePermission,
      outcomeVerification: "not-configured", ...(input.outcomeObserverId ? { outcomeObserverId: input.outcomeObserverId } : {}),
      sourceProvenance: this.store.get("repository-inspection", input.snapshot.sourceDigest)
        ? { kind: "git-blob-inspection", verifiedUpstreamBytes: false, localGitBlobsVerified: true, detail: localGitDetail }
        : { kind: "operator-provided-manifest", verifiedUpstreamBytes: false, detail: "File/hash integrity verified. An uploaded self-declared revision does not prove these bytes exist in the upstream repository." }, error: null };
    return this.save(session);
  }
  private job(sessionId: string, status: RepositoryJourney["status"], action: (signal: AbortSignal) => Promise<void>) {
    if (this.jobs.has(sessionId)) throw new AppError("REPOSITORY_JOURNEY_BUSY", "An operation is already running for this source revision.", 409);
    const session = this.session(sessionId); session.status = status; session.error = null; this.save(session);
    const controller = new AbortController();
    const done = this.tail.then(async () => { controller.signal.throwIfAborted(); await action(controller.signal); }).then(() => {
      const latest = this.session(sessionId); latest.status = latest.review ? "approved" : latest.draft ? "review" : "ready"; this.save(latest);
    }).catch(error => {
      const latest = this.session(sessionId); latest.status = "error";
      if (error instanceof GenerationOutputError) this.store.put("compiler-generation-failure", error.failure.id, error.failure);
      const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "REPOSITORY_OPERATION_FAILED";
      latest.error = { code: controller.signal.aborted ? "CANCELLED" : code, message: controller.signal.aborted ? "Operation cancelled. Completed evidence remains available." : error instanceof Error ? error.message.slice(0, 2000) : "Repository work could not finish." };
      const repair = latest.repairs.at(-1); if (repair && ["localizing", "generating", "verifying"].includes(repair.status)) { repair.status = "error"; repair.error = latest.error.message; }
      this.save(latest);
    }).finally(() => { this.jobs.delete(sessionId); });
    this.jobs.set(sessionId, { controller, done }); this.tail = done; return session;
  }
  async wait(sessionId: string) { await this.jobs.get(sessionId)?.done; return this.session(sessionId); }
  cancel(sessionId: string) { const job = this.jobs.get(sessionId); if (!job) throw new AppError("NO_ACTIVE_REPOSITORY_JOB", "This repository has no active operation.", 409); job.controller.abort(new Error("Cancelled by operator.")); return this.session(sessionId); }
  private approved(session: RepositoryJourney): TemporalContract {
    if (!session.review || !session.draft || !session.contract || session.review.draftDigest !== session.draft.digest) throw new AppError("CONTRACT_REVIEW_REQUIRED", "Review the exact observed contract before repairing or verifying this repository.", 409);
    validateTemporalContract(session.contract); return session.contract;
  }
  build(sessionId: string) { return this.job(sessionId, "building", async signal => { const session = this.session(sessionId); const build = await buildRepository({ snapshot: session.snapshot, signal }); signal.throwIfAborted(); const latest = this.session(sessionId); latest.build = build; this.save(latest); }); }
  private async execute(session: RepositoryJourney, snapshot: RepositorySnapshot, contract: TemporalContract, label: string, signal: AbortSignal): Promise<RepositoryReplay> {
    const build = await buildRepository({ snapshot, signal }); signal.throwIfAborted();
    const browser = await chromium.launch({ headless: true, executablePath: await chromiumExecutable(), timeout: 20000 });
    const context = await browser.newContext({ serviceWorkers: "block", acceptDownloads: false, reducedMotion: "reduce" });
    const page = await context.newPage(); page.setDefaultTimeout(contract.bounds.actionTimeoutMs);
    const identity = { executionId: randomUUID(), sourceDigest: build.sourceDigest, buildId: build.id, sessionId: randomUUID(), contractDigest: contract.digest, adapter: "external-react-static-v1" };
    const recorder = await recordTrace(page, identity);
    const abort = () => { void context.close().catch(() => undefined); void browser.close().catch(() => undefined); }; signal.addEventListener("abort", abort, { once: true });
    const observer = session.outcomeObserverId ? this.observers.get(session.outcomeObserverId) : undefined;
    let protectedOutcome: RepositoryReplay["protectedOutcome"] = null;
    let completed: RepositoryReplay | undefined;
    try {
      const origin = new URL(build.previewUrl).origin;
      await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort("blockedbyclient"));
      await page.goto(build.previewUrl, { waitUntil: "domcontentloaded", timeout: 12000 });
      const execution = await executeContract({ page, contract, recorder, identity, signal,
        ...(observer ? { outcomeObserver: async () => {
          const observed = await observer.observe({ buildId: build.id, sourceDigest: build.sourceDigest, sessionId: identity.sessionId });
          if (!observed.verified || observed.sourceDigest !== build.sourceDigest || observed.observerId !== observer.id || !observed.records.every(record => record && typeof record === "object" && !Array.isArray(record))) throw new Error("Protected observer returned unverified or mismatched outcome identity.");
          protectedOutcome = { authority: observer.id, records: observed.records as Record<string, unknown>[] }; return protectedOutcome;
        } } : {}),
      });
      completed = { id: id("repository-replay"), createdAt: now(), label, sourceDigest: build.sourceDigest, contractDigest: contract.digest,
        build, execution, outcomeVerification: protectedOutcome ? "verified" : "not-configured", protectedOutcome };
      return completed;
    } finally {
      signal.removeEventListener("abort", abort);
      // Request target/browser termination before awaiting any page-dependent
      // recorder work. A starving renderer cannot hold the shared queue here.
      const closeContext = context.close();
      const closeBrowser = browser.close();
      const cleanup = Promise.allSettled([recorder.stop({ timeoutMs: 500, pageWillClose: true }), closeContext, closeBrowser]);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([cleanup, new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 2000); })]);
      clearTimeout(timer);
      const failure = result === null ? "Repository browser cleanup exceeded 2000 ms; termination was requested but process exit was not confirmed."
        : result[0].status === "rejected" ? result[0].reason : result[2].status === "rejected" ? result[2].reason : null;
      if (failure && completed) {
        const message = failure instanceof Error ? failure.message : String(failure);
        completed.execution.status = "error"; completed.execution.passed = false; completed.execution.failureSignature = null;
        completed.execution.error = [completed.execution.error, `Shutdown: ${message}`].filter(Boolean).join(" ");
        completed.execution.completedAt = now(); completed.execution.durationMs = Date.now() - Date.parse(completed.execution.startedAt);
        completed.execution.trace.push({ sequence: completed.execution.trace.length + 1, at: now(), elapsedMs: (completed.execution.trace.at(-1)?.elapsedMs ?? 0) + Math.max(0, Date.now() - Date.parse(completed.execution.trace.at(-1)?.at ?? completed.execution.startedAt)), provenance: "controller", kind: "error", label: message, data: { phase: "repository-shutdown", traceIncomplete: true } });
      }
    }
  }
  capture(sessionId: string) { return this.job(sessionId, "capturing", async signal => {
    const session = this.session(sessionId), probe = approveTemporalContract(session.proposedContract, { actor: "Public-source development probe author", role: "operator", evidenceClass: "authored-development", approvedAt: now() });
    const replay = await this.execute(session, session.snapshot, probe, "Observed original revision", signal);
    const latest = this.session(sessionId); latest.build = replay.build; latest.replays.push(replay); this.save(latest);
  }); }
  draft(sessionId: string, mode: "observed" | "live") {
    const session = this.session(sessionId);
    if (!session.replays.length) throw new AppError("OBSERVATION_REQUIRED", "Capture the original revision before drafting its requirements.", 409);
    if (mode === "live") this.provider.assertAvailable();
    return this.job(sessionId, "drafting", async signal => {
      const current = this.session(sessionId);
      let body: TemporalContractBody = { ...current.proposedContract, revision: current.drafts.length + 1 };
      const probe = approveTemporalContract(body, { actor: "Public-source development probe author", role: "operator", evidenceClass: "authored-development", approvedAt: now() });
      const captures = current.replays.map(captureForModel);
      const generated = mode === "live" ? await draftWithModel({ provider: this.provider, runId: current.id, task: current.task, captures, contracts: [probe], signal }) : null;
      if (generated) {
        const { digest: _digest, approval: _approval, ...generatedBody } = generated.contracts[0];
        body = generatedBody;
      }
      const lastCapture = captures.at(-1)!;
      const obligations: CompilerObligation[] = generated?.obligations ?? body.assertions.map(assertion => ({ id: assertion.id, text: assertion.label, origin: "inferred",
        evidenceRefs: lastCapture.trace.filter(event => event.kind === "assertion" && event.label === assertion.label).map(event => event.id).slice(0, 3), assertionIds: [assertion.id] }));
      const draft: RepositoryContractDraft = { id: id("repository-contract-draft"), digest: "", createdAt: now(), method: mode,
        summary: generated?.summary ?? "The supplied task bindings and actual observed events become a reviewed bounded contract. Existing requirements are preserved.",
        body, obligations, ambiguities: generated?.ambiguities ?? ["Confirm the supplied semantic bindings and intended task result.", "No protected business outcome is configured unless a separate server observer is registered.", "No actual participant or assistive-technology outcome is implied by browser checks."], ...(generated ? { receipt: generated.receipt } : {}) };
      draft.digest = sha256(JSON.stringify({ body, obligations, ambiguities: draft.ambiguities, observations: current.replays.map(replay => replay.id) }));
      const latest = this.session(sessionId); latest.draft = draft; latest.drafts.push(draft); latest.review = null; latest.contract = null; this.save(latest);
    });
  }
  review(sessionId: string, raw: unknown) {
    const input = reviewSchema.parse(raw), session = this.session(sessionId);
    if (this.jobs.has(sessionId)) throw new AppError("REPOSITORY_JOURNEY_BUSY", "Wait for the active operation before approving.", 409);
    if (!session.draft || session.draft.digest !== input.expectedDigest) throw new AppError("STALE_CONTRACT_DRAFT", "This draft changed. Review the current requirements.", 409);
    session.review = { maintainer: input.maintainer, interactionReviewer: input.interactionReviewer, approvedAt: now(), draftDigest: input.expectedDigest,
      evidenceClass: input.reviewProvenance === "automated-development" ? "automated-development-review" : "operator-attested-review", reviewProvenance: input.reviewProvenance, independentlyReviewed: false };
    session.contract = approveTemporalContract(session.draft.body, { actor: input.interactionReviewer, role: "operator", evidenceClass: "authored-development", approvedAt: session.review.approvedAt });
    validateTemporalContract(session.contract); session.status = "approved"; session.error = null; return this.save(session);
  }
  private candidateSnapshot(session: RepositoryJourney): RepositorySnapshot {
    const repair = [...session.repairs].reverse().find(item => item.patches.length);
    if (!repair) throw new AppError("NO_REPOSITORY_CANDIDATE", "Generate a source patch before checking a candidate.", 409);
    return applyRepositoryPatch(session.snapshot, Object.fromEntries(repair.patches.map(patch => {
      if (sha256(patch.source) !== patch.afterDigest) throw new AppError("CANDIDATE_INTEGRITY_FAILED", "Candidate source does not match its receipt.", 409);
      return [patch.path, patch.source];
    })));
  }
  revise(sessionId: string, raw: unknown) {
    const input = z.object({ expectedDigest: z.string().regex(/^[a-f0-9]{64}$/), dropAssertionIds: z.array(z.string().min(1).max(120)).min(1).max(100), notes: z.string().trim().min(10).max(3000) }).strict().parse(raw);
    if (this.jobs.has(sessionId)) throw new AppError("REPOSITORY_JOURNEY_BUSY", "Wait for the active operation before correcting its requirements.", 409);
    const session = this.session(sessionId), original = session.draft;
    if (!original || original.digest !== input.expectedDigest) throw new AppError("STALE_CONTRACT_DRAFT", "Review the latest draft before applying corrections.", 409);
    const protectedIds = new Set(session.proposedContract.assertions.map(assertion => assertion.id)), drop = new Set(input.dropAssertionIds);
    if (input.dropAssertionIds.some(id => protectedIds.has(id) || !original.body.assertions.some(assertion => assertion.id === id))) throw new AppError("PROTECTED_REQUIREMENT", "Only model-added assertions can be removed here. Changing an original task requirement needs a new recorded journey and review.", 409);
    const body = { ...original.body, revision: session.drafts.length + 1, assertions: original.body.assertions.filter(assertion => !drop.has(assertion.id)) };
    validateTemporalContract(approveTemporalContract(body, { actor: "Development draft correction", role: "operator", approvedAt: now(), evidenceClass: "authored-development" }));
    const obligations = original.obligations.map(obligation => ({ ...obligation, assertionIds: obligation.assertionIds.filter(id => !drop.has(id)) })).filter(obligation => obligation.assertionIds.length);
    const draft: RepositoryContractDraft = { id: id("repository-contract-draft"), digest: "", createdAt: now(), method: "operator-revision", parentDigest: original.digest,
      revisionNotes: input.notes, summary: "An explicit reviewer correction removed unsupported proposed assertions. Original protected requirements are unchanged.", body, obligations, ambiguities: original.ambiguities };
    draft.digest = sha256(JSON.stringify({ body, obligations, parentDigest: original.digest, revisionNotes: input.notes }));
    session.drafts.push(draft); session.draft = draft; session.contract = null; session.review = null; session.status = "review"; session.error = null; return this.save(session);
  }
  verify(sessionId: string, variant: "original" | "candidate") {
    this.approved(this.session(sessionId));
    return this.job(sessionId, "verifying", async signal => {
      const session = this.session(sessionId), snapshot = variant === "original" ? session.snapshot : this.candidateSnapshot(session);
      const replay = await this.execute(session, snapshot, this.approved(session), `Reviewed ${variant} revision`, signal);
      const latest = this.session(sessionId); latest.replays.push(replay); this.save(latest);
    });
  }
  revision(sessionId: string, input: { label: string; snapshot: PublicRepositorySnapshot }) {
    const session = this.session(sessionId); this.approved(session); validateRepositorySnapshot(input.snapshot);
    if (!sameBoundary(session.snapshot, input.snapshot)) throw new AppError("REPOSITORY_BOUNDARY_CHANGED", "A later revision must retain the same repository and protected adapter boundary. A changed application adapter requires new review.", 409);
    return this.job(sessionId, "verifying", async signal => {
      const current = this.session(sessionId), replay = await this.execute(current, input.snapshot, this.approved(current), input.label, signal);
      const latest = this.session(sessionId); latest.replays.push(replay); this.save(latest);
    });
  }
  repair(sessionId: string) {
    const session = this.session(sessionId); this.approved(session); this.provider.assertAvailable();
    return this.job(sessionId, "repairing", async signal => {
      const current = this.session(sessionId), previous = [...current.repairs].reverse().find(repair => repair.patches.length);
      const snapshot = previous?.patches.length ? this.candidateSnapshot(current) : current.snapshot;
      const contract = this.approved(current);
      const repair: RepositoryRepairAttempt = { id: id("repository-repair"), createdAt: now(), status: "localizing", contractDigest: contract.digest,
        summary: "Inspecting the permitted source for the observed transition.", locations: [], patches: [], receipts: [] };
      current.repairs.push(repair); this.save(current);
      const generated = await localizeAndPatch({ provider: this.provider, runId: current.id, task: current.task,
        captures: current.replays.map(captureForModel), draft: { contract, obligations: current.draft!.obligations },
        files: snapshot.files.map(file => ({ path: file.path, content: file.content, digest: file.sha256 })), signal,
        capabilities: "Fixed isolated React 19 static build adapter. Only existing source paths in the immutable manifest may change. The exact dependency catalog and protected mount bootstrap are fixed. No package scripts, dependency installation, external requests or provider credentials are available in the worker. Preserve original exports, inputs and task validation. The generic data-only interpreter and protected observer are outside your patch scope.",
        previousFeedback: previous?.replayId ? current.replays.find(replay => replay.id === previous.replayId)?.execution : null,
        onStage: (stage, data) => { const latest = this.session(sessionId), currentRepair = latest.repairs.find(item => item.id === repair.id)!;
          currentRepair.status = stage; if (data?.inspection) currentRepair.inspection = data.inspection; if (data?.locations) currentRepair.locations = data.locations; if (data?.receipt) currentRepair.receipts.push(data.receipt); this.save(latest); },
      });
      // Accumulate patches relative to the immutable original. A retry must not drop an earlier changed file.
      const merged = new Map((previous?.patches ?? []).map(patch => [patch.path, patch]));
      for (const patch of generated.patches) {
        const original = current.snapshot.files.find(file => file.path === patch.path)!;
        merged.set(patch.path, { ...patch, beforeDigest: original.sha256,
          diff: createTwoFilesPatch(`a/${patch.path}`, `b/${patch.path}`, original.content, patch.source, "immutable original", "cumulative candidate") });
      }
      const latest = this.session(sessionId), attempt = latest.repairs.find(item => item.id === repair.id)!;
      attempt.patches = [...merged.values()]; attempt.locations = generated.locations; attempt.receipts = generated.receipts;
      attempt.summary = generated.summary; attempt.status = "verifying"; this.save(latest);
      const patched = applyRepositoryPatch(current.snapshot, Object.fromEntries(attempt.patches.map(patch => [patch.path, patch.source])));
      const replay = await this.execute(latest, patched, contract, "Model candidate against frozen contract", signal);
      const complete = this.session(sessionId), final = complete.repairs.find(item => item.id === repair.id)!;
      final.replayId = replay.id; final.status = replay.execution.passed ? "accepted" : "rejected"; complete.replays.push(replay); this.save(complete);
    });
  }
  export(sessionId: string) {
    const session = this.session(sessionId), contract = this.approved(session);
    return { schema: "passage-repository-guard/v1", generatedAt: now(), task: session.task, source: session.snapshot,
      sourceNotices: sourceNotices(session.snapshot.repositoryUrl),
      contract, review: session.review, sourceProvenance: session.sourceProvenance,
      patches: session.repairs.filter(repair => repair.status === "accepted" && repair.contractDigest === contract.digest).at(-1)?.patches ?? [],
      replays: session.replays, drafts: session.drafts, repairs: session.repairs, assistiveCaptures: session.assistiveCaptures ?? [], outcomeVerification: session.outcomeVerification,
      generationFailures: this.store.list<{ runId: string }>("compiler-generation-failure").filter(failure => failure.runId === session.id),
      runner: "npm run verify:repository-guard -- --guard /absolute/path/guard.json --snapshot /absolute/path/next-snapshot.json",
      limitations: ["Requires the same qualified disposable worker and reviewed protected outcome adapter.", "Recorded UI success is not protected business completion when no observer is configured.", "Operator-attested developer evidence, not independent maintainer or participant validation."] };
  }
  attachAT(sessionId: string, raw: unknown) {
    const session = this.session(sessionId), capture = importActualAT(this.store, session, raw);
    if (session.assistiveCaptures?.some(item => item.digest === capture.digest)) return session;
    session.assistiveCaptures = [...(session.assistiveCaptures ?? []), capture]; return this.save(session);
  }
}
