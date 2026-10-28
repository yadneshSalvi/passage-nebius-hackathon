import type { TemporalContract, TemporalContractBody, TemporalExecution } from "./temporal.js";
import type { CompilerObligation, CompilerPatch, SourceInspection, SourceLocation } from "./compiler.js";
import type { ModelReceipt, ProviderStatus } from "./types.js";
import type { ActualATCapture } from "./assistive-capture.js";

/** No server imports are required by the browser. Full source is visible only in this explicit local review workspace. */
export interface PublicRepositorySnapshot {
  schema: "passage.repository.v1"; repositoryUrl: string; revision: string; sourceDigest: string;
  entryPoint: string; rootElementId: string; rootElementClass?: string;
  files: { path: string; sha256: string; content: string }[]; disclosure: "public-source";
  bootstrap?: { source: string; sha256: string; description: string }; moduleAliases?: Record<string, string>;
}
export interface RepositoryBuildView {
  id: string; revision: string; sourceDigest: string; bundleDigest: string; previewUrl: string;
  createdAt: string; outcomeVerification: "not-configured";
  isolation: { runtime: "docker-linux"; context: string; image: string; network: "none"; hostMounts: false;
    readOnlyRoot: true; user: "1000:1000"; capabilities: "none"; memoryBytes: number; pidsLimit: number };
}
export interface RepositoryReplay {
  id: string; createdAt: string; label: string; sourceDigest: string; contractDigest: string;
  build: RepositoryBuildView; execution: TemporalExecution;
  outcomeVerification: "not-configured" | "verified";
  protectedOutcome: { authority: string; records: Record<string, unknown>[] } | null;
}
export interface RepositoryContractDraft {
  id: string; digest: string; createdAt: string; method: "observed" | "live" | "operator-revision";
  summary: string; body: TemporalContractBody; obligations: CompilerObligation[];
  ambiguities: string[]; receipt?: ModelReceipt;
  parentDigest?: string; revisionNotes?: string;
}
export interface RepositoryRepairAttempt {
  id: string; createdAt: string; status: "localizing" | "generating" | "verifying" | "accepted" | "rejected" | "error";
  contractDigest: string; summary: string; locations: SourceLocation[]; patches: CompilerPatch[];
  inspection?: SourceInspection;
  receipts: ModelReceipt[]; replayId?: string; error?: string;
}
export interface RepositoryJourney {
  id: string; createdAt: string; updatedAt: string; task: string; label: string;
  status: "ready" | "building" | "capturing" | "drafting" | "review" | "approved" | "repairing" | "verifying" | "error";
  snapshot: PublicRepositorySnapshot; build: RepositoryBuildView | null;
  proposedContract: TemporalContractBody; draft: RepositoryContractDraft | null; drafts: RepositoryContractDraft[];
  contract: TemporalContract | null;
  review: { maintainer: string; interactionReviewer: string; approvedAt: string; draftDigest: string;
    evidenceClass: "operator-attested-review" | "automated-development-review"; independentlyReviewed: false;
    reviewProvenance?: "operator-attested" | "automated-development" } | null;
  replays: RepositoryReplay[]; repairs: RepositoryRepairAttempt[];
  sourcePermission: "public-source-development";
  outcomeObserverId?: string;
  sourceProvenance?: { kind: "operator-provided-manifest" | "git-blob-inspection"; verifiedUpstreamBytes: boolean; localGitBlobsVerified?: boolean; detail: string; correction?: string };
  outcomeVerification: "not-configured" | "verified";
  error: { code: string; message: string } | null;
  assistiveCaptures?: ActualATCapture[];
}
export interface RepositoryJourneyBootstrap {
  worker: { status: "ready" | "blocked"; reason?: string; checkedAt: string;
    runtime?: { context: string; image: string }; engineVersion?: string };
  sessions: RepositoryJourney[]; provider: ProviderStatus;
  limitations: string[];
}
