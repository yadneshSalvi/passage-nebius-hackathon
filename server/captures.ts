import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { AppError, Store, id, now, sha256 } from "./store.js";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const short = z.string().trim().min(1).max(200);
export const captureCreateSchema = z
  .object({
    runId: short,
    candidateDigest: digest,
    buildId: short,
    contractDigest: digest,
    participant: short,
    operator: short,
    os: short,
    browser: short,
    assistiveTechnology: short,
    inputMode: z.literal("keyboard"),
    locale: z.enum(["en", "de"]),
    consent: z.literal(true),
    consentScope: z.literal("private-study"),
    clockOffsetMs: z.number().int().min(-86400000).max(86400000).optional(),
  })
  .strict();
export const captureImportSchema = z
  .object({
    importToken: z.string().regex(/^[a-f0-9]{64}$/),
    candidateDigest: digest,
    buildId: short,
    contractDigest: digest,
    completion: z.enum(["completed", "blocked", "stopped"]),
    elapsedMs: z.number().int().nonnegative().max(86400000),
    interventions: z.number().int().nonnegative().max(1000),
    operatorAttestation: z.literal(true),
    artifacts: z
      .array(
        z
          .object({
            name: z
              .string()
              .trim()
              .min(1)
              .max(100)
              .regex(/^[\w .-]+$/),
            evidenceType: z.enum([
              "operator-notes",
              "speech-viewer-transcript",
            ]),
            content: z.string().min(1).max(20000),
            sha256: digest,
          })
          .strict(),
      )
      .min(1)
      .max(4),
  })
  .strict();
type CaptureCreate = z.infer<typeof captureCreateSchema>;
type CaptureImport = z.infer<typeof captureImportSchema>;
type Status =
  | "pending"
  | "imported"
  | "revoked"
  | "deletion_pending"
  | "deleted"
  | "expired";
export interface CaptureOutcomeBinding {
  fixtureSessionId: string; buildId: string; sourceDigest: string; contractDigest: string;
  createdAt: string; intended: { date: string; attendee: string; service: string };
  status: "awaiting-attempt" | "verified" | "mismatch" | "incomplete";
  verifiedAt?: string; outcomeDigest?: string; outcomeId?: string; failureCode?: string;
}
export interface CaptureReviewDecision {
  reviewer: string; reviewedAt: string; independentFromOperatorAttestation: true;
  classification: "reviewer-attested-independence"; authenticatedIdentityVerified: false;
  conclusion: "accepted" | "needs-follow-up"; notes?: string;
}
export interface AssistiveSession {
  id: string;
  runId: string;
  candidateDigest: string;
  buildId: string;
  contractDigest: string;
  createdAt: string;
  expiresAt: string;
  importedAt: string | null;
  revokedAt: string | null;
  status: Status;
  independentlyReviewed: boolean;
  backendOutcomeVerified: boolean;
  outcomeBinding?: CaptureOutcomeBinding;
  review?: CaptureReviewDecision;
  evidenceType: "operator-attested-assistive-session";
  metadata: Omit<
    CaptureCreate,
    "runId" | "candidateDigest" | "buildId" | "contractDigest"
  > | null;
  result: {
    completion: CaptureImport["completion"];
    elapsedMs: number;
    interventions: number;
    operatorAttestation: true;
  } | null;
  artifacts: {
    name: string;
    digest: string;
    mediaType: "text/plain";
    evidenceType: "operator-notes" | "speech-viewer-transcript";
    url: string;
    bytes: number;
  }[];
  limitations: string[];
  importTokenHash?: string;
}
const limitations = [
  "The operator attests the build and actual assistive-technology output; there is no automated screen-reader recording or independent review.",
  "No participant outcome is independently established by this capture. Backend outcome verification for the human session is pending.",
  "Capture supports private UTF-8 text only. Video, audio, public publication and external backup deletion are not implemented.",
  "Downloaded copies and operating-system backups are outside this local application’s control.",
];

