import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser } from '@playwright/test';
import { FixtureHost } from '../engine/host.js';
import { getReferenceSource, scenarioDefinitions } from '../engine/catalog.js';
import { chromiumExecutable } from '../engine/browser.js';
import { approveTemporalContract, executeContract, temporalContractBodySchema, validateTemporalContract } from '../engine/contract-interpreter.js';
import { createFixtureTemporalContract, runFixtureTemporal } from '../engine/temporal-fixture.js';
import { recordTrace } from '../engine/trace-recorder.js';
import { compileSchedule, reduceSchedule } from '../engine/event-scheduler.js';
import type { TemporalContractBody, TemporalExecution } from '../shared/temporal.js';

const approval = { actor: 'Authored test operator', role: 'operator' as const, approvedAt: '2026-10-28T00:00:00.000Z', evidenceClass: 'authored-development' as const };
const basic = (): TemporalContractBody => ({ version: 'passage-temporal/v1', id: 'generic-test', revision: 1, title: 'Independent selector vocabulary test', bindings: { value: { kind: 'css', value: '#foreign-value', read: 'value' } }, actions: [{ id: 'observe', label: 'Observe', kind: 'checkpoint', required: true }], assertions: [{ id: 'preserved', label: 'Preserved', after: 'observe', kind: 'valuePreserved', binding: 'value', since: 'initial' }], allowedEvents: [], bounds: { maxActions: 20, maxDurationMs: 5000, actionTimeoutMs: 1000 } });

describe('strict approved temporal vocabulary', () => {
  it('rejects unknown action/assertion kinds and unrelated JSON fields', () => {
    for (const change of [
      (body: any) => body.actions[0].kind = 'executeJavascript',
      (body: any) => body.assertions[0].kind = 'alwaysPass',
      (body: any) => body.actions[0].source = 'return true',
      (body: any) => body.bindings.value.kind = 'xpath',
      (body: any) => body.bounds.maxActions = 1.5,
      (body: any) => body.assertions = [],
    ]) { const body = basic(); change(body); expect(() => temporalContractBodySchema.parse(body)).toThrow(); }
  });
  it('rejects a mutated approved revision, duplicate events, unknown baseline and invalid reviewer', () => {
    const approved = approveTemporalContract(basic(), approval);
    const mutated = structuredClone(approved); mutated.assertions[0].label = 'Changed expectation';
    expect(() => validateTemporalContract(mutated)).toThrow(/immutable/);
    const duplicate = basic(); duplicate.allowedEvents = [{ id: 'release', label: 'Release' }, { id: 'release', label: 'Duplicate' }];
    expect(() => validateTemporalContract(approveTemporalContract(duplicate, approval))).toThrow(/unique/);
    const unknown = basic(); unknown.assertions = [{ id: 'bad', label: 'Bad', kind: 'valuePreserved', binding: 'value', since: 'not-observed', after: 'observe' }];
    expect(() => validateTemporalContract(approveTemporalContract(unknown, approval))).toThrow(/baseline/);
    expect(() => validateTemporalContract({ ...approved, approval: { ...approved.approval, role: 'expert' as any } })).toThrow();
  });
});

