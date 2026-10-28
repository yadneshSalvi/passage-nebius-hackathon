/** Authored appointment adapter. The generic interpreter has no fixture-family branches. */
import { chromium, type Page, type Route, type BrowserContext } from '@playwright/test';
import type { Scenario } from '../shared/types.js';
import type { TemporalAction, TemporalAssertion, TemporalContract, TemporalContractBody, TemporalExecution } from '../shared/temporal.js';
import { chromiumExecutable } from './browser.js';
import { ActionBarrierError, approveTemporalContract, executeContract, validateTemporalContract, type TemporalEventDriver } from './contract-interpreter.js';
import type { FixtureBuild, FixtureHost } from './host.js';
import { recordTrace, type TraceRecorder } from './trace-recorder.js';
import { randomUUID } from 'node:crypto';
export type FixtureTemporalScheduleId = 'baseline' | 'cancel-pending' | 'modal-boundary';
export function createFixtureTemporalContract(options: { scheduleId: FixtureTemporalScheduleId; choiceDate: string; approval?: Omit<TemporalContract['approval'], 'digest'> }): TemporalContract {
  if (!/^2026-11-\d{2}$/.test(options.choiceDate)) throw new Error('An explicit intended fixture date is required.');
  const actions: TemporalAction[] = [
    { id: 'reach-trigger', label: 'Tab to the appointment control', kind: 'press', key: 'Tab', required: true },
    { id: 'open', label: 'Open appointments with Enter', kind: 'press', key: 'Enter', binding: 'trigger', requires: ['reach-trigger'], required: true },
    { id: 'opened', label: 'Observe the opened dialog', kind: 'waitFor', binding: 'panel', state: 'visible', requires: ['open'], required: true },
  ];
  const assertions: TemporalAssertion[] = [{ id: 'opening-preserves-value', label: 'Opening does not commit a choice', kind: 'valuePreserved', binding: 'value', since: 'initial', after: 'opened' }];
  const allowedEvents: TemporalContractBody['allowedEvents'] = [];
  if (options.scheduleId === 'modal-boundary') {
    actions.push(
      { id: 'cancel', label: 'Close the modal using Escape', kind: 'press', key: 'Escape', requires: ['opened'], required: true },
      { id: 'closed', label: 'Observe closure', kind: 'waitFor', binding: 'panel', state: 'hidden', requires: ['cancel'], required: true },
    );
    assertions.push(
      { id: 'modal-focus-contained', label: 'Tab and reverse Tab stay inside the modal', kind: 'modalContainment', binding: 'panel', steps: 12, after: 'opened' },
      { id: 'closure-restores-focus', label: 'Closure restores focus to the trigger', kind: 'closedFocusRestored', panel: 'panel', trigger: 'trigger', after: 'closed' },
      { id: 'cancel-preserves-value', label: 'Closing preserves the original value', kind: 'valuePreserved', binding: 'value', since: 'initial', after: 'closed' },
    );
  } else {
    if (options.scheduleId === 'cancel-pending') actions.push(
      { id: 'explore-forward', label: 'Explore the next appointment', kind: 'press', key: 'ArrowRight', requires: ['opened'] },
      { id: 'explore-back', label: 'Return to the intended appointment', kind: 'press', key: 'ArrowLeft', requires: ['opened'] },
    );
    actions.push(
      { id: 'activate-choice', label: 'Activate the intended appointment with Enter', kind: 'press', key: 'Enter', binding: 'choice', requires: ['opened'], required: true },
      { id: 'pending', label: 'Observe an actual pending availability request', kind: 'event', event: 'availability.pending', requires: ['activate-choice'], required: true },
    );
    allowedEvents.push({ id: 'availability.pending', label: 'Observe a pending availability request', requires: ['activate-choice'] });
    if (options.scheduleId === 'cancel-pending') {
      actions.push(
        { id: 'cancel', label: 'Press Escape while the real response is held', kind: 'press', key: 'Escape', requires: ['pending'], required: true },
        { id: 'closed', label: 'Observe closure before releasing the response', kind: 'waitFor', binding: 'panel', state: 'hidden', requires: ['cancel'], required: true },
      );
      assertions.push(
        { id: 'pending-preserves-value', label: 'Pending selection has not committed', kind: 'valuePreserved', binding: 'value', since: 'initial', after: 'pending' },
        { id: 'cancel-restores-focus', label: 'Cancellation closes and restores focus', kind: 'closedFocusRestored', panel: 'panel', trigger: 'trigger', after: 'closed' },
      );
    }
    actions.push({ id: 'release', label: 'Deliver the actual protected availability response', kind: 'event', event: 'availability.release', requires: [options.scheduleId === 'cancel-pending' ? 'closed' : 'pending'], required: true });
    allowedEvents.push({ id: 'availability.release', label: 'Deliver the real held response', requires: ['pending'] });
    if (options.scheduleId === 'cancel-pending') assertions.push(
      { id: 'late-response-cannot-commit', label: 'Cancelled response cannot commit a date', kind: 'valuePreserved', binding: 'value', since: 'initial', after: 'release' },
      { id: 'late-response-cannot-steal-focus', label: 'Late completion retains closure and restored focus', kind: 'closedFocusRestored', panel: 'panel', trigger: 'trigger', after: 'release' },
      { id: 'no-cancelled-booking', label: 'Cancellation created no protected booking', kind: 'outcome', expected: {}, count: 0, after: 'release' },
    );
    else {
      actions.push(
        { id: 'selection-closed', label: 'Wait for committed selection to close the dialog', kind: 'waitFor', binding: 'panel', state: 'hidden', requires: ['release'], required: true },
        { id: 'reach-name', label: 'Tab to the attendee name', kind: 'press', key: 'Tab', requires: ['selection-closed'], required: true },
        { id: 'enter-name', label: 'Enter the fictional attendee', kind: 'fill', binding: 'name', value: 'Alex Morgan', requires: ['reach-name'], required: true },
        { id: 'reach-confirm', label: 'Tab to confirmation', kind: 'press', key: 'Tab', requires: ['enter-name'], required: true },
        { id: 'confirm', label: 'Confirm the requested appointment with Enter', kind: 'press', key: 'Enter', binding: 'confirm', requires: ['reach-confirm'], required: true },
        { id: 'saved', label: 'Observe the real confirmation', kind: 'waitFor', binding: 'confirmation', state: 'visible', requires: ['confirm'], required: true },
      );
      assertions.push(
        { id: 'explicit-choice-committed', label: 'Committed date matches the explicit choice', kind: 'valueEquals', binding: 'value', expected: options.choiceDate, after: 'selection-closed' },
        { id: 'selection-restores-focus', label: 'Selection restores focus to the trigger', kind: 'closedFocusRestored', panel: 'panel', trigger: 'trigger', after: 'selection-closed' },
        { id: 'protected-correct-single-outcome', label: 'Exactly one protected record matches the explicit choice', kind: 'outcome', expected: { date: options.choiceDate, attendee: 'Alex Morgan' }, count: 1, after: 'saved' },
        { id: 'confirmation-focus', label: 'Focus reaches the stored confirmation', kind: 'focusWithin', binding: 'confirmationHeading', after: 'saved' },
      );
    }
  }
  const body: TemporalContractBody = {
    version: 'passage-temporal/v1', id: `authored-appointment-${options.scheduleId}`, revision: 1, title: `Authored appointment: ${options.scheduleId}`,
    bindings: {
      trigger: { kind: 'testId', value: 'slot-trigger' }, panel: { kind: 'testId', value: 'slot-panel' }, value: { kind: 'testId', value: 'selected-date', read: 'value' },
      choice: { kind: 'css', value: `[data-date="${options.choiceDate}"]` }, name: { kind: 'testId', value: 'attendee-input', read: 'value' }, confirm: { kind: 'testId', value: 'confirm-appointment' },
      confirmation: { kind: 'testId', value: 'confirmation' }, confirmationHeading: { kind: 'testId', value: 'confirmation-heading' },
    }, actions, assertions, allowedEvents, bounds: { maxActions: 40, maxDurationMs: 15000, actionTimeoutMs: 3000 },
  };
  return approveTemporalContract(body, options.approval ?? { actor: 'Passage authored-fixture operator', role: 'operator', approvedAt: '2026-10-28T00:00:00.000Z', evidenceClass: 'authored-development' });
}
/** Holds only real server responses. No invented availability or bypassed validation. */
export async function installAvailabilityGate(page: Page, url: string): Promise<{ drive: TemporalEventDriver; dispose(): Promise<void> }> {
  let resolveArrived!: () => void, resolveRelease!: () => void, resolveDelivered!: () => void;
  const arrived = new Promise<void>(resolve => { resolveArrived = resolve; });
  const release = new Promise<void>(resolve => { resolveRelease = resolve; });
  const delivered = new Promise<void>(resolve => { resolveDelivered = resolve; });
  let pending = false, released = false, routeError: unknown;
  const routeHandler = async (route: Route) => {
    if (pending) { await route.continue(); return; }
    pending = true; resolveArrived();
    try { const response = await route.fetch(); await release; await route.fulfill({ response }); }
    catch (error) { routeError = error; await route.abort().catch(() => undefined); }
    finally { resolveDelivered(); }
  };
  await page.route(url, routeHandler);
  const drive: TemporalEventDriver = async (event, context) => {
    context.signal?.throwIfAborted();
    if (event === 'availability.pending') {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const observed = await Promise.race([arrived.then(() => true), new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), context.timeoutMs); })]);
      clearTimeout(timer);
      if (!observed) throw new ActionBarrierError(context.actionId, 'expected-event-unreachable', 'No actual availability request occurred after the approved activation.');
      if (!pending || released) throw new Error('No held pending request was observed.');
      context.recorder.record({ kind: 'event', label: 'Observed actual pending availability request', data: { url } });
    } else if (event === 'availability.release') {
      if (!pending || released) throw new Error('Release requires exactly one actual pending request.');
      const response = page.waitForResponse(url, { timeout: context.timeoutMs });
      released = true; resolveRelease(); const actual = await response; await actual.finished(); await delivered;
      if (routeError) throw routeError;
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      context.recorder.record({ kind: 'event', label: 'Delivered actual protected availability response', data: { url, status: actual.status() } });
    } else throw new Error(`Unsupported fixture event ${event}.`);
  };
  return { drive, dispose: async () => { resolveRelease(); await page.unroute(url, routeHandler); } };
}
export async function runFixtureTemporal(options: { host: FixtureHost; build: FixtureBuild; scenario: Scenario; contract: TemporalContract; actions?: TemporalAction[]; signal?: AbortSignal }): Promise<TemporalExecution> {
  validateTemporalContract(options.contract); options.signal?.throwIfAborted();
  const session = await options.host.createSession(options.build, options.scenario);
  options.signal?.throwIfAborted();
  const browser = await chromium.launch({ headless: true, executablePath: await chromiumExecutable(), timeout: 20000 });
  let context: BrowserContext | undefined, recorder: TraceRecorder | undefined;
  let gate: Awaited<ReturnType<typeof installAvailabilityGate>> | undefined;
  let completed: TemporalExecution | undefined;
  const identity = { executionId: randomUUID(), sourceDigest: options.build.digest, buildId: options.build.id, sessionId: session.id, contractDigest: options.contract.digest, adapter: 'authored-fixture-temporal-v3' };
  const abort = () => { void context?.close().catch(() => undefined); void browser.close().catch(() => undefined); };
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    options.signal?.throwIfAborted();
    context = await browser.newContext(); const page = await context.newPage();
    recorder = await recordTrace(page, identity, { signal: options.signal });
    gate = await installAvailabilityGate(page, `${options.host.origin}/s/${session.id}/availability`);
    options.signal?.throwIfAborted();
    await page.goto(`${options.host.origin}/s/${session.id}`, { waitUntil: 'networkidle', timeout: 12000 });
    await page.getByTestId('application-ready').waitFor({ timeout: 3000 });
    // Only the initial keyboard origin is reset; subsequent actions use real keys.
    await page.evaluate(() => { const prior = document.body.getAttribute('tabindex'); document.body.setAttribute('tabindex', '-1'); document.body.focus(); if (prior === null) document.body.removeAttribute('tabindex'); else document.body.setAttribute('tabindex', prior); });
    recorder.record({ kind: 'action', label: 'Reset initial keyboard origin to document body', data: { setup: true } });
    completed = await executeContract({ page, contract: options.contract, actions: options.actions, identity, recorder, signal: options.signal, eventDriver: gate.drive,
      outcomeObserver: async () => {
        const observed = await options.host.getSession(session.id);
        if (observed.sourceDigest !== options.build.digest || observed.buildId !== options.build.id) throw new Error('Protected outcome identity mismatch.');
        return { authority: `FixtureHost protected session ${session.id}`, records: observed.outcome ? [observed.outcome as unknown as Record<string, unknown>] : [] };
      },
    });
    return completed;
  } finally {
    options.signal?.removeEventListener('abort', abort);
    // Never let a rejected recorder stop prevent browser termination. Closing a
    // context and closing its browser may race; successful browser close wins.
    const closeContext = context?.close() ?? Promise.resolve();
    const closeBrowser = browser.close();
    const cleanup = Promise.allSettled([recorder?.stop({ timeoutMs: 500, pageWillClose: true }) ?? Promise.resolve(), closeContext, closeBrowser, gate?.dispose() ?? Promise.resolve()]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([cleanup, new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 2000); })]);
    clearTimeout(timer);
    const failure = result === null ? new Error('Fixture browser cleanup exceeded 2000 ms; termination was requested but process exit was not confirmed.')
      : result[2].status === 'rejected' ? result[2].reason
      : result[0].status === 'rejected' && completed?.status !== 'cancelled' ? result[0].reason : null;
    if (failure && completed) {
      const message = failure instanceof Error ? failure.message : String(failure);
      if (completed.status !== 'cancelled') completed.status = 'error';
      completed.passed = false; completed.failureSignature = null;
      completed.error = [completed.error, `Shutdown: ${message}`].filter(Boolean).join(' ');
      completed.completedAt = new Date().toISOString(); completed.durationMs = Date.now() - Date.parse(completed.startedAt);
      const last = completed.trace.at(-1);
      completed.trace.push({ sequence: completed.trace.length + 1, at: completed.completedAt, elapsedMs: (last?.elapsedMs ?? 0) + Math.max(0, Date.now() - Date.parse(last?.at ?? completed.startedAt)), provenance: 'controller', kind: 'error', label: message, data: { phase: 'fixture-shutdown', traceIncomplete: true } });
    }
  }
}
