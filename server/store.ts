import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type {
  AppSettings,
  InteractionContract,
  Journey,
  RepairRun,
  RunEvent,
  RunStatus,
} from "../shared/types.js";
import type {
  LiveProvider,
  ProviderPurpose,
  ProviderUsageSummary,
} from "../shared/types.js";

export const sha256 = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
export const now = () => new Date().toISOString();
export const id = (prefix: string) => `${prefix}_${randomUUID()}`;
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode = 400,
  ) {
    super(message);
  }
}
export interface UsageEntry {
  id: string;
  runId: string;
  startedAt: string;
  completedAt: string | null;
  model: string;
  provider?: LiveProvider;
  purpose?: ProviderPurpose;
  reservedUsd: number | null;
  chargedUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  state: "reserved" | "complete" | "uncertain" | "rejected";
  requestId: string | null;
  pricing?: { inputUsdPerMillion: number; outputUsdPerMillion: number } | null;
  servedModel?: string | null;
  reasoningTokens?: number;
  finalOutputDigest?: string;
  completionQualified?: boolean;
  generation?: {
    maxOutputTokens: number;
    timeoutMs: number;
    reasoningEffort?: string;
    thinkingEnabled?: boolean;
    responseFormat?: "json_object" | "prompt_schema";
  };
}
const defaults: AppSettings = {
  highContrast: false,
  reduceMotion: false,
  retentionDays: 30,
  defaultMode: "offline",
};
const active: RunStatus[] = [
  "queued",
  "preparing",
  "reproducing",
  "generating",
  "verifying",
];

