/** Synthetic provider responses only; no paid call is made. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { RepairProvider, MODEL, FIREWORKS_ULTRA_MODEL } from "../server/provider.js";
import { Store, type UsageEntry } from "../server/store.js";

let root: string, store: Store;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "passage-budget-unit-")); store = new Store(root); vi.stubEnv("PASSAGE_NEBIUS_BUDGET_USD", undefined); });
afterEach(() => { vi.unstubAllEnvs(); store.close(); rmSync(root, { recursive: true, force: true }); });
const at = "2026-10-28T00:00:00.000Z";
const historical = (chargedUsd: number): UsageEntry => ({ id: "unit-historical", runId: "unit-history", startedAt: at, completedAt: at,
  provider: "nebius", purpose: "submission", model: MODEL, reservedUsd: chargedUsd, chargedUsd,
  inputTokens: 0, outputTokens: 0, state: "complete", requestId: "unit-historical" });
const fakeFetch = () => vi.fn(async () => new Response(JSON.stringify({ model: MODEL, id: "unit-only", usage: { prompt_tokens: 10, completion_tokens: 10 },
  choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }] })));
const options = (fetcher: typeof fetch) => ({ provider: "nebius" as const, apiKey: "unit-secret", baseUrl: "https://api.tokenfactory.nebius.com/v1", model: MODEL, allowLive: true, fetch: fetcher });
const request = () => ({ runId: "unit-budget", signal: new AbortController().signal, promptVersion: "unit-only", system: "Synthetic unit fixture", payload: {}, schema: z.object({ ok: z.literal(true) }).strict() });

describe("configured Nebius admission budget", () => {
  it("defaults to two dollars and rejects invalid or out-of-bound configuration", () => {
    const fake = fakeFetch();
    expect(new RepairProvider(store, options(fake as typeof fetch)).status().budgetUsd).toBe(2);
    for (const value of ["", "not-money", "Infinity", "NaN", "-1", "100.01"]) {
      vi.stubEnv("PASSAGE_NEBIUS_BUDGET_USD", value);
      expect(() => new RepairProvider(store, options(fake as typeof fetch))).toThrow(/finite amount from \$0 to \$100/);
    }
    vi.stubEnv("PASSAGE_NEBIUS_BUDGET_USD", "0");
    expect(new RepairProvider(store, options(fake as typeof fetch)).status()).toMatchObject({ budgetUsd: 0, enabled: false });
    expect(fake).not.toHaveBeenCalled();
  });
  it("uses the explicitly configured four-dollar cap without rewriting history and records the admission cap", async () => {
    const previous = historical(2.5); store.saveUsage(previous);
    const fake = fakeFetch();
    expect(new RepairProvider(store, options(fake as typeof fetch)).status().enabled).toBe(false);
    vi.stubEnv("PASSAGE_NEBIUS_BUDGET_USD", "4");
    const provider = new RepairProvider(store, options(fake as typeof fetch));
    expect(provider.status()).toMatchObject({ budgetUsd: 4, committedUsd: 2.5, enabled: true });
    expect(provider.usage()).toMatchObject({ budgetUsd: 4, providers: { nebius: { budgetUsd: 4 } } });
    await provider.completeStructured(request());
    expect(store.usage()[0]).toEqual(previous);
    expect(store.usage()[1]).toMatchObject({ admissionBudgetUsd: 4, state: "complete" });
    expect(provider.usage().committedUsd).toBeGreaterThan(2.5);
    expect(fake).toHaveBeenCalledTimes(1);
  });
  it("rejects a reservation exceeding the configured cap before a request and leaves development uncapped", async () => {
    store.saveUsage(historical(3.9999)); vi.stubEnv("PASSAGE_NEBIUS_BUDGET_USD", "4");
    const fake = fakeFetch(), provider = new RepairProvider(store, options(fake as typeof fetch));
    await expect(provider.completeStructured(request())).rejects.toMatchObject({ code: "BUDGET_EXCEEDED", statusCode: 402 });
    expect(fake).not.toHaveBeenCalled(); expect(store.usage()).toHaveLength(1);
    const development = new RepairProvider(store, { ...options(fake as typeof fetch), provider: "fireworks", baseUrl: "https://api.fireworks.ai/inference/v1", model: FIREWORKS_ULTRA_MODEL });
    expect(development.status()).toMatchObject({ budgetUsd: null, enabled: true });
    expect(development.usage().providers.nebius.budgetUsd).toBe(4);
  });
});
