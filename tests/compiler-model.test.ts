/** Synthetic model/controller fixtures. No inference, browser, upstream source or participant is used. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { draftWithModel, localizeAndPatch, proposeScheduleWithModel } from '../server/journey-model.js';
import { JourneyService } from '../server/journey-service.js';
import { buildJourneyGuardBundle } from '../server/journey-guard.js';
import { Store, sha256 } from '../server/store.js';
import { approveTemporalContract } from '../engine/contract-interpreter.js';
import type { RepairProvider } from '../server/provider.js';
import type { ModelReceipt } from '../shared/types.js';
import type { CompilerCapture } from '../shared/compiler.js';
import type { TemporalContractBody, TemporalExecution } from '../shared/temporal.js';
const at = '2026-10-28T12:00:00.000Z';
const receipt: ModelReceipt = { provider: 'offline-fixture', model: 'synthetic-structured-model', requestId: 'unit-only', promptVersion: 'unit', temperature: 0, inputTokens: 0, outputTokens: 0, durationMs: 0, startedAt: at, completedAt: at, live: false };
function contract() { const body: TemporalContractBody = { version: 'passage-temporal/v1', id: 'synthetic-task', revision: 1, title: 'Synthetic unit task', bindings: { value: { kind: 'css', value: '#value', read: 'value' } }, actions: [{ id: 'observe', kind: 'checkpoint', label: 'Observe', required: true }], assertions: [{ id: 'protected', label: 'Protected original assertion', kind: 'valuePreserved', binding: 'value', since: 'initial', after: 'observe' }], allowedEvents: [], bounds: { maxActions: 20, maxDurationMs: 5000, actionTimeoutMs: 1000 } }; return approveTemporalContract(body, { actor: 'Synthetic test operator', role: 'operator', evidenceClass: 'authored-development', approvedAt: at }); }
function capture(): CompilerCapture { const expected = contract(), execution: TemporalExecution = { version: 'passage-temporal-execution/v1', id: 'synthetic-execution', identity: { executionId: 'synthetic-execution', sourceDigest: sha256('unit-source'), buildId: sha256('unit-build'), sessionId: 'synthetic-session', contractDigest: expected.digest, adapter: 'unit-no-browser' }, contractDigest: expected.digest, status: 'failed', passed: false, startedAt: at, completedAt: at, durationMs: 0, actionsExecuted: ['observe'], checks: [], trace: [], failureSignature: 'synthetic-failure', limitations: ['Synthetic unit fixture only'] }; return { id: 'unit-capture', createdAt: at, variant: 'original', scheduleId: 'baseline', sourceDigest: sha256('unit-source'), buildId: sha256('unit-build'), previewUrl: 'http://127.0.0.1:9/unit-only', trace: [{ id: 'unit-capture:1', sequence: 1, atMs: 0, kind: 'assertion', label: 'Synthetic controller observation', detail: 'Unit test only', provenance: 'controller' }, { id: 'unit-capture:2', sequence: 2, atMs: 1, kind: 'focus', label: 'Synthetic page event', detail: 'Page-origin evidence only', provenance: 'page-instrumentation' }], checks: [], status: 'failed', outcome: null, execution, contractDigest: expected.digest, limitations: ['Synthetic unit fixture only'] }; }
function proposal() { const expected = contract(); return { summary: 'Synthetic grounded proposal', contracts: [{ id: expected.id, assertions: structuredClone(expected.assertions) }], obligations: [{ id: 'unit-obligation', text: 'Preserve the original requirement', origin: 'observed' as 'observed' | 'inferred', evidenceRefs: ['unit-capture:1'], assertionIds: ['protected'] }], ambiguities: ['No actual participant or AT evidence exists in this unit fixture.'] }; }
let root: string, store: Store;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'passage-compiler-model-unit-')); store = new Store(root); });
afterEach(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
function model(value: unknown) { return { completeStructured: vi.fn(async (input: any) => ({ value: input.schema.parse(value), receipt })) } as unknown as RepairProvider; }
async function draft(value: unknown) { return draftWithModel({ provider: model(value), runId: 'unit-run', task: 'Synthetic unit task', captures: [capture()], contracts: [contract()], signal: new AbortController().signal }); }

describe('model contract integrity', () => {
  it('retains protected assertions exactly and allows only grounded executable additions', async () => {
    const value = proposal(), original = contract();
    value.contracts[0].assertions.push({ id: 'new-value', label: 'Synthetic new value assertion', kind: 'valueEquals', binding: 'value', expected: 'after', after: 'observe' });
    value.obligations.push({ id: 'new-inference', text: 'An explicitly inferred new requirement', origin: 'inferred', evidenceRefs: [], assertionIds: ['new-value'] });
    const generated = await draft(value); expect(generated.contracts[0].assertions[0]).toEqual(original.assertions[0]); expect(generated.contracts[0].assertions).toHaveLength(2); expect(generated.contracts[0].digest).not.toBe(original.digest); expect(original.assertions).toHaveLength(1);
    for (const mutate of [(input: ReturnType<typeof proposal>) => { input.contracts[0].assertions = []; }, (input: ReturnType<typeof proposal>) => { input.contracts[0].assertions[0].label = 'Weakened meaning'; }]) { const invalid = proposal(); mutate(invalid); await expect(draft(invalid)).rejects.toThrow(); }
  });
  it('rejects invented/absent evidence, unsupported assertions, uncovered requirements and page-only observed claims', async () => {
    for (const [mutate, code] of [
      [(input: ReturnType<typeof proposal>) => { input.obligations[0].evidenceRefs = ['unit-capture:1', 'invented:99']; }, 'UNGROUNDED_MODEL_REFERENCE'],
      [(input: ReturnType<typeof proposal>) => { input.obligations[0].evidenceRefs = []; }, 'UNGROUNDED_MODEL_REFERENCE'],
      [(input: ReturnType<typeof proposal>) => { input.obligations[0].assertionIds = ['unsupported']; }, 'UNKNOWN_ASSERTION'],
      [(input: ReturnType<typeof proposal>) => { input.obligations[0].evidenceRefs = ['unit-capture:2']; }, 'UNTRUSTED_OBSERVATION'],
    ] as const) { const invalid = proposal(); mutate(invalid); await expect(draft(invalid)).rejects.toMatchObject({ code }); }
    const uncovered = proposal(); uncovered.contracts[0].assertions.push({ id: 'uncovered', label: 'Uncovered added assertion', kind: 'valueEquals', binding: 'value', expected: 'required', after: 'observe' }); await expect(draft(uncovered)).rejects.toMatchObject({ code: 'WEAKENED_OBLIGATIONS' });
    const duplicate = proposal(); duplicate.obligations.push(structuredClone(duplicate.obligations[0])); await expect(draft(duplicate)).rejects.toMatchObject({ code: 'DUPLICATE_OBLIGATION' });
  });
  it('keeps a page-supported interpretation inferred and rejects claims of independent human review in model output', async () => {
    const inferred = proposal(); inferred.obligations[0].origin = 'inferred'; inferred.obligations[0].evidenceRefs = ['unit-capture:2']; expect((await draft(inferred)).obligations[0].origin).toBe('inferred');
    await expect(draft({ ...proposal(), independentlyReviewed: true, participantCount: 1 })).rejects.toThrow();
  });
});
describe('bounded model schedule proposals', () => {
  it('bounds model trace context independently of the length of retained history', async () => {
    const calls: any[] = [];
    const provider = { completeStructured: vi.fn(async (input: any) => { calls.push(input); return { value: input.schema.parse({ label: 'Synthetic bounded probe', steps: ['observe'] }), receipt }; }) } as unknown as RepairProvider;
    const history = Array.from({ length: 100 }, (_, index) => ({ ...capture(), id: `synthetic-capture-${index}` }));
    await proposeScheduleWithModel({ provider, runId: 'unit-run', proposalId: 'unit-probe', task: 'Synthetic task', captures: history, contract: contract(), signal: new AbortController().signal });
    expect(calls[0].payload.observations.map((item: { id: string }) => item.id)).toEqual(['synthetic-capture-99']);
    expect(history).toHaveLength(100);
    expect(calls[0].promptVersion).toBe('passage-bounded-schedule-v2-scoped-context');
  });
  it('retains a rejected model receipt and prevents invented commands, duplicates, missing required actions and dependency reordering', async () => {
    const approved = approveTemporalContract({ ...contract(), actions: [
      { id: 'prepare', kind: 'checkpoint', label: 'Prepare', required: true },
      { id: 'explore', kind: 'checkpoint', label: 'Optional exploration', requires: ['prepare'] },
      { id: 'observe', kind: 'checkpoint', label: 'Observe', required: true, requires: ['prepare'] },
    ] }, contract().approval);
    for (const steps of [['prepare', 'javascript:alert(1)', 'observe'], ['prepare', 'prepare', 'observe'], ['prepare'], ['observe', 'prepare']]) {
      const onProposal = vi.fn();
      await expect(proposeScheduleWithModel({ provider: model({ label: 'Synthetic invalid public probe', steps }), runId: 'unit-run', proposalId: 'unit-probe', task: 'Synthetic task', captures: [capture()], contract: approved, signal: new AbortController().signal, onProposal })).rejects.toMatchObject({ code: 'INVALID_BOUNDED_SCHEDULE' });
      expect(onProposal).toHaveBeenCalledWith({ label: 'Synthetic invalid public probe', steps }, receipt);
    }
    const generated = await proposeScheduleWithModel({ provider: model({ label: 'Synthetic valid bounded subset', steps: ['prepare', 'observe'] }), runId: 'unit-run', proposalId: 'unit-probe', task: 'Synthetic task', captures: [capture()], contract: approved, signal: new AbortController().signal });
    expect(generated.proposal.contractDigest).toBe(approved.digest);
    expect(generated.proposal.actions).toEqual([approved.actions[0], approved.actions[2]]);
    expect(approved.actions).toHaveLength(3);
  });
});
const source = 'export default function App() {\n  // Keep this exact intervening source comment.\n  return <button>Original task</button>;\n}\n';
function patchInput(provider: RepairProvider, onStage?: Parameters<typeof localizeAndPatch>[0]['onStage']) { return { provider, runId: 'unit-localize', task: 'Synthetic exact-source integrity task', captures: [capture()], draft: { contract: contract(), obligations: proposal().obligations }, files: [{ path: 'App.jsx', content: source, digest: sha256(source) }], signal: new AbortController().signal, capabilities: 'Synthetic unit fixture, no worker is executed', onStage }; }
function citation(quote: string) { return { summary: 'Synthetic causal source citation', locations: [{ path: 'App.jsx', startLine: 1, endLine: 4, symbol: 'App', quote, reason: 'Synthetic observed transition', evidenceRefs: ['unit-capture:1'] }] }; }
describe('source localization and patch integrity', () => {
  it('selects the only admitted authored file deterministically and accepts grounded localization without an advisory summary', async () => {
    const calls: any[] = [], changed = source.replace('Original task', 'Repaired task');
    const provider = { completeStructured: vi.fn(async (input: any) => {
      calls.push(input);
      const value = calls.length === 1 ? { locations: [{ lineIds: [input.payload.inspectedFiles[0].sourceLines[2].id], symbol: 'App', reason: 'Synthetic hypothesis', evidenceRefs: ['unit-capture:1'] }] }
        : { summary: 'Synthetic patch', patches: [{ path: 'App.jsx', beforeDigest: sha256(source), source: changed }] };
      return { value: input.schema.parse(value), receipt };
    }) } as unknown as RepairProvider;
    const result = await localizeAndPatch({ ...patchInput(provider), inspectionMode: 'only-permitted-file' });
    expect(calls).toHaveLength(2); expect(calls.some(call => call.promptVersion.startsWith('passage-source-inspection-'))).toBe(false);
    expect(result.receipts).toHaveLength(2);
    expect(result.inspection).toMatchObject({ method: 'deterministic-single-file', files: [{ path: 'App.jsx', sourceDigest: sha256(source), bytes: Buffer.byteLength(source) }] });
    const oversized = ' '.repeat(70001), tooMany = patchInput(provider);
    tooMany.files.push({ path: 'Other.jsx', content: source, digest: sha256(source) });
    await expect(localizeAndPatch({ ...tooMany, inspectionMode: 'only-permitted-file' })).rejects.toMatchObject({ code: 'SOURCE_SCOPE_VIOLATION' });
    await expect(localizeAndPatch({ ...patchInput(provider), files: [{ path: 'App.jsx', content: oversized, digest: sha256(oversized) }], inspectionMode: 'only-permitted-file' })).rejects.toMatchObject({ code: 'INSPECTION_TOO_LARGE' });
    expect(calls).toHaveLength(2);
  });
  it('resolves immutable line IDs to exact source bytes without treating the causal explanation as proven', async () => {
    const changed = source.replace('Original task', 'Repaired task'), calls: any[] = [];
    const provider = { completeStructured: vi.fn(async (input: any) => {
      calls.push(input);
      const value = calls.length === 1 ? { files: ['App.jsx'], purpose: 'Inspect synthetic source' }
        : calls.length === 2 ? { summary: 'Synthetic causal hypothesis only', locations: [{
          lineIds: input.payload.inspectedFiles[0].sourceLines.slice(1, 3).map((line: any) => line.id),
          symbol: 'App', reason: 'A model hypothesis, not an independently established cause', evidenceRefs: ['unit-capture:1'],
        }] } : { summary: 'Synthetic candidate', patches: [{ path: 'App.jsx', beforeDigest: sha256(source), source: changed }] };
      return { value: input.schema.parse(value), receipt };
    }) } as unknown as RepairProvider;
    const result = await localizeAndPatch(patchInput(provider));
    expect(calls).toHaveLength(3);
    expect(calls[1].promptVersion).toBe('passage-source-localization-v9-reference-catalog');
    expect(calls[1].payload.outputSchema.properties.locations.items.required).toEqual(['lineIds', 'symbol', 'reason', 'evidenceRefs']);
    expect(result.locations[0]).toMatchObject({ path: 'App.jsx', startLine: 2, endLine: 3, sourceDigest: sha256(source),
      citationDigest: sha256(source.split('\n').slice(1, 3).join('\n')), verified: true,
      reason: 'A model hypothesis, not an independently established cause' });
    expect(result.locations[0].lineIds).toHaveLength(2);
    expect(calls[2].payload.groundedLocations).toEqual(result.locations);
  });
  it('rejects unknown, duplicate, reordered, nonconsecutive and cross-file source-line IDs before requesting a patch', async () => {
    for (const invalid of ['unknown', 'duplicate', 'reordered', 'nonconsecutive', 'cross-file']) {
      const calls: any[] = [];
      const provider = { completeStructured: vi.fn(async (input: any) => {
        calls.push(input);
        if (calls.length === 1) return { value: input.schema.parse({ files: ['App.jsx', 'Other.jsx'], purpose: 'Inspect synthetic source files' }), receipt };
        const [first, second] = input.payload.inspectedFiles;
        const ids = first.sourceLines.map((line: any) => line.id);
        const lineIds = invalid === 'unknown' ? ['line:' + '0'.repeat(24)]
          : invalid === 'duplicate' ? [ids[0], ids[0]] : invalid === 'reordered' ? [ids[1], ids[0]]
          : invalid === 'nonconsecutive' ? [ids[0], ids[2]] : [ids[0], second.sourceLines[1].id];
        return { value: input.schema.parse({ summary: 'Synthetic invalid IDs', locations: [{ lineIds,
          symbol: 'App', reason: 'Synthetic invalid source reference', evidenceRefs: ['unit-capture:1'] }] }), receipt };
      }) } as unknown as RepairProvider;
      const input = patchInput(provider);
      input.files.push({ path: 'Other.jsx', content: source, digest: sha256(source) });
      await expect(localizeAndPatch(input)).rejects.toMatchObject({ code: 'UNGROUNDED_SOURCE_REFERENCE' });
      expect(calls).toHaveLength(4);
      expect(calls.some(call => call.promptVersion.startsWith('passage-journey-patch-'))).toBe(false);
    }
  });
  it('retains failed citation receipts, supplies exact feedback and accepts a corrected contiguous quote', async () => {
    const wrong = 'export default function App() {\n  return <button>Original task</button>;', changed = source.replace('Original task', 'Repaired task');
    const values = [{ files: ['App.jsx'], purpose: 'Inspect synthetic source' }, citation(wrong), citation('  return <button>Original task</button>;'), { summary: 'Synthetic candidate', patches: [{ path: 'App.jsx', beforeDigest: sha256(source), source: changed }] }], calls: any[] = [], retained: ModelReceipt[] = [];
    const provider = { completeStructured: vi.fn(async (input: any) => { calls.push(input); return { value: input.schema.parse(values.shift()), receipt: { ...receipt, requestId: `unit-${calls.length}` } }; }) } as unknown as RepairProvider;
    const result = await localizeAndPatch(patchInput(provider, (_stage, data) => { if (data?.receipt) retained.push(data.receipt); }));
    expect(retained).toHaveLength(4); expect(result.receipts).toHaveLength(4); expect(calls[2].payload.citationFeedback.error).toContain('contiguous exact substring'); expect(calls[2].payload.citationFeedback.execution).toContain('No patch'); expect(result.locations[0].verified).toBe(true); expect(result.patches[0]).toMatchObject({ beforeDigest: sha256(source), afterDigest: sha256(changed), source: changed });
  });
  it('stops after bounded invalid citations and never asks for a patch or executes source', async () => {
    const calls: string[] = [], retained: ModelReceipt[] = [];
    const provider = { completeStructured: vi.fn(async (input: any) => { calls.push(input.promptVersion); return { value: input.schema.parse(calls.length === 1 ? { files: ['App.jsx'], purpose: 'Inspect synthetic source' } : citation('Invented source text never present in the file')), receipt: { ...receipt, requestId: `unit-${calls.length}` } }; }) } as unknown as RepairProvider;
    await expect(localizeAndPatch(patchInput(provider, (_stage, data) => { if (data?.receipt) retained.push(data.receipt); }))).rejects.toMatchObject({ code: 'UNGROUNDED_SOURCE_REFERENCE' }); expect(calls).toHaveLength(4); expect(retained).toHaveLength(4); expect(calls.some(name => name.startsWith('passage-journey-patch-'))).toBe(false);
  });
});
describe('portable authored guard exports', () => {
  it('retains historical drafts/attempts/failures but exports an accepted patch only for the current reviewed suite', async () => {
    const service = new JourneyService(store, model(null));
    try {
      const session = service.create({ fixtureId: 'northstar-appointments', task: 'Synthetic guard-export unit task', captureConsent: true }); session.captures.push(capture()); store.put('compiler-session', session.id, session);
      const approve = () => service.review(session.id, { expectedDigest: service.session(session.id).draft!.digest, maintainer: 'Unit automation maintainer', interactionReviewer: 'Unit automation reviewer', acknowledgeInferred: true, reviewProvenance: 'automated-development' });
      service.draft(session.id, { mode: 'observed' }); await service.wait(session.id); const original = approve();
      const patched = 'export default function UnitFixture() { return <button>Synthetic patch only</button>; }';
      original.repairs.push({ id: 'unit-accepted-old', createdAt: at, contractDigest: original.review!.contractDigest, status: 'accepted', summary: 'Synthetic accepted fixture only', locations: [], patches: [{ path: 'DatePicker.jsx', source: patched, beforeDigest: sha256('original synthetic source'), afterDigest: sha256(patched), diff: 'Synthetic unit fixture diff' }], receipts: [receipt], verificationIds: [] });
      original.repairs.push({ id: 'unit-failed-empty', createdAt: at, contractDigest: original.review!.contractDigest, status: 'error', summary: 'Synthetic failed attempt', locations: [], patches: [], receipts: [receipt], verificationIds: [], error: 'Synthetic invalid model output' }); store.put('compiler-session', session.id, original);
      store.put('compiler-generation-failure', 'unit-failure', { id: 'unit-failure', runId: session.id, receipt }); store.put('compiler-generation-failure', 'foreign-failure', { id: 'foreign-failure', runId: 'not-this-session' });
      expect(service.export(session.id).patches).toHaveLength(1);
      service.draft(session.id, { mode: 'observed' }); await service.wait(session.id); expect(() => service.export(session.id)).toThrow(/Approve this exact draft/); const current = approve();
      const guard = service.export(session.id); expect(guard.patches).toEqual([]); expect(guard.evidence.drafts).toHaveLength(2); expect(guard.evidence.repairs).toHaveLength(2); expect(guard.evidence.generationFailures).toHaveLength(1); expect(guard.review).toMatchObject({ evidenceClass: 'automated-development-review', independentlyReviewed: false, reviewProvenance: 'automated-development' }); expect(current.assistiveEvidence.participantCount).toBe(0);
      const zip = unzipSync(await buildJourneyGuardBundle(guard)); const portable = JSON.parse(strFromU8(zip['guard.json']));
      expect(portable.contractsBySchedule).toEqual(guard.contractsBySchedule); expect(portable.patches).toEqual([]);
      expect(Object.keys(portable.contractsBySchedule).sort()).toEqual(['baseline', 'cancel-pending', 'modal-boundary']);
      expect(JSON.parse(strFromU8(zip['package.json'])).scripts).toEqual({ 'verify:guard': 'tsx scripts/verify-journey-guard.ts', 'verify:preservation': 'tsx scripts/check-authored-preservation.ts' });
      for (const line of strFromU8(zip['SHA256SUMS']).trim().split('\n')) { const [digest, path] = line.split('  '); expect(sha256(Buffer.from(zip[path]))).toBe(digest); }
      expect(Object.keys(zip).some(path => path.includes('.env') || path.endsWith('.db') || path.startsWith('server/') || path.includes('captures/'))).toBe(false);
      expect(zip['engine/contract-interpreter.ts']).toBeDefined(); expect(zip['engine/trace-recorder.ts']).toBeDefined();
    } finally { await service.close(); }
  });
});

it('carries source-admission diagnostics and earlier executed failures into an authored retry that has no new verification', async () => {
  const calls: any[] = [];
  const provider = { assertAvailable: vi.fn(), completeStructured: vi.fn(async (input: any) => {
    calls.push(input);
    throw new Error('Synthetic stop before patch or browser execution');
  }) } as unknown as RepairProvider;
  const service = new JourneyService(store, provider);
  try {
    const session = service.create({ fixtureId: 'northstar-appointments', captureConsent: true });
    session.captures.push(capture()); store.put('compiler-session', session.id, session);
    service.draft(session.id, { mode: 'observed' }); await service.wait(session.id);
    const reviewed = service.review(session.id, { expectedDigest: service.session(session.id).draft!.digest, maintainer: 'Synthetic automated intent reviewer', interactionReviewer: 'Synthetic automated interaction reviewer', acknowledgeInferred: true, reviewProvenance: 'automated-development' });
    const earlier = { ...capture(), id: 'earlier-actual-execution-fixture', variant: 'candidate' as const };
    reviewed.verifications.push(earlier);
    const rejected = 'export default function SlotControl() { window.dispatchEvent(new CustomEvent("invented")); return null; }';
    reviewed.repairs.push({ id: 'synthetic-source-rejection', createdAt: at, contractDigest: reviewed.review!.contractDigest, status: 'error', summary: 'Synthetic admission rejection', locations: [], patches: [{ path: 'DatePicker.jsx', beforeDigest: sha256('prior'), afterDigest: sha256(rejected), source: rejected, diff: 'Synthetic patch fixture' }], receipts: [], verificationIds: [], errorCode: 'SOURCE_REJECTED', error: 'The component may not access window or construct DOM events.' });
    store.put('compiler-session', reviewed.id, reviewed);
    const execute = vi.spyOn(service as any, 'execute');
    service.repair(reviewed.id); await service.wait(reviewed.id);
    expect(calls).toHaveLength(1); expect(execute).not.toHaveBeenCalled();
    expect(calls[0].payload.previousPublicFeedback.sourceError).toEqual({ code: 'SOURCE_REJECTED', message: 'The component may not access window or construct DOM events.' });
    expect(calls[0].payload.previousPublicFeedback.currentSourceAdmission).toMatchObject({ sourceDigest: sha256(rejected), valid: false });
    expect(calls[0].payload.previousPublicFeedback.currentSourceAdmission.errors.join(' ')).toContain('window');
    expect(calls[0].payload.admissionDiagnostics).toEqual([{ path: 'DatePicker.jsx', sourceDigest: sha256(rejected), errors: calls[0].payload.previousPublicFeedback.currentSourceAdmission.errors }]);
    expect(calls[0].payload.observations.some((item: { id: string }) => item.id === earlier.id)).toBe(true);
    expect(calls[0].payload.previousPublicFeedback.observationScope.kind).toBe('earlier-executed-revision');
    expect(service.session(reviewed.id).repairs[0].verificationIds).toEqual([]);
    expect(service.session(reviewed.id).repairs.at(-1)?.inspection?.method).toBe('deterministic-single-file');
  } finally { await service.close(); }
});

it('derives the single-file patch identity from the immutable inspection while the model returns only source', async () => {
  const changed = source.replace('Original task', 'Repaired task');
  const provider = { singleSourceOutputAvailable: true,
    completeStructured: vi.fn(async (input: any) => ({ value: input.schema.parse(citation('  return <button>Original task</button>;')), receipt })),
    completeSingleSource: vi.fn(async () => ({ source: changed, receipt: { ...receipt, outputProtocol: 'single-source' as const } })),
  } as unknown as RepairProvider;
  const result = await localizeAndPatch({ ...patchInput(provider), inspectionMode: 'only-permitted-file' });
  expect(provider.completeStructured).toHaveBeenCalledTimes(1);
  expect(provider.completeSingleSource).toHaveBeenCalledTimes(1);
  expect(result.patches[0]).toMatchObject({ path: 'App.jsx', beforeDigest: sha256(source), afterDigest: sha256(changed), source: changed });
  expect(result.receipts.at(-1)?.outputProtocol).toBe('single-source');
  const request = vi.mocked(provider.completeSingleSource).mock.calls[0][0];
  expect(request.promptVersion).toBe('passage-journey-source-v2-supplied-observations');
  expect(request.system).toContain('Do not JSON-escape');
  expect(request.payload).not.toHaveProperty('outputSchema');
});

it('keeps source-bound supplied observations separate from captured-event citations in both model stages', async () => {
  const observation = { id: 'source-observation-unit', sourceDigest: sha256(source), details: 'Synthetic supplied behavior report outside the captured schedule.',
    observer: 'Synthetic automation', provenance: 'automated-development' as const, recordedAt: at, independentlyReviewed: false as const };
  const calls: any[] = [];
  let referenceMode = 'valid';
  const provider = { completeStructured: vi.fn(async (input: any) => {
    calls.push(input);
    const value = input.promptVersion.startsWith('passage-source-localization')
      ? { summary: 'Synthetic source-bound report hypothesis', locations: [{ lineIds: [input.payload.inspectedFiles[0].sourceLines[2].id], symbol: 'App', reason: 'Supplied report, not captured failure',
        evidenceRefs: referenceMode === 'forged-event' ? [observation.id] : [], reportedObservationRefs: referenceMode === 'valid' ? [observation.id] : referenceMode === 'unknown' ? ['unknown-report'] : [] }] }
      : { summary: 'Synthetic candidate', patches: [{ path: 'App.jsx', beforeDigest: sha256(source), source: source.replace('Original task', 'Repaired task') }] };
    return { value: input.schema.parse(value), receipt };
  }) } as unknown as RepairProvider;
  const input = { ...patchInput(provider), inspectionMode: 'only-permitted-file' as const, additionalSourceObservations: [observation] };
  const result = await localizeAndPatch(input);
  expect(result.locations[0]).toMatchObject({ evidenceRefs: [], reportedObservationRefs: [observation.id], sourceDigest: sha256(source) });
  expect(calls).toHaveLength(2);
  for (const call of calls) expect(call.payload.additionalSourceObservations).toEqual([observation]);
  expect(calls[1].system).toContain('Passing frozen checks does not resolve a separate observed regression');
  await expect(localizeAndPatch({ ...input, additionalSourceObservations: [{ ...observation, sourceDigest: '0'.repeat(64) }] })).rejects.toMatchObject({ code: 'STALE_SOURCE_OBSERVATION' });
  expect(calls).toHaveLength(2);
  for (const mode of ['unknown', 'empty', 'forged-event']) {
    referenceMode = mode; calls.length = 0;
    await expect(localizeAndPatch(input)).rejects.toMatchObject({ code: mode === 'forged-event' ? 'UNGROUNDED_MODEL_REFERENCE' : 'UNGROUNDED_SOURCE_REFERENCE' });
    expect(calls.every(call => call.promptVersion.startsWith('passage-source-localization'))).toBe(true);
  }
});

it('retains an invalid capture-ID citation and corrects it using the actual event catalog before patching', async () => {
  const calls: any[] = [], retained: ModelReceipt[] = [];
  const provider = { completeStructured: vi.fn(async (input: any) => {
    calls.push(input);
    const value = calls.length < 3 ? { locations: [{ lineIds: [input.payload.inspectedFiles[0].sourceLines[2].id],
      symbol: 'App', reason: 'Synthetic bounded citation correction', evidenceRefs: [calls.length === 1 ? 'unit-capture' : 'unit-capture:1'] }] }
      : { summary: 'Synthetic candidate', patches: [{ path: 'App.jsx', beforeDigest: sha256(source), source: source.replace('Original task', 'Repaired task') }] };
    return { value: input.schema.parse(value), receipt: { ...receipt, requestId: `synthetic-citation-${calls.length}` } };
  }) } as unknown as RepairProvider;
  const result = await localizeAndPatch({ ...patchInput(provider, (_stage, data) => { if (data?.receipt) retained.push(data.receipt); }), inspectionMode: 'only-permitted-file' });
  expect(calls).toHaveLength(3); expect(retained).toHaveLength(3);
  expect(calls[0].payload.citationReferenceKinds.evidenceRefs[0]).toMatchObject({ captureIdNotForCitation: 'unit-capture', allowedEventIds: ['unit-capture:1', 'unit-capture:2'] });
  expect(calls[1].payload.citationFeedback.error).toContain('not capture IDs');
  expect(calls[1].payload.citationFeedback.invalidProposal.locations[0].evidenceRefs).toEqual(['unit-capture']);
  expect(result.locations[0].evidenceRefs).toEqual(['unit-capture:1']);
});

it('diagnoses exact-current-source executions without mixing stale original failures, while preserving both in the guard', async () => {
  const calls: any[] = [];
  const provider = { assertAvailable: vi.fn(), completeStructured: vi.fn(async (input: any) => {
    calls.push(input); throw new Error('Synthetic stop before patch or browser execution');
  }) } as unknown as RepairProvider;
  const service = new JourneyService(store, provider);
  try {
    const session = service.create({ fixtureId: 'northstar-appointments', captureConsent: true });
    session.captures.push(capture()); store.put('compiler-session', session.id, session);
    service.draft(session.id, { mode: 'observed' }); await service.wait(session.id);
    const reviewed = service.review(session.id, { expectedDigest: service.session(session.id).draft!.digest,
      maintainer: 'Synthetic automated intent reviewer', interactionReviewer: 'Synthetic automated interaction reviewer',
      acknowledgeInferred: true, reviewProvenance: 'automated-development' });
    const currentSource = 'export default function SlotControl() { return <button>Current synthetic revision</button>; }';
    const stale = { ...capture(), id: 'stale-candidate', variant: 'candidate' as const };
    const current = { ...capture(), id: 'current-candidate', sourceDigest: sha256(currentSource), variant: 'candidate' as const };
    reviewed.verifications.push(stale, current);
    reviewed.repairs.push({ id: 'current-patch', createdAt: at, contractDigest: reviewed.review!.contractDigest, status: 'rejected',
      summary: 'Synthetic current revision', locations: [], patches: [{ path: 'DatePicker.jsx', beforeDigest: sha256('older'),
        afterDigest: sha256(currentSource), source: currentSource, diff: 'Synthetic patch fixture' }], receipts: [], verificationIds: [current.id] });
    store.put('compiler-session', reviewed.id, reviewed);
    const observation = { sourceDigest: sha256(currentSource), details: 'Synthetic additional observed behavior outside the frozen checks.', observer: 'Synthetic automated observer', provenance: 'automated-development' as const };
    service.repair(reviewed.id, observation); await service.wait(reviewed.id);
    expect(calls).toHaveLength(1);
    expect(calls[0].payload.observations.map((item: { id: string }) => item.id)).toEqual([current.id]);
    expect(calls[0].payload.previousPublicFeedback.observationScope).toMatchObject({ kind: 'exact-inspected-revision', inspectedSourceDigest: sha256(currentSource) });
    expect(calls[0].payload.previousPublicFeedback.additionalObservedFeedback).toMatchObject({ ...observation, independentlyReviewed: false });
    expect(service.session(reviewed.id).repairs.at(-1)?.additionalObservation).toMatchObject(observation);
    const guard = service.export(reviewed.id);
    expect(guard.evidence.captures.map(item => item.id)).toEqual(['unit-capture']);
    expect(guard.evidence.verifications.map(item => item.id)).toEqual([stale.id, current.id]);
    service.repair(reviewed.id, { ...observation, sourceDigest: '0'.repeat(64) }); await service.wait(reviewed.id);
    expect(service.session(reviewed.id).error?.code).toBe('STALE_SOURCE_OBSERVATION');
    expect(calls).toHaveLength(1);
  } finally { await service.close(); }
});
