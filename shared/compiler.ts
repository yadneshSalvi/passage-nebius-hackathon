import type { FixtureDefinition, ModelReceipt, ProviderStatus } from "./types.js";
import type { TemporalContract, TemporalExecution } from "./temporal.js";

export type CompilerVariant = "original" | "reference" | "candidate";
export type CompilerSchedule = "baseline" | "cancel-pending" | "modal-boundary";
export type CompilerStatus = "ready" | "capturing" | "drafting" | "review" | "approved" | "repairing" | "verifying" | "error";
export interface CompilerTraceEvent {
  id: string; sequence: number; atMs: number;
  kind: "action" | "focus" | "request" | "response" | "dom" | "assertion" | "outcome";
  label: string; detail: string; binding?: string; correlationId?: string;
  provenance?: "controller" | "browser-network" | "page-instrumentation";
}
export interface CompilerCheck {
  id: string; label: string; status: "passed" | "failed" | "error" | "inconclusive";
  expected: string; actual: string;
}
export interface CompilerCapture {
  id: string; createdAt: string; variant: CompilerVariant; scheduleId: CompilerSchedule;
  sourceDigest: string; buildId: string; previewUrl: string;
  trace: CompilerTraceEvent[]; checks: CompilerCheck[];
  status: "passed" | "failed" | "error" | "inconclusive";
  outcome: Record<string, unknown> | null; execution: TemporalExecution; contractDigest: string;
  counterexample?: {
    summary: string; events: CompilerTraceEvent[]; attempts: number; minimal: boolean;
    reductionId?: string; originalSteps?: string[]; minimizedSteps?: string[]; acceptedRemovals?: number; historyCount?: number;
    search?: { algorithm: string; termination: string; localMinimal: boolean; globalMinimal: false; limitation: string; inconclusiveReplays?: number };
  };
  scheduleProposal?: { id: string; label: string; steps: string[]; receipt?: ModelReceipt };
  limitations: string[];
}
export interface CompilerObligation {
  id: string; text: string; origin: "observed" | "inferred"; evidenceRefs: string[]; assertionIds: string[];
}
export interface CompilerDraft {
  id: string; version: number; digest: string; createdAt: string; method: "observed" | "live";
  summary: string; obligations: CompilerObligation[]; ambiguities: string[];
  contract: TemporalContract;
  contractsBySchedule: Record<CompilerSchedule, TemporalContract>;
  receipt?: ModelReceipt;
}
export interface CompilerReview {
  id: string; draftDigest: string; contractDigest: string; approvedAt: string;
  maintainer: string; interactionReviewer: string; acknowledgeInferred: true;
  evidenceClass: "operator-attested-review" | "automated-development-review"; independentlyReviewed: false;
  reviewProvenance?: "operator-attested" | "automated-development";
}
export interface SourceLocation {
  path: string; startLine: number; endLine: number; symbol: string; reason: string; evidenceRefs: string[]; verified: boolean;
  /** Supplied observations stay distinct from captured browser/controller events. */
  reportedObservationRefs?: string[];
  /** Binds a citation to inspected bytes; this does not verify the model's causal explanation. */
  sourceDigest?: string; citationDigest?: string; lineIds?: string[];
}
export interface SourceInspection {
  method: "deterministic-single-file" | "model-selected";
  files: { path: string; sourceDigest: string; bytes: number }[];
  purpose?: string;
}
export interface CompilerPatch {
  path: string; beforeDigest: string; afterDigest: string; source: string; diff: string;
}
export interface SourceObservation {
  sourceDigest: string;
  details: string;
  observer: string;
  provenance: "automated-development" | "operator-attested";
}
export interface SourceObservationRecord extends SourceObservation { id: string; recordedAt: string; independentlyReviewed: false }
export type CompilerAcceptancePolicy = "frozen-suite-and-preservation-v1";
export interface CompilerPreservationCheck {
  id: string; sessionId: string; repairId?: string; revisionId?: string;
  reason: "automatic-acceptance" | "later-check" | "revision-check";
  sourceDigest: string; contractDigest: string; verifierVersion: string;
  createdAt: string; completedAt: string; reportDigest: string;
  status: "passed" | "failed" | "error" | "cancelled"; passed: boolean;
  runs: { id: string; kind: string; scenarioId: string; status: string; passed: boolean;
    checks: { id: string; label: string; status: string; expected: string; actual: string }[] }[];
  sourceObservation?: SourceObservationRecord;
}
export interface CompilerRepair {
  id: string; createdAt: string; contractDigest: string;
  status: "localizing" | "generating" | "verifying" | "accepted" | "rejected" | "error";
  summary: string; locations: SourceLocation[]; patches: CompilerPatch[];
  inspection?: SourceInspection;
  additionalObservation?: SourceObservationRecord;
  acceptancePolicy?: CompilerAcceptancePolicy;
  preservationChecks?: CompilerPreservationCheck[];
  receipts: ModelReceipt[]; verificationIds: string[]; error?: string; errorCode?: string;
}
export interface CompilerRevisionCheck {
  id: string; createdAt: string; label: string;
  classification: "candidate" | "harmless-refactor" | "declared-regression" | "external-revision";
  sourceDigest: string; contractDigest: string; verificationIds: string[]; passed: boolean;
  acceptancePolicy?: CompilerAcceptancePolicy;
  preservationCheck?: CompilerPreservationCheck;
}
export interface CompilerSession {
  id: string; fixtureId: string; title: string; task: string; createdAt: string; updatedAt: string;
  status: CompilerStatus; scope: "authored-fixture" | "external-react"; captureConsent: true;
  captures: CompilerCapture[]; drafts: CompilerDraft[]; draft: CompilerDraft | null; review: CompilerReview | null;
  verifications: CompilerCapture[]; repairs: CompilerRepair[]; revisions: CompilerRevisionCheck[];
  error: { code: string; message: string } | null;
  assistiveEvidence: { status: "not-captured" | "operator-capture" | "automated-at";
    evidenceClass: "none" | "actual-at-automation" | "actual-operator-session";
    participantCount: number; note: string };
}
export interface CompilerAdapterStatus {
  id: string; name: string; status: "ready" | "blocked" | "unqualified"; scope: string; detail: string;
}
export interface CompilerBootstrap {
  fixtures: FixtureDefinition[]; sessions: CompilerSession[]; adapters: CompilerAdapterStatus[];
  schedules: { id: CompilerSchedule; label: string; description: string }[];
  provider: ProviderStatus; recordedSessionId: string | null;
  story: { fixtureId: string; originalPreviewUrl: string; recordedRunId: string | null } | null;
  limitations: string[];
}
