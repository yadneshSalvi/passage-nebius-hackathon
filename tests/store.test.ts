import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AppError,
  Store,
  now,
  sha256,
  type UsageEntry,
} from "../server/store.js";
import type { RepairRun } from "../shared/types.js";

describe("durable local store", () => {
  let root: string;
  let store: Store;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "passage-store-"));
    store = new Store(root);
  });
  afterEach(() => {
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  it("replays only committed events using durable monotonic cursors", () => {
    const received: number[] = [];
    store.subscribe((event) => received.push(event.id));
    const a = store.event("a", "queued", "first");
    expect(() =>
      store.transaction(() => {
        store.event("a", "preparing", "rolled back");
        throw new Error("failed write");
      }),
    ).toThrow("failed write");
    expect(received).toEqual([a.id]);
    expect(store.events("a")).toHaveLength(1);
    store.transaction(() => {
      store.event("b", "queued", "another run");
      store.event("a", "reproducing", "second");
    });
    const remaining = store.events("a", a.id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBeGreaterThan(a.id);
    store.close();
    store = new Store(root);
    expect(store.events("a", a.id)).toEqual(remaining);
  });
  it("persists idempotency results and rejects changed request bodies", () => {
    let executions = 0;
    const operation = () => {
      executions++;
      store.put("thing", "1", { id: 1 });
      return { id: 1 };
    };
    expect(store.idempotent("create-one", "fingerprint", operation)).toEqual({
      id: 1,
    });
    store.close();
    store = new Store(root);
    expect(store.idempotent("create-one", "fingerprint", operation)).toEqual({
      id: 1,
    });
    expect(executions).toBe(1);
    expect(() =>
      store.idempotent("create-one", "different", operation),
    ).toThrow(AppError);
    expect(executions).toBe(1);
  });
  it("rolls entity writes and idempotency reservation back together", () => {
    expect(() =>
      store.idempotent("failed", "f", () => {
        store.put("thing", "1", true);
        throw new Error("rollback");
      }),
    ).toThrow();
    expect(store.get("thing", "1")).toBeUndefined();
    expect(store.idempotent("failed", "f", () => 4)).toBe(4);
  });
  it("addresses immutable artifacts by their actual bytes and detects corruption", () => {
    const first = store.artifact("fixed source");
    expect(first.digest).toBe(sha256("fixed source"));
    expect(store.artifact("fixed source")).toEqual(first);
    expect(store.readArtifact(first.digest).toString()).toBe("fixed source");
    expect(() => store.readArtifact("../runs.db")).toThrow(AppError);
    writeFileSync(first.path, "tampered");
    expect(() => store.readArtifact(first.digest)).toThrow("integrity");
    expect(() => store.artifact("fixed source")).toThrow("integrity");
  });
  it("revokes private derived exports permanently without resurrecting their content hash", () => {
    const artifact = store.artifact("capture-dependent exported evidence");
    store.revokeArtifact(artifact.digest);
    expect(() => store.readArtifact(artifact.digest)).toThrow("revoked");
    expect(() => store.artifact("capture-dependent exported evidence")).toThrow(
      "revoked",
    );
    store.close();
    store = new Store(root);
    expect(() => store.readArtifact(artifact.digest)).toThrow("revoked");
  });
  it("keeps committed state even if a disconnected event subscriber throws", () => {
    store.subscribe(() => {
      throw new Error("socket closed");
    });
    expect(() =>
      store.transaction(() => {
        store.put("entity", "one", true);
        store.event("run", "queued", "Committed event");
      }),
    ).not.toThrow();
    expect(store.get("entity", "one")).toBe(true);
    expect(store.events("run")).toHaveLength(1);
  });
  it("guards worker ownership before restart recovery and reclaims a dead process", () => {
    const release = store.claimWorker();
    const second = new Store(root);
    expect(() => second.claimWorker()).toThrow("Another local worker");
    expect(store.get<{ pid: number }>("worker", "local-owner")?.pid).toBe(
      process.pid,
    );
    release();
    expect(() => second.claimWorker()).not.toThrow();
    second.close();
    store.put("worker", "local-owner", {
      pid: 2147483647,
      token: "dead-process",
    });
    expect(() => store.claimWorker()).not.toThrow();
  });
  it("marks interrupted work as environment failure and preserves unknown usage reservations", () => {
    const partial = {
      id: "run",
      status: "verifying",
      events: [],
      cancellationRequested: false,
      baseline: { id: "baseline" },
      candidates: [{ id: "retained" }],
      updatedAt: now(),
    } as unknown as RepairRun;
    store.saveRun(partial);
    const usage: UsageEntry = {
      id: "usage",
      runId: partial.id,
      startedAt: now(),
      completedAt: null,
      model: "nvidia/model",
      reservedUsd: 0.01,
      chargedUsd: 0.01,
      inputTokens: null,
      outputTokens: null,
      state: "reserved",
      requestId: null,
    };
    store.saveUsage(usage);
    store.close();
    store = new Store(root);
    expect(store.recover()).toBe(1);
    const recovered = store.run("run");
    expect(recovered.status).toBe("environment_error");
    expect(recovered.error?.code).toBe("WORKER_RESTARTED");
    expect(recovered.baseline?.id).toBe("baseline");
    expect(recovered.candidates[0].id).toBe("retained");
    expect(store.usage()[0].state).toBe("uncertain");
    expect(store.committedSpend()).toBe(0.01);
    expect(store.recover()).toBe(0);
  });
});
