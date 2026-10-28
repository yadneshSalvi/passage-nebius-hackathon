import { createTwoFilesPatch } from "diff";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type {
  Candidate,
  EvidenceManifest,
  HumanObservation,
  InteractionContract,
  Journey,
  RepairRun,
  RunMode,
  RunStatus,
  Scenario,
  VerificationResult,
} from "../shared/types.js";
import {
  fixtureDefinitions,
  scenarioDefinitions,
  effectiveScenario,
  createContract,
  getOriginalSource,
  getReferenceSource,
  validateCandidateSource,
  FixtureEngine,
  type FixtureBuild,
} from "../engine/index.js";
import { AppError, Store, id, now, sha256 } from "./store.js";
import { RepairProvider, PROMPT_VERSION } from "./provider.js";
import { GenerationOutputError } from "./generation-output.js";

export type Build = FixtureBuild;
export interface Engine {
  root?: string;
  start(): Promise<unknown>;
  close(): Promise<unknown>;
  prepareBuild(input: { fixtureId: string; source: string }): Promise<Build>;
  verify(input: {
    build: Build;
    contract: InteractionContract;
    scenario: Scenario;
    kind: "baseline" | "candidate" | "challenge";
    signal: AbortSignal;
    onProgress?: (message: string) => void;
  }): Promise<VerificationResult>;
}
interface Job {
  controller: AbortController;
  fence: symbol;
  done: Promise<void>;
}
export class Orchestrator {
  readonly engine: Engine;
  private jobs = new Map<string, Job>();
  private tail: Promise<void> = Promise.resolve();
  private closing = false;
  private releaseWorker?: () => void;
  constructor(
    readonly store: Store,
    readonly provider: RepairProvider,
    engine?: Engine,
  ) {
    this.engine =
      engine ?? new FixtureEngine({ artifactRoot: join(store.root, "engine") });
  }
  async start() {
    this.releaseWorker = this.store.claimWorker();
    this.store.recover();
    await this.engine.start();
  }
  fixtures() {
    return fixtureDefinitions;
  }
  scenarios() {
    return scenarioDefinitions;
  }
  private fixture(fixtureId: string) {
    const fixture = fixtureDefinitions.find((value) => value.id === fixtureId);
    if (!fixture)
      throw new AppError(
        "UNSUPPORTED_FIXTURE",
        "Choose one of the supported authored applications.",
        422,
      );
    return fixture;
  }
  private baselineScenario() {
    const scenario = scenarioDefinitions[0];
    if (!scenario)
      throw new AppError(
        "SCENARIO_UNAVAILABLE",
        "No baseline scenario is configured.",
        503,
      );
    return scenario;
  }
  private assertResult(
    result: VerificationResult,
    build: Build,
    contract: InteractionContract,
    scenario: Scenario,
  ) {
    if (
      build.digest !== sha256(build.source) ||
      result.sourceDigest !== build.digest ||
      result.buildId !== build.id ||
      result.contractDigest !== contract.digest ||
      result.fixtureId !== build.fixtureId ||
      !isDeepStrictEqual(
        result.scenario,
        effectiveScenario(build.fixtureId, scenario),
      )
    )
      throw new AppError(
        "EVIDENCE_BINDING_MISMATCH",
        "The verification result does not match the exact source, build, effective scenario parameters and seed, and contract revision.",
        500,
      );
    if (
      result.passed &&
      (result.status !== "passed" ||
        contract.assertions
          .filter((value) => value.enabled)
          .some(
            (assertion) =>
              !result.checks.some(
                (check) =>
                  check.id === assertion.id && check.status === "passed",
              ),
          ) ||
        !result.outcome ||
        result.outcome.sourceDigest !== build.digest)
    )
      throw new AppError(
        "INCOMPLETE_ACCEPTANCE_EVIDENCE",
        "The verifier did not supply all enabled assertions and the exact backend outcome for acceptance.",
        500,
      );
  }
  createJourney(input: {
    fixtureId: string;
    inputMode: "keyboard";
    locale: "en";
    captureConsent: boolean;
  }): { journey: Journey; run: RepairRun } {
    const fixture = this.fixture(input.fixtureId);
    const contract = createContract(fixture.id);
    this.store.saveContract(contract);
    const journey: Journey = {
      id: id("journey"),
      fixtureId: fixture.id,
      title: fixture.name,
      task: fixture.task,
      createdAt: now(),
      inputMode: input.inputMode,
      locale: effectiveScenario(fixture.id, this.baselineScenario()).locale,
      captureConsent: input.captureConsent,
      contract,
      activeRunId: null,
    };
    const run = this.newRun(journey, "offline");
    journey.activeRunId = run.id;
    this.store.put("journey", journey.id, journey);
    return { journey, run: this.store.run(run.id) };
  }
  private newRun(
    journey: Journey,
    mode: RunMode,
    parentRunId?: string,
  ): RepairRun {
    const timestamp = now();
    const run: RepairRun = {
      id: id("repair"),
      journeyId: journey.id,
      fixtureId: journey.fixtureId,
      mode,
      status: "queued",
      createdAt: timestamp,
      updatedAt: timestamp,
      contract: journey.contract,
      isStale: false,
      baseline: null,
      candidates: [],
      activeCandidateId: null,
      challenges: [],
      events: [],
      humanObservations: [],
      error: null,
      cancellationRequested: false,
      exportedAt: null,
      ...(parentRunId ? { parentRunId } : {}),
    };
    this.store.saveRun(run);
    this.store.event(
      run.id,
      "queued",
      "Journey queued for a real browser baseline.",
    );
    return run;
  }
  retry(runId: string, mode?: RunMode): RepairRun {
    const old = this.store.run(runId);
    if (this.jobs.has(runId) && !old.cancellationRequested)
      throw new AppError(
        "RUN_BUSY",
        "Cancel this active run before starting a retry.",
        409,
      );
    const journey = this.store.journey(old.journeyId);
    const run = this.newRun(journey, mode ?? old.mode, old.id);
    journey.activeRunId = run.id;
    this.store.put("journey", journey.id, journey);
    return this.store.run(run.id);
  }
  private guard(runId: string, fence: symbol): RepairRun {
    const run = this.store.run(runId);
    if (
      this.jobs.get(runId)?.fence !== fence ||
      run.cancellationRequested ||
      run.isStale ||
      this.closing
    )
      throw new DOMException(
        "This worker no longer owns the run.",
        "AbortError",
      );
    return run;
  }
  private update(
    runId: string,
    fence: symbol,
    change: (run: RepairRun) => void,
  ): RepairRun {
    const run = this.guard(runId, fence);
    change(run);
    run.updatedAt = now();
    run.exportedAt = null;
    this.store.saveRun(run);
    return run;
  }
  private stage(
    runId: string,
    fence: symbol,
    status: RunStatus,
    message: string,
  ) {
    this.update(runId, fence, (run) => {
      run.status = status;
    });
    this.store.event(runId, status, message);
  }
  private enqueue(
    runId: string,
    work: (fence: symbol, signal: AbortSignal) => Promise<void>,
  ) {
    if (this.closing)
      throw new AppError(
        "SERVER_CLOSING",
        "The local worker is shutting down.",
        503,
      );
    if (this.jobs.has(runId))
      throw new AppError(
        "RUN_BUSY",
        "This run already has an active job.",
        409,
      );
    const fence = Symbol(runId);
    const controller = new AbortController();
    const admittedStatus = this.store.run(runId).status;
    const done = this.tail
      .then(async () => {
        const persisted = this.guard(runId, fence);
        if (persisted.status !== admittedStatus) {
          controller.abort();
          return;
        }
        await work(fence, controller.signal);
      })
      .catch((error) => {
        if (this.jobs.get(runId)?.fence !== fence) return;
        const run = this.store.run(runId);
        if (
          controller.signal.aborted ||
          run.cancellationRequested ||
          run.isStale ||
          this.closing
        )
          return;
        run.status = "environment_error";
        run.updatedAt = now();
        run.error = {
          code: error instanceof AppError ? error.code : "EXECUTION_FAILED",
          message:
            error instanceof AppError
              ? error.message
              : "The local browser or build worker could not complete this stage. Completed evidence is preserved; retry creates a new run.",
          retryable: true,
        };
        if (
          error instanceof GenerationOutputError &&
          !run.generationFailures?.some(
            (value) => value.id === error.failure.id,
          )
        )
          (run.generationFailures ??= []).push(error.failure);
        this.store.saveRun(run);
        this.store.event(run.id, run.status, run.error.message);
      })
      .finally(() => {
        if (this.jobs.get(runId)?.fence === fence) this.jobs.delete(runId);
      });
    this.jobs.set(runId, { controller, fence, done });
    this.tail = done;
  }
  startBaseline(runId: string) {
    const run = this.store.run(runId);
    if (run.status !== "queued" || this.jobs.has(runId)) return;
    this.enqueue(runId, async (fence, signal) => {
      this.stage(
        runId,
        fence,
        "preparing",
        "Building the immutable original application.",
      );
      const build = await this.engine.prepareBuild({
        fixtureId: run.fixtureId,
        source: await getOriginalSource(run.fixtureId),
      });
      this.guard(runId, fence);
      this.store.artifact(build.source);
      this.stage(
        runId,
        fence,
        "reproducing",
        "Replaying the keyboard task and checking the independent backend outcome.",
      );
      const baseline = await this.engine.verify({
        build,
        contract: run.contract,
        scenario: this.baselineScenario(),
        kind: "baseline",
        signal,
        onProgress: (message) => {
          this.guard(runId, fence);
          this.store.event(runId, "reproducing", message);
        },
      });
      this.assertResult(baseline, build, run.contract, this.baselineScenario());
      this.guard(runId, fence);
      this.store.artifact(JSON.stringify(baseline));
      this.update(runId, fence, (current) => {
        current.baseline = baseline;
      });
      if (baseline.status === "error")
        throw new AppError(
          "BASELINE_ENVIRONMENT_ERROR",
          "The baseline browser checks could not complete. Repair generation requires a reliable baseline.",
          503,
        );
      this.stage(
        runId,
        fence,
        "contract_review",
        baseline.passed
          ? "The baseline passed this scope. Review the contract before deciding whether a source change is needed."
          : "Baseline recorded. Review the interaction contract before generating a repair.",
      );
    });
  }
  generate(runId: string, mode: RunMode): RepairRun {
    const run = this.store.run(runId);
    if (run.isStale)
      throw new AppError(
        "STALE_CONTRACT",
        "The interaction contract changed. Retry to reproduce against its current revision.",
        409,
      );
    if (
      !run.baseline ||
      !["contract_review", "candidate_rejected"].includes(run.status)
    )
      throw new AppError(
        "INVALID_RUN_STATE",
        "Wait for the baseline and review the contract before generating a repair.",
        409,
      );
    if (mode === "live") this.provider.assertAvailable();
    if (run.candidates.length + (run.generationFailures?.length ?? 0) >= 3)
      throw new AppError(
        "ATTEMPT_LIMIT",
        "This run has reached its three-candidate limit. Retry creates a separate run.",
        409,
      );
    if (this.jobs.has(runId))
      throw new AppError(
        "RUN_BUSY",
        "This run already has an active job.",
        409,
      );
    run.mode = mode;
    run.status = "generating";
    run.error = null;
    this.store.saveRun(run);
    this.store.event(
      runId,
      "generating",
      mode === "live"
        ? `Live NVIDIA repair requested from ${this.provider.label}: ${this.provider.model}. Scope: ${this.provider.status().purpose}.`
        : "Using the explicitly labeled handcrafted reference patch. No model inference will run.",
    );
    this.enqueue(runId, async (fence, signal) => {
      const originalSource = this.store
        .readArtifact(run.baseline!.sourceDigest)
        .toString("utf8");
      const attempts =
        mode === "offline"
          ? 1
          : 3 - run.candidates.length - (run.generationFailures?.length ?? 0);
      for (let attempt = 0; attempt < attempts; attempt++) {
        const current = this.guard(runId, fence);
        const parent = current.parentRunId
          ? this.store.run(current.parentRunId)
          : null;
        const parentCandidate =
          parent &&
          !parent.isStale &&
          parent.contract.digest === current.contract.digest &&
          parent.baseline?.sourceDigest === current.baseline?.sourceDigest
            ? parent.candidates.at(-1)
            : undefined;
        const previous = current.candidates.at(-1) ?? parentCandidate;
        const compatibleParent =
          parent &&
          !parent.isStale &&
          parent.contract.digest === current.contract.digest &&
          parent.baseline?.sourceDigest === current.baseline?.sourceDigest
            ? parent
            : null;
        const previousFailure =
          current.generationFailures?.at(-1) ??
          compatibleParent?.generationFailures?.at(-1);
        const parentError =
          compatibleParent?.error &&
          [
            "MALFORMED_MODEL_OUTPUT",
            "MODEL_TRUNCATED",
            "MODEL_REFUSAL",
          ].includes(compatibleParent.error.code)
            ? compatibleParent.error
            : null;
        const failureExcerpt = previousFailure?.outputArtifact
          ? this.store
              .readArtifact(previousFailure.outputArtifact.digest)
              .subarray(0, 12000)
              .toString("utf8")
          : null;
        const timestamp = now();
        let generated;
        try {
          generated =
            mode === "live"
              ? await this.provider.generate({
                  runId,
                  source: originalSource,
                  contract: run.contract,
                  observations: {
                    interactionFamily: this.fixture(run.fixtureId).family,
                    fixtureBarrier: this.fixture(run.fixtureId).barrier,
                    baseline: run.baseline?.observations ?? [],
                  },
                  failedChecks: {
                    checks:
                      previous?.verification?.checks.filter(
                        (check) => check.status !== "passed",
                      ) ?? [],
                    sourceValidationError: previous?.rejectionReason ?? null,
                    previousCandidateSource: previous?.source ?? null,
                    previousCandidatePatch: previous?.patch ?? null,
                    previousObservedEvidence:
                      previous?.verification?.observations ?? null,
                    previousGenerationFailure: previousFailure
                      ? {
                          code: previousFailure.code,
                          message: previousFailure.message,
                          diagnostics: previousFailure.diagnostics,
                          topLevelKeys: previousFailure.topLevelKeys,
                          receipt: previousFailure.receipt,
                          finalContentAvailable: Boolean(
                            previousFailure.outputArtifact,
                          ),
                        }
                      : parentError
                        ? {
                            ...parentError,
                            finalContentAvailable: false,
                            limitation:
                              "This historical failure did not retain final message.content; only its error, receipt/usage and events remain.",
                          }
                        : null,
                    untrustedPreviousFinalContentExcerpt: failureExcerpt
                      ? {
                          text: failureExcerpt,
                          boundedBytes: 12000,
                          untrusted: true,
                        }
                      : null,
                  },
                  signal,
                })
              : {
                  source: await getReferenceSource(run.fixtureId),
                  summary:
                    "Handcrafted reference repair for this authored fixture; independently verified below. This is offline demonstration evidence.",
                  receipt: {
                    provider: "offline-fixture" as const,
                    model: "handcrafted-reference",
                    requestId: null,
                    promptVersion: PROMPT_VERSION,
                    temperature: 0,
                    inputTokens: null,
                    outputTokens: null,
                    durationMs: 0,
                    startedAt: timestamp,
                    completedAt: timestamp,
                    live: false,
                  },
                };
        } catch (error) {
          if (error instanceof GenerationOutputError) {
            this.update(runId, fence, (saved) => {
              (saved.generationFailures ??= []).push(error.failure);
            });
            this.store.event(
              runId,
              "generating",
              "Provider output failed validation and was not executed. Its final-content artifact and public schema diagnostics are retained.",
            );
            if (attempt + 1 < attempts) {
              this.stage(
                runId,
                fence,
                "generating",
                "Requesting a bounded correction using public output-schema feedback on the same explicit provider.",
              );
              continue;
            }
          }
          throw error;
        }
        this.guard(runId, fence);
        const candidate: Candidate = {
          id: id("candidate"),
          revision: current.candidates.length + 1,
          createdAt: now(),
          source: generated.source,
          sourceFile: this.fixture(run.fixtureId).sourceFile,
          digest: sha256(generated.source),
          patch: createTwoFilesPatch(
            this.fixture(run.fixtureId).sourceFile,
            this.fixture(run.fixtureId).sourceFile,
            originalSource,
            generated.source,
            "original",
            "candidate",
          ),
          summary: generated.summary,
          receipt: generated.receipt,
          buildId: "",
          previewUrl: "",
          status: "verifying",
          verification: null,
        };
        this.store.artifact(candidate.source);
        this.store.artifact(candidate.patch);
        this.store.artifact(JSON.stringify(candidate.receipt));
        this.update(runId, fence, (saved) => {
          saved.candidates.push(candidate);
          saved.activeCandidateId = candidate.id;
        });
        try {
          const validation = validateCandidateSource(candidate.source);
          if (!validation.valid)
            throw new AppError(
              "UNSAFE_CANDIDATE",
              validation.errors.join("; "),
            );
          this.stage(
            runId,
            fence,
            "verifying",
            `Building candidate ${candidate.revision} and checking the unchanged contract.`,
          );
          const build = await this.engine.prepareBuild({
            fixtureId: run.fixtureId,
            source: candidate.source,
          });
          if (build.digest !== candidate.digest)
            throw new AppError(
              "BUILD_DIGEST_MISMATCH",
              "The candidate build did not match its exact source digest.",
              500,
            );
          this.update(runId, fence, (saved) => {
            const value = saved.candidates.find((c) => c.id === candidate.id)!;
            value.buildId = build.id;
            value.previewUrl = build.previewUrl;
          });
          const verification = await this.engine.verify({
            build,
            contract: run.contract,
            scenario: this.baselineScenario(),
            kind: "candidate",
            signal,
            onProgress: (message) => {
              this.guard(runId, fence);
              this.store.event(runId, "verifying", message);
            },
          });
          this.assertResult(
            verification,
            build,
            run.contract,
            this.baselineScenario(),
          );
          this.guard(runId, fence);
          this.store.artifact(JSON.stringify(verification));
          this.update(runId, fence, (saved) => {
            const value = saved.candidates.find((c) => c.id === candidate.id)!;
            value.verification = verification;
            value.status = verification.passed ? "accepted" : "rejected";
          });
          if (verification.status === "error")
            throw new AppError(
              "VERIFIER_ENVIRONMENT_ERROR",
              "The browser verifier could not complete; this candidate has not been accepted.",
              503,
            );
          if (verification.passed) {
            this.stage(
              runId,
              fence,
              "ready",
              "The candidate passed the automated keyboard and business checks in this scope. Human assistive-technology validation remains pending.",
            );
            return;
          }
          this.stage(
            runId,
            fence,
            "candidate_rejected",
            `Candidate ${candidate.revision} failed the independent checks. Its patch and evidence are retained.`,
          );
        } catch (error) {
          if (
            signal.aborted ||
            (error instanceof DOMException && error.name === "AbortError")
          )
            throw error;
          const rejectionReason = (
            error instanceof Error
              ? error.message
              : "The scoped component failed validation or compilation."
          ).slice(0, 2000);
          this.update(runId, fence, (saved) => {
            const rejected = saved.candidates.find(
              (c) => c.id === candidate.id,
            )!;
            rejected.status = "rejected";
            rejected.rejectionReason = rejectionReason;
          });
          if (
            error instanceof AppError &&
            [
              "VERIFIER_ENVIRONMENT_ERROR",
              "EVIDENCE_BINDING_MISMATCH",
              "INCOMPLETE_ACCEPTANCE_EVIDENCE",
              "BUILD_DIGEST_MISMATCH",
            ].includes(error.code)
          )
            throw error;
          this.stage(
            runId,
            fence,
            "candidate_rejected",
            `Candidate ${candidate.revision} was rejected during scoped source validation or compilation.`,
          );
          this.store.event(
            runId,
            "candidate_rejected",
            "Scoped validation feedback retained for the next candidate.",
            rejectionReason,
          );
        }
        if (attempt + 1 < attempts)
          this.stage(
            runId,
            fence,
            "generating",
            "Requesting a new candidate using only failed public checks.",
          );
      }
    });
    return this.store.run(runId);
  }
  cancel(runId: string): RepairRun {
    const run = this.store.run(runId);
    if (run.status === "cancelled") return run;
    const job = this.jobs.get(runId);
    run.cancellationRequested = true;
    run.status = "cancelled";
    run.updatedAt = now();
    run.error = null;
    this.store.saveRun(run);
    this.store.event(
      runId,
      "cancelled",
      "Cancellation recorded. Completed evidence is preserved; late worker results cannot be accepted.",
    );
    job?.controller.abort(new DOMException("Run cancelled", "AbortError"));
    return this.store.run(runId);
  }
  reviseContract(
    contractId: string,
    input: {
      expectedVersion: number;
      task: string;
      reviewer: string;
      assertions: InteractionContract["assertions"];
    },
  ): InteractionContract {
    const original = this.store.contract(contractId);
    if (input.expectedVersion !== original.version)
      throw new AppError(
        "CONTRACT_VERSION_CONFLICT",
        "This contract changed since it was opened. Reload the current revision.",
        409,
      );
    if (
      input.assertions.length !== original.assertions.length ||
      new Set(input.assertions.map((a) => a.id)).size !==
        original.assertions.length
    )
      throw new AppError(
        "INVALID_ASSERTIONS",
        "All approved assertions must remain in the contract.",
      );
    const assertions = original.assertions.map((assertion) => {
      const proposed = input.assertions.find(
        (value) => value.id === assertion.id,
      );
      if (!proposed || (assertion.required && !proposed.enabled))
        throw new AppError(
          "REQUIRED_ASSERTION",
          "Required business and interaction assertions cannot be removed or disabled.",
        );
      return { ...assertion, enabled: proposed.enabled };
    });
    const content = {
      ...original,
      task: input.task,
      reviewer: input.reviewer,
      assertions,
      version: original.version + 1,
      createdAt: now(),
      digest: "",
    };
    const contract = { ...content, digest: sha256(JSON.stringify(content)) };
    this.store.transaction(() => {
      this.store.saveContract(contract);
      for (const journey of this.store.list<Journey>("journey"))
        if (journey.contract.id === contractId) {
          journey.contract = contract;
          journey.task = contract.task;
          this.store.put("journey", journey.id, journey);
        }
      for (const run of this.store.runs())
        if (run.contract.id === contractId) {
          run.isStale = true;
          run.updatedAt = now();
          this.store.saveRun(run);
          this.store.event(
            run.id,
            run.status,
            "A new contract revision invalidated acceptance of this run. Original evidence remains bound to its original contract.",
          );
        }
    });
    for (const run of this.store.runs())
      if (run.contract.id === contractId && this.jobs.has(run.id))
        this.cancel(run.id);
    return contract;
  }
  challenge(
    runId: string,
    scenarioId: string,
    candidateDigest: string,
  ): RepairRun {
    const run = this.store.run(runId);
    if (run.isStale)
      throw new AppError(
        "STALE_CONTRACT",
        "Retry against the current contract before challenging a repair.",
        409,
      );
    const candidate = run.candidates.find(
      (value) =>
        value.digest === candidateDigest &&
        value.id === run.activeCandidateId &&
        value.status === "accepted",
    );
    if (!candidate || run.status !== "ready")
      throw new AppError(
        "CANDIDATE_MISMATCH",
        "Challenge the currently accepted candidate by its exact digest.",
        409,
      );
    const scenario = scenarioDefinitions.find(
      (value) => value.id === scenarioId,
    );
    if (!scenario)
      throw new AppError(
        "UNKNOWN_SCENARIO",
        "Choose a supported challenge scenario.",
        422,
      );
    if (this.jobs.has(runId))
      throw new AppError(
        "RUN_BUSY",
        "This run already has an active job.",
        409,
      );
    run.status = "verifying";
    this.store.saveRun(run);
    this.store.event(
      run.id,
      "verifying",
      `Running the ${scenario.name} challenge against the same candidate digest.`,
    );
    this.enqueue(runId, async (fence, signal) => {
      const build = await this.engine.prepareBuild({
        fixtureId: run.fixtureId,
        source: candidate.source,
      });
      this.guard(runId, fence);
      if (build.digest !== candidate.digest)
        throw new AppError(
          "BUILD_DIGEST_MISMATCH",
          "The rebuilt candidate did not match the evidence digest.",
          500,
        );
      const result = await this.engine.verify({
        build,
        contract: run.contract,
        scenario,
        kind: "challenge",
        signal,
      });
      this.assertResult(result, build, run.contract, scenario);
      this.guard(runId, fence);
      this.store.artifact(JSON.stringify(result));
      this.update(runId, fence, (value) => {
        value.challenges.push(result);
      });
      this.stage(
        runId,
        fence,
        "ready",
        result.passed
          ? "The candidate passed this challenge. This result is bound to its source and contract digests."
          : "The challenge did not pass. Review the failed checks before using this repair under these conditions.",
      );
    });
    return this.store.run(runId);
  }
  humanObservation(
    runId: string,
    input: Pick<
      HumanObservation,
      | "candidateDigest"
      | "participant"
      | "operator"
      | "browser"
      | "assistiveTechnology"
      | "consent"
      | "completion"
      | "notes"
    >,
  ): RepairRun {
    const run = this.store.run(runId);
    const candidate = run.candidates.find(
      (value) =>
        value.digest === input.candidateDigest && value.status === "accepted",
    );
    if (!candidate || run.isStale)
      throw new AppError(
        "CANDIDATE_MISMATCH",
        "Attach the observation to a current accepted candidate digest.",
        409,
      );
    if (!input.consent)
      throw new AppError(
        "CONSENT_REQUIRED",
        "Participant consent is required before saving an operator observation.",
      );
    run.humanObservations.push({
      ...input,
      id: id("observation"),
      runId,
      contractDigest: run.contract.digest,
      createdAt: now(),
      evidenceType: "operator-observation",
      independentlyReviewed: false,
    });
    run.updatedAt = now();
    run.exportedAt = null;
    this.store.saveRun(run);
    this.store.event(
      runId,
      run.status,
      "An operator observation was attached. It is not independently reviewed human validation.",
    );
    return this.store.run(runId);
  }
  async export(runId: string): Promise<EvidenceManifest> {
    const run = this.store.run(runId);
    if (this.jobs.has(runId))
      throw new AppError(
        "RUN_BUSY",
        "Wait for this stage to finish before exporting its evidence.",
        409,
      );
    run.exportedAt ??= now();
    this.store.saveRun(run);
    const legacyObservationCount = run.humanObservations.length;
    run.humanObservations = [];
    const candidate = run.candidates.find(
      (value) => value.id === run.activeCandidateId,
    );
    const results = [
      run.baseline,
      ...run.candidates.map((value) => value.verification),
      ...run.challenges,
    ].filter((value): value is VerificationResult => value !== null);
    const artifacts: { name: string; digest: string }[] = [];
    const add = (name: string, data: string) =>
      artifacts.push({ name, digest: this.store.artifact(data).digest });
    add(
      "original-source",
      run.baseline
        ? this.store.readArtifact(run.baseline.sourceDigest).toString("utf8")
        : await getOriginalSource(run.fixtureId),
    );
    add("interaction-contract.json", JSON.stringify(run.contract));
    for (const value of run.candidates) {
      add(`candidate-${value.revision}.tsx`, value.source);
      add(`candidate-${value.revision}.patch`, value.patch);
      add(
        `candidate-${value.revision}-receipt.json`,
        JSON.stringify(value.receipt),
      );
      if (value.receipt.finalOutputDigest)
        add(
          `candidate-${value.revision}-final-content.txt`,
          this.store
            .readArtifact(value.receipt.finalOutputDigest)
            .toString("utf8"),
        );
    }
    for (const [index, failure] of (run.generationFailures ?? []).entries()) {
      add(`generation-failure-${index + 1}.json`, JSON.stringify(failure));
      if (failure.outputArtifact)
        add(
          `generation-failure-${index + 1}-final-content.txt`,
          this.store
            .readArtifact(failure.outputArtifact.digest)
            .toString("utf8"),
        );
    }
    for (const result of results) {
      add(`${result.kind}-${result.id}.json`, JSON.stringify(result));
      for (const value of result.artifacts)
        artifacts.push({ name: value.name, digest: value.digest });
    }
    add("run.json", JSON.stringify(run));
    const checks = candidate?.verification?.checks ?? [];
    return {
      schemaVersion: "1.0",
      generatedAt: run.exportedAt,
      run,
      fixture: this.fixture(run.fixtureId),
      sourceDigest: run.baseline?.sourceDigest ?? null,
      candidateDigest: candidate?.digest ?? null,
      contractDigest: run.contract.digest,
      automatedSummary: {
        passed: checks.filter((value) => value.status === "passed").length,
        total: checks.length,
        challengesPassed: run.challenges.filter((value) => value.passed).length,
        challengesTotal: run.challenges.length,
      },
      humanValidation: run.humanObservations.length
        ? "operator-observations-only"
        : "pending",
      limitations: [
        ...new Set([
          "Authored synthetic applications and fictional appointment data.",
          "Local single-worker verification; Chromium keyboard checks do not establish screen-reader or human task outcomes.",
          "No independently reviewed participant study or universal accessibility certification.",
          ...([
            "MALFORMED_MODEL_OUTPUT",
            "MODEL_TRUNCATED",
            "MODEL_REFUSAL",
          ].includes(run.error?.code ?? "") && !run.generationFailures?.length
            ? [
                "This historical provider failure retains its error, receipt/usage and events; final message.content was not captured and cannot be reconstructed.",
              ]
            : []),
          ...(legacyObservationCount
            ? [
                "Legacy private operator notes and identifiers are excluded from this export. Their existence does not establish human validation.",
              ]
            : []),
          ...(run.isStale
            ? [
                "The contract changed; this run is stale and its acceptance does not apply to the current contract.",
              ]
            : []),
          ...(run.mode === "offline"
            ? [
                "Offline mode uses a handcrafted reference patch, not model-generated code.",
              ]
            : []),
          ...results.flatMap((value) => value.limitations),
        ]),
      ],
      integrity: { algorithm: "sha256", artifacts },
    };
  }
  async idle() {
    await this.tail;
  }
  async close() {
    this.closing = true;
    for (const job of this.jobs.values())
      job.controller.abort(
        new DOMException("Worker shutting down", "AbortError"),
      );
    try {
      await this.tail;
      await this.engine.close();
    } finally {
      this.releaseWorker?.();
      this.releaseWorker = undefined;
    }
  }
}