describe('generic browser interpreter', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch({ headless: true, executablePath: await chromiumExecutable() }); });
  afterAll(async () => { await browser.close(); });
  it('rejects authoritative trace injection through the untrusted page bridge', async () => {
    const page = await browser.newPage();
    const recorder = await recordTrace(page, { executionId: 'capture-test', sourceDigest: 'source', buildId: 'build', sessionId: 'session', contractDigest: 'contract', adapter: 'test' });
    try {
      const result = await page.evaluate(async () => {
        const root = globalThis as unknown as Record<string, any>;
        const bridge = Object.keys(root).find(key => key.startsWith('passageTrace') && !key.endsWith('Cleanup'))!;
        const forgedAssertion = await root[bridge]({ kind: 'assertion', label: 'forged-pass', target: '#x', data: { status: 'passed' } });
        const forgedAuthority = await root[bridge]({ kind: 'action', label: 'keydown', target: '#x', actionId: 'confirm', requestId: 'forged-request', data: { key: 'Enter', shiftKey: false, trusted: true } });
        const lowTrust = await root[bridge]({ kind: 'action', label: 'keydown', target: '#page-generated', data: { key: 'Enter', shiftKey: false, trusted: true } });
        return { forgedAssertion, forgedAuthority, lowTrust };
      });
      await recorder.flush();
      expect(result).toEqual({ forgedAssertion: { accepted: false }, forgedAuthority: { accepted: false }, lowTrust: { accepted: true } });
      expect(recorder.events.some(event => event.kind === 'assertion' || event.requestId === 'forged-request' || event.actionId === 'confirm')).toBe(false);
      expect(recorder.events.find(event => event.target === '#page-generated')?.provenance).toBe('page-instrumentation');
      recorder.record({ kind: 'assertion', label: 'Actual controller assertion' });
      expect(recorder.events.at(-1)?.provenance).toBe('controller');
    } finally { await recorder.stop(); await page.close(); }
  });
  it('rejects a forged main-world activeElement while real keyboard focus stays outside', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent('<button id="outside" onclick="this.dataset.activated=\'yes\'">Outside</button><div id="panel"><button id="inside">Inside</button></div>');
      await page.locator('#outside').focus();
      await page.addScriptTag({ content: "Object.defineProperty(Document.prototype,'activeElement',{configurable:true,get(){return document.getElementById('inside')}}); Element.prototype.contains=()=>true;" });
      expect(await page.evaluate(() => document.activeElement?.id)).toBe('inside');
      const body = basic(); body.bindings = { panel: { kind: 'css', value: '#panel' } }; body.assertions = [{ id: 'focus', label: 'Actual modal focus', kind: 'focusWithin', binding: 'panel', after: 'observe' }];
      const result = await executeContract({ page, contract: approveTemporalContract(body, approval) });
      expect(result.status).toBe('failed'); expect(result.failureSignature).toBe('focus:focus-escaped'); expect(result.verifierVersion).toBe('passage-temporal-native-focus-bounded-cleanup-v3');
      await page.keyboard.press('Enter'); expect(await page.locator('#outside').getAttribute('data-activated')).toBe('yes');
      await page.locator('#inside').focus();
      expect((await executeContract({ page, contract: approveTemporalContract(body, approval) })).status).toBe('passed');
    } finally { await page.close(); }
  });
  it('observes actual modal Tab escape despite forged getters and contains methods', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent('<button id="outside">Outside</button><div id="panel"><button id="inside">Inside</button></div><button>After</button>');
      await page.locator('#inside').focus();
      await page.addScriptTag({ content: "Object.defineProperty(Document.prototype,'activeElement',{configurable:true,get(){return document.getElementById('inside')}}); Element.prototype.contains=()=>true;" });
      const body = basic(); body.bindings = { panel: { kind: 'css', value: '#panel' } }; body.assertions = [{ id: 'containment', label: 'Actual modal containment', kind: 'modalContainment', binding: 'panel', steps: 2, after: 'observe' }];
      const result = await executeContract({ page, contract: approveTemporalContract(body, approval) });
      expect(result.status).toBe('failed'); expect(result.checks[0].actual).toContain('1 Shift+Tab');
      expect(result.trace.some(event => event.label === 'Modal containment probe: Shift+Tab')).toBe(true);
      expect(await page.locator('#outside:focus').count()).toBe(1);
    } finally { await page.close(); }
  });
  it('requires actual restored trigger focus and actual press/fill target focus under a forged getter', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent('<button id="trigger">Trigger</button><input id="other"><div id="panel" hidden>Closed</div>');
      await page.locator('#other').focus();
      await page.addScriptTag({ content: "Object.defineProperty(Document.prototype,'activeElement',{configurable:true,get(){return document.getElementById('trigger')}});" });
      const body = basic(); body.bindings = { panel: { kind: 'css', value: '#panel' }, trigger: { kind: 'css', value: '#trigger' } }; body.assertions = [{ id: 'restore', label: 'Actual closure restoration', kind: 'closedFocusRestored', panel: 'panel', trigger: 'trigger', after: 'observe' }];
      expect((await executeContract({ page, contract: approveTemporalContract(body, approval) })).status).toBe('failed');
      body.actions = [{ id: 'observe', label: 'Actual keyboard activation', kind: 'press', key: 'Enter', binding: 'trigger', required: true }];
      const blocked = await executeContract({ page, contract: approveTemporalContract(body, approval) }); expect(blocked.failureSignature).toBe('action:observe:focus-unreachable');
      await page.locator('#trigger').focus();
      body.actions = [{ id: 'observe', label: 'Observe closure', kind: 'checkpoint', required: true }]; expect((await executeContract({ page, contract: approveTemporalContract(body, approval) })).status).toBe('passed');
      await page.addScriptTag({ content: "Object.defineProperty(Document.prototype,'activeElement',{configurable:true,get(){return document.getElementById('other')}});" });
      body.bindings.other = { kind: 'css', value: '#other' }; body.actions = [{ id: 'observe', label: 'Actual text entry', kind: 'fill', binding: 'other', value: 'forged', required: true }];
      const fill = await executeContract({ page, contract: approveTemporalContract(body, approval) }); expect(fill.failureSignature).toBe('action:observe:focus-unreachable'); expect(await page.locator('#other').inputValue()).toBe('');
    } finally { await page.close(); }
  });
  it('keeps value, text, attribute and visibility reads outside main-world prototype overrides', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent('<input id="foreign-value" value="actual"><p id="text" data-state="actual">actual</p><button id="visible">Visible</button><div id="hidden" style="display:none">Hidden</div>');
      await page.locator('#visible').focus();
      await page.addScriptTag({ content: "Object.defineProperty(HTMLInputElement.prototype,'value',{configurable:true,get(){return 'forged'}}); Object.defineProperty(Node.prototype,'textContent',{configurable:true,get(){return 'forged'}}); Element.prototype.getAttribute=()=> 'forged'; window.getComputedStyle=()=>({display:'none',visibility:'hidden'}); Element.prototype.getClientRects=()=>[];" });
      const body = basic();
      for (const binding of [{ kind: 'css' as const, value: '#foreign-value', read: 'value' as const }, { kind: 'css' as const, value: '#text', read: 'text' as const }, { kind: 'css' as const, value: '#text', read: { attribute: 'data-state' } }]) {
        body.bindings = { value: binding }; body.assertions = [{ id: 'native-value', label: 'Native value read', kind: 'valueEquals', binding: 'value', expected: 'forged', after: 'observe' }];
        const result = await executeContract({ page, contract: approveTemporalContract(body, approval) }); expect(result.status).toBe('failed'); expect(result.checks[0].actual).toBe('actual');
      }
      body.bindings = { value: { kind: 'css', value: '#visible' } }; body.assertions = [{ id: 'visible-focus', label: 'Native visibility and focus', kind: 'focusWithin', binding: 'value', after: 'observe' }];
      expect((await executeContract({ page, contract: approveTemporalContract(body, approval) })).status).toBe('passed');
      body.bindings.value = { kind: 'css', value: '#hidden' }; expect((await executeContract({ page, contract: approveTemporalContract(body, approval) })).status).toBe('failed');
    } finally { await page.close(); }
  });
  it('returns a bounded error with collected evidence when an actual renderer starves during activation', async () => {
    const context = await browser.newContext(); const page = await context.newPage();
    const watchdog = setTimeout(() => { void context.close(); }, 1500);
    try {
      await page.setContent('<button id="target" onclick="while(true){}">Starve renderer</button>'); await page.locator('#target').focus();
      const body = basic(); body.bindings = { target: { kind: 'css', value: '#target' } }; body.actions = [{ id: 'activate', label: 'Activate actual renderer loop', kind: 'press', key: 'Enter', binding: 'target', required: true }]; body.assertions = [{ id: 'focus', label: 'Observe post-activation focus', kind: 'focusWithin', binding: 'target', after: 'activate' }]; body.bounds = { maxActions: 2, maxDurationMs: 300, actionTimeoutMs: 100 };
      const start = Date.now(); const result = await executeContract({ page, contract: approveTemporalContract(body, approval) });
      expect(Date.now() - start).toBeLessThan(1000); expect(result.status).toBe('error'); expect(result.passed).toBe(false);
      expect(result.trace.some(event => event.kind === 'action' && event.actionId === 'activate')).toBe(true);
      expect(result.trace.some(event => event.kind === 'error' && event.data?.traceIncomplete === true)).toBe(true);
      expect(result.checks[0].status).toBe('not-run'); expect(result.failureSignature).toBeNull();
    } finally { clearTimeout(watchdog); await context.close(); }
  });
  it('bounds cancellation and page-provided listener cleanup without accepting incomplete traces', async () => {
    const page = await browser.newPage(); const identity = { executionId: 'cleanup-test', sourceDigest: 'source', buildId: 'build', sessionId: 'session', contractDigest: 'contract', adapter: 'test' };
    try {
      const recorder = await recordTrace(page, identity); recorder.record({ kind: 'action', label: 'Already observed controller action' });
      await page.evaluate(() => { const root = globalThis as unknown as Record<string, any>; const key = Object.keys(root).find(key => key.startsWith('passageTrace') && key.endsWith('Cleanup'))!; root[key] = () => { while (true) {} }; });
      const start = Date.now(); await expect(recorder.stop({ timeoutMs: 100 })).rejects.toThrow(/bounded timeout/); expect(Date.now() - start).toBeLessThan(700);
      expect(recorder.events.some(event => event.label === 'Already observed controller action')).toBe(true);
    } finally { await page.close(); }
    const healthy = await browser.newPage();
    try {
      const recorder = await recordTrace(healthy, identity); const controller = new AbortController(); controller.abort(new Error('Review cancellation'));
      await expect(recorder.flush({ timeoutMs: 100, signal: controller.signal })).rejects.toThrow(/Review cancellation/);
      await expect(recorder.stop({ timeoutMs: 100, pageWillClose: true })).rejects.toThrow(/Review cancellation/);
    } finally { await healthy.close(); }
  });
  it('retains normal real input/focus recording when bounded cleanup succeeds', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent('<input id="foreign-value" value="unchanged"><button id="record">Record</button>');
      const recorder = await recordTrace(page, { executionId: 'normal-cleanup', sourceDigest: 'source', buildId: 'build', sessionId: 'session', contractDigest: 'contract', adapter: 'test' });
      await page.locator('#record').focus(); await page.keyboard.press('Enter'); await recorder.flush({ timeoutMs: 500 });
      expect(recorder.events.some(event => event.kind === 'focus')).toBe(true); expect(recorder.events.some(event => event.label === 'keydown')).toBe(true);
      await recorder.stop({ timeoutMs: 500 }); expect(recorder.events.some(event => event.kind === 'error')).toBe(false);
      expect((await executeContract({ page, contract: approveTemporalContract(basic(), approval) })).status).toBe('passed');
    } finally { await page.close(); }
  });
  it('runs foreign bindings and never labels an omitted checkpoint passed', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent('<input id="foreign-value" value="unchanged">');
      const body = basic(); body.actions[0].required = false;
      const contract = approveTemporalContract(body, approval);
      const complete = await executeContract({ page, contract });
      expect(complete.status).toBe('passed');
      const skipped = await executeContract({ page, contract, actions: [] });
      expect(skipped.status).toBe('failed'); expect(skipped.checks[0].status).toBe('not-run'); expect(skipped.failureSignature).toBeNull();
    } finally { await page.close(); }
  });
  it('distinguishes unavailable observation errors from falsified invariants', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent('<input id="foreign-value" value="before">');
      const body = basic(); body.actions = [{ id: 'change', label: 'Observed actual change', kind: 'event', event: 'change', required: true }];
      body.allowedEvents = [{ id: 'change', label: 'Change input' }]; body.assertions[0].after = 'change';
      const contract = approveTemporalContract(body, approval);
      const failed = await executeContract({ page, contract, eventDriver: async () => { await page.locator('#foreign-value').fill('after'); } });
      expect(failed.status).toBe('failed'); expect(failed.failureSignature).toBe('preserved:value-changed');
      const errored = await executeContract({ page, contract });
      expect(errored.status).toBe('error'); expect(errored.failureSignature).toBeNull(); expect(errored.checks[0].status).toBe('not-run');
    } finally { await page.close(); }
  });
  it('records keyboard/state barriers separately from harness errors', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent('<input id="foreign-value" value="unchanged"><button id="target">Choose</button>');
      const body = basic(); body.bindings.target = { kind: 'css', value: '#target' };
      body.actions = [{ id: 'activate', label: 'Activate by keyboard', kind: 'press', key: 'Enter', binding: 'target', required: true }]; body.assertions[0].after = 'activate';
      const blocked = await executeContract({ page, contract: approveTemporalContract(body, approval) });
      expect(blocked.status).toBe('failed'); expect(blocked.failureSignature).toBe('action:activate:focus-unreachable');
      expect(blocked.checks[0].status).toBe('failed'); expect(blocked.checks[1].status).toBe('not-run');
      body.bindings.missing = { kind: 'css', value: '#missing' };
      body.actions = [{ id: 'appear', label: 'Wait for recovery', kind: 'waitFor', binding: 'missing', state: 'visible', timeoutMs: 100, required: true }]; body.assertions[0].after = 'appear';
      const absent = await executeContract({ page, contract: approveTemporalContract(body, approval) });
      expect(absent.status).toBe('failed'); expect(absent.failureSignature).toBe('action:appear:expected-state-unreachable');
    } finally { await page.close(); }
  });
  it('rejects wrong protected records, duplicate transactions and absent observers', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent('<p>Another application</p>');
      const body = basic(); body.assertions = [{ id: 'stored', label: 'Protected result', kind: 'outcome', after: 'observe', expected: { date: 'right', name: 'Alex' }, count: 1 }];
      const contract = approveTemporalContract(body, approval);
      for (const records of [[{ date: 'wrong', name: 'Alex' }], [{ date: 'right', name: 'Alex' }, { date: 'right', name: 'Alex' }]]) {
        const result = await executeContract({ page, contract, outcomeObserver: async () => ({ records, authority: 'Protected test service' }) });
        expect(result.status).toBe('failed'); expect(result.checks[0].status).toBe('failed');
      }
      expect((await executeContract({ page, contract })).status).toBe('error');
    } finally { await page.close(); }
  });
});