export class Captures {
  constructor(private store: Store) {
    this.purgeExpired();
  }
  private safe(session: AssistiveSession): AssistiveSession {
    const { importTokenHash: _, ...value } = session;
    return value;
  }
  private get(sessionId: string): AssistiveSession {
    if (!/^assistive_[a-f0-9-]{36}$/.test(sessionId))
      throw new AppError(
        "CAPTURE_NOT_FOUND",
        "This capture session does not exist.",
        404,
      );
    const session = this.store.get<AssistiveSession>("capture", sessionId);
    if (!session)
      throw new AppError(
        "CAPTURE_NOT_FOUND",
        "This capture session does not exist.",
        404,
      );
    return session;
  }
  private audit(session: AssistiveSession, action: string) {
    const auditId = id("capture-audit");
    this.store.put("capture-audit", auditId, {
      id: auditId,
      sessionId: session.id,
      runId: session.runId,
      at: now(),
      action,
    });
  }
  private active(session: AssistiveSession) {
    if (
      session.expiresAt <= now() ||
      !["pending", "imported"].includes(session.status)
    )
      throw new AppError(
        "CAPTURE_REVOKED",
        "This private capture was revoked, expired or deleted. Its content is unavailable.",
        410,
      );
  }
  create(input: CaptureCreate): {
    session: AssistiveSession;
    importToken: string;
  } {
    const run = this.store.run(input.runId);
    const candidate = run.candidates.find(
      (value) =>
        value.digest === input.candidateDigest &&
        value.id === run.activeCandidateId &&
        value.status === "accepted",
    );
    if (
      !candidate ||
      run.isStale ||
      run.contract.digest !== input.contractDigest ||
      candidate.buildId !== input.buildId
    )
      throw new AppError(
        "CAPTURE_BINDING_MISMATCH",
        "Create a capture for the exact accepted candidate, build and current contract digests.",
        409,
      );
    const { runId, candidateDigest, buildId, contractDigest, ...metadata } =
      input;
    const importToken = randomBytes(32).toString("hex");
    const timestamp = now();
    const session: AssistiveSession = {
      id: id("assistive"),
      runId,
      candidateDigest,
      buildId,
      contractDigest,
      createdAt: timestamp,
      expiresAt: new Date(
        Date.now() + this.store.settings().retentionDays * 86400000,
      ).toISOString(),
      importedAt: null,
      revokedAt: null,
      status: "pending",
      independentlyReviewed: false,
      backendOutcomeVerified: false,
      evidenceType: "operator-attested-assistive-session",
      metadata,
      result: null,
      artifacts: [],
      limitations,
      importTokenHash: sha256(importToken),
    };
    this.store.transaction(() => {
      this.store.put("capture", session.id, session);
      this.audit(session, "created-with-private-consent");
    });
    return { session: this.safe(session), importToken };
  }
  list(runId?: string) {
    this.purgeExpired();
    return this.store
      .list<AssistiveSession>("capture")
      .filter((value) => !runId || value.runId === runId)
      .map((value) => this.safe(value));
  }
  evidence(runId: string) {
    const sessions = this.list(runId);
    return {
      assistiveCaptureSummary: {
        imported: sessions.filter((value) => value.status === "imported")
          .length,
        pending: sessions.filter((value) => value.status === "pending").length,
        revokedOrExpired: sessions.filter(
          (value) => !["pending", "imported"].includes(value.status),
        ).length,
        independentlyReviewed: sessions.filter(value => value.status === "imported" && value.independentlyReviewed).length,
        backendOutcomeVerified: sessions.filter(value => value.status === "imported" && value.backendOutcomeVerified).length,
      },
      assistiveSessions: sessions.map((value) => ({
        id: value.id,
        status: value.status,
        candidateDigest: value.candidateDigest,
        buildId: value.buildId,
        contractDigest: value.contractDigest,
        createdAt: value.createdAt,
        expiresAt: value.expiresAt,
        importedAt: value.importedAt,
        revokedAt: value.revokedAt,
        evidenceType: value.evidenceType,
        independentlyReviewed: value.independentlyReviewed,
        backendOutcomeVerified: value.backendOutcomeVerified,
        reviewEvidenceClass: value.review?.classification ?? "not-reviewed",
        reviewConclusion: value.review?.conclusion ?? null,
        authenticatedReviewerIdentityVerified: false,
        outcomeEvidenceClass: value.backendOutcomeVerified ? "protected-session-outcome" : "unverified",
        outcomeBindingSummary: value.outcomeBinding ? { status: value.outcomeBinding.status, createdAt: value.outcomeBinding.createdAt, verifiedAt: value.outcomeBinding.verifiedAt ?? null } : null,
        privateContentIncluded: false,
        artifacts: value.artifacts.map((artifact) => ({
          digest: artifact.digest,
          evidenceType: artifact.evidenceType,
          mediaType: artifact.mediaType,
          url: artifact.url,
        })),
        limitations: value.limitations,
      })),
    };
  }
  linkExport(sessionIds: string[], artifactDigest: string) {
    if (sessionIds.length)
      this.store.put("capture-export", artifactDigest, {
        artifactDigest,
        sessionIds,
      });
  }
  read(sessionId: string) {
    this.purgeExpired();
    return this.safe(this.get(sessionId));
  }
  import(sessionId: string, input: CaptureImport) {
    this.purgeExpired();
    const session = this.get(sessionId);
    this.active(session);
    if (session.status !== "pending" || !session.importTokenHash)
      throw new AppError(
        "CAPTURE_ALREADY_IMPORTED",
        "The one-time capture import was already consumed.",
        409,
      );
    if (
      !timingSafeEqual(
        Buffer.from(session.importTokenHash, "hex"),
        Buffer.from(sha256(input.importToken), "hex"),
      )
    )
      throw new AppError(
        "INVALID_CAPTURE_TOKEN",
        "The capture import token does not match this session.",
        403,
      );
    if (
      input.candidateDigest !== session.candidateDigest ||
      input.contractDigest !== session.contractDigest ||
      input.buildId !== session.buildId
    )
      throw new AppError(
        "CAPTURE_BINDING_MISMATCH",
        "The imported manifest must match the session’s exact candidate, build and contract digests.",
        409,
      );
    const run = this.store.run(session.runId);
    if (run.isStale || run.contract.digest !== session.contractDigest)
      throw new AppError(
        "STALE_CONTRACT",
        "The contract changed during capture. Create a new session against the current accepted revision.",
        409,
      );
    if (
      new Set(input.artifacts.map((value) => value.name)).size !==
      input.artifacts.length
    )
      throw new AppError(
        "DUPLICATE_CAPTURE_ARTIFACT",
        "Each capture artifact needs a distinct name.",
      );
    for (const artifact of input.artifacts)
      if (sha256(artifact.content) !== artifact.sha256)
        throw new AppError(
          "CAPTURE_DIGEST_MISMATCH",
          "A text artifact did not match the digest in the import manifest.",
        );
    const folder = join(this.store.root, "captures", session.id);
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    try {
      for (const artifact of input.artifacts) {
        const path = join(folder, artifact.sha256);
        try {
          writeFileSync(path, artifact.content, { flag: "wx", mode: 0o600 });
        } catch (error) {
          if (
            (error as NodeJS.ErrnoException).code !== "EEXIST" ||
            sha256(readFileSync(path)) !== artifact.sha256
          )
            throw error;
        }
        session.artifacts.push({
          name: artifact.name,
          digest: artifact.sha256,
          mediaType: "text/plain",
          evidenceType: artifact.evidenceType,
          url: `/v1/assistive-sessions/${session.id}/artifacts/${artifact.sha256}`,
          bytes: Buffer.byteLength(artifact.content),
        });
      }
      session.result = {
        completion: input.completion,
        elapsedMs: input.elapsedMs,
        interventions: input.interventions,
        operatorAttestation: true,
      };
      session.status = "imported";
      session.importedAt = now();
      delete session.importTokenHash;
      this.store.transaction(() => {
        this.store.put("capture", session.id, session);
        this.audit(session, "private-text-imported-operator-attested");
      });
    } catch (error) {
      rmSync(folder, { recursive: true, force: true });
      throw error;
    }
    return this.safe(session);
  }
  artifact(sessionId: string, artifactDigest: string): Buffer {
    this.purgeExpired();
    const session = this.get(sessionId);
    this.active(session);
    if (
      !/^[a-f0-9]{64}$/.test(artifactDigest) ||
      !session.artifacts.some((value) => value.digest === artifactDigest)
    )
      throw new AppError(
        "CAPTURE_ARTIFACT_NOT_FOUND",
        "This private text artifact does not exist in the capture.",
        404,
      );
    let content: Buffer;
    try {
      content = readFileSync(
        join(this.store.root, "captures", session.id, artifactDigest),
      );
    } catch {
      throw new AppError(
        "CAPTURE_ARTIFACT_UNAVAILABLE",
        "This private text artifact is no longer available.",
        410,
      );
    }
    if (sha256(content) !== artifactDigest)
      throw new AppError(
        "CAPTURE_ARTIFACT_CORRUPTED",
        "The private text artifact failed its integrity check.",
        500,
      );
    return content;
  }
  delete(sessionId: string, reason: "deleted" | "expired" = "deleted") {
    const session = this.get(sessionId);
    if (["deleted", "expired"].includes(session.status))
      return this.safe(session);
    // Revoke access before touching files. Keep no transcript, names, notes or token in the tombstone.
    session.revokedAt ??= now();
    session.status = "revoked";
    session.metadata = null;
    session.result = null;
    session.artifacts = [];
    delete session.importTokenHash;
    delete session.outcomeBinding;
    delete session.review;
    session.backendOutcomeVerified = false;
    session.independentlyReviewed = false;
    this.store.put("capture", session.id, session);
    this.audit(
      session,
      reason === "expired"
        ? "retention-expired-content-revoked"
        : "deletion-requested-content-revoked",
    );
    try {
      rmSync(join(this.store.root, "captures", session.id), {
        recursive: true,
        force: true,
      });
      for (const exported of this.store.list<{
        artifactDigest: string;
        sessionIds: string[];
      }>("capture-export"))
        if (exported.sessionIds.includes(session.id))
          this.store.revokeArtifact(exported.artifactDigest);
      session.status = reason;
    } catch {
      session.status = "deletion_pending";
    }
    this.store.put("capture", session.id, session);
    this.audit(
      session,
      session.status === "deletion_pending"
        ? "controlled-file-deletion-pending"
        : "controlled-files-removed",
    );
    // Flush the active WAL; external filesystem snapshots/backups are explicitly out of scope.
    this.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    return this.safe(session);
  }
  purgeExpired() {
    for (const session of this.store.list<AssistiveSession>("capture")) {
      if (session.status === "deletion_pending") this.delete(session.id);
      else if (
        ["pending", "imported"].includes(session.status) &&
        session.expiresAt <= now()
      )
        this.delete(session.id, "expired");
    }
  }
  status() {
    this.purgeExpired();
    const sessions = this.list();
    return {
      retentionDays: this.store.settings().retentionDays,
      sessions: sessions.length,
      active: sessions.filter((value) =>
        ["pending", "imported"].includes(value.status),
      ).length,
      deleted: sessions.filter((value) => value.status === "deleted").length,
      expired: sessions.filter((value) => value.status === "expired").length,
      pendingDeletion: sessions.filter(
        (value) => value.status === "deletion_pending",
      ).length,
      audits: this.store.list("capture-audit"),
      limitations,
    };
  }
}
