import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { unzipSync, strFromU8 } from "fflate";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  InteractionContract,
  RepairRun,
  VerificationResult,
  Scenario,
} from "../shared/types.js";
import type { Build, Engine } from "../server/orchestrator.js";
import { sha256 } from "../server/store.js";
import { MODEL } from "../server/provider.js";

// Protocol/lifecycle fakes are not browser or human evidence. The engine suite verifies actual browsers separately.
vi.mock("../engine/index.js", () => ({
  fixtureDefinitions: [
    {
      id: "sample",
      name: "Authored application",
      organization: "Fictional",
      task: "Confirm a valid appointment",
      barrier: "The recovery action cannot receive keyboard focus.",
      family: "date-picker",
      sourceFile: "SlotControl.tsx",
      supported: true,
    },
    {
      id: "german-sample",
      name: "German authored application",
      organization: "Fictional",
      task: "Confirm a valid appointment",
      family: "date-picker",
      sourceFile: "SlotControl.tsx",
      supported: true,
    },
  ],
  scenarioDefinitions: [
    { id: "baseline", name: "Baseline", locale: "en", seed: 1 },
    { id: "late-error", name: "Late error", locale: "de", seed: 2 },
  ],
  effectiveScenario: (fixtureId: string, requested: Scenario) =>
    fixtureId === "german-sample"
      ? { ...requested, locale: "de", longLabels: true }
      : structuredClone(requested),
  createContract: () => ({
    id: `contract_${randomUUID()}`,
    version: 1,
    digest: sha256(randomUUID()),
    task: "Confirm a valid appointment",
    reviewer: "Initial authored contract",
    createdAt: new Date().toISOString(),
    assertions: [
      {
        id: "correct_outcome_persisted",
        label: "Correct outcome",
        description: "Preserve the backend outcome",
        enabled: true,
        required: true,
        source: "independent backend",
        evidenceType: "backend",
      },
    ],
    preconditions: [],
    transitions: [],
    outcomeOracle: "independent backend",
    humanChecks: [],
    supportedCombinations: ["Chromium keyboard"],
  }),
  getOriginalSource: async () =>
    "export default function SlotControl(){return <div>Original authored source</div>}",
  getReferenceSource: async () =>
    "export default function SlotControl(){return <button>Reference authored source</button>}",
  validateCandidateSource: (source: string) => ({
    valid: !source.includes("unsafe"),
    errors: source.includes("unsafe")
      ? ["Forbidden source capability: unsafe"]
      : [],
  }),
  FixtureEngine: class {},
}));
import { createApp } from "../server/app.js";
import { effectiveScenario } from "../engine/index.js";