/** One local dispatcher owns this WAL database. No private source or credentials are logged. */
export class Store {
  readonly db: DatabaseSync;
  readonly artifactDir: string;
  private listeners = new Set<(event: RunEvent) => void>();
  private pendingEvents: RunEvent[] | null = null;
  private workerToken: string | null = null;
  constructor(readonly root: string) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    this.artifactDir = join(root, "artifacts");
    mkdirSync(this.artifactDir, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(root, "runs.db"));
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA secure_delete=ON;
      CREATE TABLE IF NOT EXISTS entities (kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS contracts (id TEXT NOT NULL,version INTEGER NOT NULL,digest TEXT NOT NULL UNIQUE,data TEXT NOT NULL,PRIMARY KEY(id,version));
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT NOT NULL,data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS events_run ON events(run_id,id);
      CREATE TABLE IF NOT EXISTS idempotency (key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS usage (id TEXT PRIMARY KEY,data TEXT NOT NULL);`);
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    this.pendingEvents = [];
    let result: T;
    let events: RunEvent[];
    try {
      result = fn();
      this.db.exec("COMMIT");
      events = this.pendingEvents;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    } finally {
      this.pendingEvents = null;
    }
    for (const event of events) this.notify(event);
    return result;
  }
  get<T>(kind: string, entityId: string): T | undefined {
    const row = this.db
      .prepare("SELECT data FROM entities WHERE kind=? AND id=?")
      .get(kind, entityId) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }
  list<T>(kind: string): T[] {
    return (
      this.db
        .prepare("SELECT data FROM entities WHERE kind=? ORDER BY rowid DESC")
        .all(kind) as { data: string }[]
    ).map((row) => JSON.parse(row.data));
  }
  put(kind: string, entityId: string, entity: unknown) {
    this.db
      .prepare(
        "INSERT INTO entities VALUES (?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data",
      )
      .run(kind, entityId, JSON.stringify(entity));
  }
  run(runId: string): RepairRun {
    const run = this.get<RepairRun>("run", runId);
    if (!run)
      throw new AppError(
        "RUN_NOT_FOUND",
        "This repair run does not exist.",
        404,
      );
    run.events = this.events(runId);
    return run;
  }
  saveRun(run: RepairRun) {
    const { events: _, ...rest } = run;
    this.put("run", run.id, { ...rest, events: [] });
  }
  runs(): RepairRun[] {
    return this.list<RepairRun>("run").map((run) => this.run(run.id));
  }
  journey(journeyId: string): Journey {
    const journey = this.get<Journey>("journey", journeyId);
    if (!journey)
      throw new AppError(
        "JOURNEY_NOT_FOUND",
        "This journey does not exist.",
        404,
      );
    return journey;
  }
  contract(contractId: string): InteractionContract {
    const row = this.db
      .prepare(
        "SELECT data FROM contracts WHERE id=? ORDER BY version DESC LIMIT 1",
      )
      .get(contractId) as { data: string } | undefined;
    if (!row)
      throw new AppError(
        "CONTRACT_NOT_FOUND",
        "This interaction contract does not exist.",
        404,
      );
    return JSON.parse(row.data);
  }
  saveContract(contract: InteractionContract) {
    this.db
      .prepare("INSERT INTO contracts VALUES (?,?,?,?)")
      .run(
        contract.id,
        contract.version,
        contract.digest,
        JSON.stringify(contract),
      );
  }
  event(
    runId: string,
    stage: RunStatus,
    message: string,
    detail?: string,
  ): RunEvent {
    const event = {
      runId,
      at: now(),
      stage,
      message,
      ...(detail ? { detail } : {}),
    };
    const inserted = this.db
      .prepare("INSERT INTO events(run_id,data) VALUES (?,?)")
      .run(runId, JSON.stringify(event));
    const full = { ...event, id: Number(inserted.lastInsertRowid) };
    if (this.pendingEvents) this.pendingEvents.push(full);
    else this.notify(full);
    return full;
  }
  private notify(event: RunEvent) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* A disconnected reader cannot invalidate committed work. */
      }
    }
  }
  events(runId: string, after = 0): RunEvent[] {
    return (
      this.db
        .prepare(
          "SELECT id,data FROM events WHERE run_id=? AND id>? ORDER BY id",
        )
        .all(runId, after) as { id: number; data: string }[]
    ).map((row) => ({ ...JSON.parse(row.data), id: row.id }));
  }
  subscribe(listener: (event: RunEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  artifact(content: string | Buffer): { digest: string; path: string } {
    const digest = sha256(content);
    const path = join(this.artifactDir, digest);
    if (this.get("revoked-artifact", digest))
      throw new AppError(
        "ARTIFACT_REVOKED",
        "This derived artifact was revoked because its private capture was deleted.",
        410,
      );
    try {
      writeFileSync(path, content, { flag: "wx", mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (sha256(readFileSync(path)) !== digest)
        throw new AppError(
          "ARTIFACT_CORRUPTED",
          "Stored artifact failed its integrity check.",
          500,
        );
    }
    return { digest, path };
  }
  readArtifact(digest: string): Buffer {
    if (!/^[a-f0-9]{64}$/.test(digest))
      throw new AppError(
        "ARTIFACT_NOT_FOUND",
        "This artifact does not exist.",
        404,
      );
    if (this.get("revoked-artifact", digest))
      throw new AppError(
        "ARTIFACT_REVOKED",
        "This derived artifact was revoked because its private capture was deleted.",
        410,
      );
    let value: Buffer;
    try {
      value = readFileSync(join(this.artifactDir, digest));
    } catch {
      throw new AppError(
        "ARTIFACT_NOT_FOUND",
        "This artifact does not exist.",
        404,
      );
    }
    if (sha256(value) !== digest)
      throw new AppError(
        "ARTIFACT_CORRUPTED",
        "Stored artifact failed its integrity check.",
        500,
      );
    return value;
  }
  revokeArtifact(digest: string) {
    if (!/^[a-f0-9]{64}$/.test(digest))
      throw new AppError(
        "INVALID_ARTIFACT_DIGEST",
        "The artifact digest is invalid.",
      );
    this.put("revoked-artifact", digest, {
      at: now(),
      reason: "dependent-private-capture-revoked",
    });
    rmSync(join(this.artifactDir, digest), { force: true });
  }
  settings(): AppSettings {
    return this.get<AppSettings>("settings", "local") ?? defaults;
  }
  saveSettings(settings: AppSettings) {
    this.put("settings", "local", settings);
  }
  idempotent<T>(key: string | undefined, fingerprint: string, fn: () => T): T {
    if (!key) return this.transaction(fn);
    if (key.length > 128)
      throw new AppError(
        "INVALID_IDEMPOTENCY_KEY",
        "Use an idempotency key of at most 128 characters.",
      );
    return this.transaction(() => {
      const row = this.db
        .prepare("SELECT fingerprint,data FROM idempotency WHERE key=?")
        .get(key) as { fingerprint: string; data: string } | undefined;
      if (row) {
        if (row.fingerprint !== fingerprint)
          throw new AppError(
            "IDEMPOTENCY_CONFLICT",
            "This idempotency key was already used for a different request.",
            409,
          );
        return JSON.parse(row.data);
      }
      const result = fn();
      this.db
        .prepare("INSERT INTO idempotency VALUES (?,?,?)")
        .run(key, fingerprint, JSON.stringify(result));
      return result;
    });
  }
  usage(): UsageEntry[] {
    return (
      this.db.prepare("SELECT data FROM usage ORDER BY rowid").all() as {
        data: string;
      }[]
    ).map((row) => JSON.parse(row.data));
  }
  saveUsage(entry: UsageEntry) {
    this.db
      .prepare(
        "INSERT INTO usage VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(entry.id, JSON.stringify(entry));
  }
  committedSpend(provider?: LiveProvider): number {
    return this.usage()
      .filter((entry) => !provider || (entry.provider ?? "nebius") === provider)
      .reduce((sum, entry) => sum + (entry.chargedUsd ?? 0), 0);
  }
  providerUsage(provider: LiveProvider): ProviderUsageSummary {
    const entries = this.usage().filter(
      (entry) => (entry.provider ?? "nebius") === provider,
    );
    const knownEstimatedUsd = entries.reduce(
      (sum, entry) => sum + (entry.chargedUsd ?? 0),
      0,
    );
    const unknownCostCalls = entries.filter(
      (entry) => entry.chargedUsd === null,
    ).length;
    return {
      provider,
      purpose: provider === "nebius" ? "submission" : "development",
      budgetUsd: provider === "nebius" ? 2 : null,
      committedUsd: unknownCostCalls ? null : knownEstimatedUsd,
      knownEstimatedUsd,
      calls: entries.length,
      inputTokens: entries.reduce(
        (sum, entry) => sum + (entry.inputTokens ?? 0),
        0,
      ),
      outputTokens: entries.reduce(
        (sum, entry) => sum + (entry.outputTokens ?? 0),
        0,
      ),
      unknownCostCalls,
      unknownUsageCalls: entries.filter(
        (entry) =>
          entry.state !== "rejected" &&
          (entry.inputTokens === null || entry.outputTokens === null),
      ).length,
    };
  }
  claimWorker(): () => void {
    const token = id("worker-owner");
    this.transaction(() => {
      const owner = this.get<{ pid: number; token: string }>(
        "worker",
        "local-owner",
      );
      if (owner) {
        let alive = true;
        if (!Number.isSafeInteger(owner.pid) || owner.pid < 1)
          throw new AppError(
            "INVALID_WORKER_OWNER",
            "The local worker ownership record is invalid. Inspect it before restarting.",
            503,
          );
        try {
          process.kill(owner.pid, 0);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ESRCH") alive = false;
        }
        if (alive)
          throw new AppError(
            "WORKER_ALREADY_RUNNING",
            "Another local worker owns this data directory. Stop it before starting a second API process.",
            409,
          );
      }
      this.put("worker", "local-owner", {
        pid: process.pid,
        token,
        startedAt: now(),
      });
      this.workerToken = token;
    });
    return () => this.releaseWorker();
  }
  private releaseWorker() {
    if (!this.workerToken) return;
    const token = this.workerToken;
    this.transaction(() => {
      if (this.get<{ token: string }>("worker", "local-owner")?.token === token)
        this.db
          .prepare("DELETE FROM entities WHERE kind=? AND id=?")
          .run("worker", "local-owner");
    });
    this.workerToken = null;
  }
  recover(): number {
    let count = 0;
    this.transaction(() => {
      for (const run of this.runs())
        if (active.includes(run.status)) {
          run.status = run.cancellationRequested
            ? "cancelled"
            : "environment_error";
          run.updatedAt = now();
          run.error = run.cancellationRequested
            ? null
            : {
                code: "WORKER_RESTARTED",
                message:
                  "The local worker restarted before this stage completed. Retry creates a new run and preserves completed evidence.",
                retryable: true,
              };
          this.saveRun(run);
          this.event(
            run.id,
            run.status,
            "Interrupted work recovered; no unfinished check was accepted.",
          );
          count++;
        }
      for (const entry of this.usage())
        if (entry.state === "reserved")
          this.saveUsage({ ...entry, state: "uncertain", completedAt: now() });
    });
    return count;
  }
  close() {
    this.releaseWorker();
    this.listeners.clear();
    this.db.close();
  }
}
