/** Synthetic unit fixtures. The paired case executes actual browser keys/focus. */
import { describe, expect, it } from 'vitest';
import { chromium } from '@playwright/test';
import { chromiumExecutable } from '../engine/browser.js';
import { approveTemporalContract, executeContract } from '../engine/contract-interpreter.js';
import { compileSchedule, reduceSchedule, type ReductionReplay } from '../engine/event-scheduler.js';
import type { CompiledSchedule, TemporalContractBody, TemporalExecution } from '../shared/temporal.js';
const approval = { actor: 'Synthetic reducer operator', role: 'operator' as const, evidenceClass: 'authored-development' as const, approvedAt: '2026-10-28T00:00:00.000Z' };
function body(): TemporalContractBody { return { version: 'passage-temporal/v1', id: 'paired-reduction', revision: 1, title: 'Synthetic pair', bindings: { value: { kind: 'css', value: '#value', read: 'value' }, choice: { kind: 'css', value: '#choice' } }, actions: [{ id: 'start', label: 'Start', kind: 'checkpoint', required: true }, { id: 'forward', label: 'Forward', kind: 'press', key: 'ArrowRight', requires: ['start'] }, { id: 'back', label: 'Back', kind: 'press', key: 'ArrowLeft', requires: ['start'] }, { id: 'activate', label: 'Activate', kind: 'press', key: 'Enter', binding: 'choice', requires: ['start'], required: true }], assertions: [{ id: 'preserved', label: 'No unexpected commitment', kind: 'valuePreserved', binding: 'value', since: 'initial', after: 'activate' }], allowedEvents: [], bounds: { maxActions: 20, maxDurationMs: 5000, actionTimeoutMs: 1000 } }; }
function result(c: CompiledSchedule, signature: string | null): TemporalExecution { return { version: 'passage-temporal-execution/v1', id: 'unit', identity: { executionId: 'unit', sourceDigest: 'unit-source', buildId: 'unit-build', sessionId: 'fresh', contractDigest: c.contractDigest, adapter: 'unit' }, contractDigest: c.contractDigest, status: signature ? 'failed' : 'passed', passed: !signature, startedAt: '', completedAt: '', durationMs: 0, actionsExecuted: [...c.steps], checks: [], trace: [], failureSignature: signature, limitations: ['Synthetic reducer unit data'] }; }
describe('grouped bounded reduction', () => {
  it('removes both inverse arrows when either single deletion changes the real keyboard prerequisite failure', async () => {
    const browser = await chromium.launch({ headless: true, executablePath: await chromiumExecutable() });
    try {
      const contract = approveTemporalContract(body(), approval), schedule = { id: 'pair', label: 'Synthetic keyboard pair', steps: contract.actions.map(a => a.id) };
      const execute = async (compiled: CompiledSchedule) => {
        const page = await browser.newPage();
        try {
          await page.setContent('<input id="value" type="hidden" value="original"><button id="previous">Previous</button><button id="choice">Choice</button><button id="next">Next</button>');
          await page.addScriptTag({ content: "const choice=document.getElementById('choice');choice.addEventListener('keydown',e=>{if(e.key==='ArrowRight')document.getElementById('next').focus();if(e.key==='ArrowLeft')document.getElementById('previous').focus();});document.getElementById('next').addEventListener('keydown',e=>{if(e.key==='ArrowLeft')choice.focus();});choice.addEventListener('click',()=>{document.getElementById('value').value='unexpected-commit'});" });
          await page.locator('#choice').focus(); return await executeContract({ page, contract, actions: compiled.actions });
        } finally { await page.close(); }
      };
      const initial = await execute(compileSchedule(contract, schedule)); expect(initial.failureSignature).toBe('preserved:value-changed');
      for (const id of ['forward', 'back']) expect((await execute(compileSchedule(contract, { ...schedule, steps: schedule.steps.filter(s => s !== id) }))).failureSignature).toBe('action:activate:focus-unreachable');
      const emitted: ReductionReplay[] = [];
      const reduced = await reduceSchedule({ contract, schedule, initial, maxAttempts: 2, execute, onReplay: record => emitted.push(record) });
      expect(reduced.minimized).toEqual(['start', 'activate']); expect(reduced.execution.failureSignature).toBe(initial.failureSignature);
      expect(reduced.attempts).toBe(1); expect(reduced.acceptedRemovals).toBe(2); expect(reduced.search.acceptedMoves).toBe(1);
      expect(reduced.search).toMatchObject({ termination: 'searched-moves-exhausted', localMinimal: true, globalMinimal: false });
      expect(reduced.replays).toHaveLength(1); expect(emitted).toEqual(reduced.replays);
      expect(reduced.replays[0]).toMatchObject({ attempt: 1, steps: ['start', 'activate'], removedActionIds: ['forward', 'back'], decision: 'accepted', reason: 'same-failure-signature', execution: { failureSignature: initial.failureSignature, status: 'failed' } });
      expect(reduced.replays[0].execution.checks[0].status).toBe('failed');
    } finally { await browser.close(); }
  });
  it('finds groups among necessary optional actions and retains rejected replay evidence', async () => {
    const input = body(); input.actions.splice(2, 0, { id: 'needed', label: 'Semantically necessary optional action', kind: 'checkpoint' });
    const contract = approveTemporalContract(input, approval), schedule = { id: 'mixed', label: 'Mixed group', steps: input.actions.map(a => a.id) }, calls: string[][] = [];
    const execute = async (c: CompiledSchedule) => { calls.push(c.steps); return result(c, !c.steps.includes('needed') ? null : c.steps.includes('forward') === c.steps.includes('back') ? 'preserved:value-changed' : 'different:focus-unreachable'); };
    const initial = await execute(compileSchedule(contract, schedule)); calls.length = 0;
    const emitted: ReductionReplay[] = [];
    const reduced = await reduceSchedule({ contract, schedule, initial, maxAttempts: 12, execute, onReplay: record => emitted.push(record) });
    expect(reduced.minimized).toEqual(['start', 'needed', 'activate']); expect(reduced.attempts).toBeLessThanOrEqual(12); expect(new Set(calls.map(s => JSON.stringify(s))).size).toBe(calls.length);
    expect(reduced.replays).toHaveLength(reduced.attempts); expect(emitted).toEqual(reduced.replays);
    expect(reduced.replays.some(r => r.decision === 'rejected' && r.reason === 'not-an-assertion-failure')).toBe(true);
    expect(reduced.replays.some(r => r.decision === 'rejected' && r.reason === 'failure-signature-changed')).toBe(true);
    expect(reduced.search).toMatchObject({ localMinimal: true, globalMinimal: false }); expect(reduced.search.limitation).toContain('no global minimality guarantee');
  });
  it('caps actual replays and never claims completed search when the budget blocks another valid move', async () => {
    const contract = approveTemporalContract(body(), approval), schedule = { id: 'cap', label: 'Budget', steps: contract.actions.map(a => a.id) };
    const initial = result(compileSchedule(contract, schedule), 'preserved:value-changed'); let calls = 0;
    const reduced = await reduceSchedule({ contract, schedule, initial, maxAttempts: 1, execute: async c => { calls++; return result(c, 'different:focus-unreachable'); } });
    expect(calls).toBe(1); expect(reduced.attempts).toBe(1); expect(reduced.minimized).toEqual(schedule.steps);
    expect(reduced.search).toMatchObject({ termination: 'replay-budget-exhausted', localMinimal: false, globalMinimal: false }); expect(reduced.replays[0].decision).toBe('rejected');
    await expect(reduceSchedule({ contract, schedule, maxAttempts: 0, execute: async c => { calls++; return result(c, 'preserved:value-changed'); } })).rejects.toThrow(/bounded/); expect(calls).toBe(1);
  });
  it('separates dependency validation skips from actual replays and keeps required event prerequisites', async () => {
    const input = body(); input.actions = [{ id: 'pending', label: 'Pending', kind: 'checkpoint' }, { id: 'noise', label: 'Noise', kind: 'checkpoint' }, { id: 'release', label: 'Release event', kind: 'event', event: 'release', requires: ['pending'], required: true }]; input.assertions[0].after = 'release'; input.allowedEvents = [{ id: 'release', label: 'Actual allowed release', requires: ['pending'] }];
    const contract = approveTemporalContract(input, approval), schedule = { id: 'dependencies', label: 'Dependencies', steps: input.actions.map(a => a.id) };
    const reduced = await reduceSchedule({ contract, schedule, initial: result(compileSchedule(contract, schedule), 'preserved:value-changed'), maxAttempts: 4, execute: async c => { expect(c.steps).toContain('pending'); expect(c.steps).toContain('release'); return result(c, 'preserved:value-changed'); } });
    expect(reduced.minimized).toEqual(['pending', 'release']); expect(reduced.attempts).toBe(1); expect(reduced.search.invalidCandidates).toBeGreaterThan(0);
    expect(reduced.validationSkips.some(skip => skip.removedActionIds.includes('pending'))).toBe(true); expect(reduced.replays).toHaveLength(1);
  });
});