const allocations: {
  root: string;
  context: Awaited<ReturnType<typeof createApp>>;
}[] = [];
const basicEngine = (overrides: Partial<Engine> = {}): Engine => ({
  start: async () => undefined,
  close: async () => undefined,
  prepareBuild: async ({ fixtureId, source }) => ({
    id: `build_${sha256(source)}`,
    digest: sha256(source),
    source,
    fixtureId,
    sourceFile: "SlotControl.tsx",
    previewUrl: `http://127.0.0.1:4103/${sha256(source)}`,
    bundleDigest: sha256(source),
    cssDigest: sha256("css"),
    toolchainDigest: sha256("toolchain"),
  }),
  verify: async ({ build, contract, scenario, kind }) =>
    result(build, contract, effectiveScenario(build.fixtureId, scenario), kind),
  ...overrides,
});
function result(
  build: Build,
  contract: InteractionContract,
  scenario: VerificationResult["scenario"],
  kind: VerificationResult["kind"],
): VerificationResult {
  const passed = kind !== "baseline";
  const at = new Date().toISOString();
  return {
    id: randomUUID(),
    fixtureId: build.fixtureId,
    kind,
    sourceDigest: build.digest,
    contractDigest: contract.digest,
    scenario,
    status: passed ? "passed" : "failed",
    passed,
    startedAt: at,
    completedAt: at,
    durationMs: 10,
    browser: "Test fake",
    browserVersion: "test",
    checks: [
      {
        id: "correct_outcome_persisted",
        label: "Backend outcome",
        status: passed ? "passed" : "failed",
        expected: "Stored appointment",
        actual: passed ? "Stored" : "Blocked",
        durationMs: 10,
        evidenceType: "backend",
      },
    ],
    observations: [],
    outcome: passed
      ? {
          id: "appointment",
          sessionId: "session",
          date: "2026-11-03",
          service: "service",
          attendee: "Fictional",
          createdAt: at,
          sourceDigest: build.digest,
        }
      : null,
    previewUrl: build.previewUrl,
    buildId: build.id,
    artifacts: [],
    limitations: ["Test fake; not browser evidence."],
  };
}
async function context(
  engine: Engine = basicEngine(),
  provider?: import("../server/provider.js").ProviderConfig,
) {
  const root = mkdtempSync(join(tmpdir(), "passage-api-"));
  const value = await createApp({
    dataDir: root,
    engine,
    provider: { provider: "nebius", ...provider },
  });
  allocations.push({ root, context: value });
  return value;
}
async function journey(
  ctx: Awaited<ReturnType<typeof createApp>>,
  key?: string,
) {
  const response = await ctx.app.inject({
    method: "POST",
    url: "/v1/journeys",
    payload: {
      fixtureId: "sample",
      inputMode: "keyboard",
      locale: "en",
      captureConsent: true,
    },
    ...(key ? { headers: { "idempotency-key": key } } : {}),
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { journey: { id: string }; run: RepairRun };
}
async function repaired(ctx: Awaited<ReturnType<typeof createApp>>) {
  const created = await journey(ctx);
  await ctx.orchestrator.idle();
  const response = await ctx.app.inject({
    method: "POST",
    url: `/v1/repairs/${created.run.id}/generate`,
    payload: { mode: "offline" },
  });
  expect(response.statusCode).toBe(202);
  await ctx.orchestrator.idle();
  return ctx.store.run(created.run.id);
}
afterEach(async () => {
  for (const allocation of allocations.splice(0)) {
    await allocation.context.app.close();
    rmSync(allocation.root, { recursive: true, force: true });
  }
});

describe("Passage local API", () => {
  it("records baseline, reference repair, exact-digest challenge and immutable export", async () => {
    const ctx = await context();
    const run = await repaired(ctx);
    expect(run.status).toBe("ready");
    expect(run.baseline?.passed).toBe(false);
    expect(run.candidates[0].receipt.live).toBe(false);
    expect(run.candidates[0].status).toBe("accepted");
    const wrong = await ctx.app.inject({
      method: "POST",
      url: `/v1/repairs/${run.id}/challenges`,
      payload: { scenarioId: "late-error", candidateDigest: "0".repeat(64) },
    });
    expect(wrong.statusCode).toBe(409);
    const challenge = await ctx.app.inject({
      method: "POST",
      url: `/v1/repairs/${run.id}/challenges`,
      payload: {
        scenarioId: "late-error",
        candidateDigest: run.candidates[0].digest,
      },
    });
    expect(challenge.statusCode).toBe(202);
    await ctx.orchestrator.idle();
    const exported = await ctx.app.inject({
      method: "GET",
      url: `/v1/repairs/${run.id}/export`,
    });
    expect(exported.statusCode).toBe(200);
    const manifest = exported.json();
    expect(manifest.humanValidation).toBe("pending");
    expect(manifest.automatedSummary.challengesPassed).toBe(1);
    expect(manifest.limitations.join(" ")).toContain("handcrafted");
    expect(manifest.candidateDigest).toBe(run.candidates[0].digest);
    for (const artifact of manifest.integrity.artifacts)
      expect(sha256(ctx.store.readArtifact(artifact.digest))).toBe(
        artifact.digest,
      );
    const patch = await ctx.app.inject({
      method: "GET",
      url: `/v1/repairs/${run.id}/patch`,
    });
    expect(patch.body).toContain("Reference authored source");
  });
  it("deduplicates creation and rejects keys reused with different bodies", async () => {
    const ctx = await context();
    const first = await journey(ctx, "same-request");
    const duplicate = await journey(ctx, "same-request");
    expect(duplicate.run.id).toBe(first.run.id);
    await ctx.orchestrator.idle();
    expect(ctx.store.runs()).toHaveLength(1);
    const conflict = await ctx.app.inject({
      method: "POST",
      url: "/v1/journeys",
      headers: { "idempotency-key": "same-request" },
      payload: {
        fixtureId: "different",
        inputMode: "keyboard",
        locale: "en",
        captureConsent: true,
      },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
  });
  it("fences late results from cancelled workers even when engine ignores abort", async () => {
    let release!: () => void;
    let entered!: () => void;
    const inside = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ctx = await context(
      basicEngine({
        verify: async (args) => {
          entered();
          await held;
          return result(args.build, args.contract, args.scenario, args.kind);
        },
      }),
    );
    const created = await journey(ctx);
    await inside;
    const cancel = await ctx.app.inject({
      method: "POST",
      url: `/v1/repairs/${created.run.id}/cancel`,
    });
    expect(cancel.json().status).toBe("cancelled");
    release();
    await ctx.orchestrator.idle();
    const run = ctx.store.run(created.run.id);
    expect(run.status).toBe("cancelled");
    expect(run.baseline).toBeNull();
    expect(run.events.at(-1)?.stage).toBe("cancelled");
  });
  it("deduplicates repair job submissions and rejects concurrent challenges", async () => {
    const ctx = await context(
      basicEngine({
        verify: async (args) => {
          if (args.kind === "challenge")
            await new Promise((resolve) => setTimeout(resolve, 20));
          return result(args.build, args.contract, args.scenario, args.kind);
        },
      }),
    );
    const created = await journey(ctx);
    await ctx.orchestrator.idle();
    const request = {
      method: "POST" as const,
      url: `/v1/repairs/${created.run.id}/generate`,
      headers: { "idempotency-key": "one-reference-candidate" },
      payload: { mode: "offline" },
    };
    const first = await ctx.app.inject(request);
    const duplicate = await ctx.app.inject(request);
    expect(first.statusCode).toBe(202);
    expect(duplicate.statusCode).toBe(202);
    await ctx.orchestrator.idle();
    const run = ctx.store.run(created.run.id);
    expect(run.candidates).toHaveLength(1);
    const [a, b] = await Promise.all([
      ctx.app.inject({
        method: "POST",
        url: `/v1/repairs/${run.id}/challenges`,
        payload: {
          scenarioId: "late-error",
          candidateDigest: run.candidates[0].digest,
        },
      }),
      ctx.app.inject({
        method: "POST",
        url: `/v1/repairs/${run.id}/challenges`,
        payload: {
          scenarioId: "late-error",
          candidateDigest: run.candidates[0].digest,
        },
      }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([202, 409]);
    await ctx.orchestrator.idle();
    expect(ctx.store.run(run.id).challenges).toHaveLength(1);
  });
  it("allows a cancelled queued run to retry while its fenced delivery drains", async () => {
    let release!: () => void;
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ctx = await context(
      basicEngine({
        verify: async (args) => {
          entered();
          await held;
          return result(args.build, args.contract, args.scenario, args.kind);
        },
      }),
    );
    await journey(ctx);
    await enteredPromise;
    const queued = await journey(ctx);
    expect(ctx.store.run(queued.run.id).status).toBe("queued");
    await ctx.app.inject({
      method: "POST",
      url: `/v1/repairs/${queued.run.id}/cancel`,
    });
    const retried = await ctx.app.inject({
      method: "POST",
      url: `/v1/repairs/${queued.run.id}/retry`,
      payload: {},
    });
    expect(retried.statusCode).toBe(201);
    expect(retried.json().parentRunId).toBe(queued.run.id);
    release();
    await ctx.orchestrator.idle();
    expect(ctx.store.run(queued.run.id).status).toBe("cancelled");
    expect(ctx.store.run(queued.run.id).baseline).toBeNull();
    expect(ctx.store.run(retried.json().id).status).toBe("contract_review");
  });
  it("preserves old contracts, invalidates acceptance and retries on new revision", async () => {
    const ctx = await context();
    const run = await repaired(ctx);
    const original = run.contract;
    const payload = {
      expectedVersion: original.version,
      task: "Confirm a valid appointment with reviewed focus behavior",
      reviewer: "Named reviewer",
      assertions: original.assertions,
    };
    const changed = await ctx.app.inject({
      method: "PUT",
      url: `/v1/contracts/${original.id}`,
      payload,
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().version).toBe(2);
    const old = ctx.store.run(run.id);
    expect(old.isStale).toBe(true);
    expect(old.contract.digest).toBe(original.digest);
    expect(old.candidates[0].verification?.contractDigest).toBe(
      original.digest,
    );
    expect(
      (
        await ctx.app.inject({
          method: "PUT",
          url: `/v1/contracts/${original.id}`,
          payload,
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await ctx.app.inject({
          method: "POST",
          url: `/v1/repairs/${run.id}/challenges`,
          payload: {
            scenarioId: "late-error",
            candidateDigest: run.candidates[0].digest,
          },
        })
      ).statusCode,
    ).toBe(409);
    const retry = await ctx.app.inject({
      method: "POST",
      url: `/v1/repairs/${run.id}/retry`,
      payload: {},
    });
    expect(retry.statusCode).toBe(201);
    expect(retry.json().contract.version).toBe(2);
    expect(retry.json().parentRunId).toBe(run.id);
    await ctx.orchestrator.idle();
    const weakened = await ctx.app.inject({
      method: "PUT",
      url: `/v1/contracts/${original.id}`,
      payload: {
        ...payload,
        expectedVersion: 2,
        assertions: original.assertions.map((a) => ({ ...a, enabled: false })),
      },
    });
    expect(weakened.statusCode).toBe(400);
  });
  it("rejects passed flags whose backend outcome belongs to another digest", async () => {
    const ctx = await context(
      basicEngine({
        verify: async (args) => {
          const value = result(
            args.build,
            args.contract,
            args.scenario,
            args.kind,
          );
          if (value.outcome) value.outcome.sourceDigest = "0".repeat(64);
          return value;
        },
      }),
    );
    const run = await repaired(ctx);
    expect(run.status).toBe("environment_error");
    expect(run.candidates[0].status).toBe("rejected");
    expect(run.error?.code).toBe("INCOMPLETE_ACCEPTANCE_EVIDENCE");
  });
  it("rejects evidence with a different seed despite an unchanged scenario ID", async () => {
    const ctx = await context(
      basicEngine({
        verify: async (args) => {
          const value = result(
            args.build,
            args.contract,
            args.scenario,
            args.kind,
          );
          value.scenario = { ...value.scenario, seed: value.scenario.seed + 1 };
          return value;
        },
      }),
    );
    const created = await journey(ctx);
    await ctx.orchestrator.idle();
    const run = ctx.store.run(created.run.id);
    expect(run.status).toBe("environment_error");
    expect(run.error?.code).toBe("EVIDENCE_BINDING_MISMATCH");
    expect(run.baseline).toBeNull();
  });
  it("records the effective fixture locale and accepts its declared scenario overrides", async () => {
    const ctx = await context();
    const response = await ctx.app.inject({
      method: "POST",
      url: "/v1/journeys",
      payload: {
        fixtureId: "german-sample",
        inputMode: "keyboard",
        locale: "en",
        captureConsent: true,
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().journey.locale).toBe("de");
    await ctx.orchestrator.idle();
    const run = ctx.store.run(response.json().run.id);
    expect(run.status).toBe("contract_review");
    expect(run.baseline?.scenario).toMatchObject({
      locale: "de",
      longLabels: true,
    });
  });
  it("retains failed candidates and feeds validation errors into bounded live revisions", async () => {
    let count = 0;
    const prompts: string[] = [];
    const fake = vi.fn(async (_url: unknown, options?: RequestInit) => {
      prompts.push(String(options?.body));
      count++;
      return new Response(
        JSON.stringify({
          id: `test-${count}`,
          usage: { prompt_tokens: 100, completion_tokens: 100 },
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  summary: "Model candidate",
                  source:
                    count === 1
                      ? "export default function SlotControl(){return <div>unsafe candidate</div>}"
                      : "export default function SlotControl(){return <button>Repaired candidate</button>}",
                }),
              },
            },
          ],
        }),
      );
    });
    const ctx = await context(basicEngine(), {
      apiKey: "fake",
      baseUrl: "https://api.tokenfactory.nebius.com/v1",
      model: MODEL,
      allowLive: true,
      fetch: fake as typeof fetch,
    });
    const created = await journey(ctx);
    await ctx.orchestrator.idle();
    await ctx.app.inject({
      method: "POST",
      url: `/v1/repairs/${created.run.id}/generate`,
      payload: { mode: "live" },
    });
    await ctx.orchestrator.idle();
    const run = ctx.store.run(created.run.id);
    expect(run.status).toBe("ready");
    expect(run.candidates).toHaveLength(2);
    expect(run.candidates[0].status).toBe("rejected");
    expect(run.candidates[0].rejectionReason).toContain("Forbidden source");
    expect(prompts[1]).toContain("Forbidden source");
    expect(prompts[1]).toContain("unsafe candidate");
    expect(ctx.store.usage()).toHaveLength(2);
  });
  it("grounds a revision in the actual failed transition, barrier, source and patch", async () => {
    const prompts: string[] = [];
    let calls = 0;
    let verifications = 0;
    const fake = vi.fn(async (_url: unknown, options?: RequestInit) => {
      prompts.push(String(options?.body));
      calls++;
      return new Response(
        JSON.stringify({
          id: `observed-${calls}`,
          usage: { prompt_tokens: 100, completion_tokens: 100 },
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  summary: "Repair observed recovery",
                  source: `export default function SlotControl(){return <button>Generated revision ${calls}</button>}`,
                }),
              },
            },
          ],
        }),
      );
    });
    const ctx = await context(
      basicEngine({
        verify: async (args) => {
          const value = result(
            args.build,
            args.contract,
            args.scenario,
            args.kind,
          );
          if (args.kind === "candidate" && ++verifications === 1) {
            value.passed = false;
            value.status = "failed";
            value.checks[0].status = "failed";
            value.observations = [
              {
                sequence: 1,
                at: new Date().toISOString(),
                kind: "focus",
                label: "Error recovery blocked",
                detail:
                  "The visible retry action is a DIV that never receives keyboard focus.",
                evidenceType: "browser",
              },
            ];
          }
          return value;
        },
      }),
      {
        apiKey: "fake",
        baseUrl: "https://api.tokenfactory.nebius.com/v1",
        model: MODEL,
        allowLive: true,
        fetch: fake as typeof fetch,
      },
    );
    const created = await journey(ctx);
    await ctx.orchestrator.idle();
    await ctx.app.inject({
      method: "POST",
      url: `/v1/repairs/${created.run.id}/generate`,
      payload: { mode: "live" },
    });
    await ctx.orchestrator.idle();
    expect(ctx.store.run(created.run.id).status).toBe("ready");
    const body = JSON.parse(prompts[1]);
    const user = JSON.parse(
      body.messages.find((message: { role: string }) => message.role === "user")
        .content,
    );
    expect(user.baselineObservedEvidence.fixtureBarrier).toBe(
      "The recovery action cannot receive keyboard focus.",
    );
    expect(
      user.failedPublicChecks.previousObservedEvidence[0].detail,
    ).toContain("retry action is a DIV");
    expect(user.failedPublicChecks.previousCandidateSource).toContain(
      "Generated revision 1",
    );
    expect(user.failedPublicChecks.previousCandidatePatch).toContain(
      "Generated revision 1",
    );
    expect(user.failedPublicChecks.checks[0].status).toBe("failed");
  });
  it("retains malformed final output with safe diagnostics, then corrects within the same bounded provider loop", async () => {
    let calls = 0;
    const prompts: string[] = [];
    const malformed = JSON.stringify({
      summary: 42,
      code: "not a source field",
    });
    const fake = vi.fn(async (_url: unknown, options?: RequestInit) => {
      prompts.push(String(options?.body));
      calls++;
      return new Response(
        JSON.stringify({
          id: `shape-${calls}`,
          usage: {
            prompt_tokens: 100,
            completion_tokens: 100,
            reasoning_tokens: 12,
          },
          choices: [
            {
              finish_reason: "stop",
              message: {
                content:
                  calls === 1
                    ? malformed
                    : JSON.stringify({
                        summary: "Valid correction",
                        source:
                          "export default function SlotControl(){return <button>Corrected final component</button>}",
                      }),
                reasoning_content: "HIDDEN_REASONING_SENTINEL",
              },
            },
          ],
        }),
      );
    });
    const engine = basicEngine();
    const builds = vi.spyOn(engine, "prepareBuild");
    const ctx = await context(engine, {
      apiKey: "fake",
      baseUrl: "https://api.tokenfactory.nebius.com/v1",
      model: MODEL,
      allowLive: true,
      fetch: fake as typeof fetch,
    });
    const created = await journey(ctx);
    await ctx.orchestrator.idle();
    await ctx.app.inject({
      method: "POST",
      url: `/v1/repairs/${created.run.id}/generate`,
      payload: { mode: "live" },
    });
    await ctx.orchestrator.idle();
    const run = ctx.store.run(created.run.id);
    expect(run.status).toBe("ready");
    expect(run.candidates).toHaveLength(1);
    expect(run.generationFailures).toHaveLength(1);
    expect(builds).toHaveBeenCalledTimes(2);
    const failure = run.generationFailures![0];
    expect(failure.diagnostics.some((value) => value.path === "summary")).toBe(
      true,
    );
    expect(failure.receipt.reasoningTokens).toBe(12);
    const content = await ctx.app.inject({
      method: "GET",
      url: failure.outputArtifact!.url,
    });
    expect(content.body).toBe(malformed);
    const next = JSON.parse(
      JSON.parse(prompts[1]).messages.find(
        (value: { role: string }) => value.role === "user",
      ).content,
    );
    expect(
      next.failedPublicChecks.previousGenerationFailure.topLevelKeys,
    ).toEqual(["summary", "code"]);
    expect(next.failedPublicChecks.previousCandidateSource).toBeNull();
    expect(
      next.failedPublicChecks.untrustedPreviousFinalContentExcerpt,
    ).toMatchObject({ text: malformed, untrusted: true });
    expect(next.outputSchema.required).toEqual(["summary", "source"]);
    const exported = await ctx.app.inject({
      method: "GET",
      url: `/v1/repairs/${run.id}/export`,
    });
    expect(exported.body).not.toContain("HIDDEN_REASONING_SENTINEL");
    const archive = await ctx.app.inject({
      method: "GET",
      url: `/v1/repairs/${run.id}/bundle`,
    });
    const files = unzipSync(archive.rawPayload);
    expect(
      strFromU8(files["generation-failures/001/final-message-content.txt"]),
    ).toBe(malformed);
    for (const bytes of Object.values(files))
      expect(strFromU8(bytes)).not.toContain("HIDDEN_REASONING_SENTINEL");
  });
  it("caps malformed-output correction at three calls without executing any bad component", async () => {
    const fake = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            usage: { prompt_tokens: 10, completion_tokens: 10 },
            choices: [{ finish_reason: "stop", message: { content: "{}" } }],
          }),
        ),
    );
    const engine = basicEngine();
    const builds = vi.spyOn(engine, "prepareBuild");
    const ctx = await context(engine, {
      apiKey: "fake",
      baseUrl: "https://api.tokenfactory.nebius.com/v1",
      model: MODEL,
      allowLive: true,
      fetch: fake as typeof fetch,
    });
    const created = await journey(ctx);
    await ctx.orchestrator.idle();
    await ctx.app.inject({
      method: "POST",
      url: `/v1/repairs/${created.run.id}/generate`,
      payload: { mode: "live" },
    });
    await ctx.orchestrator.idle();
    const run = ctx.store.run(created.run.id);
    expect(run.status).toBe("environment_error");
    expect(run.generationFailures).toHaveLength(3);
    expect(run.candidates).toHaveLength(0);
    expect(fake).toHaveBeenCalledTimes(3);
    expect(builds).toHaveBeenCalledTimes(1);
    expect(
      (
        await ctx.app.inject({
          method: "POST",
          url: `/v1/repairs/${run.id}/generate`,
          payload: { mode: "live" },
        })
      ).statusCode,
    ).toBe(409);
    expect(fake).toHaveBeenCalledTimes(3);
  });
  it("feeds a historical provider error into a fresh retry even when no candidate or raw final was retained", async () => {
    let captured = "";
    const fake = vi.fn(async (_url: unknown, options?: RequestInit) => {
      captured = String(options?.body);
      return new Response(
        JSON.stringify({
          usage: { prompt_tokens: 10, completion_tokens: 10 },
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  summary: "Valid retry",
                  source:
                    "export default function SlotControl(){return <button>Fresh valid component</button>}",
                }),
              },
            },
          ],
        }),
      );
    });
    const ctx = await context(basicEngine(), {
      apiKey: "fake",
      baseUrl: "https://api.tokenfactory.nebius.com/v1",
      model: MODEL,
      allowLive: true,
      fetch: fake as typeof fetch,
    });
    const created = await journey(ctx);
    await ctx.orchestrator.idle();
    const old = ctx.store.run(created.run.id);
    old.status = "environment_error";
    old.error = {
      code: "MALFORMED_MODEL_OUTPUT",
      message: "Historical output schema failure",
      retryable: true,
    };
    ctx.store.saveRun(old);
    const exported = await ctx.app.inject({
      method: "GET",
      url: `/v1/repairs/${old.id}/export`,
    });
    expect(exported.json().limitations.join(" ")).toContain(
      "cannot be reconstructed",
    );
    const retried = await ctx.app.inject({
      method: "POST",
      url: `/v1/repairs/${old.id}/retry`,
      payload: { mode: "live" },
    });
    await ctx.orchestrator.idle();
    await ctx.app.inject({
      method: "POST",
      url: `/v1/repairs/${retried.json().id}/generate`,
      payload: { mode: "live" },
    });
    await ctx.orchestrator.idle();
    const user = JSON.parse(
      JSON.parse(captured).messages.find(
        (value: { role: string }) => value.role === "user",
      ).content,
    );
    expect(user.failedPublicChecks.previousGenerationFailure).toMatchObject({
      code: "MALFORMED_MODEL_OUTPUT",
      finalContentAvailable: false,
    });
    expect(user.failedPublicChecks.previousCandidateSource).toBeNull();
    expect(
      user.failedPublicChecks.untrustedPreviousFinalContentExcerpt,
    ).toBeNull();
  });
  it("rejects preview writes, DNS rebinding, unsupported import and fabricated human metadata", async () => {
    const ctx = await context();
    const untrusted = await ctx.app.inject({
      method: "PUT",
      url: "/v1/settings",
      headers: { origin: "http://127.0.0.1:4103" },
      payload: {
        highContrast: true,
        reduceMotion: false,
        retentionDays: 30,
        defaultMode: "offline",
      },
    });
    expect(untrusted.statusCode).toBe(403);
    expect(
      (
        await ctx.app.inject({
          method: "GET",
          url: "/v1/bootstrap",
          headers: { host: "attacker.example" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await ctx.app.inject({
          method: "POST",
          url: "/v1/repositories/import",
          payload: { url: "https://example.org/repo" },
        })
      ).json().error.code,
    ).toBe("UNSUPPORTED_REPOSITORY_IMPORT");
    const run = await repaired(ctx);
    const note = {
      candidateDigest: run.candidates[0].digest,
      participant: "Pseudonym P1",
      operator: "Operator",
      browser: "Safari 26",
      assistiveTechnology: "VoiceOver",
      consent: true,
      completion: "completed",
      notes: "Observed the participant complete the fictional task.",
    };
    expect(
      (
        await ctx.app.inject({
          method: "POST",
          url: `/v1/repairs/${run.id}/human-observations`,
          payload: { ...note, independentlyReviewed: true },
        })
      ).statusCode,
    ).toBe(410);
    const saved = await ctx.app.inject({
      method: "POST",
      url: `/v1/repairs/${run.id}/human-observations`,
      payload: note,
    });
    expect(saved.statusCode).toBe(410);
    expect(ctx.store.run(run.id).humanObservations).toHaveLength(0);
  });
  it("replays persisted SSE events after a reconnect cursor without old events", async () => {
    const ctx = await context();
    const run = await repaired(ctx);
    const after = run.events[1].id;
    const address = await ctx.app.listen({ port: 0, host: "127.0.0.1" });
    const abort = new AbortController();
    const response = await fetch(`${address}/v1/repairs/${run.id}/events`, {
      headers: { "Last-Event-ID": String(after) },
      signal: abort.signal,
    });
    const reader = response.body!.getReader();
    const first = await reader.read();
    const text = new TextDecoder().decode(first.value);
    abort.abort();
    await reader.cancel().catch(() => undefined);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(text).not.toContain(`id: ${after}\n`);
    expect(text).toContain(`id: ${run.events.at(-1)!.id}\n`);
  });
  it("imports one-time consented assistive text and deletes every controlled private copy", async () => {
    const ctx = await context();
    const run = await repaired(ctx);
    const candidate = run.candidates[0];
    const receipt = await ctx.app.inject({
      method: "POST",
      url: "/v1/assistive-sessions",
      payload: {
        runId: run.id,
        candidateDigest: candidate.digest,
        buildId: candidate.buildId,
        contractDigest: run.contract.digest,
        participant: "Private participant pseudonym",
        operator: "Private operator",
        os: "macOS 26",
        browser: "Safari 26",
        assistiveTechnology: "VoiceOver",
        inputMode: "keyboard",
        locale: "en",
        consent: true,
        consentScope: "private-study",
      },
    });
    expect(receipt.statusCode).toBe(201);
    const { session, importToken } = receipt.json();
    const listed = (
      await ctx.app.inject({
        method: "GET",
        url: `/v1/assistive-sessions?runId=${run.id}`,
      })
    ).json();
    expect(JSON.stringify(listed)).not.toContain(importToken);
    expect(JSON.stringify(listed)).not.toContain("importTokenHash");
    const text =
      "Actual operator notes: this test verifies upload plumbing; it is not a participant session.";
    const payload = {
      importToken,
      candidateDigest: candidate.digest,
      buildId: candidate.buildId,
      contractDigest: run.contract.digest,
      completion: "stopped",
      elapsedMs: 12000,
      interventions: 0,
      operatorAttestation: true,
      artifacts: [
        {
          name: "operator-notes.txt",
          evidenceType: "operator-notes",
          content: text,
          sha256: sha256(text),
        },
      ],
    };
    const mismatch = await ctx.app.inject({
      method: "POST",
      url: `/v1/assistive-sessions/${session.id}/import`,
      payload: {
        ...payload,
        artifacts: [{ ...payload.artifacts[0], sha256: "0".repeat(64) }],
      },
    });
    expect(mismatch.statusCode).toBe(400);
    const imported = await ctx.app.inject({
      method: "POST",
      url: `/v1/assistive-sessions/${session.id}/import`,
      payload,
    });
    expect(imported.statusCode).toBe(200);
    expect(imported.json()).toMatchObject({
      status: "imported",
      independentlyReviewed: false,
      backendOutcomeVerified: false,
    });
    expect(
      (
        await ctx.app.inject({
          method: "POST",
          url: `/v1/assistive-sessions/${session.id}/import`,
          payload,
        })
      ).statusCode,
    ).toBe(409);
    const artifactUrl = imported.json().artifacts[0].url;
    expect(
      (await ctx.app.inject({ method: "GET", url: artifactUrl })).body,
    ).toBe(text);
    expect(
      (
        await ctx.app.inject({
          method: "GET",
          url: `/v1/artifacts/${sha256(text)}`,
        })
      ).statusCode,
    ).toBe(404);
    const exportedResponse = await ctx.app.inject({
      method: "GET",
      url: `/v1/repairs/${run.id}/export`,
    });
    const exported = exportedResponse.body;
    expect(exported).not.toContain(text);
    expect(exported).not.toContain("Private participant pseudonym");
    const exportDigest = exportedResponse.headers["x-content-sha256"] as string;
    expect(sha256(exported)).toBe(exportDigest);
    expect(exportedResponse.json().assistiveCaptureSummary).toMatchObject({
      imported: 1,
      independentlyReviewed: 0,
    });
    expect(
      (
        await ctx.app.inject({
          method: "GET",
          url: `/v1/artifacts/${exportDigest}`,
        })
      ).statusCode,
    ).toBe(200);
    const deleted = await ctx.app.inject({
      method: "DELETE",
      url: `/v1/captures/${session.id}`,
    });
    expect(deleted.json()).toMatchObject({
      status: "deleted",
      metadata: null,
      artifacts: [],
      result: null,
    });
    expect(
      (await ctx.app.inject({ method: "GET", url: artifactUrl })).statusCode,
    ).toBe(410);
    expect(
      (
        await ctx.app.inject({
          method: "GET",
          url: `/v1/artifacts/${exportDigest}`,
        })
      ).statusCode,
    ).toBe(410);
    const refreshed = await ctx.app.inject({
      method: "GET",
      url: `/v1/repairs/${run.id}/export`,
    });
    expect(refreshed.json().assistiveCaptureSummary).toMatchObject({
      imported: 0,
      revokedOrExpired: 1,
    });
    expect(
      (
        await ctx.app.inject({
          method: "DELETE",
          url: `/v1/captures/${session.id}`,
        })
      ).json().status,
    ).toBe("deleted");
    const status = (
      await ctx.app.inject({ method: "GET", url: "/v1/captures/status" })
    ).json();
    expect(status.deleted).toBe(1);
    expect(JSON.stringify(status)).not.toContain(
      "Private participant pseudonym",
    );
  });
  it("expires private captures and prevents manifest imports against stale contracts", async () => {
    const ctx = await context();
    const run = await repaired(ctx);
    const candidate = run.candidates[0];
    const create = async () =>
      (
        await ctx.app.inject({
          method: "POST",
          url: "/v1/assistive-sessions",
          payload: {
            runId: run.id,
            candidateDigest: candidate.digest,
            buildId: candidate.buildId,
            contractDigest: run.contract.digest,
            participant: "P1",
            operator: "Operator",
            os: "macOS",
            browser: "Safari",
            assistiveTechnology: "VoiceOver",
            inputMode: "keyboard",
            locale: "en",
            consent: true,
            consentScope: "private-study",
          },
        })
      ).json();
    const first = await create();
    const stored = ctx.store.get<
      import("../server/captures.js").AssistiveSession
    >("capture", first.session.id)!;
    stored.expiresAt = "2000-01-01T00:00:00.000Z";
    ctx.store.put("capture", stored.id, stored);
    const expired = await ctx.app.inject({
      method: "GET",
      url: `/v1/assistive-sessions/${stored.id}`,
    });
    expect(expired.json()).toMatchObject({ status: "expired", metadata: null });
    const second = await create();
    await ctx.app.inject({
      method: "PUT",
      url: `/v1/contracts/${run.contract.id}`,
      payload: {
        expectedVersion: 1,
        task: "A newly reviewed appointment task",
        reviewer: "Reviewer",
        assertions: run.contract.assertions,
      },
    });
    const content = "Actual operator observation from a previous contract.";
    const stale = await ctx.app.inject({
      method: "POST",
      url: `/v1/assistive-sessions/${second.session.id}/import`,
      payload: {
        importToken: second.importToken,
        candidateDigest: candidate.digest,
        buildId: candidate.buildId,
        contractDigest: run.contract.digest,
        completion: "blocked",
        elapsedMs: 10000,
        interventions: 1,
        operatorAttestation: true,
        artifacts: [
          {
            name: "notes.txt",
            evidenceType: "operator-notes",
            content,
            sha256: sha256(content),
          },
        ],
      },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("STALE_CONTRACT");
  });
  it("merges individual settings without resetting other preferences", async () => {
    const ctx = await context();
    const response = await ctx.app.inject({
      method: "PUT",
      url: "/v1/settings",
      payload: { highContrast: true },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      highContrast: true,
      reduceMotion: false,
      retentionDays: 30,
      defaultMode: "offline",
    });
    expect(
      (
        await ctx.app.inject({
          method: "PUT",
          url: "/v1/settings",
          payload: { retentionDays: 0 },
        })
      ).statusCode,
    ).toBe(400);
    expect(ctx.store.settings().highContrast).toBe(true);
  });
  it("bundles exact source/artifact bytes with portable paths and verified checksums", async () => {
    const trace = Buffer.from(
      '{"event":"synthetic protocol-test trace, not browser evidence"}',
    );
    const digest = sha256(trace);
    const engine = basicEngine({
      verify: async (args) => {
        const value = result(
          args.build,
          args.contract,
          args.scenario,
          args.kind,
        );
        value.artifacts = [
          {
            name: "Protocol trace",
            digest,
            url: `http://127.0.0.1:4103/artifacts/${digest}.json`,
            mediaType: "application/json",
          },
        ];
        return value;
      },
    });
    const ctx = await context(engine);
    engine.root = join(ctx.store.root, "engine");
    mkdirSync(join(engine.root, "artifacts"), { recursive: true });
    writeFileSync(join(engine.root, "artifacts", `${digest}.json`), trace);
    const run = await repaired(ctx);
    const response = await ctx.app.inject({
      method: "GET",
      url: `/v1/repairs/${run.id}/bundle`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("application/zip");
    expect(sha256(response.rawPayload)).toBe(
      response.headers["x-content-sha256"],
    );
    const files = unzipSync(response.rawPayload);
    expect(Buffer.from(files[`artifacts/${digest}.json`])).toEqual(trace);
    expect(strFromU8(files["source/original.jsx"])).toContain(
      "Original authored source",
    );
    expect(strFromU8(files["candidates/001/repair.patch"])).toContain(
      "Reference authored source",
    );
    const manifest = JSON.parse(strFromU8(files["manifest.json"]));
    expect(manifest.portable.pathBase).toBe("archive-root");
    expect(manifest.run.candidates[0].verification.artifacts[0].url).toBe(
      `artifacts/${digest}.json`,
    );
    expect(manifest.run.candidates[0].previewUrl).toBeNull();
    for (const line of strFromU8(files["SHA256SUMS"]).trim().split("\n")) {
      const [hash, path] = line.split("  ");
      expect(sha256(Buffer.from(files[path]))).toBe(hash);
    }
    writeFileSync(join(engine.root, "artifacts", `${digest}.json`), "tampered");
    const invalid = await ctx.app.inject({
      method: "GET",
      url: `/v1/repairs/${run.id}/bundle`,
    });
    expect(invalid.statusCode).toBe(500);
    expect(invalid.json().error.code).toBe("BUNDLE_ARTIFACT_CORRUPTED");
  });
  it("excludes legacy private identifiers and notes from every exported representation", async () => {
    const ctx = await context();
    const run = await repaired(ctx);
    run.humanObservations.push({
      id: "legacy",
      runId: run.id,
      candidateDigest: run.candidates[0].digest,
      contractDigest: run.contract.digest,
      createdAt: new Date().toISOString(),
      participant: "PRIVATE_PARTICIPANT_SENTINEL",
      operator: "PRIVATE_OPERATOR_SENTINEL",
      browser: "Safari",
      assistiveTechnology: "VoiceOver",
      consent: true,
      completion: "blocked",
      notes: "PRIVATE_TRANSCRIPT_SENTINEL",
      evidenceType: "operator-observation",
      independentlyReviewed: false,
    });
    ctx.store.saveRun(run);
    const manifestResponse = await ctx.app.inject({
      method: "GET",
      url: `/v1/repairs/${run.id}/export`,
    });
    expect(manifestResponse.statusCode).toBe(200);
    expect(manifestResponse.body).not.toContain("PRIVATE_");
    const manifest = manifestResponse.json();
    expect(manifest.run.humanObservations).toEqual([]);
    for (const artifact of manifest.integrity.artifacts)
      expect(ctx.store.readArtifact(artifact.digest).toString()).not.toContain(
        "PRIVATE_",
      );
    const archive = await ctx.app.inject({
      method: "GET",
      url: `/v1/repairs/${run.id}/bundle`,
    });
    expect(archive.statusCode).toBe(200);
    for (const bytes of Object.values(unzipSync(archive.rawPayload)))
      expect(strFromU8(bytes)).not.toContain("PRIVATE_");
    expect(ctx.store.run(run.id).humanObservations[0].participant).toBe(
      "PRIVATE_PARTICIPANT_SENTINEL",
    );
  });
});
