import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, id, now, sha256 } from '../server/store.js';
import { Captures, captureImportSchema, type AssistiveSession } from '../server/captures.js';
import { CaptureReview, captureReviewDecisionSchema, captureReviewStartSchema } from '../server/capture-review.js';
import { FixtureHost, type FixtureBuild } from '../engine/host.js';
import { createContract, getReferenceSource, scenarioDefinitions } from '../engine/catalog.js';
import type { RepairRun } from '../shared/types.js';

describe('ready operator outcome binding and named review plumbing (no real participant sessions)', () => {
  let root: string, store: Store, captures: Captures, review: CaptureReview, host: FixtureHost, build: FixtureBuild, run: RepairRun;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'passage-capture-review-'));
    store = new Store(join(root, 'store')); captures = new Captures(store);
    host = new FixtureHost({ previewPort: 0, artifactRoot: join(root, 'fixture') }); await host.start();
    build = await host.prepareBuild({ fixtureId: 'northstar-appointments', source: await getReferenceSource('northstar-appointments') });
    run = { id: id('repair'), journeyId: id('journey'), fixtureId: build.fixtureId, mode: 'offline', status: 'ready', createdAt: now(), updatedAt: now(), contract: createContract(build.fixtureId), isStale: false, baseline: null, candidates: [{ id: 'test-accepted', revision: 1, createdAt: now(), source: build.source, sourceFile: build.sourceFile, digest: build.digest, patch: '', summary: 'Test-only accepted binding', receipt: { provider: 'offline-fixture', model: 'test', requestId: null, promptVersion: 'test', temperature: 0, inputTokens: null, outputTokens: null, durationMs: 0, startedAt: now(), completedAt: now(), live: false }, buildId: build.id, previewUrl: build.previewUrl, status: 'accepted', verification: null }], activeCandidateId: 'test-accepted', challenges: [], events: [], humanObservations: [], error: null, cancellationRequested: false, exportedAt: null };
    store.put('run', run.id, run); review = new CaptureReview(store, captures, host);
  });
  afterEach(async () => { await host.close(); store.close(); await rm(root, { recursive: true, force: true }); });
  const payload = () => ({ runId: run.id, candidateDigest: build.digest, buildId: build.id, contractDigest: run.contract.digest, participant: 'Private test participant', operator: 'Private Test Operator', os: 'Test OS', browser: 'Test browser', assistiveTechnology: 'Operator-supplied test transcript; no actual AT', inputMode: 'keyboard' as const, locale: 'en' as const, consent: true as const, consentScope: 'private-study' as const, intended: { date: '2026-11-16', attendee: 'Fictional attendee', service: build.fixtureId } });
  const imported = async (completion: 'completed' | 'blocked' | 'stopped' = 'completed') => {
    const started = await review.start(payload());
    const content = 'Test-only intake plumbing. No consenting participant observation is represented by this test.';
    const manifest = captureImportSchema.parse({ importToken: started.importToken, candidateDigest: build.digest, buildId: build.id, contractDigest: run.contract.digest, completion, elapsedMs: 3000, interventions: 0, operatorAttestation: true, artifacts: [{ name: 'operator-notes.txt', evidenceType: 'operator-notes', content, sha256: sha256(content) }] });
    captures.import(started.session.id, manifest);
    return { ...started, manifest };
  };
  const book = async (fixtureSessionId: string, date = '2026-11-16', attendee = 'Fictional attendee') => host.submitAppointment(fixtureSessionId, { date, attendee });

  it('pins a new empty operator session and never borrows a verifier booking', async () => {
    const verifierSession = await host.createSession(build, scenarioDefinitions[0]); await book(verifierSession.id);
    const attempt = await imported();
    expect(attempt.attempt.fixtureSessionId).not.toBe(verifierSession.id);
    expect(attempt.attempt.previewUrl).toBe(`${host.origin}/s/${attempt.attempt.fixtureSessionId}`);
    expect(captures.evidence(run.id).assistiveCaptureSummary.independentlyReviewed).toBe(0);
    const empty = await review.verify(attempt.session.id);
    expect(empty.verification).toMatchObject({ verified: false, status: 'incomplete', failureCode: 'CAPTURE_OUTCOME_ABSENT' });
    await book(attempt.attempt.fixtureSessionId);
    const verified = await review.verify(attempt.session.id);
    expect(verified.verification.verified).toBe(true); expect(verified.session.backendOutcomeVerified).toBe(true);
    expect(verified.session.independentlyReviewed).toBe(false);
    expect(() => captures.import(attempt.session.id, attempt.manifest)).toThrow(/one-time/);
  });
  it('rejects wrong expected fields and incomplete attempts without an outcome-success claim', async () => {
    const attempt = await imported(); await book(attempt.attempt.fixtureSessionId, '2026-11-17');
    expect((await review.verify(attempt.session.id)).verification).toMatchObject({ verified: false, status: 'mismatch', failureCode: 'CAPTURE_OUTCOME_MISMATCH' });
    const blocked = await imported('blocked'); await book(blocked.attempt.fixtureSessionId);
    expect((await review.verify(blocked.session.id)).verification).toMatchObject({ verified: false, status: 'incomplete', failureCode: 'CAPTURE_INCOMPLETE' });
    expect(() => review.review(blocked.session.id, { reviewer: 'Separate test reviewer', independentFromOperator: true, conclusion: 'accepted' })).toThrow(/verified protected outcome/);
  });
  it('rejects build/source mismatches and stale approved contracts', async () => {
    const wrong = { ...payload(), candidateDigest: '0'.repeat(64) };
    await expect(review.start(wrong)).rejects.toMatchObject({ code: 'CAPTURE_BINDING_MISMATCH' });
    const attempt = await imported();
    const protectedSession = await host.getSession(attempt.attempt.fixtureSessionId); protectedSession.sourceDigest = '0'.repeat(64);
    await expect(review.verify(attempt.session.id)).rejects.toMatchObject({ code: 'CAPTURE_BINDING_MISMATCH' });
    expect(captures.read(attempt.session.id).backendOutcomeVerified).toBe(false);
    run.contract = createContract(build.fixtureId); store.put('run', run.id, run);
    await expect(review.verify(attempt.session.id)).rejects.toMatchObject({ code: 'STALE_CONTRACT' });
    expect(() => review.review(attempt.session.id, { reviewer: 'Separate test reviewer', independentFromOperator: true, conclusion: 'needs-follow-up' })).toThrow(/contract changed/);
  });
  it('requires a separately named reviewer and labels independence as attested', async () => {
    const attempt = await imported(); await book(attempt.attempt.fixtureSessionId); await review.verify(attempt.session.id);
    expect(() => review.review(attempt.session.id, { reviewer: ' private  test OPERATOR ', independentFromOperator: true, conclusion: 'accepted' })).toThrow(/differ from the operator/);
    expect(() => captureReviewDecisionSchema.parse({ reviewer: 'Separate reviewer', independentFromOperator: false, conclusion: 'accepted' })).toThrow();
    const reviewed = review.review(attempt.session.id, { reviewer: 'Private Separate Reviewer', independentFromOperator: true, conclusion: 'accepted', notes: 'Private reviewer notes' });
    expect(reviewed.independentlyReviewed).toBe(true);
    expect(reviewed.review).toMatchObject({ classification: 'reviewer-attested-independence', authenticatedIdentityVerified: false });
    const exported = JSON.stringify(captures.evidence(run.id));
    for (const privateValue of ['Private test participant', 'Private Test Operator', 'Private Separate Reviewer', 'Private reviewer notes', 'Fictional attendee']) expect(exported).not.toContain(privateValue);
    expect(exported).toContain('reviewer-attested-independence'); expect(exported).toContain('protected-session-outcome');
  });
  it('revokes all capture-owned outcome/review fields and derived exports on deletion', async () => {
    const attempt = await imported(); await book(attempt.attempt.fixtureSessionId); await review.verify(attempt.session.id);
    review.review(attempt.session.id, { reviewer: 'Private Separate Reviewer', independentFromOperator: true, conclusion: 'accepted', notes: 'Private reviewer notes' });
    const artifact = store.artifact(JSON.stringify(captures.evidence(run.id))); captures.linkExport([attempt.session.id], artifact.digest);
    captures.delete(attempt.session.id);
    const tombstone = store.get<AssistiveSession>('capture', attempt.session.id)!;
    expect(tombstone.outcomeBinding).toBeUndefined(); expect(tombstone.review).toBeUndefined();
    expect(tombstone.backendOutcomeVerified).toBe(false); expect(tombstone.independentlyReviewed).toBe(false);
    const text = JSON.stringify(tombstone);
    for (const privateValue of ['Private test participant', 'Private Test Operator', 'Private Separate Reviewer', 'Private reviewer notes', 'Fictional attendee', attempt.attempt.fixtureSessionId]) expect(text).not.toContain(privateValue);
    await expect(review.verify(attempt.session.id)).rejects.toMatchObject({ code: 'CAPTURE_REVOKED' });
    expect(() => review.review(attempt.session.id, { reviewer: 'Another reviewer', independentFromOperator: true, conclusion: 'accepted' })).toThrow(/revoked/);
    expect(() => store.readArtifact(artifact.digest)).toThrow(/revoked/);
  });
  it('rejects verify-before-import, legacy unbound captures and unrelated start JSON', async () => {
    const started = await review.start(payload());
    await expect(review.verify(started.session.id)).rejects.toMatchObject({ code: 'CAPTURE_NOT_IMPORTED' });
    expect(() => captureReviewStartSchema.parse({ ...payload(), independentExpert: true })).toThrow();
    const attempt = await imported();
    const stored = store.get<AssistiveSession>('capture', attempt.session.id)!; delete stored.outcomeBinding; store.put('capture', stored.id, stored);
    await expect(review.verify(stored.id)).rejects.toMatchObject({ code: 'CAPTURE_ATTEMPT_UNBOUND' });
  });
});
