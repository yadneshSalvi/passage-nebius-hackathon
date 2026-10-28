import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Locator, Page } from '@playwright/test';
import type { SemanticBinding, TemporalAction, TemporalAssertion, TemporalCheck, TemporalContract, TemporalContractBody, TemporalExecution, TraceIdentity } from '../shared/temporal.js';
import { recordTrace, type TraceRecorder } from './trace-recorder.js';

export const TEMPORAL_VERIFIER_VERSION = 'passage-temporal-native-focus-bounded-cleanup-v3';

export class ActionBarrierError extends Error {
  constructor(readonly actionId: string, readonly code: string, message: string) { super(message); this.name = 'ActionBarrierError'; }
}
export interface ProtectedOutcomeSnapshot { records: Record<string, unknown>[]; authority: string }
export type OutcomeObserver = () => Promise<ProtectedOutcomeSnapshot>;
export type TemporalEventDriver = (event: string, context: { page: Page; signal?: AbortSignal; timeoutMs: number; recorder: TraceRecorder; actionId: string }) => Promise<void>;
export interface ExecuteContractOptions {
  page: Page; contract: TemporalContract; actions?: TemporalAction[];
  outcomeObserver?: OutcomeObserver; eventDriver?: TemporalEventDriver;
  identity?: Partial<TraceIdentity>; signal?: AbortSignal; recorder?: TraceRecorder;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
export function temporalContractDigest(body: TemporalContractBody): string {
  const { version, id, revision, title, bindings, actions, assertions, allowedEvents, bounds } = body;
  return createHash('sha256').update(canonical({ version, id, revision, title, bindings, actions, assertions, allowedEvents, bounds })).digest('hex');
}
/** This helper records an explicit reviewer decision; calling it is not independent review. */
export function approveTemporalContract(body: TemporalContractBody, reviewer: Omit<TemporalContract['approval'], 'digest'>): TemporalContract {
  const allowedKeys = new Set(['version','id','revision','title','bindings','actions','assertions','allowedEvents','bounds','digest','approval']);
  if (Object.keys(body).some(key => !allowedKeys.has(key))) throw new Error('Unknown contract body field.');
  const { version, id, revision, title, bindings, actions, assertions, allowedEvents, bounds } = body;
  const frozenBody = temporalContractBodySchema.parse(JSON.parse(JSON.stringify({ version, id, revision, title, bindings, actions, assertions, allowedEvents, bounds }))) as TemporalContractBody;
  const digest = temporalContractDigest(frozenBody);
  const approved = { ...frozenBody, digest, approval: { ...reviewer, digest } };
  const freeze = (value: unknown): void => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } };
  freeze(approved); return approved;
}
const identifier = z.string().min(1).max(120);
const readSchema = z.union([z.enum(['value', 'text']), z.strictObject({ attribute: identifier })]).optional();
const bindingSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('testId'), value: z.string().min(1).max(500), read: readSchema }),
  z.strictObject({ kind: z.literal('css'), value: z.string().min(1).max(500), read: readSchema }),
  z.strictObject({ kind: z.literal('role'), role: z.enum(['alert','alertdialog','application','article','banner','blockquote','button','caption','cell','checkbox','code','columnheader','combobox','complementary','contentinfo','definition','deletion','dialog','directory','document','emphasis','feed','figure','form','generic','grid','gridcell','group','heading','img','insertion','link','list','listbox','listitem','log','main','marquee','math','meter','menu','menubar','menuitem','menuitemcheckbox','menuitemradio','navigation','none','note','option','paragraph','presentation','progressbar','radio','radiogroup','region','row','rowgroup','rowheader','scrollbar','search','searchbox','separator','slider','spinbutton','status','strong','subscript','superscript','switch','tab','table','tablist','tabpanel','term','textbox','time','timer','toolbar','tooltip','tree','treegrid','treeitem']), name: z.string().max(500).optional(), read: readSchema }),
]);
const actionBase = { id: identifier, label: z.string().min(1).max(500), requires: z.array(identifier).max(200).optional(), required: z.boolean().optional() };
const actionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...actionBase, kind: z.literal('focus'), binding: identifier }),
  z.strictObject({ ...actionBase, kind: z.literal('press'), key: z.string().min(1).max(80), binding: identifier.optional() }),
  z.strictObject({ ...actionBase, kind: z.literal('fill'), binding: identifier, value: z.string().max(4096) }),
  z.strictObject({ ...actionBase, kind: z.literal('waitFor'), binding: identifier, state: z.enum(['visible','hidden','attached','detached']), timeoutMs: z.number().int().min(1).max(120000).optional() }),
  z.strictObject({ ...actionBase, kind: z.literal('event'), event: identifier }),
  z.strictObject({ ...actionBase, kind: z.literal('checkpoint') }),
]);
const assertionBase = { id: identifier, label: z.string().min(1).max(500), after: identifier, required: z.boolean().optional() };
const assertionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...assertionBase, kind: z.literal('valuePreserved'), binding: identifier, since: identifier }),
  z.strictObject({ ...assertionBase, kind: z.literal('valueEquals'), binding: identifier, expected: z.string().max(4096) }),
  z.strictObject({ ...assertionBase, kind: z.literal('focusWithin'), binding: identifier }),
  z.strictObject({ ...assertionBase, kind: z.literal('modalContainment'), binding: identifier, steps: z.number().int().min(1).max(64) }),
  z.strictObject({ ...assertionBase, kind: z.literal('closedFocusRestored'), panel: identifier, trigger: identifier }),
  z.strictObject({ ...assertionBase, kind: z.literal('outcome'), expected: z.record(identifier, z.union([z.string().max(4096),z.number().finite(),z.boolean(),z.null()])), count: z.number().int().min(0).max(100) }),
]);
const temporalContractShape = {
  version: z.literal('passage-temporal/v1'), id: identifier, revision: z.number().int().min(1), title: z.string().min(1).max(500),
  bindings: z.record(identifier, bindingSchema), actions: z.array(actionSchema).min(1).max(200), assertions: z.array(assertionSchema).min(1).max(200),
  allowedEvents: z.array(z.strictObject({ id: identifier, label: z.string().min(1).max(500), requires: z.array(identifier).max(200).optional() })).max(100),
  bounds: z.strictObject({ maxActions: z.number().int().min(1).max(200), maxDurationMs: z.number().int().min(1).max(120000), actionTimeoutMs: z.number().int().min(1).max(120000) }),
};
export const temporalContractBodySchema = z.strictObject(temporalContractShape);
export const temporalContractSchema = z.strictObject({
  ...temporalContractShape,
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  approval: z.strictObject({ digest: z.string().regex(/^[a-f0-9]{64}$/), approvedAt: z.string().datetime(), actor: z.string().trim().min(1).max(120), role: z.enum(['operator','maintainer','accessibility-reviewer']), evidenceClass: z.enum(['authored-development','independent-review']) }),
});
export function validateTemporalContract(contract: TemporalContract): void {
  temporalContractSchema.parse(contract);
  if (contract.version !== 'passage-temporal/v1' || temporalContractDigest(contract) !== contract.digest || contract.approval?.digest !== contract.digest) throw new Error('Contract is not the immutable approved revision.');
  if (!contract.approval.actor.trim() || !Number.isFinite(Date.parse(contract.approval.approvedAt))) throw new Error('Contract requires a named reviewer and approval time.');
  const { maxActions, maxDurationMs, actionTimeoutMs } = contract.bounds;
  if (!Number.isInteger(maxActions) || maxActions < 1 || maxActions > 200 || maxDurationMs < 1 || maxDurationMs > 120_000 || actionTimeoutMs < 1 || actionTimeoutMs > maxDurationMs) throw new Error('Invalid bounded execution limits.');
  const maximumOperations = contract.actions.length + contract.assertions.reduce((count, assertion) => count + (assertion.kind === 'modalContainment' ? assertion.steps * 2 : 0), 0);
  if (maximumOperations > maxActions) throw new Error('Contract exceeds the action bound, including generated modal probes.');
  const ids = contract.actions.map(action => action.id);
  if (ids.includes('initial')) throw new Error('The action ID initial is reserved for the pre-action value snapshot.');
  if (new Set(ids).size !== ids.length || new Set(contract.assertions.map(assertion => assertion.id)).size !== contract.assertions.length) throw new Error('Action and assertion IDs must be unique.');
  const events = new Set(contract.allowedEvents.map(event => event.id));
  if (events.size !== contract.allowedEvents.length) throw new Error('Event IDs must be unique.');
  contract.allowedEvents.forEach(event => { if (event.requires?.some(id => !ids.includes(id))) throw new Error('Unknown event dependency.'); });
  contract.actions.forEach((action, index) => {
    if (action.requires?.some(id => !ids.slice(0, index).includes(id))) throw new Error(`Invalid dependency for ${action.id}.`);
    if ('binding' in action && action.binding && !Object.hasOwn(contract.bindings, action.binding)) throw new Error(`Unknown binding ${action.binding}.`);
    if (action.kind === 'event' && !events.has(action.event)) throw new Error(`Event ${action.event} is not allowed.`);
  });
  contract.assertions.forEach(assertion => {
    if (!ids.includes(assertion.after)) throw new Error(`Unknown assertion checkpoint ${assertion.after}.`);
    if (assertion.kind === 'modalContainment' && (!Number.isInteger(assertion.steps) || assertion.steps < 1 || assertion.steps > 64)) throw new Error('Modal probes require 1–64 Tab presses in each direction.');
    if (assertion.kind === 'valuePreserved' && assertion.since !== 'initial' && !ids.slice(0, ids.indexOf(assertion.after) + 1).includes(assertion.since)) throw new Error('Value preservation baseline must precede its assertion.');
    const names = 'binding' in assertion ? [assertion.binding] : assertion.kind === 'closedFocusRestored' ? [assertion.panel, assertion.trigger] : [];
    if (names.some(name => !Object.hasOwn(contract.bindings, name))) throw new Error(`Unknown assertion binding for ${assertion.id}.`);
  });
}
export function resolveBinding(page: Page, binding: SemanticBinding): Locator {
  if (binding.kind === 'testId') return page.getByTestId(binding.value);
  if (binding.kind === 'css') return page.locator(binding.value);
  return page.getByRole(binding.role as Parameters<Page['getByRole']>[0], binding.name === undefined ? undefined : { name: binding.name, exact: true });
}
// Locator queries run in Playwright's isolated utility world. Browser-native
// :focus state avoids application-patched document.activeElement/contains in
// the main world. This samples focus; it does not authenticate DOM semantics.
async function hasNativeFocus(page: Page, target: Locator): Promise<boolean> {
  return await target.and(page.locator(':focus')).count() === 1;
}
async function hasNativeFocusWithin(page: Page, container: Locator): Promise<boolean> {
  return await hasNativeFocus(page, container) || await container.locator(':focus').count() > 0;
}
async function readBinding(page: Page, binding: SemanticBinding): Promise<string> {
  const locator = resolveBinding(page, binding);
  if (typeof binding.read === 'object') return await locator.getAttribute(binding.read.attribute) ?? '';
  if (binding.read === 'value') return locator.inputValue();
  return await locator.textContent() ?? '';
}
function bounded<T>(task: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (callback: (value: any) => void, value: unknown) => {
      if (done) return; done = true; clearTimeout(timer);
      signal?.removeEventListener('abort', abort); callback(value);
    };
    const abort = () => finish(reject, signal?.reason ?? new Error('Execution cancelled.'));
    timer = setTimeout(() => finish(reject, new Error('Temporal operation exceeded its bounded timeout.')), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    task.then(value => finish(resolve, value), cause => finish(reject, cause));
  });
}
export async function executeContract(options: ExecuteContractOptions): Promise<TemporalExecution> {
  const { page, signal } = options;
  const contract = JSON.parse(JSON.stringify(options.contract)) as TemporalContract;
  validateTemporalContract(contract);
  const actions = structuredClone(options.actions ?? contract.actions);
  const approvedActions = new Map(contract.actions.map(action => [action.id, canonical(action)]));
  const seen = new Set<string>();
  for (const action of actions) {
    if (approvedActions.get(action.id) !== canonical(action) || seen.has(action.id)) throw new Error('Execution actions must be an unmodified subset of the approved contract.');
    if (action.requires?.some(id => !seen.has(id))) throw new Error(`Schedule omits the dependency of ${action.id}.`);
    seen.add(action.id);
  }
  if (contract.actions.some(action => action.required && !seen.has(action.id))) throw new Error('Schedule omits a required action.');
  const started = Date.now(), startedAt = new Date().toISOString(), id = options.identity?.executionId ?? randomUUID();
  const identity: TraceIdentity = { executionId: id, sourceDigest: '', buildId: '', sessionId: '', adapter: 'semantic-bindings', ...options.identity, contractDigest: contract.digest };
  const recorder = options.recorder ?? await recordTrace(page, identity, { timeoutMs: Math.min(500, contract.bounds.actionTimeoutMs, contract.bounds.maxDurationMs), signal });
  const checks: TemporalCheck[] = [], actionsExecuted: string[] = [], snapshots = new Map<string, Record<string, string>>();
  const signatures: string[] = [];
  let error: string | undefined;
  let stopped = false;
  const alive = () => { if (stopped) throw new Error('Temporal execution has stopped.'); signal?.throwIfAborted(); if (Date.now() - started >= contract.bounds.maxDurationMs) throw new Error('Temporal execution exceeded its duration bound.'); };
  const timeout = () => Math.max(1, Math.min(contract.bounds.actionTimeoutMs, contract.bounds.maxDurationMs - (Date.now() - started)));
  const snapshot = async (name: string) => {
    const values: Record<string, string> = Object.create(null);
    for (const assertion of contract.assertions) if (assertion.kind === 'valuePreserved' && assertion.since === name) values[assertion.binding] = await readBinding(page, contract.bindings[assertion.binding]);
    snapshots.set(name, values);
  };
  const test = async (assertion: TemporalAssertion) => {
    let passed = false, expected = '', actual = '', code: string = assertion.kind;
    if (assertion.kind === 'valuePreserved') {
      if (!(assertion.binding in (snapshots.get(assertion.since) ?? {}))) throw new Error(`Missing executed baseline ${assertion.since}.`);
      expected = snapshots.get(assertion.since)![assertion.binding]; actual = await readBinding(page, contract.bindings[assertion.binding]); passed = expected === actual; code = 'value-changed';
    } else if (assertion.kind === 'valueEquals') {
      expected = assertion.expected; actual = await readBinding(page, contract.bindings[assertion.binding]); passed = expected === actual; code = 'wrong-value';
    } else if (assertion.kind === 'focusWithin' || assertion.kind === 'modalContainment') {
      const container = resolveBinding(page, contract.bindings[assertion.binding]);
      expected = assertion.kind === 'modalContainment' ? 'Actual focus remains inside the visible modal.' : 'Actual focus is within the visible bound element.';
      const inside = async () => await container.isVisible() && await hasNativeFocusWithin(page, container);
      passed = await inside(); actual = passed ? 'Focus inside.' : 'Focus escaped or modal absent.';
      if (passed && assertion.kind === 'modalContainment') for (const key of ['Shift+Tab', 'Tab']) {
        for (let step = 0; step < assertion.steps; step++) {
          alive(); recorder.record({ kind: 'action', label: `Modal containment probe: ${key}`, actionId: assertion.after, data: { assertionId: assertion.id, step: step + 1 } });
          await page.keyboard.press(key);
          if (!await inside()) { passed = false; actual = `Focus escaped after ${step + 1} ${key} presses.`; break; }
        }
        if (!passed) break;
      }
      code = 'focus-escaped';
    } else if (assertion.kind === 'closedFocusRestored') {
      expected = 'Panel closed and focus returned to the surviving trigger.';
      const panel = resolveBinding(page, contract.bindings[assertion.panel]);
      const trigger = resolveBinding(page, contract.bindings[assertion.trigger]);
      const closed = !await panel.isVisible(), focused = await hasNativeFocus(page, trigger);
      passed = closed && focused; actual = `Panel ${closed ? 'closed' : 'open'}; trigger ${focused ? 'focused' : 'not focused'}.`; code = 'closure-focus';
    } else {
      if (!options.outcomeObserver) throw new Error('A protected read-only outcome observer is required.');
      const outcome = await options.outcomeObserver();
      if (!outcome.authority.trim()) throw new Error('Outcome observer must identify its protected authority.');
      expected = `${assertion.count} protected record(s) matching ${JSON.stringify(assertion.expected)}.`;
      passed = outcome.records.length === assertion.count && outcome.records.every(record => Object.entries(assertion.expected).every(([key, value]) => record[key] === value));
      actual = `${outcome.records.length} record(s) from ${outcome.authority}: ${JSON.stringify(outcome.records)}`; code = 'protected-outcome';
    }
    alive();
    const status = passed ? 'passed' : 'failed';
    const traceSequence = recorder.record({ kind: 'assertion', label: assertion.label, actionId: assertion.after, data: { assertionId: assertion.id, status, expected, actual } });
    checks.push({ id: assertion.id, label: assertion.label, actionId: assertion.after, status, expected, actual, traceSequence });
    if (!passed) signatures.push(`${assertion.id}:${code}`);
  };
  try {
    alive(); await bounded(snapshot('initial'), timeout(), signal);
    actionLoop: for (const action of actions) {
      alive(); const actionTimeout = timeout();
      const browserTimeout = Math.max(1, actionTimeout - Math.min(25, Math.floor(actionTimeout / 10)));
      const focusedTarget = async (binding: string) => {
        const target = resolveBinding(page, contract.bindings[binding]);
        if (await target.count() !== 1) throw new ActionBarrierError(action.id, 'target-unavailable', `Expected exactly one target for ${binding}.`);
        if (!await hasNativeFocus(page, target)) throw new ActionBarrierError(action.id, 'focus-unreachable', `Target ${binding} does not have actual keyboard focus.`);
        return target;
      };
      recorder.record({ kind: 'action', label: action.label, actionId: action.id, data: { kind: action.kind, ...('key' in action ? { key: action.key } : {}) } });
      await bounded((async () => {
        if (action.kind === 'focus') {
          try { await resolveBinding(page, contract.bindings[action.binding]).focus({ timeout: browserTimeout }); }
          catch (cause) { if (cause instanceof Error && cause.name === 'TimeoutError' && !page.isClosed()) throw new ActionBarrierError(action.id, 'target-unavailable', `Focus target ${action.binding} was not available.`); throw cause; }
        }
        else if (action.kind === 'fill') {
          const target = await focusedTarget(action.binding);
          await target.fill(action.value, { timeout: browserTimeout });
        }
        else if (action.kind === 'press') {
          if (action.binding) {
            await focusedTarget(action.binding);
          }
          await page.keyboard.press(action.key);
        } else if (action.kind === 'waitFor') {
          try { await resolveBinding(page, contract.bindings[action.binding]).waitFor({ state: action.state, timeout: Math.min(action.timeoutMs ?? browserTimeout, browserTimeout) }); }
          catch (cause) { if (cause instanceof Error && cause.name === 'TimeoutError' && !page.isClosed()) throw new ActionBarrierError(action.id, 'expected-state-unreachable', `${action.binding} did not become ${action.state} within the allowed wait.`); throw cause; }
        }
        else if (action.kind === 'event') {
          if (!options.eventDriver) throw new Error(`No event driver for allowed event ${action.event}.`);
          await options.eventDriver(action.event, { page, signal, timeoutMs: browserTimeout, recorder, actionId: action.id });
          alive();
          recorder.record({ kind: 'event', label: `Completed ${action.event}`, actionId: action.id });
        }
      })(), actionTimeout, signal);
      actionsExecuted.push(action.id);
      await bounded(snapshot(action.id), timeout(), signal);
      for (const assertion of contract.assertions.filter(item => item.after === action.id)) {
        try { await bounded(test(assertion), timeout(), signal); if (checks.at(-1)?.status === 'failed') break actionLoop; }
        catch (cause) {
          checks.push({ id: assertion.id, label: assertion.label, actionId: assertion.after, status: 'error', expected: 'Assertion executes with observed evidence.', actual: cause instanceof Error ? cause.message : String(cause) });
          throw cause;
        }
      }
    }
  } catch (cause) {
    if (cause instanceof ActionBarrierError) {
      const action = actions.find(item => item.id === cause.actionId)!;
      const traceSequence = recorder.record({ kind: 'assertion', label: `Blocked: ${action.label}`, actionId: action.id, data: { status: 'failed', code: cause.code, actual: cause.message } });
      checks.push({ id: `action:${action.id}`, label: action.label, actionId: action.id, status: 'failed', expected: 'The approved action is operable from the observed keyboard state.', actual: cause.message, traceSequence });
      signatures.push(`action:${action.id}:${cause.code}`);
    } else {
      error = cause instanceof Error ? cause.message : String(cause);
      recorder.record({ kind: 'error', label: error });
    }
  } finally {
    stopped = true;
    const cleanupBudget = () => Math.max(1, Math.min(500, contract.bounds.maxDurationMs - (Date.now() - started)));
    const cleanupError = (cause: unknown) => {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (!error?.includes(message)) error = error ? `${error} Cleanup: ${message}` : `Trace cleanup failed: ${message}`;
      recorder.record({ kind: 'error', label: message, data: { phase: 'execution-cleanup', traceIncomplete: true } });
    };
    try { await recorder.flush({ timeoutMs: cleanupBudget(), signal }); } catch (cause) { cleanupError(cause); }
    if (!options.recorder) try { await recorder.stop({ timeoutMs: cleanupBudget(), signal }); } catch (cause) { cleanupError(cause); }
  }
  for (const assertion of contract.assertions) if (!checks.some(check => check.id === assertion.id)) checks.push({ id: assertion.id, label: assertion.label, actionId: assertion.after, status: 'not-run', expected: 'Executed checkpoint and assertion.', actual: 'Checkpoint was omitted or execution stopped.' });
  const status = signal?.aborted ? 'cancelled' : error || checks.some(check => check.status === 'error') ? 'error' : checks.length === 0 || checks.some(check => check.status !== 'passed') ? 'failed' : 'passed';
  return { version: 'passage-temporal-execution/v1', verifierVersion: TEMPORAL_VERIFIER_VERSION, id, identity, contractDigest: contract.digest, status, passed: status === 'passed', startedAt, completedAt: new Date().toISOString(), durationMs: Date.now() - started, actionsExecuted, checks, trace: [...recorder.events], failureSignature: status === 'failed' && signatures.length ? signatures.sort().join('|') : null, ...(error ? { error } : {}), limitations: ['Bounded browser and protected outcome checks; no claim of formal verification.', 'Native browser focus and visibility are sampled at bounded checkpoints; page-authored content is not independently authenticated semantic truth.', 'DOM and keyboard evidence is not actual assistive-technology speech or a participant session.', `Contract approval: ${contract.approval.role}; ${contract.approval.evidenceClass}.`] };
}