describe('actual temporal fixture regressions', () => {
  let host: FixtureHost, root: string;
  beforeAll(async () => { root = await mkdtemp(join(tmpdir(), 'passage-temporal-')); host = new FixtureHost({ previewPort: 0, artifactRoot: root }); await host.start(); });
  afterAll(async () => { await host.close(); await rm(root, { recursive: true, force: true }); });
  it('runs the frozen subcontracts with German labels, an unavailable first date and real delayed responses', async () => {
    const build = await host.prepareBuild({ fixtureId: 'northstar-appointments', source: await getReferenceSource('northstar-appointments') });
    const scenario = scenarioDefinitions.find(value => value.id === 'combined')!;
    for (const scheduleId of ['baseline', 'modal-boundary', 'cancel-pending'] as const) {
      const contract = createFixtureTemporalContract({ scheduleId, choiceDate: '2026-11-17' });
      const result = await runFixtureTemporal({ host, build, scenario, contract });
      expect(result.status, JSON.stringify({ error: result.error, checks: result.checks })).toBe('passed');
    }
  });
  it('rejects deleting the required availability request instead of handling cancellation', async () => {
    const reference = await getReferenceSource('northstar-appointments');
    const source = reference.replace('const result = checkAvailability ? await checkAvailability(choice.date) : { available: true };', 'const result = { available: true };');
    expect(source).not.toBe(reference);
    const build = await host.prepareBuild({ fixtureId: 'northstar-appointments', source });
    const contract = createFixtureTemporalContract({ scheduleId: 'cancel-pending', choiceDate: '2026-11-16' });
    const result = await runFixtureTemporal({ host, build, scenario: scenarioDefinitions[0], contract });
    expect(result.status, result.error).toBe('failed'); expect(result.failureSignature).toBe('action:pending:expected-event-unreachable');
  });
  it('catches reintroduced modal wrapping and cancellation defects in the new reference', async () => {
    const reference = await getReferenceSource('northstar-appointments');
    for (const scheduleId of ['modal-boundary', 'cancel-pending'] as const) {
      const source = scheduleId === 'modal-boundary' ? reference.replace("event.key === 'Tab'", "event.key === 'NotTab'") : reference.replace('requestVersion.current += 1;', '');
      expect(source).not.toBe(reference);
      const build = await host.prepareBuild({ fixtureId: 'northstar-appointments', source });
      const contract = createFixtureTemporalContract({ scheduleId, choiceDate: '2026-11-16' });
      const result = await runFixtureTemporal({ host, build, scenario: scenarioDefinitions[0], contract });
      expect(result.status, result.error).toBe('failed');
      expect(result.failureSignature).toBe(scheduleId === 'modal-boundary' ? 'modal-focus-contained:focus-escaped' : 'late-response-cannot-commit:value-changed');
    }
  });
  for (const scheduleId of ['modal-boundary', 'cancel-pending', 'baseline'] as const) {
    it(`runs ${scheduleId} against the exact historic source and new reference`, async () => {
      const historic = await readFile(new URL('../docs/samples/date-picker/DatePicker.jsx', import.meta.url), 'utf8');
      const reference = await getReferenceSource('northstar-appointments');
      const contract = createFixtureTemporalContract({ scheduleId, choiceDate: '2026-11-16' });
      const outcomes: TemporalExecution[] = [];
      for (const source of [historic, reference]) {
        const build = await host.prepareBuild({ fixtureId: 'northstar-appointments', source });
        outcomes.push(await runFixtureTemporal({ host, build, scenario: scenarioDefinitions[0], contract }));
      }
      const [before, after] = outcomes;
      if (scheduleId === 'baseline') expect(before.status, JSON.stringify(before.checks)).toBe('passed');
      else {
        expect(before.status, before.error).toBe('failed');
        expect(before.checks.find(check => check.id === (scheduleId === 'cancel-pending' ? 'late-response-cannot-commit' : 'modal-focus-contained'))?.status).toBe('failed');
        if (scheduleId === 'cancel-pending') {
          const build = await host.prepareBuild({ fixtureId: 'northstar-appointments', source: historic });
          const reduced = await reduceSchedule({ contract, schedule: { id: 'cancel-race', label: 'Cancel race', steps: contract.actions.map(action => action.id) }, initial: before, execute: schedule => runFixtureTemporal({ host, build, scenario: scenarioDefinitions[0], contract, actions: schedule.actions }) });
          expect(reduced.minimized).not.toContain('explore-forward'); expect(reduced.minimized).not.toContain('explore-back');
          expect(reduced.minimized).toContain('pending'); expect(reduced.minimized).toContain('cancel'); expect(reduced.minimized).toContain('release');
          expect(reduced.attempts).toBe(1); expect(reduced.acceptedRemovals).toBe(2); expect(reduced.execution.failureSignature).toBe(before.failureSignature);
        }
      }
      expect(after.status, JSON.stringify({ error: after.error, checks: after.checks })).toBe('passed');
      expect(after.identity.sourceDigest).not.toBe(before.identity.sourceDigest);
      if (scheduleId !== 'modal-boundary') {
        const request = before.trace.find(event => event.kind === 'request' && event.label.includes('/availability'));
        expect(request?.requestId).toBeTruthy();
        expect(before.trace.some(event => event.kind === 'response' && event.requestId === request?.requestId)).toBe(true);
      }
      expect(after.trace.some(event => event.kind === 'focus')).toBe(true);
      if (scheduleId === 'modal-boundary') {
        expect(after.trace.filter(event => event.label === 'Modal containment probe: Tab')).toHaveLength(12);
        expect(after.trace.filter(event => event.label === 'Modal containment probe: Shift+Tab')).toHaveLength(12);
        expect(before.checks.find(check => check.id === 'modal-focus-contained')?.actual).toContain('2 Shift+Tab');
      }
    });
  }
});

