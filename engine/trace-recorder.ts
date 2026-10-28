import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Page, Request } from '@playwright/test';
import type { TemporalTraceEvent, TraceIdentity } from '../shared/temporal.js';

export interface TraceCleanupOptions { timeoutMs?: number; signal?: AbortSignal; pageWillClose?: boolean }
export class TraceCleanupError extends Error {
  readonly code = 'TRACE_CLEANUP_FAILED';
  constructor(message: string) { super(message); this.name = 'TraceCleanupError'; }
}
function deadline(options: TraceCleanupOptions = {}) {
  const timeoutMs = options.timeoutMs ?? 500;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 5000) throw new TraceCleanupError('Trace cleanup requires a bounded 1–5000 ms budget.');
  return Date.now() + timeoutMs;
}
function observedWithin<T>(operation: () => Promise<T>, until: number, signal: AbortSignal | undefined, phase: string): Promise<T> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new TraceCleanupError('Trace cleanup cancelled.'));
  const remaining = until - Date.now();
  if (remaining <= 0) return Promise.reject(new TraceCleanupError(`${phase} exceeded its bounded timeout.`));
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (callback: (value: any) => void, value: unknown) => {
      if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); callback(value);
    };
    const abort = () => finish(reject, signal?.reason ?? new TraceCleanupError('Trace cleanup cancelled.'));
    const timer = setTimeout(() => finish(reject, new TraceCleanupError(`${phase} exceeded its bounded timeout.`)), remaining);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    try { operation().then(value => finish(resolve, value), cause => finish(reject, cause)); }
    catch (cause) { finish(reject, cause); }
  });
}
export interface TraceRecorder {
  identity: TraceIdentity; events: TemporalTraceEvent[];
  record(event: Omit<TemporalTraceEvent, 'sequence' | 'at' | 'elapsedMs'>): number;
  flush(options?: TraceCleanupOptions): Promise<void>; stop(options?: TraceCleanupOptions): Promise<void>;
}
const bridgeEventSchema = z.strictObject({
  kind: z.enum(['focus', 'action', 'input']), label: z.enum(['focusin', 'keydown', 'click', 'input']),
  target: z.string().min(1).max(500),
  data: z.strictObject({ key: z.string().max(80).optional(), shiftKey: z.boolean().optional(), trusted: z.boolean() }),
}).superRefine((event, context) => {
  const expectedKind = event.label === 'focusin' ? 'focus' : event.label === 'input' ? 'input' : 'action';
  if (event.kind !== expectedKind || (event.label === 'keydown' && (event.data.key === undefined || event.data.shiftKey === undefined))) context.addIssue({ code: 'custom', message: 'Unexpected page instrumentation event shape.' });
});
/** Records real browser input/focus and correlated requests/responses; never synthesizes AT speech. */
export async function recordTrace(page: Page, identity: TraceIdentity, options: TraceCleanupOptions = {}): Promise<TraceRecorder> {
  const setupDeadline = deadline(options);
  const started = Date.now();
  const events: TemporalTraceEvent[] = [];
  const requests = new WeakMap<Request, string>();
  const pending = new Set<Promise<unknown>>();
  const binding = `passageTrace${randomUUID().replaceAll('-', '')}`;
  let active = true;
  const record: TraceRecorder['record'] = event => {
    if (!active) return events.length;
    events.push({ provenance: 'controller', ...event, sequence: events.length + 1, at: new Date().toISOString(), elapsedMs: Date.now() - started });
    return events.length;
  };
  await observedWithin(() => page.exposeBinding(binding, (_source, raw: unknown) => {
    const parsed = bridgeEventSchema.safeParse(raw);
    if (!parsed.success) return { accepted: false };
    // The page can call this bridge itself: page instrumentation is never an
    // authoritative assertion, application outcome, or authenticated trusted input.
    record({ ...parsed.data, provenance: 'page-instrumentation' });
    return { accepted: true };
  }), setupDeadline, options.signal, 'Trace binding setup');
  // A script string keeps browser callbacks independent of the host TS transform's
  // function-name helpers (tsx can otherwise inject an unavailable __name helper).
  const install = `(() => {
    const binding = ${JSON.stringify(binding)};
    const root = globalThis;
    const key = binding + 'Cleanup';
    if (root[key]) return;
    const target = element => {
      if (!(element instanceof Element)) return 'none';
      return element.getAttribute('data-testid') ? '[data-testid="' + element.getAttribute('data-testid') + '"]' : element.id ? '#' + element.id : element.tagName.toLowerCase() + (element.getAttribute('role') ? '[role="' + element.getAttribute('role') + '"]' : '') + (element.getAttribute('data-date') ? '[data-date="' + element.getAttribute('data-date') + '"]' : '');
    };
    const listeners = ['focusin', 'keydown', 'click', 'input'].map(type => {
      const listener = event => {
        void root[binding]({ kind: type === 'focusin' ? 'focus' : type === 'input' ? 'input' : 'action', label: type, target: target(event.target), data: { key: event.key, shiftKey: event.shiftKey, trusted: event.isTrusted } });
      };
      document.addEventListener(type, listener, true);
      return { type, listener };
    });
    root[key] = () => { listeners.forEach(({ type, listener }) => document.removeEventListener(type, listener, true)); delete root[key]; };
  })()`;
  await observedWithin(() => page.addInitScript({ content: install }), setupDeadline, options.signal, 'Trace script setup');
  await observedWithin(() => page.evaluate(install), setupDeadline, options.signal, 'Trace script installation');
  const onRequest = (request: Request) => {
    const requestId = `request-${events.filter(event => event.kind === 'request').length + 1}`;
    requests.set(request, requestId);
    record({ provenance: 'browser-network', kind: 'request', label: `${request.method()} ${new URL(request.url()).pathname}`, requestId, data: { url: request.url(), method: request.method(), postData: request.postData()?.slice(0, 4096) ?? null } });
  };
  const onResponse = (response: import('@playwright/test').Response) => {
    const task = (async () => {
      const request = response.request();
      let body: unknown;
      if (response.headers()['content-type']?.includes('application/json')) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        body = await Promise.race([response.json().catch(() => undefined), new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), 1000); })]);
        clearTimeout(timer);
        if (body !== undefined && JSON.stringify(body).length > 8192) body = { omitted: 'Response JSON exceeds the trace body bound.' };
      }
      record({ provenance: 'browser-network', kind: 'response', label: `${response.status()} ${new URL(response.url()).pathname}`, requestId: requests.get(request), data: { status: response.status(), url: response.url(), body } });
    })();
    pending.add(task); void task.finally(() => pending.delete(task));
  };
  const onFailed = (request: Request) => record({ provenance: 'browser-network', kind: 'requestFailed', label: request.failure()?.errorText ?? 'Request failed', requestId: requests.get(request), data: { url: request.url() } });
  page.on('request', onRequest); page.on('response', onResponse); page.on('requestfailed', onFailed);
  let cleanupFailure: Error | undefined;
  let stopping: Promise<void> | undefined;
  const rememberFailure = (cause: unknown, phase: string) => {
    const error = cause instanceof Error ? cause : new TraceCleanupError(String(cause));
    cleanupFailure ??= error;
    record({ kind: 'error', label: error.message, data: { phase, traceIncomplete: true } });
    return error;
  };
  const flush = async (cleanup: TraceCleanupOptions = {}) => {
    if (cleanupFailure) throw cleanupFailure;
    const until = deadline(cleanup);
    try {
      if (!page.isClosed()) await observedWithin(() => page.evaluate(() => undefined), until, cleanup.signal, 'Trace flush');
      await observedWithin(() => Promise.allSettled([...pending]), until, cleanup.signal, 'Trace response flush');
    } catch (cause) { throw rememberFailure(cause, 'flush'); }
  };
  const stop = (cleanup: TraceCleanupOptions = {}) => {
    if (stopping) return stopping;
    stopping = (async () => {
      const until = deadline(cleanup);
      let failure = cleanupFailure;
      if (cleanup.pageWillClose) {
        active = false;
        page.off('request', onRequest); page.off('response', onResponse); page.off('requestfailed', onFailed);
        try { await observedWithin(() => Promise.allSettled([...pending]), until, cleanup.signal, 'Closing trace responses'); }
        catch (cause) { failure ??= cause instanceof Error ? cause : new TraceCleanupError(String(cause)); }
        if (failure) throw failure;
        return;
      }
      try { await flush({ ...cleanup, timeoutMs: Math.max(1, until - Date.now()) }); }
      catch (cause) { failure = rememberFailure(cause, 'stop-flush'); }
      finally {
        active = false;
        page.off('request', onRequest); page.off('response', onResponse); page.off('requestfailed', onFailed);
      }
      // A failed flush is terminal: leave renderer shutdown to the independent owner.
      if (!failure && !page.isClosed()) {
        try { await observedWithin(() => page.evaluate(key => (globalThis as unknown as Record<string, any>)[key]?.(), `${binding}Cleanup`), until, cleanup.signal, 'Trace listener removal'); }
        catch (cause) { failure = cause instanceof Error ? cause : new TraceCleanupError(String(cause)); }
      }
      if (failure) throw failure;
    })();
    return stopping;
  };
  return { identity, events, record, flush, stop };
}
