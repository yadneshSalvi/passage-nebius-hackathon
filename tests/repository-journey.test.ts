/** Synthetic unit fixtures only; no upstream application, paid call, external build or actual participant. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyPatch } from 'diff';
import { createServer } from 'node:http';
import { RepositoryJourneyService } from '../server/repository-journey-service.js';
import { Store, sha256 } from '../server/store.js';
import { GenerationOutputError } from '../server/generation-output.js';
import { importActualAT } from '../server/actual-at-evidence.js';
import { buildRepository, validateRepositorySnapshot } from '../engine/repository-worker.js';
import { approveTemporalContract } from '../engine/contract-interpreter.js';
import type { TemporalContract, TemporalContractBody, TemporalExecution } from '../shared/temporal.js';
import type { PublicRepositorySnapshot, RepositoryBuildView, RepositoryJourney, RepositoryReplay } from '../shared/repository-journey.js';
import type { ModelReceipt } from '../shared/types.js';
import type { RepairProvider } from '../server/provider.js';
vi.mock('../engine/repository-worker.js', async importOriginal => ({ ...await importOriginal<typeof import('../engine/repository-worker.js')>(), buildRepository: vi.fn() }));
const at = '2026-10-28T12:00:00.000Z';
const sources = { 'App.jsx': 'export default function App() { return <button>Original A</button>; }\n', 'helper.js': "export const helper = () => 'Original helper B content';\n", 'unchanged.js': "export const untouched = 'Original untouched C content';\n" };
function snapshot(overrides: Partial<PublicRepositorySnapshot> = {}): PublicRepositorySnapshot {
  const source = 'export default function TestMount() { return null; }';
  const value: PublicRepositorySnapshot = { schema: 'passage.repository.v1', repositoryUrl: 'https://github.com/unit-fixture/synthetic-app', revision: 'a'.repeat(40), sourceDigest: '', entryPoint: 'App.jsx', rootElementId: 'unit-root', rootElementClass: 'unit-fixture', disclosure: 'public-source', bootstrap: { source, sha256: sha256(source), description: 'Synthetic protected unit mount' }, moduleAliases: { 'unit-helper': 'helper.js' }, files: Object.entries(sources).map(([path, content]) => ({ path, content, sha256: sha256(content) })), ...overrides };
  value.sourceDigest = sha256(JSON.stringify({ schema: value.schema, repositoryUrl: value.repositoryUrl, revision: value.revision, entryPoint: value.entryPoint, rootElementId: value.rootElementId, rootElementClass: value.rootElementClass ?? '', disclosure: value.disclosure, bootstrap: value.bootstrap ? { source: value.bootstrap.source, description: value.bootstrap.description, sha256: value.bootstrap.sha256 } : null, moduleAliases: Object.fromEntries(Object.entries(value.moduleAliases ?? {}).sort(([a], [b]) => a.localeCompare(b))), files: value.files.map(({ path, sha256 }) => ({ path, sha256 })).sort((a, b) => a.path.localeCompare(b.path)) })); return value;
}
function body(): TemporalContractBody { return { version: 'passage-temporal/v1', id: 'unit-task', revision: 1, title: 'Synthetic unit task', bindings: { value: { kind: 'css', value: '#unit-value', read: 'value' } }, actions: [{ id: 'observe', kind: 'checkpoint', label: 'Observe', required: true }], assertions: [{ id: 'protected-value', kind: 'valuePreserved', binding: 'value', since: 'initial', after: 'observe', label: 'Preserve original requirement' }], allowedEvents: [], bounds: { maxActions: 20, maxDurationMs: 5000, actionTimeoutMs: 1000 } }; }
function build(source: PublicRepositorySnapshot): RepositoryBuildView { return { id: sha256(`test-build:${source.sourceDigest}`), revision: source.revision, sourceDigest: source.sourceDigest, bundleDigest: sha256('synthetic bundle'), previewUrl: 'http://127.0.0.1:9/unit-only', createdAt: at, outcomeVerification: 'not-configured', isolation: { runtime: 'docker-linux', context: 'unit-mock', image: 'unit-no-image', network: 'none', hostMounts: false, readOnlyRoot: true, user: '1000:1000', capabilities: 'none', memoryBytes: 1, pidsLimit: 1 } }; }
function replay(source: PublicRepositorySnapshot, contract: TemporalContract, passed = false): RepositoryReplay {
  const execution: TemporalExecution = { version: 'passage-temporal-execution/v1', id: 'unit-execution', identity: { executionId: 'unit-execution', sourceDigest: source.sourceDigest, buildId: build(source).id, sessionId: 'unit-browser-session', contractDigest: contract.digest, adapter: 'unit-no-browser' }, contractDigest: contract.digest, status: passed ? 'passed' : 'failed', passed, startedAt: at, completedAt: at, durationMs: 0, actionsExecuted: ['observe'], checks: [], trace: [{ sequence: 1, at, elapsedMs: 0, kind: 'assertion', label: 'Synthetic controller observation', provenance: 'controller', data: { status: 'failed' } }], failureSignature: passed ? null : 'protected-value:value-changed', limitations: ['Synthetic replay; not browser or human evidence.'] };
  return { id: `unit-replay-${source.sourceDigest.slice(0, 8)}-${contract.revision}`, createdAt: at, label: 'Synthetic replay', sourceDigest: source.sourceDigest, contractDigest: contract.digest, build: build(source), execution, outcomeVerification: 'not-configured', protectedOutcome: null };
}
function receipt(index: number, promptVersion = 'unit-stage'): ModelReceipt { return { provider: 'offline-fixture', model: 'unit-structured-provider', requestId: `unit-${index}`, promptVersion, temperature: 0, inputTokens: 0, outputTokens: 0, durationMs: 0, startedAt: at, completedAt: at, live: false }; }
let root: string, store: Store, service: RepositoryJourneyService, replies: ((input: any) => unknown)[], calls: any[], sequence: number;
const provider = { assertAvailable: vi.fn(), completeStructured: vi.fn() };
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'passage-repository-unit-')); store = new Store(root); replies = []; calls = []; sequence = 0; provider.completeStructured.mockReset(); provider.completeStructured.mockImplementation(async input => { calls.push(input); const reply = replies.shift(); if (!reply) throw new Error('No synthetic reply queued'); return { value: input.schema.parse(reply(input)), receipt: receipt(++sequence, input.promptVersion) }; }); vi.mocked(buildRepository).mockReset(); vi.mocked(buildRepository).mockImplementation(async options => build(options.snapshot) as Awaited<ReturnType<typeof buildRepository>>); service = new RepositoryJourneyService(store, provider as unknown as RepairProvider); });
afterEach(async () => { await service.close(); store.close(); await rm(root, { recursive: true, force: true }); vi.restoreAllMocks(); });
function create() { return service.create({ label: 'Synthetic unit fixture', task: 'Synthetic integrity task', snapshot: snapshot(), contract: body(), sourcePermission: 'public-source-development' }); }
async function approved() { const session = create(), contract = approveTemporalContract(body(), { actor: 'Unit author', role: 'operator', evidenceClass: 'authored-development', approvedAt: at }); session.replays.push(replay(session.snapshot, contract)); store.put('repository-journey', session.id, session); service.draft(session.id, 'observed'); await service.wait(session.id); return review(session.id); }
function review(id: string) { return service.review(id, { expectedDigest: service.session(id).draft!.digest, maintainer: 'Unit maintainer automation', interactionReviewer: 'Unit reviewer automation', acknowledgeInferred: true, reviewProvenance: 'automated-development' }); }
function queuePatch(changes: Record<string, string>, invalidDigest = false) { replies.push(() => ({ files: Object.keys(sources), purpose: 'Inspect synthetic source' }), input => ({ summary: 'Exact synthetic citation', locations: [{ path: 'App.jsx', startLine: 1, endLine: 1, symbol: 'App', quote: input.payload.inspectedFiles.find((file: any) => file.path === 'App.jsx').sourceLines[0].text, reason: 'Synthetic transition', evidenceRefs: [input.payload.observations[0].trace[0].id] }] }), input => ({ summary: 'Synthetic update', patches: Object.entries(changes).map(([path, source]) => ({ path, source, beforeDigest: invalidDigest ? '0'.repeat(64) : input.payload.inspectedFiles.find((file: any) => file.path === path).digest })) })); }
describe('repository starving-renderer shutdown', () => {
  it('closes the browser independently, retains collected evidence, and leaves healthy recordings accepted', async () => {
    const session = create(); let starves = false;
    const server = createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(`<button id="run" onclick="${starves ? 'while(true){}' : 'this.dataset.activated=true'}">Run</button>`); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address() as { port: number };
    vi.mocked(buildRepository).mockImplementation(async options => ({ ...build(options.snapshot), previewUrl: `http://127.0.0.1:${address.port}/` }) as Awaited<ReturnType<typeof buildRepository>>);
    try {
      for (const starving of [false, true]) {
        starves = starving; const controller = new AbortController(); let watchdogFired = false;
        const watchdog = setTimeout(() => { watchdogFired = true; controller.abort(new Error('Independent test watchdog')); }, 1800);
        try {
          const task = body(); task.bindings = { run: { kind: 'css', value: '#run' } }; task.actions = [{ id: 'focus', kind: 'focus', binding: 'run', label: 'Initial scripted focus', required: true }, { id: 'activate', kind: 'press', key: 'Enter', binding: 'run', label: 'Activate actual button', requires: ['focus'], required: true }]; task.assertions = [{ id: 'actual-focus', kind: 'focusWithin', binding: 'run', after: 'activate', label: 'Retain focus after activation' }]; task.bounds = { maxActions: 3, maxDurationMs: starving ? 300 : 2000, actionTimeoutMs: starving ? 100 : 1000 };
          const approved = approveTemporalContract(task, { actor: 'Synthetic shutdown reviewer', role: 'operator', evidenceClass: 'authored-development', approvedAt: at });
          const result: RepositoryReplay = await (service as any).execute(session, session.snapshot, approved, 'Synthetic shutdown regression', controller.signal);
          expect(watchdogFired).toBe(false); expect(result.execution.status, JSON.stringify({ error: result.execution.error, trace: result.execution.trace.slice(-3) })).toBe(starving ? 'error' : 'passed'); expect(result.execution.passed).toBe(!starving);
          expect(result.execution.trace.some(event => event.actionId === 'activate')).toBe(true);
          expect(result.execution.verifierVersion).toBe('passage-temporal-native-focus-bounded-cleanup-v3');
        } finally { clearTimeout(watchdog); }
      }
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});
describe('repository repair integrity', () => {
  it('retries the last nonempty multi-file candidate after a failed empty attempt, preserving prior untouched patches', async () => {
    const session = await approved(), original = structuredClone(session.snapshot);
    const nextA = sources['App.jsx'].replace('Original A', 'First candidate A'), nextB = sources['helper.js'].replace('Original helper B', 'First candidate helper B'), finalA = sources['App.jsx'].replace('Original A', 'Final candidate A');
    const executed: PublicRepositorySnapshot[] = [];
    vi.spyOn(service as any, 'execute').mockImplementation(async (_session: unknown, source: unknown, contract: unknown) => { validateRepositorySnapshot(source as PublicRepositorySnapshot); executed.push(structuredClone(source as PublicRepositorySnapshot)); return replay(source as PublicRepositorySnapshot, contract as TemporalContract, executed.length > 1); });
    queuePatch({ 'App.jsx': nextA, 'helper.js': nextB }); service.repair(session.id); await service.wait(session.id);
    const first = service.session(session.id).repairs[0]; expect(first.status).toBe('rejected');
    queuePatch({ 'App.jsx': finalA }, true); service.repair(session.id); await service.wait(session.id);
    const failure = service.session(session.id).repairs[1]; expect(failure.status).toBe('error'); expect(failure.patches).toEqual([]);
    expect(failure.receipts.map(item => item.promptVersion)).toEqual(['passage-source-inspection-v2-explicit-manifest', 'passage-source-localization-v9-reference-catalog', 'passage-journey-patch-v3-admission-aware']);
    queuePatch({ 'App.jsx': finalA }); service.repair(session.id); await service.wait(session.id);
    const result = service.session(session.id), candidate = result.repairs[2]; expect(candidate.status).toBe('accepted'); expect(candidate.patches.map(patch => patch.path).sort()).toEqual(['App.jsx', 'helper.js']);
    const patch = candidate.patches.find(item => item.path === 'App.jsx')!;
    expect(patch.beforeDigest).toBe(sha256(sources['App.jsx'])); expect(patch.beforeDigest).not.toBe(sha256(nextA)); expect(applyPatch(sources['App.jsx'], patch.diff)).toBe(finalA);
    expect(candidate.patches.find(item => item.path === 'helper.js')).toEqual(first.patches.find(item => item.path === 'helper.js'));
    const lastFiles = calls.filter(call => call.promptVersion === 'passage-journey-patch-v3-admission-aware').at(-1).payload.inspectedFiles;
    expect(lastFiles.find((file: any) => file.path === 'App.jsx').content).toBe(nextA); expect(lastFiles.find((file: any) => file.path === 'helper.js').content).toBe(nextB);
    expect(executed.at(-1)!.files.find(file => file.path === 'unchanged.js')!.content).toBe(sources['unchanged.js']); expect(result.snapshot).toEqual(original); expect(executed).toHaveLength(2);
  });
  it('excludes stale accepted patches under a new contract while retaining drafts, attempts and failed-stage receipts', async () => {
    const session = await approved(); vi.spyOn(service as any, 'execute').mockImplementation(async (_session: unknown, source: unknown, contract: unknown) => replay(source as PublicRepositorySnapshot, contract as TemporalContract, true));
    queuePatch({ 'App.jsx': sources['App.jsx'].replace('Original A', 'Accepted old A') }); service.repair(session.id); await service.wait(session.id);
    const old = service.session(session.id); expect(old.repairs[0].status).toBe('accepted');
    const failedReceipt = receipt(999, 'passage-journey-patch-v1'); queuePatch({ 'App.jsx': sources['App.jsx'].replace('Original A', 'Invalid A') });
    replies[replies.length - 1] = () => { throw new GenerationOutputError({ id: 'unit-generation-failure', runId: session.id, usageEntryId: 'unit-usage', createdAt: at, code: 'MALFORMED_MODEL_OUTPUT', message: 'Synthetic invalid final output', receipt: failedReceipt, diagnostics: [{ path: '$', code: 'unit', message: 'Unit fixture only' }], topLevelKeys: [] }); };
    service.repair(session.id); await service.wait(session.id); expect(service.session(session.id).repairs[1].receipts).toHaveLength(2);
    service.draft(session.id, 'observed'); await service.wait(session.id); expect(() => service.export(session.id)).toThrow(/Review the exact/); review(session.id);
    store.put('compiler-generation-failure', 'foreign', { id: 'foreign', runId: 'another-session' });
    const guard = service.export(session.id); expect(guard.contract.digest).not.toBe(old.contract!.digest); expect(guard.patches).toEqual([]); expect(guard.drafts).toHaveLength(2); expect(guard.repairs).toHaveLength(2); expect(guard.replays.length).toBeGreaterThan(1);
    expect(guard.generationFailures).toHaveLength(1); expect(guard.generationFailures[0]).toMatchObject({ id: 'unit-generation-failure', receipt: failedReceipt });
    expect(guard.review).toMatchObject({ evidenceClass: 'automated-development-review', reviewProvenance: 'automated-development', independentlyReviewed: false });
  });
  it('permits explicit correction of model additions while retaining original requirements and invalidating review', async () => {
    const session = await approved(), protectedAssertion = structuredClone(session.proposedContract.assertions[0]), current = service.session(session.id);
    current.draft!.body.assertions.push({ id: 'model-added', label: 'Synthetic inferred addition', kind: 'valueEquals', binding: 'value', expected: 'synthetic', after: 'observe' });
    current.draft!.obligations.push({ id: 'model-obligation', text: 'Synthetic inferred addition', origin: 'inferred', evidenceRefs: [], assertionIds: ['model-added'] }); current.draft!.digest = sha256('unit-added-draft'); current.drafts[0] = structuredClone(current.draft!); store.put('repository-journey', current.id, current); review(current.id);
    expect(() => service.revise(current.id, { expectedDigest: current.draft!.digest, dropAssertionIds: ['protected-value'], notes: 'Never weaken original protected requirements.' })).toThrow(/Only model-added/);
    const corrected = service.revise(current.id, { expectedDigest: current.draft!.digest, dropAssertionIds: ['model-added'], notes: 'Remove unsupported synthetic model addition only.' });
    expect(corrected.draft!.body.assertions).toEqual([protectedAssertion]); expect(corrected.review).toBeNull(); expect(corrected.contract).toBeNull(); expect(corrected.status).toBe('review'); expect(corrected.draft!.method).toBe('operator-revision'); expect(corrected.draft!.parentDigest).toBe(current.draft!.digest); expect(corrected.drafts).toHaveLength(2); expect(corrected.draft!.obligations.flatMap(item => item.assertionIds)).not.toContain('model-added'); expect(() => service.verify(current.id, 'candidate')).toThrow(/Review the exact/);
  });
  it('distinguishes self-hash integrity from upstream ancestry and protects bootstrap, aliases and root class', async () => {
    const session = await approved(); service.build(session.id); await service.wait(session.id);
    expect(buildRepository).toHaveBeenCalledTimes(1); expect(service.session(session.id).sourceProvenance).toMatchObject({ kind: 'operator-provided-manifest', verifiedUpstreamBytes: false }); expect(service.export(session.id).sourceProvenance?.detail).toContain('does not prove');
    for (const changed of [snapshot({ rootElementClass: 'other-class' }), snapshot({ moduleAliases: {} }), snapshot({ bootstrap: undefined })]) expect(() => service.revision(session.id, { label: 'Changed adapter', snapshot: changed })).toThrow(/protected adapter boundary/);
    const tampered = snapshot(); tampered.files[0].content += '\n'; expect(() => service.create({ label: 'Tampered', task: 'Unit task', snapshot: tampered, contract: body(), sourcePermission: 'public-source-development' })).toThrow(/source manifest/);
    store.put('repository-inspection', snapshot().sourceDigest, { sourceDigest: snapshot().sourceDigest, revision: snapshot().revision, repositoryUrl: snapshot().repositoryUrl, inspectedAt: at });
    const local = create();
    expect(local.sourceProvenance).toMatchObject({ kind: 'git-blob-inspection', localGitBlobsVerified: true, verifiedUpstreamBytes: false });
    expect(local.sourceProvenance?.detail).toContain('does not authenticate');
    local.sourceProvenance!.verifiedUpstreamBytes = true; store.put('repository-journey', local.id, local);
    expect(service.session(local.id).sourceProvenance).toMatchObject({ verifiedUpstreamBytes: false, localGitBlobsVerified: true, correction: expect.stringContaining('overstated') });
  });
  it('preserves page instrumentation provenance through the repository-to-model adapter', async () => {
    const session = create(), contract = approveTemporalContract(body(), { actor: 'Unit author', role: 'operator', evidenceClass: 'authored-development', approvedAt: at }), captured = replay(session.snapshot, contract); captured.execution.trace[0].provenance = 'page-instrumentation'; session.replays.push(captured); store.put('repository-journey', session.id, session);
    replies.push(() => ({ summary: 'Synthetic page-only proposal', contracts: [{ id: contract.id, assertions: contract.assertions }], obligations: [{ id: 'page-only', text: 'Page-only evidence needs independent observation', origin: 'observed', evidenceRefs: [`${captured.id}:1`], assertionIds: ['protected-value'] }], ambiguities: [] }));
    service.draft(session.id, 'live'); const result = await service.wait(session.id); expect(result.error?.code).toBe('UNTRUSTED_OBSERVATION'); expect(result.draft).toBeNull();
  });
});
function atReceipt(session: RepositoryJourney) { return { schema: 'passage.actual-at.v1', buildId: session.build!.id, sourceDigest: session.build!.sourceDigest, sessionId: 'unit-at-session', startedAt: at, completedAt: '2026-10-28T12:00:03.000Z', provenance: 'automated-actual-screen-reader', screenReader: 'Synthetic schema fixture, not actual AT evidence', guidepupVersion: 'unit-fixture', browser: 'Unit browser', platform: 'Unit platform', humanParticipant: false, independentlyReviewed: false, backendOutcomeVerified: false, steps: [{ action: 'Synthetic unit step', at: '2026-10-28T12:00:01.000Z', spoken: 'Synthetic schema test text' }], spokenPhraseLog: ['Synthetic schema test text'], status: 'captured', limitations: ['Synthetic unit receipt, no actual speech or participant.'] }; }
function importAT(session: RepositoryJourney, value: unknown) { const content = JSON.stringify(value); return importActualAT(store, session, { content, sha256: sha256(content), attestedActual: true }); }
describe('actual-AT receipt integrity', () => {
  it('binds exact bytes/build/source, prevents duplicate attachments and leaves automation participantCount zero', async () => {
    const session = create(); service.build(session.id); const built = await service.wait(session.id), receipt = atReceipt(built), accepted = importAT(built, receipt);
    expect(accepted).toMatchObject({ participantCount: 0, evidenceClass: 'actual-at-automation', importAttested: true, executionAuthenticated: false }); expect(accepted.receipt).toMatchObject({ humanParticipant: false, independentlyReviewed: false, backendOutcomeVerified: false }); expect(store.readArtifact(accepted.digest).toString()).toBe(JSON.stringify(receipt));
    expect(() => importActualAT(store, built, { content: JSON.stringify(receipt), sha256: '0'.repeat(64), attestedActual: true })).toThrow(/bytes do not match/);
    for (const mismatched of [{ ...receipt, buildId: '0'.repeat(64) }, { ...receipt, sourceDigest: '1'.repeat(64) }]) expect(() => importAT(built, mismatched)).toThrow(/exact build/);
    const raw = { content: JSON.stringify(receipt), sha256: sha256(JSON.stringify(receipt)), attestedActual: true }; expect(service.attachAT(session.id, raw).assistiveCaptures).toHaveLength(1); expect(service.attachAT(session.id, raw).assistiveCaptures).toHaveLength(1);
  });
  it('rejects invalid timelines, empty captured speech and human-claim escalation while retaining failed no-speech receipts', async () => {
    const session = create(); service.build(session.id); const built = await service.wait(session.id), receipt = atReceipt(built);
    const invalid = [{ ...receipt, completedAt: '2026-10-28T11:59:59.000Z' }, { ...receipt, steps: [{ ...receipt.steps[0], at: '2026-10-28T11:59:59.000Z' }] }, { ...receipt, steps: [{ ...receipt.steps[0], at: '2026-10-28T12:00:04.000Z' }] }, { ...receipt, steps: [{ ...receipt.steps[0], at: '2026-10-28T12:00:02.000Z' }, receipt.steps[0]] }];
    for (const timeline of invalid) expect(() => importAT(built, timeline)).toThrow(/times|precedes/);
    expect(() => importAT(built, { ...receipt, spokenPhraseLog: [' ', ''] })).toThrow(/actual spoken output/);
    for (const escalated of [{ ...receipt, humanParticipant: true }, { ...receipt, independentlyReviewed: true }, { ...receipt, backendOutcomeVerified: true }]) expect(() => importAT(built, escalated)).toThrow();
    const failed = importAT(built, { ...receipt, status: 'failed', spokenPhraseLog: [] }); expect(failed.receipt.status).toBe('failed'); expect(failed.participantCount).toBe(0);
  });
});
