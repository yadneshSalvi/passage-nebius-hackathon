import type { BoundedSchedule, CompiledSchedule, ScheduleReduction, TemporalContract, TemporalExecution } from '../shared/temporal.js';
import { validateTemporalContract } from './contract-interpreter.js';

/** Only already approved actions and named application events may run. */
export function compileSchedule(contract: TemporalContract, proposal: BoundedSchedule): CompiledSchedule {
  validateTemporalContract(contract);
  if (!proposal.steps.length || proposal.steps.length > contract.bounds.maxActions || new Set(proposal.steps).size !== proposal.steps.length) throw new Error('Schedule must be nonempty, unique and within its bound.');
  const actionMap = new Map(contract.actions.map(action => [action.id, action]));
  const seen = new Set<string>();
  const actions = proposal.steps.map(id => {
    const action = actionMap.get(id);
    if (!action) throw new Error(`Unknown allowed action ${id}.`);
    if (action.requires?.some(dependency => !seen.has(dependency))) throw new Error(`Missing or reordered dependency for ${id}.`);
    if (action.kind === 'event') {
      const event = contract.allowedEvents.find(item => item.id === action.event);
      if (!event || event.requires?.some(dependency => !seen.has(dependency))) throw new Error(`Unavailable event ${action.event}.`);
    }
    seen.add(id); return structuredClone(action);
  });
  if (contract.actions.some(action => action.required && !seen.has(action.id))) throw new Error('A required action cannot be removed.');
  return { ...structuredClone(proposal), contractDigest: contract.digest, actions };
}
export interface ReductionReplay {
  attempt: number; steps: string[]; removedActionIds: string[];
  decision: 'initial' | 'accepted' | 'rejected';
  reason: 'initial-failure' | 'same-failure-signature' | 'execution-identity-mismatch' | 'not-an-assertion-failure' | 'failure-signature-changed';
  execution: TemporalExecution;
}
export interface ReductionValidationSkip { steps: string[]; removedActionIds: string[]; reason: string }
export interface ReductionSearch {
  algorithm: 'optional-group-ddmin-v2';
  termination: 'searched-moves-exhausted' | 'replay-budget-exhausted' | 'inconclusive-replays';
  localMinimal: boolean; globalMinimal: false;
  replayLimit: number; initialReused: boolean;
  candidatesChecked: number; invalidCandidates: number; reusedExecutions: number; acceptedMoves: number; inconclusiveReplays: number;
  limitation: string;
}
/** Deterministic chunks, complements, pairs and singles over optional actions.
 * Required actions remain present even when optional groups span their positions.
 * This move family is bounded; it does not enumerate every possible subset.
 */
function optionalDeletionGroups(ids: string[]): string[][] {
  const groups: string[][] = [], seen = new Set<string>();
  const add = (group: string[]) => {
    if (!group.length) return;
    const key = JSON.stringify(group);
    if (!seen.has(key)) { seen.add(key); groups.push(group); }
  };
  for (let parts = 1; parts <= ids.length;) {
    for (let part = 0; part < parts; part++) {
      const group = ids.slice(Math.floor(part * ids.length / parts), Math.floor((part + 1) * ids.length / parts));
      add(group);
      const removed = new Set(group);
      add(ids.filter(id => !removed.has(id)));
    }
    if (parts === ids.length) break;
    parts = Math.min(ids.length, parts * 2);
  }
  // Unaligned pairs can cancel each other's effects even when neither single
  // deletion retains the failure. The replay cap still applies to every run.
  for (let first = 0; first < ids.length; first++)
    for (let second = first + 1; second < ids.length; second++) add([ids[first], ids[second]]);
  ids.forEach(id => add([id]));
  return groups;
}
/** Every uncached candidate reruns a fresh browser/session supplied by execute.
 * A result is local only to the searched deletion moves, never a global minimum.
 */
