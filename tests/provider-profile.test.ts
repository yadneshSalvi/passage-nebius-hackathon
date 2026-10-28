/** Profile qualification unit fixtures use synthetic responses, never live inference. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { RepairProvider, NEBIUS_ULTRA_MODEL } from "../server/provider.js";
import { Store } from "../server/store.js";

let root: string, store: Store;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "passage-profile-unit-")); store = new Store(root); });
afterEach(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
const regional = "https://api.tokenfactory.us-central1.nebius.com/v1";
const request = () => ({ runId: "unit-profile", signal: new AbortController().signal, promptVersion: "synthetic-unit-profile", system: "Synthetic unit fixture", payload: {}, schema: z.object({ ok: z.literal(true) }).strict() });
function create(fetcher: typeof fetch, baseUrl = regional) { return new RepairProvider(store, { provider: "nebius", model: NEBIUS_ULTRA_MODEL, baseUrl, apiKey: "unit-secret", allowLive: true, nebiusBudgetUsd: 2, fetch: fetcher }); }
function reply(content = '{"ok":true}') { return new Response(JSON.stringify({ model: NEBIUS_ULTRA_MODEL, id: "synthetic-only", usage: { prompt_tokens: 10, completion_tokens: 10 }, choices: [{ finish_reason: "stop", message: { content } }] })); }

describe("exact generation-profile qualification", () => {
  it("does not borrow an unfingerprinted old completion and records the actual requested settings", async () => {
    const at = "2026-10-28T00:00:00.000Z";
    const old = { id: "legacy-profile", runId: "legacy", provider: "nebius" as const, model: NEBIUS_ULTRA_MODEL, servedModel: NEBIUS_ULTRA_MODEL,
      completionQualified: true, startedAt: at, completedAt: at, reservedUsd: 0, chargedUsd: 0, inputTokens: 0, outputTokens: 0, state: "complete" as const, requestId: "legacy-only",
      generation: { maxOutputTokens: 32000, timeoutMs: 480000, thinkingEnabled: true } };
    store.saveUsage(old);
    const calls: any[] = [], fake = vi.fn(async (_url: unknown, init: any) => { calls.push(JSON.parse(init.body)); return reply(); });
    const provider = create(fake as typeof fetch), status = provider.status();
    expect(status.runtimeQualified).toBe(false);
    expect(status.generation).toMatchObject({ temperature: 1, topP: 0.95, thinkingEnabled: true, forceNonemptyContent: true, maxOutputTokens: 32000, timeoutMs: 480000 });
    expect(status.generationProfileFingerprint).toMatch(/^[a-f0-9]{64}$/);
    const result = await provider.completeStructured(request());
    expect(calls[0]).toMatchObject({ temperature: 1, top_p: 0.95, max_tokens: 32000, chat_template_kwargs: { enable_thinking: true, force_nonempty_content: true } });
    expect(result.receipt).toMatchObject({ temperature: 1, baseUrl: regional, generation: status.generation, generationProfileFingerprint: status.generationProfileFingerprint });
    expect(store.usage()[0]).toEqual(old);
    expect(store.usage()[1]).toMatchObject({ baseUrl: regional, generation: status.generation, generationProfileFingerprint: status.generationProfileFingerprint, completionQualified: true });
    expect(provider.status().runtimeQualified).toBe(true);
    const otherEndpoint = create(fake as typeof fetch, "https://api.tokenfactory.nebius.com/v1").status();
    expect(otherEndpoint.generationProfileFingerprint).not.toBe(status.generationProfileFingerprint);
    expect(otherEndpoint.runtimeQualified).toBe(false);
  });
  it("retains a malformed response without qualifying its profile", async () => {
    const provider = create(vi.fn(async () => reply('{"ok":false}')) as typeof fetch);
    await expect(provider.completeStructured(request())).rejects.toMatchObject({ code: "MALFORMED_MODEL_OUTPUT" });
    expect(store.usage()[0].generationProfileFingerprint).toBe(provider.status().generationProfileFingerprint);
    expect(store.usage()[0].completionQualified).not.toBe(true);
    expect(provider.status().runtimeQualified).toBe(false);
  });
});
