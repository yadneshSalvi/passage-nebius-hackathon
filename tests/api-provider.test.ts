import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { GenerationOutputError } from "../server/generation-output.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, now } from "../server/store.js";
import {
  MODEL,
  SUPER_MODEL,
  FIREWORKS_ULTRA_MODEL,
  TOGETHER_SUPER_MODEL,
  NEBIUS_ULTRA_MODEL,
  NebiusProvider,
  RepairProvider,
} from "../server/provider.js";

describe("Nebius budget and safe response handling", () => {
  let root: string;
  let store: Store;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "passage-provider-"));
    store = new Store(root);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  const input = () => ({
    runId: "run",
    source:
      "export default function SlotControl(){return <button>Choose</button>}",
    contract: {},
    observations: [],
    failedChecks: [],
    signal: new AbortController().signal,
  });
  const response = (
    content = JSON.stringify({
      summary: "Fixed keyboard interaction",
      source:
        "export default function SlotControl(){return <button>Choose</button>}",
    }),
  ) =>
    new Response(
      JSON.stringify({
        id: "request-1",
        choices: [{ finish_reason: "stop", message: { content } }],
        usage: { prompt_tokens: 100, completion_tokens: 80 },
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  const provider = (fetcher: typeof fetch) =>
    new NebiusProvider(store, {
      apiKey: "test-secret",
      baseUrl: "https://api.tokenfactory.nebius.com/v1",
      model: MODEL,
      allowLive: true,
      fetch: fetcher,
    });
  it("serializes calls, records actual tokens, and applies strict output validation", async () => {
    let active = 0;
    let maximum = 0;
    const fake = vi.fn(async () => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      return response();
    });
    const model = provider(fake as typeof fetch);
    const results = await Promise.all([
      model.generate(input()),
      model.generate(input()),
    ]);
    expect(maximum).toBe(1);
    expect(results[0].receipt).toMatchObject({
      provider: "nebius",
      model: MODEL,
      inputTokens: 100,
      outputTokens: 80,
      requestId: "request-1",
      live: true,
    });
    expect(store.usage().every((entry) => entry.state === "complete")).toBe(
      true,
    );
    expect(store.committedSpend()).toBeCloseTo(
      (2 * (100 * 0.06 + 80 * 0.24)) / 1e6,
    );
    expect(
      JSON.parse(
        (fake.mock.calls[0] as unknown as [string, RequestInit])[1]
          .body as string,
      ).max_tokens,
    ).toBe(6000);
    expect(
      JSON.parse(
        (fake.mock.calls[0] as unknown as [string, RequestInit])[1]
          .body as string,
      ).chat_template_kwargs,
    ).toEqual({ enable_thinking: false });
    await expect(
      provider(
        vi.fn(async () => response('{"source":"bad"}')) as typeof fetch,
      ).generate(input()),
    ).rejects.toMatchObject({ code: "MALFORMED_MODEL_OUTPUT" });
    expect(store.usage()).toHaveLength(3);
  });
  it("counts unknown in-flight usage conservatively after network failure", async () => {
    const fake = vi.fn(async () => {
      throw new Error("network unreachable");
    });
    await expect(
      provider(fake as typeof fetch).generate(input()),
    ).rejects.toMatchObject({ code: "PROVIDER_CONNECTION_FAILED" });
    expect(store.usage()[0].state).toBe("uncertain");
    expect(store.committedSpend()).toBeGreaterThan(0);
    store.close();
    store = new Store(root);
    expect(store.committedSpend()).toBeGreaterThan(0);
  });
  it("refuses a request before HTTP when its durable ledger would exceed $2", async () => {
    store.saveUsage({
      id: "existing",
      runId: "earlier",
      startedAt: now(),
      completedAt: now(),
      model: MODEL,
      reservedUsd: 1.9999,
      chargedUsd: 1.9999,
      inputTokens: null,
      outputTokens: null,
      state: "uncertain",
      requestId: null,
    });
    const fake = vi.fn(async () => response());
    await expect(
      provider(fake as typeof fetch).generate(input()),
    ).rejects.toMatchObject({ code: "BUDGET_EXCEEDED" });
    expect(fake).not.toHaveBeenCalled();
    expect(store.usage()).toHaveLength(1);
  });
  it("stops after insufficient credits with no provider fallback or silent retry", async () => {
    const fake = vi.fn(
      async () =>
        new Response('{"error":"insufficient credits"}', { status: 402 }),
    );
    const model = provider(fake as typeof fetch);
    await expect(model.generate(input())).rejects.toMatchObject({
      code: "INSUFFICIENT_CREDITS",
    });
    await expect(model.generate(input())).rejects.toMatchObject({
      code: "LIVE_UNAVAILABLE",
    });
    expect(fake).toHaveBeenCalledTimes(1);
    expect(store.committedSpend()).toBe(0);
    expect(model.status().enabled).toBe(false);
    expect(JSON.stringify(store.usage())).not.toContain("test-secret");
  });
  it("does not route credentials to a custom host or non-budgeted model", () => {
    expect(
      new NebiusProvider(store, {
        apiKey: "x",
        baseUrl: "https://attacker.example/v1",
        model: MODEL,
        allowLive: true,
      }).status().configured,
    ).toBe(false);
    expect(
      new NebiusProvider(store, {
        apiKey: "x",
        baseUrl: "https://api.tokenfactory.nebius.com/v1",
        model: "other-model",
        allowLive: true,
      }).status().configured,
    ).toBe(false);
  });
  it("prices an explicitly selected Super request with its own durable rates", async () => {
    const model = new NebiusProvider(store, {
      apiKey: "fake",
      baseUrl: "https://api.tokenfactory.nebius.com/v1",
      model: SUPER_MODEL,
      allowLive: true,
      fetch: vi.fn(async () => response()) as typeof fetch,
    });
    const output = await model.generate(input());
    expect(output.receipt.model).toBe(SUPER_MODEL);
    expect(store.usage()[0].pricing).toEqual({
      inputUsdPerMillion: 0.3,
      outputUsdPerMillion: 0.9,
    });
    expect(store.committedSpend()).toBeCloseTo((100 * 0.3 + 80 * 0.9) / 1e6);
  });
  it("keeps paid Fireworks development isolated from the exhausted Nebius cap and historical rows", async () => {
    const historical = {
      id: "old-nebius",
      runId: "old",
      startedAt: now(),
      completedAt: now(),
      model: MODEL,
      reservedUsd: 2,
      chargedUsd: 2,
      inputTokens: 10,
      outputTokens: 10,
      state: "complete" as const,
      requestId: "old-request",
    };
    store.saveUsage(historical);
    let body: Record<string, unknown> = {};
    const fake = vi.fn(async (url: unknown, options?: RequestInit) => {
      expect(url).toBe(
        "https://api.fireworks.ai/inference/v1/chat/completions",
      );
      body = JSON.parse(String(options?.body));
      const data = JSON.parse(await response().text());
      data.model = FIREWORKS_ULTRA_MODEL;
      data.choices[0].message.reasoning_content =
        "PRIVATE_REASONING_MUST_NOT_BE_SAVED";
      return new Response(JSON.stringify(data), {
        headers: { "x-request-id": "fireworks-request" },
      });
    });
    const dev = new RepairProvider(store, {
      provider: "fireworks",
      apiKey: "fw-fake",
      baseUrl: "https://api.fireworks.ai/inference/v1",
      model: FIREWORKS_ULTRA_MODEL,
      allowLive: true,
      fetch: fake as typeof fetch,
    });
    expect(dev.status()).toMatchObject({
      provider: "fireworks",
      purpose: "development",
      budgetUsd: null,
      enabled: true,
    });
    const output = await dev.generate(input());
    expect(body).toMatchObject({
      model: FIREWORKS_ULTRA_MODEL,
      max_tokens: 32000,
      reasoning_effort: "high",
    });
    expect(body).not.toHaveProperty("response_format");
    expect(body).not.toHaveProperty("chat_template_kwargs");
    expect(output.receipt).not.toHaveProperty("reasoningTokens");
    expect(output.receipt).toMatchObject({
      provider: "fireworks",
      purpose: "development",
      servedModel: FIREWORKS_ULTRA_MODEL,
      generation: {
        maxOutputTokens: 32000,
        timeoutMs: 480000,
        reasoningEffort: "high",
        responseFormat: "prompt_schema",
      },
    });
    expect(JSON.stringify(output)).not.toContain("PRIVATE_REASONING");
    expect(JSON.stringify(store.usage())).not.toContain("PRIVATE_REASONING");
    expect(store.usage()[0]).toEqual(historical);
    expect(store.committedSpend("nebius")).toBe(2);
    expect(store.providerUsage("fireworks").committedUsd).toBeCloseTo(
      (100 * 0.6 + 80 * 2.4) / 1e6,
    );
    expect(dev.usage().providers.nebius.budgetUsd).toBe(2);
    expect(
      provider(vi.fn(async () => response()) as typeof fetch).status().enabled,
    ).toBe(false);
  });
  it("does not let substantial development spend consume Nebius authorization", async () => {
    store.saveUsage({
      id: "dev",
      runId: "dev",
      provider: "fireworks",
      purpose: "development",
      startedAt: now(),
      completedAt: now(),
      model: FIREWORKS_ULTRA_MODEL,
      reservedUsd: 50,
      chargedUsd: 50,
      inputTokens: 100,
      outputTokens: 100,
      state: "complete",
      requestId: "dev",
    });
    const nebius = provider(vi.fn(async () => response()) as typeof fetch);
    expect(nebius.status().enabled).toBe(true);
    await nebius.generate(input());
    expect(nebius.usage().committedUsd).toBeLessThan(2);
    expect(nebius.usage().providers.fireworks.committedUsd).toBe(50);
  });
  it("uses Together's verified thinking shape without Fireworks reasoning settings", async () => {
    let body: Record<string, unknown> = {};
    const together = new RepairProvider(store, {
      provider: "together",
      apiKey: "t-fake",
      baseUrl: "https://api.together.xyz/v1",
      model: TOGETHER_SUPER_MODEL,
      allowLive: true,
      fetch: vi.fn(async (_url, options) => {
        body = JSON.parse(String(options?.body));
        return response();
      }) as typeof fetch,
    });
    await together.generate(input());
    expect(body).toMatchObject({
      model: TOGETHER_SUPER_MODEL,
      max_tokens: 16000,
      chat_template_kwargs: { enable_thinking: true },
    });
    expect(body).not.toHaveProperty("reasoning_effort");
    expect(store.usage()[0]).toMatchObject({
      provider: "together",
      purpose: "development",
      pricing: { inputUsdPerMillion: 0.15, outputUsdPerMillion: 0.5 },
    });
  });
  it("isolates credit latches and never falls back to a dedicated Fireworks key", async () => {
    store.put("provider", "credits_exhausted", true);
    const fake = vi.fn(
      async () => new Response("insufficient credit", { status: 402 }),
    );
    const dev = new RepairProvider(store, {
      provider: "fireworks",
      apiKey: "fake",
      baseUrl: "https://api.fireworks.ai/inference/v1",
      model: FIREWORKS_ULTRA_MODEL,
      allowLive: true,
      fetch: fake as typeof fetch,
    });
    expect(dev.status().enabled).toBe(true);
    await expect(dev.generate(input())).rejects.toMatchObject({
      code: "INSUFFICIENT_CREDITS",
    });
    await expect(dev.generate(input())).rejects.toMatchObject({
      code: "LIVE_UNAVAILABLE",
    });
    expect(fake).toHaveBeenCalledTimes(1);
    dev.resetCreditError();
    expect(store.get("provider", "credits_exhausted")).toBe(true);
    vi.stubEnv("FIREWORKS_AI_API_KEY", "");
    vi.stubEnv("FIREWORKS_AI_DEDICATED_API_KEY", "unused-dedicated");
    expect(
      new RepairProvider(store, {
        provider: "fireworks",
        allowLive: true,
      }).status().configured,
    ).toBe(false);
  });
  it("defaults to Nebius despite development keys and marks explicit Ultra qualification pending", () => {
    vi.stubEnv("PASSAGE_PROVIDER", undefined);
    vi.stubEnv("FIREWORKS_AI_API_KEY", "present");
    expect(new RepairProvider(store).provider).toBe("nebius");
    expect(
      new NebiusProvider(store, {
        apiKey: "fake",
        model: NEBIUS_ULTRA_MODEL,
        allowLive: true,
      }).status(),
    ).toMatchObject({
      enabled: true,
      configured: true,
      catalogVerified: true,
      runtimeQualified: false,
    });
    vi.stubEnv("PASSAGE_PROVIDER", "unknown-service");
    expect(() => new RepairProvider(store)).toThrow("PASSAGE_PROVIDER");
  });
  it("qualifies the exact provider/model only after its own matching valid completion", async () => {
    store.saveUsage({
      id: "other-provider",
      runId: "dev",
      provider: "fireworks",
      purpose: "development",
      startedAt: now(),
      completedAt: now(),
      model: NEBIUS_ULTRA_MODEL,
      servedModel: NEBIUS_ULTRA_MODEL,
      completionQualified: true,
      reservedUsd: 0.01,
      chargedUsd: 0.01,
      inputTokens: 100,
      outputTokens: 100,
      state: "complete",
      requestId: "not-nebius",
    });
    let requestBody: Record<string, unknown> = {};
    const nebius = new NebiusProvider(store, {
      apiKey: "fake",
      baseUrl: "https://api.tokenfactory.nebius.com/v1",
      model: NEBIUS_ULTRA_MODEL,
      allowLive: true,
      fetch: vi.fn(async (_url, options) => {
        requestBody = JSON.parse(String(options?.body));
        const data = JSON.parse(await response().text());
        data.model = NEBIUS_ULTRA_MODEL;
        return new Response(JSON.stringify(data));
      }) as typeof fetch,
    });
    expect(nebius.status().runtimeQualified).toBe(false);
    const result = await nebius.generate(input());
    expect(requestBody).toMatchObject({
      temperature: 1,
      top_p: 0.95,
      max_tokens: 32000,
      chat_template_kwargs: {
        enable_thinking: true,
        force_nonempty_content: true,
      },
    });
    expect(requestBody).not.toHaveProperty("response_format");
    expect(result.receipt.temperature).toBe(1);
    expect(result.receipt.generation).toMatchObject({
      maxOutputTokens: 32000,
      timeoutMs: 480000,
      thinkingEnabled: true,
      responseFormat: "prompt_schema",
    });
    expect(nebius.status().runtimeQualified).toBe(true);
    expect(store.usage().at(-1)).toMatchObject({
      provider: "nebius",
      model: NEBIUS_ULTRA_MODEL,
      completionQualified: true,
    });
  });
  it("retains bounded malformed final content and field diagnostics without hidden reasoning", async () => {
    const malformed = JSON.stringify({ summary: 42, code: "wrong field" });
    const model = new RepairProvider(store, {
      provider: "fireworks",
      apiKey: "fake",
      baseUrl: "https://api.fireworks.ai/inference/v1",
      model: FIREWORKS_ULTRA_MODEL,
      allowLive: true,
      fetch: vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              id: "bad-shape",
              model: FIREWORKS_ULTRA_MODEL,
              usage: {
                prompt_tokens: 100,
                completion_tokens: 80,
                reasoning_tokens: 23,
              },
              choices: [
                {
                  finish_reason: "stop",
                  message: {
                    content: malformed,
                    reasoning_content: "HIDDEN_REASONING_SENTINEL",
                  },
                },
              ],
            }),
          ),
      ) as typeof fetch,
    });
    let failure: GenerationOutputError | undefined;
    try {
      await model.generate(input());
    } catch (error) {
      failure = error as GenerationOutputError;
    }
    expect(failure).toBeInstanceOf(GenerationOutputError);
    expect(failure!.failure).toMatchObject({
      runId: "run",
      code: "MALFORMED_MODEL_OUTPUT",
      topLevelKeys: ["summary", "code"],
      receipt: {
        provider: "fireworks",
        requestId: "bad-shape",
        reasoningTokens: 23,
      },
    });
    expect(
      failure!.failure.diagnostics.some((value) => value.path === "summary"),
    ).toBe(true);
    expect(
      store.readArtifact(failure!.failure.outputArtifact!.digest).toString(),
    ).toBe(malformed);
    expect(store.usage()[0].finalOutputDigest).toBe(
      failure!.failure.outputArtifact!.digest,
    );
    expect(store.usage()[0].chargedUsd).toBeCloseTo(
      (100 * 0.6 + 80 * 2.4) / 1e6,
    );
    expect(JSON.stringify(store.usage())).not.toContain(
      "HIDDEN_REASONING_SENTINEL",
    );
    for (const file of readdirSync(store.artifactDir))
      expect(
        readFileSync(join(store.artifactDir, file)).toString(),
      ).not.toContain("HIDDEN_REASONING_SENTINEL");
  });
  it("enforces the expanded Fireworks response byte cap before parsing or storing output", async () => {
    const model = new RepairProvider(store, {
      provider: "fireworks",
      apiKey: "fake",
      baseUrl: "https://api.fireworks.ai/inference/v1",
      model: FIREWORKS_ULTRA_MODEL,
      allowLive: true,
      fetch: vi.fn(
        async () => new Response("x".repeat(1048577)),
      ) as typeof fetch,
    });
    await expect(model.generate(input())).rejects.toMatchObject({
      code: "MODEL_RESPONSE_TOO_LARGE",
    });
    expect(store.usage()[0].state).toBe("uncertain");
    expect(readdirSync(store.artifactDir)).toEqual([]);
  });
  it("bounds retained final-content captures and labels incomplete captures honestly", async () => {
    const content = JSON.stringify({
      summary: "Oversized source",
      source: "x".repeat(140000),
    });
    const model = new RepairProvider(store, {
      provider: "fireworks",
      apiKey: "fake",
      baseUrl: "https://api.fireworks.ai/inference/v1",
      model: FIREWORKS_ULTRA_MODEL,
      allowLive: true,
      fetch: vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              usage: { prompt_tokens: 10, completion_tokens: 10 },
              choices: [{ finish_reason: "stop", message: { content } }],
            }),
          ),
      ) as typeof fetch,
    });
    let failure: GenerationOutputError | undefined;
    try {
      await model.generate(input());
    } catch (error) {
      failure = error as GenerationOutputError;
    }
    expect(failure!.failure.outputArtifact).toMatchObject({
      byteLength: Buffer.byteLength(content),
      capturedBytes: 128000,
      captureTruncated: true,
    });
    expect(store.readArtifact(failure!.failure.outputArtifact!.digest)).toEqual(
      Buffer.from(content).subarray(0, 128000),
    );
  });
  it("accepts Together's documented official alias without switching endpoints", async () => {
    const fake = vi.fn(async (_url: unknown) => response());
    const model = new RepairProvider(store, {
      provider: "together",
      apiKey: "fake",
      baseUrl: "https://api.together.ai/v1",
      model: TOGETHER_SUPER_MODEL,
      allowLive: true,
      fetch: fake as typeof fetch,
    });
    await model.generate(input());
    expect(fake.mock.calls[0][0]).toBe(
      "https://api.together.ai/v1/chat/completions",
    );
  });
  it("reports unknown development costs explicitly rather than treating them as free", () => {
    store.saveUsage({
      id: "unknown-dev",
      runId: "dev",
      provider: "fireworks",
      purpose: "development",
      startedAt: now(),
      completedAt: now(),
      model: FIREWORKS_ULTRA_MODEL,
      reservedUsd: null,
      chargedUsd: null,
      inputTokens: 100,
      outputTokens: 100,
      state: "complete",
      requestId: "unknown-price",
      pricing: null,
    });
    expect(store.providerUsage("fireworks")).toMatchObject({
      budgetUsd: null,
      committedUsd: null,
      unknownCostCalls: 1,
      knownEstimatedUsd: 0,
    });
    expect(store.providerUsage("nebius")).toMatchObject({
      committedUsd: 0,
      unknownCostCalls: 0,
    });
  });
});