export async function reduceSchedule(options: {
  contract: TemporalContract; schedule: BoundedSchedule;
  execute: (schedule: CompiledSchedule) => Promise<TemporalExecution>;
  initial?: TemporalExecution; maxAttempts?: number; signal?: AbortSignal;
  onReplay?: (replay: ReductionReplay) => void;
}): Promise<ScheduleReduction & { search: ReductionSearch; replays: ReductionReplay[]; validationSkips: ReductionValidationSkip[]; validationSkipsTruncated: number }> {
  const limit = options.maxAttempts ?? 30;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('Reduction attempts must be bounded from 1 to 200.');
  const compiled = compileSchedule(options.contract, options.schedule);
  let attempts = 0, acceptedRemovals = 0, acceptedMoves = 0;
  const replays: ReductionReplay[] = [], validationSkips: ReductionValidationSkip[] = [];
  const retain = (record: ReductionReplay) => { const frozen = structuredClone(record); replays.push(frozen); options.onReplay?.(structuredClone(frozen)); };
  let execution = options.initial;
  options.signal?.throwIfAborted();
  if (!execution) { attempts++; execution = await options.execute(compiled); retain({ attempt: attempts, steps: [...compiled.steps], removedActionIds: [], decision: 'initial', reason: 'initial-failure', execution }); }
  options.signal?.throwIfAborted();
  const boundToSchedule = (result: TemporalExecution, steps: string[]) => result.contractDigest === options.contract.digest && !result.actionsExecuted.some((id, index) => steps[index] !== id);
  if (!boundToSchedule(execution, compiled.steps)) throw new Error('Initial execution is not bound to this exact schedule and contract.');
  if (execution.status !== 'failed' || !execution.failureSignature) throw new Error('Only a reproduced assertion failure can be reduced; errors/skipped probes cannot stand in for failures.');
  const signature = execution.failureSignature;
  let steps = [...compiled.steps];
  const cache = new Map<string, TemporalExecution>([[JSON.stringify(steps), execution]]);
  const required = new Set(options.contract.actions.filter(action => action.required).map(action => action.id));
  let candidatesChecked = 0, invalidCandidates = 0, reusedExecutions = 0, inconclusiveReplays = 0;
  let termination: ReductionSearch['termination'] = 'searched-moves-exhausted';
  search: while (true) {
    let accepted = false;
    for (const group of optionalDeletionGroups(steps.filter(id => !required.has(id)))) {
      options.signal?.throwIfAborted();
      const remove = new Set(group), candidate = steps.filter(id => !remove.has(id));
      candidatesChecked++;
      let proposal: CompiledSchedule;
      try { proposal = compileSchedule(options.contract, { ...options.schedule, steps: candidate }); }
      catch (cause) {
        invalidCandidates++;
        if (validationSkips.length < 200) validationSkips.push({ steps: candidate, removedActionIds: [...group], reason: cause instanceof Error ? cause.message : String(cause) });
        continue;
      }
      const key = JSON.stringify(candidate);
      let result = cache.get(key);
      if (result) reusedExecutions++;
      else {
        if (attempts >= limit) { termination = 'replay-budget-exhausted'; break search; }
        attempts++; result = await options.execute(proposal); cache.set(key, result);
        const bound = boundToSchedule(result, candidate);
        const sameFailure = bound && result.status === 'failed' && result.failureSignature === signature;
        if (!bound || result.status === 'error' || result.status === 'cancelled' || (result.status === 'failed' && !result.failureSignature)) inconclusiveReplays++;
        retain({ attempt: attempts, steps: [...candidate], removedActionIds: [...group], decision: sameFailure ? 'accepted' : 'rejected',
          reason: !bound ? 'execution-identity-mismatch' : result.status !== 'failed' || !result.failureSignature ? 'not-an-assertion-failure' : result.failureSignature !== signature ? 'failure-signature-changed' : 'same-failure-signature', execution: result });
        options.signal?.throwIfAborted();
      }
      if (boundToSchedule(result, candidate) && result.status === 'failed' && result.failureSignature === signature) {
        acceptedRemovals += steps.length - candidate.length; acceptedMoves++;
        steps = candidate; execution = result; accepted = true; break;
      }
    }
    if (!accepted) break;
  }
  options.signal?.throwIfAborted();
  if (termination === 'searched-moves-exhausted' && inconclusiveReplays) termination = 'inconclusive-replays';
  return { original: [...compiled.steps], minimized: steps, signature, attempts, acceptedRemovals, execution, replays, validationSkips, validationSkipsTruncated: invalidCandidates - validationSkips.length,
    search: { algorithm: 'optional-group-ddmin-v2', termination, localMinimal: termination === 'searched-moves-exhausted', globalMinimal: false,
      replayLimit: limit, initialReused: !!options.initial, candidatesChecked, invalidCandidates, reusedExecutions, acceptedMoves, inconclusiveReplays,
      limitation: 'Local only to validated chunks, complements, pairs and single deletions searched within the replay budget; no global minimality guarantee. Inconclusive error/cancelled trials cannot establish local minimality. Identical candidate schedules may reuse an observed execution; nondeterministic behavior is not established by cached evidence.' } };
}