describe('bounded schedule compilation and reduction', () => {
  it('preserves required steps and refuses impossible events and dependencies', () => {
    const body = basic(); body.actions.push({ id: 'release', label: 'Release', kind: 'event', event: 'response', requires: ['observe'] }); body.allowedEvents = [{ id: 'response', label: 'Real response', requires: ['observe'] }];
    const contract = approveTemporalContract(body, approval);
    expect(() => compileSchedule(contract, { id: 'bad', label: 'Bad', steps: ['release', 'observe'] })).toThrow(/dependency/);
    expect(() => compileSchedule(contract, { id: 'bad', label: 'Bad', steps: ['unknown'] })).toThrow(/Unknown/);
    expect(() => compileSchedule(contract, { id: 'bad', label: 'Bad', steps: ['release'] })).toThrow();
  });
  it('reruns actual schedules and reduces only the same assertion failure', async () => {
    const body = basic(); body.actions.unshift({ id: 'noise', label: 'Unrelated action', kind: 'checkpoint' });
    const contract = approveTemporalContract(body, approval);
    const schedule = { id: 'failing', label: 'Failure', steps: body.actions.map(action => action.id) };
    const calls: string[][] = [];
    const execute = async (compiled: ReturnType<typeof compileSchedule>): Promise<TemporalExecution> => {
      calls.push(compiled.steps);
      return { version: 'passage-temporal-execution/v1', id: 'test', identity: { executionId: 'test', sessionId: 'fresh', sourceDigest: 'source', buildId: 'build', contractDigest: contract.digest, adapter: 'unit' }, contractDigest: contract.digest, status: 'failed', passed: false, startedAt: '', completedAt: '', durationMs: 0, actionsExecuted: compiled.steps, checks: [], trace: [], failureSignature: 'preserved:value-changed', limitations: [] };
    };
    const reduced = await reduceSchedule({ contract, schedule, execute });
    expect(reduced.minimized).toEqual(['observe']); expect(reduced.attempts).toBe(2); expect(calls).toEqual([['noise', 'observe'], ['observe']]);
    await expect(reduceSchedule({ contract, schedule, execute: async compiled => ({ ...await execute(compiled), status: 'error', failureSignature: null }) })).rejects.toThrow(/Only a reproduced/);
  });
});
