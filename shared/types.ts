export type Family =
  "date-picker" | "combobox" | "modal-wizard" | "async-validation";
export type RunStatus =
  | "queued"
  | "preparing"
  | "reproducing"
  | "contract_review"
  | "generating"
  | "verifying"
  | "ready"
  | "candidate_rejected"
  | "environment_error"
  | "cancelled";
export type RunMode = "offline" | "live";
export type LiveProvider = "nebius" | "fireworks" | "together";
export type ProviderPurpose = "submission" | "development";
export type CheckStatus = "passed" | "failed" | "inconclusive" | "error";
export type AssertionId =
  | "control_keyboard_reachable"
  | "selection_keyboard_operable"
  | "focus_restored"
  | "required_validation_preserved"
  | "unavailable_slot_rejected"
  | "correct_outcome_persisted"
  | "confirmation_focus"
  | "dialog_escape"
  | "error_announced";

export interface FixtureDefinition {
  id: string;
  name: string;
  organization: string;
  description: string;
  task: string;
  family: Family;
  barrier: string;
  sourceFile: string;
  tags: string[];
  color: string;
  ancestry: string;
  supported: true;
}
export interface Scenario {
  id: string;
  name: string;
  description: string;
  locale: "en" | "de";
  delayedValidationMs: number;
  unavailableFirst: boolean;
  longLabels: boolean;
  seed: number;
}
export interface ContractAssertion {
  id: AssertionId;
  label: string;
  description: string;
  enabled: boolean;
  required: boolean;
  source: string;
  evidenceType: "browser" | "backend";
}
export interface InteractionContract {
  id: string;
  version: number;
  digest: string;
  createdAt: string;
  reviewer: string;
  task: string;
  preconditions: string[];
  assertions: ContractAssertion[];
  transitions: {
    from: string;
    action: string;
    to: string;
    assertionIds: AssertionId[];
  }[];
  outcomeOracle: string;
  humanChecks: string[];
  supportedCombinations: string[];
}
export interface Journey {
  id: string;
  fixtureId: string;
  title: string;
  task: string;
  createdAt: string;
  inputMode: "keyboard";
  locale: "en" | "de";
  captureConsent: boolean;
  contract: InteractionContract;
  activeRunId: string | null;
}
export interface Observation {
  sequence: number;
  at: string;
  kind: "focus" | "action" | "dom" | "business" | "assertion";
  label: string;
  detail: string;
  focus?: string;
  source?: string;
  evidenceType: "browser" | "backend";
}
export interface CheckResult {
  id: AssertionId;
  label: string;
  status: CheckStatus;
  expected: string;
  actual: string;
  durationMs: number;
  evidenceType: "browser" | "backend";
}
export interface BackendOutcome {
  id: string;
  sessionId: string;
  date: string;
  service: string;
  attendee: string;
  createdAt: string;
  sourceDigest: string;
}
export interface VerificationResult {
  verifierVersion?: string;
  id: string;
  fixtureId: string;
  kind: "baseline" | "candidate" | "challenge";
  sourceDigest: string;
  contractDigest: string;
  scenario: Scenario;
  status: CheckStatus;
  passed: boolean;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  browser: string;
  browserVersion: string;
  checks: CheckResult[];
  observations: Observation[];
  outcome: BackendOutcome | null;
  previewUrl: string;
  buildId: string;
  screenshotUrl?: string;
  ariaSnapshot?: string;
  artifacts: { name: string; digest: string; url: string; mediaType: string }[];
  limitations: string[];
}
export interface ModelReceipt {
  reasoningTokens?: number;
  finalOutputDigest?: string;
  provider: LiveProvider | "offline-fixture";
  purpose?: ProviderPurpose | "offline";
  servedModel?: string | null;
  generation?: {
    maxOutputTokens: number;
    timeoutMs: number;
    reasoningEffort?: string;
    thinkingEnabled?: boolean;
    responseFormat?: "json_object" | "prompt_schema";
  };
  model: string;
  requestId: string | null;
  promptVersion: string;
  temperature: number;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number;
  startedAt: string;
  completedAt: string;
  live: boolean;
}
export interface GenerationFailure {
  id: string;
  runId: string;
  usageEntryId: string;
  createdAt: string;
  code: "MALFORMED_MODEL_OUTPUT" | "MODEL_TRUNCATED" | "MODEL_REFUSAL";
  message: string;
  receipt: ModelReceipt;
  diagnostics: { path: string; code: string; message: string }[];
  topLevelKeys: string[];
  outputArtifact?: {
    name: string;
    digest: string;
    url: string;
    mediaType: "text/plain";
    byteLength: number;
    capturedBytes: number;
    captureTruncated: boolean;
  };
}
export interface Candidate {
  id: string;
  revision: number;
  createdAt: string;
  source: string;
  sourceFile: string;
  digest: string;
  patch: string;
  summary: string;
  receipt: ModelReceipt;
  buildId: string;
  previewUrl: string;
  status: "verifying" | "accepted" | "rejected";
  verification: VerificationResult | null;
  rejectionReason?: string;
}
export interface RunEvent {
  id: number;
  runId: string;
  at: string;
  stage: RunStatus;
  message: string;
  detail?: string;
}
export interface HumanObservation {
  id: string;
  runId: string;
  candidateDigest: string;
  contractDigest: string;
  createdAt: string;
  participant: string;
  operator: string;
  browser: string;
  assistiveTechnology: string;
  consent: boolean;
  completion: "completed" | "blocked" | "stopped";
  notes: string;
  evidenceType: "operator-observation";
  independentlyReviewed: false;
}
export interface RepairRun {
  generationFailures?: GenerationFailure[];
  id: string;
  journeyId: string;
  fixtureId: string;
  mode: RunMode;
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
  contract: InteractionContract;
  isStale: boolean;
  baseline: VerificationResult | null;
  candidates: Candidate[];
  activeCandidateId: string | null;
  challenges: VerificationResult[];
  events: RunEvent[];
  humanObservations: HumanObservation[];
  error: { code: string; message: string; retryable: boolean } | null;
  cancellationRequested: boolean;
  exportedAt: string | null;
  parentRunId?: string;
}
export interface ProviderStatus {
  catalogVerified?: boolean;
  runtimeQualified?: boolean;
  configured: boolean;
  enabled: boolean;
  provider: LiveProvider;
  purpose: ProviderPurpose;
  budgetUsd: number | null;
  committedUsd: number | null;
  model: string;
  baseUrl: string;
  reason: string;
}
export interface ProviderUsageSummary {
  provider: LiveProvider;
  purpose: ProviderPurpose;
  budgetUsd: number | null;
  committedUsd: number | null;
  knownEstimatedUsd: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  unknownCostCalls: number;
  unknownUsageCalls: number;
}
export interface ProviderUsageData {
  provider: LiveProvider;
  purpose: ProviderPurpose;
  budgetUsd: number | null;
  committedUsd: number | null;
  providers: Record<LiveProvider, ProviderUsageSummary>;
  entries: {
    id: string;
    runId: string;
    provider?: LiveProvider;
    purpose?: ProviderPurpose;
    model: string;
    reservedUsd: number | null;
    chargedUsd: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    state: "reserved" | "complete" | "uncertain" | "rejected";
    requestId: string | null;
    startedAt: string;
    completedAt: string | null;
    servedModel?: string | null;
    reasoningTokens?: number;
    finalOutputDigest?: string;
    generation?: {
      maxOutputTokens: number;
      timeoutMs: number;
      reasoningEffort?: string;
      thinkingEnabled?: boolean;
      responseFormat?: "json_object" | "prompt_schema";
    };
    pricing?: {
      inputUsdPerMillion: number;
      outputUsdPerMillion: number;
    } | null;
  }[];
}
export interface AppSettings {
  highContrast: boolean;
  reduceMotion: boolean;
  retentionDays: number;
  defaultMode: RunMode;
}
export interface BootstrapData {
  fixtures: FixtureDefinition[];
  scenarios: Scenario[];
  journeys: Journey[];
  runs: RepairRun[];
  provider: ProviderStatus;
  settings: AppSettings;
}
export interface EvidenceManifest {
  schemaVersion: "1.0";
  generatedAt: string;
  run: RepairRun;
  fixture: FixtureDefinition;
  sourceDigest: string | null;
  candidateDigest: string | null;
  contractDigest: string;
  automatedSummary: {
    passed: number;
    total: number;
    challengesPassed: number;
    challengesTotal: number;
  };
  humanValidation: "pending" | "operator-observations-only";
  limitations: string[];
  integrity: {
    algorithm: "sha256";
    artifacts: { name: string; digest: string }[];
  };
}
