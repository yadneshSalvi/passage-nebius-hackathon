import { z } from "zod";
import type { ActualATCapture } from "../shared/assistive-capture.js";
import type { RepositoryJourney } from "../shared/repository-journey.js";
import { AppError, Store, id, now, sha256 } from "./store.js";
const short = z.string().min(1).max(300);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const actualATImportSchema = z.object({ content: z.string().min(1).max(250000), sha256: digest, attestedActual: z.literal(true) }).strict();
const receiptSchema = z.object({
  schema: z.literal("passage.actual-at.v1"), buildId: digest, sourceDigest: digest, sessionId: short,
  startedAt: z.string().datetime(), completedAt: z.string().datetime(), provenance: z.literal("automated-actual-screen-reader"),
  screenReader: short, guidepupVersion: short, browser: short, browserVersion: short.optional(), platform: short, compatibility: short.optional(),
  humanParticipant: z.literal(false), independentlyReviewed: z.literal(false), backendOutcomeVerified: z.literal(false),
  protocol: z.string().min(1).max(150).optional(), taskOutcome: z.string().min(1).max(500).optional(),
  steps: z.array(z.object({ action: short, at: z.string().datetime(), spoken: z.string().max(12000),
    focus: z.object({ tag: short, label: z.string().max(500).nullable(), text: z.string().max(3000) }).strict().optional(), actualTitle: z.string().max(3000).optional() }).strict()).min(1).max(200),
  spokenPhraseLog: z.array(z.string().max(12000)).max(500), status: z.enum(["captured", "failed"]), limitations: z.array(z.string().max(2000)).max(40),
}).strict();
/** Validates an explicitly attested runner import, not the identity of its human operator or the runner process. */
export function importActualAT(store: Store, session: RepositoryJourney, raw: unknown): ActualATCapture {
  const input = actualATImportSchema.parse(raw);
  if (sha256(input.content) !== input.sha256) throw new AppError("AT_ARTIFACT_INTEGRITY", "The actual-AT receipt bytes do not match the supplied digest.", 422);
  let parsed: unknown; try { parsed = JSON.parse(input.content); } catch { throw new AppError("INVALID_AT_RECEIPT", "The runner receipt must be JSON.", 422); }
  const receipt = receiptSchema.parse(parsed);
  const builds = [session.build, ...session.replays.map(replay => replay.build)].filter(Boolean);
  if (!builds.some(build => build!.id === receipt.buildId && build!.sourceDigest === receipt.sourceDigest)) throw new AppError("AT_BUILD_MISMATCH", "The speech receipt must match an exact build already recorded for this journey.", 409);
  let previous = Date.parse(receipt.startedAt);
  for (const step of receipt.steps) { const at = Date.parse(step.at); if (at < previous || at > Date.parse(receipt.completedAt)) throw new AppError("AT_TIMELINE_INVALID", "Speech steps must retain their real ordered capture times.", 422); previous = at; }
  if (Date.parse(receipt.completedAt) < Date.parse(receipt.startedAt)) throw new AppError("AT_TIMELINE_INVALID", "Capture completion precedes its start.", 422);
  if (receipt.status === "captured" && !receipt.spokenPhraseLog.some(phrase => phrase.trim())) throw new AppError("AT_SPEECH_ABSENT", "A captured-speech receipt requires actual spoken output. Keep no-speech failures labeled failed.", 422);
  const artifact = store.artifact(input.content);
  return { id: id("actual-at"), createdAt: now(), digest: artifact.digest, receipt, artifactUrl: `/v1/artifacts/${artifact.digest}`,
    evidenceClass: "actual-at-automation", importAttested: true, executionAuthenticated: false, participantCount: 0 };
}
