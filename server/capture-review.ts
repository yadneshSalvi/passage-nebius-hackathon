import { z } from 'zod';
import { Captures, captureCreateSchema, type AssistiveSession, type CaptureOutcomeBinding } from './captures.js';
import { AppError, Store, id, now, sha256 } from './store.js';
import type { FixtureHost } from '../engine/host.js';
import { scenarioDefinitions } from '../engine/catalog.js';

const name = z.string().trim().min(1).max(200);
export const captureReviewStartSchema = captureCreateSchema.extend({
  intended: z.strictObject({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), attendee: name.max(80), service: name }),
}).strict();
export const captureReviewDecisionSchema = z.strictObject({
  reviewer: name, independentFromOperator: z.literal(true),
  conclusion: z.enum(['accepted', 'needs-follow-up']), notes: z.string().trim().max(4000).optional(),
});
export const captureReviewVerifySchema = z.strictObject({});
export type CaptureReviewStart = z.infer<typeof captureReviewStartSchema>;
export type CaptureReviewInput = z.infer<typeof captureReviewDecisionSchema>;
const normalizedName = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase('en').replace(/\s+/g, ' ');

/** Ready intake workflow. No method creates participant observations or fabricates a review. */
export class CaptureReview {
  constructor(private store: Store, private captures: Captures, private host: FixtureHost) {}
  private session(captureId: string) {
    const session = this.captures.read(captureId);
    if (!['pending', 'imported'].includes(session.status) || session.expiresAt <= now() || !session.metadata)
      throw new AppError('CAPTURE_REVOKED', 'This private capture is revoked, deleted or expired.', 410);
    return session;
  }
  private current(session: AssistiveSession) {
    const run = this.store.run(session.runId);
    if (run.isStale || run.contract.digest !== session.contractDigest)
      throw new AppError('STALE_CONTRACT', 'The capture contract changed. Start a fresh accepted-revision attempt.', 409);
    const candidate = run.candidates.find(value => value.id === run.activeCandidateId && value.status === 'accepted' && value.digest === session.candidateDigest && value.buildId === session.buildId);
    if (!candidate) throw new AppError('CAPTURE_BINDING_MISMATCH', 'This capture no longer matches the exact accepted candidate and build.', 409);
    return run;
  }
  private save(session: AssistiveSession, action: string) {
    this.store.transaction(() => {
      // Preserve the one-time token hash, which Captures.read intentionally omits.
      const stored = this.store.get<AssistiveSession>('capture', session.id)!;
      this.store.put('capture', session.id, { ...session, ...(stored.importTokenHash ? { importTokenHash: stored.importTokenHash } : {}) });
      const auditId = id('capture-audit');
      this.store.put('capture-audit', auditId, { id: auditId, sessionId: session.id, runId: session.runId, at: now(), action });
    });
  }
  async start(raw: CaptureReviewStart) {
    const { intended, ...creation } = captureReviewStartSchema.parse(raw);
    // Captures.create repeats accepted-candidate and current-contract validation after these awaits.
    const run = this.store.run(creation.runId);
    const candidate = run.candidates.find(value => value.id === run.activeCandidateId && value.status === 'accepted' && value.digest === creation.candidateDigest && value.buildId === creation.buildId);
    if (!candidate || run.isStale || run.contract.digest !== creation.contractDigest)
      throw new AppError('CAPTURE_BINDING_MISMATCH', 'Start with the exact accepted build and current contract.', 409);
    const build = await this.host.getBuild(creation.buildId);
    if (build.digest !== creation.candidateDigest || build.fixtureId !== run.fixtureId || intended.service !== build.fixtureId)
      throw new AppError('CAPTURE_BINDING_MISMATCH', 'Protected build, source and intended service must match the accepted revision.', 409);
    const scenario = candidate.verification?.scenario ?? scenarioDefinitions[0];
    const attempt = await this.host.createSession(build, scenario);
    if (attempt.buildId !== build.id || attempt.sourceDigest !== build.digest || attempt.fixtureId !== build.fixtureId || attempt.outcome !== null)
      throw new AppError('CAPTURE_BINDING_MISMATCH', 'A new empty protected application session is required before the operator attempt.', 409);
    if (!attempt.choices.some(choice => choice.date === intended.date && !choice.unavailable))
      throw new AppError('CAPTURE_INTENT_INVALID', 'The explicit intended date must be a valid available choice in this fresh application session.', 409);
    const created = this.captures.create(creation);
    const binding: CaptureOutcomeBinding = { fixtureSessionId: attempt.id, buildId: build.id, sourceDigest: build.digest, contractDigest: creation.contractDigest, createdAt: attempt.createdAt, intended, status: 'awaiting-attempt' };
    created.session.outcomeBinding = binding;
    this.save(created.session, 'fresh-protected-operator-attempt-bound');
    return { session: this.captures.read(created.session.id), importToken: created.importToken, attempt: { fixtureSessionId: attempt.id, previewUrl: `${this.host.origin}/s/${attempt.id}`, buildId: build.id, sourceDigest: build.digest, contractDigest: creation.contractDigest, intended } };
  }
  async verify(captureId: string) {
    const session = this.session(captureId);
    this.current(session);
    if (session.status !== 'imported' || !session.result)
      throw new AppError('CAPTURE_NOT_IMPORTED', 'Import the actual operator-attested attempt before verifying its outcome.', 409);
    const binding = session.outcomeBinding;
    if (!binding) throw new AppError('CAPTURE_ATTEMPT_UNBOUND', 'Legacy captures have no fresh protected operator session. Start a new bound attempt.', 409);
    const observed = await this.host.getSession(binding.fixtureSessionId);
    // Recheck revocation and contract changes after asynchronous protected reads.
    const live = this.session(captureId); this.current(live);
    if (JSON.stringify(live.outcomeBinding) !== JSON.stringify(binding)) throw new AppError('CAPTURE_BINDING_MISMATCH', 'The protected capture binding changed during verification.', 409);
    const identityMatches = observed.id === binding.fixtureSessionId && observed.buildId === binding.buildId && observed.sourceDigest === binding.sourceDigest && observed.fixtureId === binding.intended.service && binding.buildId === session.buildId && binding.sourceDigest === session.candidateDigest && binding.contractDigest === session.contractDigest;
    const outcome = observed.outcome;
    const complete = session.result.completion === 'completed';
    const fieldsMatch = !!outcome && outcome.sessionId === binding.fixtureSessionId && outcome.sourceDigest === binding.sourceDigest && outcome.date === binding.intended.date && outcome.attendee === binding.intended.attendee && outcome.service === binding.intended.service && outcome.createdAt >= binding.createdAt;
    const verified = identityMatches && complete && fieldsMatch;
    const outcomeDigest = outcome ? sha256(JSON.stringify(outcome)) : undefined;
    if (!verified || outcomeDigest !== binding.outcomeDigest) { delete session.review; session.independentlyReviewed = false; }
    session.backendOutcomeVerified = verified;
    binding.status = verified ? 'verified' : !identityMatches || (complete && outcome && !fieldsMatch) ? 'mismatch' : 'incomplete';
    binding.failureCode = verified ? undefined : !identityMatches ? 'CAPTURE_BINDING_MISMATCH' : !complete ? 'CAPTURE_INCOMPLETE' : !outcome ? 'CAPTURE_OUTCOME_ABSENT' : 'CAPTURE_OUTCOME_MISMATCH';
    binding.verifiedAt = verified ? now() : undefined;
    binding.outcomeDigest = verified ? outcomeDigest : undefined;
    binding.outcomeId = verified ? outcome?.id : undefined;
    this.limitations(session); this.save(session, verified ? 'operator-session-protected-outcome-verified' : 'operator-session-outcome-not-verified');
    if (!identityMatches) throw new AppError('CAPTURE_BINDING_MISMATCH', 'The protected operator session failed its exact build/source/session identity check.', 409);
    return { session: this.captures.read(captureId), verification: { verified, status: binding.status, failureCode: binding.failureCode ?? null, authority: 'fresh-protected-operator-session', identityAuthenticated: false } };
  }
  review(captureId: string, raw: CaptureReviewInput) {
    const input = captureReviewDecisionSchema.parse(raw);
    const session = this.session(captureId); this.current(session);
    if (session.status !== 'imported' || !session.result || !session.outcomeBinding)
      throw new AppError('CAPTURE_NOT_IMPORTED', 'Review requires an imported actual attempt bound to its own protected session.', 409);
    if (normalizedName(input.reviewer) === normalizedName(session.metadata!.operator))
      throw new AppError('REVIEWER_NOT_INDEPENDENT', 'The named reviewer must differ from the operator and explicitly attest independence.', 409);
    if (input.conclusion === 'accepted' && (!session.backendOutcomeVerified || session.result.completion !== 'completed'))
      throw new AppError('CAPTURE_OUTCOME_UNVERIFIED', 'An accepted completion review requires this operator attempt’s verified protected outcome.', 409);
    session.review = { reviewer: input.reviewer, reviewedAt: now(), independentFromOperatorAttestation: true, classification: 'reviewer-attested-independence', authenticatedIdentityVerified: false, conclusion: input.conclusion, ...(input.notes ? { notes: input.notes } : {}) };
    session.independentlyReviewed = true;
    this.limitations(session); this.save(session, `private-reviewer-attested-${input.conclusion}`);
    return this.captures.read(captureId);
  }
  private limitations(session: AssistiveSession) {
    session.limitations = [
      'Actual attempt, completion and supplied AT text remain operator-attested; no automatic participant identity or AT authenticity proof is claimed.',
      session.backendOutcomeVerified ? 'The stored outcome was read from the fresh pinned operator session and matched the explicit task fields.' : 'The operator session has no verified matching completed protected outcome.',
      session.review ? 'Review independence is explicitly reviewer-attested; reviewer identity and external independence are not authenticated.' : 'No separate reviewer decision has been recorded.',
      'Private UTF-8 text intake only; no video/audio capture, participant study claim, or publication consent is implied.',
      'Deleting this capture revokes its private outcome binding and review. The protected application retains its business record under its own retention policy.',
      'Downloaded copies and operating-system backups are outside this local application’s control.',
    ];
  }
}