describe('reduction cancellation and inconclusive probes', () => {
  it('retains the final completed cancelled replay before rejecting cancellation', async () => {
    const input = body(); input.actions = [{ id: 'noise', label: 'Optional', kind: 'checkpoint' }, { id: 'activate', label: 'Required', kind: 'checkpoint', required: true }];
    const contract = approveTemporalContract(input, approval), schedule = { id: 'last-cancel', label: 'Cancellation', steps: input.actions.map(a => a.id) };
    const controller = new AbortController(), recorded: ReductionReplay[] = [];
    await expect(reduceSchedule({ contract, schedule, initial: result(compileSchedule(contract, schedule), 'preserved:value-changed'), signal: controller.signal,
      execute: async candidate => { controller.abort(new Error('Operator cancelled final replay')); return { ...result(candidate, null), status: 'cancelled', passed: false }; }, onReplay: replay => recorded.push(replay),
    })).rejects.toThrow(/Operator cancelled final replay/);
    expect(recorded).toHaveLength(1); expect(recorded[0].execution.status).toBe('cancelled'); expect(recorded[0].decision).toBe('rejected');
  });
  it('reports inconclusive scope instead of local minimality when the last trial errors or is cancelled', async () => {
    const input = body(); input.actions = [{ id: 'noise', label: 'Optional', kind: 'checkpoint' }, { id: 'activate', label: 'Required', kind: 'checkpoint', required: true }];
    const contract = approveTemporalContract(input, approval), schedule = { id: 'inconclusive', label: 'Inconclusive', steps: input.actions.map(a => a.id) };
    for (const status of ['error', 'cancelled'] as const) {
      const reduced = await reduceSchedule({ contract, schedule, initial: result(compileSchedule(contract, schedule), 'preserved:value-changed'), execute: async candidate => ({ ...result(candidate, null), status, passed: false }) });
      expect(reduced.minimized).toEqual(schedule.steps); expect(reduced.search).toMatchObject({ termination: 'inconclusive-replays', inconclusiveReplays: 1, localMinimal: false, globalMinimal: false });
      expect(reduced.replays[0].execution.status).toBe(status);
    }
  });
});
