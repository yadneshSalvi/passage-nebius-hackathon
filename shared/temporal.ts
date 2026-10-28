/** Bounded, data-only interaction vocabulary. Candidate source cannot edit this contract. */
export type SemanticBinding =
  | { kind: 'testId'; value: string; read?: 'value' | 'text' | { attribute: string } }
  | { kind: 'role'; role: string; name?: string; read?: 'value' | 'text' | { attribute: string } }
  | { kind: 'css'; value: string; read?: 'value' | 'text' | { attribute: string } };

export type TemporalAction = { id: string; label: string; requires?: string[]; required?: boolean } & (
  | { kind: 'focus'; binding: string }
  | { kind: 'press'; key: string; binding?: string }
  | { kind: 'fill'; binding: string; value: string }
  | { kind: 'waitFor'; binding: string; state: 'visible' | 'hidden' | 'attached' | 'detached'; timeoutMs?: number }
  | { kind: 'event'; event: string }
  | { kind: 'checkpoint' }
);
export type TemporalAssertion = { id: string; label: string; after: string; required?: boolean } & (
  | { kind: 'valuePreserved'; binding: string; since: string | 'initial' }
  | { kind: 'valueEquals'; binding: string; expected: string }
  | { kind: 'focusWithin'; binding: string }
  | { kind: 'modalContainment'; binding: string; steps: number }
  | { kind: 'closedFocusRestored'; panel: string; trigger: string }
  | { kind: 'outcome'; expected: Record<string, string | number | boolean | null>; count: number }
);
export interface TemporalContractBody {
  version: 'passage-temporal/v1'; id: string; revision: number; title: string;
  bindings: Record<string, SemanticBinding>; actions: TemporalAction[]; assertions: TemporalAssertion[];
  allowedEvents: { id: string; label: string; requires?: string[] }[];
  bounds: { maxActions: number; maxDurationMs: number; actionTimeoutMs: number };
}
export interface TemporalContract extends TemporalContractBody {
  digest: string;
  approval: { digest: string; approvedAt: string; actor: string; role: 'operator' | 'maintainer' | 'accessibility-reviewer'; evidenceClass: 'authored-development' | 'independent-review' };
}
export interface TraceIdentity { executionId: string; sourceDigest: string; buildId: string; sessionId: string; contractDigest: string; adapter: string }
export interface TemporalTraceEvent {
  sequence: number; at: string; elapsedMs: number;
  provenance?: 'controller' | 'browser-network' | 'page-instrumentation';
  kind: 'action' | 'focus' | 'request' | 'response' | 'requestFailed' | 'event' | 'assertion' | 'error' | 'input';
  label: string; actionId?: string; requestId?: string; target?: string; data?: Record<string, unknown>;
}
export interface TemporalCheck {
  id: string; label: string; status: 'passed' | 'failed' | 'error' | 'not-run';
  expected: string; actual: string; actionId: string; traceSequence?: number;
}
export interface TemporalExecution {
  version: 'passage-temporal-execution/v1'; verifierVersion?: string; id: string; identity: TraceIdentity; contractDigest: string;
  status: 'passed' | 'failed' | 'error' | 'cancelled'; passed: boolean;
  startedAt: string; completedAt: string; durationMs: number;
  actionsExecuted: string[]; checks: TemporalCheck[]; trace: TemporalTraceEvent[];
  failureSignature: string | null; error?: string;
  limitations: string[];
}
export interface BoundedSchedule { id: string; label: string; steps: string[] }
export interface CompiledSchedule extends BoundedSchedule { contractDigest: string; actions: TemporalAction[] }
export interface ScheduleReduction {
  original: string[]; minimized: string[]; signature: string; attempts: number;
  acceptedRemovals: number; execution: TemporalExecution;
}
