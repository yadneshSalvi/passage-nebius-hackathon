import Fastify, { type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import { fileURLToPath } from "node:url";
import { AppError, Store, sha256 } from "./store.js";
import { RepairProvider, type ProviderConfig } from "./provider.js";
import { Orchestrator, type Engine } from "./orchestrator.js";
import type { BootstrapData, InteractionContract } from "../shared/types.js";
import {
  Captures,
  captureCreateSchema,
  captureImportSchema,
} from "./captures.js";
import { buildEvidenceBundle } from "./bundle.js";
import { JourneyService } from "./journey-service.js";
import { registerJourneyRoutes } from "./journey-routes.js";
import { RepositoryJourneyService } from "./repository-journey-service.js";
import { registerRepositoryJourneyRoutes } from "./repository-journey-routes.js";
import type { RepositoryOutcomeObserver } from "../engine/repository-worker.js";
import { RepositoryWorkerError, startRepositoryPreview, stopRepositoryPreview } from "../engine/repository-worker.js";
import { FixtureHost } from "../engine/host.js";
import { CaptureReview, captureReviewStartSchema, captureReviewDecisionSchema, captureReviewVerifySchema } from "./capture-review.js";

const mode = z.enum(["offline", "live"]);
const idSchema = z.string().min(1).max(120);
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const journeySchema = z
  .object({
    fixtureId: idSchema,
    inputMode: z.literal("keyboard"),
    locale: z.literal("en"),
    captureConsent: z.literal(true),
  })
  .strict();
const assertionSchema = z
  .object({
    id: z.string(),
    label: z.string().max(500),
    description: z.string().max(2000),
    enabled: z.boolean(),
    required: z.boolean(),
    source: z.string().max(2000),
    evidenceType: z.enum(["browser", "backend"]),
  })
  .strict();
const contractSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    task: z.string().trim().min(8).max(2000),
    reviewer: z.string().trim().min(1).max(200),
    assertions: z.array(assertionSchema).max(30),
  })
  .strict();
const observationSchema = z
  .object({
    candidateDigest: digestSchema,
    participant: z.string().trim().min(1).max(120),
    operator: z.string().trim().min(1).max(120),
    browser: z.string().trim().min(1).max(200),
    assistiveTechnology: z.string().trim().min(1).max(200),
    consent: z.literal(true),
    completion: z.enum(["completed", "blocked", "stopped"]),
    notes: z.string().trim().min(10).max(10000),
  })
  .strict();
const settingsSchema = z
  .object({
    highContrast: z.boolean(),
    reduceMotion: z.boolean(),
    retentionDays: z.number().int().min(1).max(365),
    defaultMode: mode,
  })
  .strict();
const trustedOrigins = new Set([
  "http://127.0.0.1:4101",
  "http://localhost:4101",
  "http://127.0.0.1:4102",
  "http://localhost:4102",
]);
export interface AppOptions {
  dataDir?: string;
  engine?: Engine;
  provider?: ProviderConfig;
  repositoryOutcomeObservers?: ReadonlyMap<string, RepositoryOutcomeObserver>;
}

export async function createApp(options: AppOptions = {}) {
  const store = new Store(
    options.dataDir ?? fileURLToPath(new URL("../.passage", import.meta.url)),
  );
  const provider = new RepairProvider(store, options.provider);
  const orchestrator = new Orchestrator(store, provider, options.engine);
  const captures = new Captures(store);
  const compiler = new JourneyService(store, provider);
  const repository = new RepositoryJourneyService(store, provider, options.repositoryOutcomeObservers);
  const captureReview = orchestrator.engine instanceof FixtureHost ? new CaptureReview(store, captures, orchestrator.engine) : null;
  const retentionTimer = setInterval(() => captures.purgeExpired(), 60000);
  retentionTimer.unref();
  const app = Fastify({
    logger: false,
    bodyLimit: 100000,
    requestTimeout: 30000,
    trustProxy: false,
  });
  let openStreams = 0;
  const streams = new Set<import("node:http").ServerResponse>();
  await app.register(cors, {
    origin: [...trustedOrigins],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Idempotency-Key", "Last-Event-ID"],
  });
  app.addHook("onRequest", async (request, reply) => {
    const host = request.headers.host?.toLowerCase();
    if (host && !/^(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(host))
      throw new AppError(
        "INVALID_HOST",
        "This development API accepts only loopback hostnames.",
        403,
      );
    const origin = request.headers.origin;
    if (origin && !trustedOrigins.has(origin))
      throw new AppError(
        "UNTRUSTED_ORIGIN",
        "This origin is not authorized to access the local repair API.",
        403,
      );
    if (request.headers["sec-fetch-site"] === "cross-site")
      throw new AppError(
        "CROSS_SITE_REQUEST",
        "Cross-site requests are not authorized for the local repair API.",
        403,
      );
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Cache-Control", "no-store");
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError)
      return reply.status(400).send({
        error: {
          code: "INVALID_REQUEST",
          message: "Check the request fields and supported values.",
        },
      });
    if (error instanceof AppError)
      return reply
        .status(error.statusCode)
        .send({ error: { code: error.code, message: error.message } });
    if (error instanceof RepositoryWorkerError)
      return reply.status(error.code === "WORKER_UNQUALIFIED" ? 503 : 422)
        .send({ error: { code: error.code, message: error.message } });
    const rawStatus = (error as { statusCode?: number }).statusCode;
    const status = rawStatus && rawStatus < 500 ? rawStatus : 500;
    return reply.status(status).send({
      error: {
        code:
          status === 413
            ? "REQUEST_TOO_LARGE"
            : status === 400
              ? "INVALID_REQUEST"
              : "INTERNAL_ERROR",
        message:
          status < 500
            ? "The request could not be accepted."
            : "The local API could not complete this request. Completed evidence remains available.",
      },
    });
  });
  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).send({
      error: { code: "NOT_FOUND", message: "This API route does not exist." },
    }),
  );
  registerJourneyRoutes(app, compiler);
  registerRepositoryJourneyRoutes(app, repository);
  const runId = (request: FastifyRequest) =>
    idSchema.parse((request.params as { id: string }).id);
  const idempotent = <T>(
    request: FastifyRequest,
    parsed: unknown,
    fn: () => T,
  ): T => {
    const key = request.headers["idempotency-key"];
    if (key !== undefined && typeof key !== "string")
      throw new AppError(
        "INVALID_IDEMPOTENCY_KEY",
        "Supply one idempotency key.",
      );
    return store.idempotent(
      key,
      sha256(
        JSON.stringify({
          method: request.method,
          route: request.url,
          body: parsed,
        }),
      ),
      fn,
    );
  };
  app.get("/health", async () => ({
    status: "ok",
    service: "passage",
    execution: "local-single-worker",
  }));
  app.get("/v1/bootstrap", async (): Promise<BootstrapData> => ({
    fixtures: orchestrator.fixtures(),
    scenarios: orchestrator.scenarios(),
    journeys: store.list("journey"),
    runs: store.runs(),
    provider: provider.status(),
    settings: store.settings(),
  }));
  app.get("/v1/repairs/:id", async (request) => store.run(runId(request)));
  app.get("/v1/journeys/:id", async (request) => store.journey(runId(request)));
  app.get("/v1/contracts/:id", async (request) =>
    store.contract(runId(request)),
  );
  app.post("/v1/journeys", async (request, reply) => {
    const input = journeySchema.parse(request.body);
    const result = idempotent(request, input, () =>
      orchestrator.createJourney(input),
    );
    orchestrator.startBaseline(result.run.id);
    return reply.status(201).send(result);
  });
  app.post("/v1/repairs/:id/generate", async (request, reply) => {
    const input = z.object({ mode }).strict().parse(request.body);
    return reply
      .status(202)
      .send(
        idempotent(request, input, () =>
          orchestrator.generate(runId(request), input.mode),
        ),
      );
  });
  app.post("/v1/repairs/:id/cancel", async (request) =>
    orchestrator.cancel(runId(request)),
  );
  app.post("/v1/repairs/:id/retry", async (request, reply) => {
    const input = z
      .object({ mode: mode.optional() })
      .strict()
      .parse(request.body ?? {});
    const run = idempotent(request, input, () =>
      orchestrator.retry(runId(request), input.mode),
    );
    orchestrator.startBaseline(run.id);
    return reply.status(201).send(run);
  });
  app.put("/v1/contracts/:id", async (request) => {
    const input = contractSchema.parse(request.body);
    return orchestrator.reviseContract(
      runId(request),
      input as {
        expectedVersion: number;
        task: string;
        reviewer: string;
        assertions: InteractionContract["assertions"];
      },
    );
  });
  app.post("/v1/repairs/:id/challenges", async (request, reply) => {
    const input = z
      .object({ scenarioId: idSchema, candidateDigest: digestSchema })
      .strict()
      .parse(request.body);
    return reply
      .status(202)
      .send(
        idempotent(request, input, () =>
          orchestrator.challenge(
            runId(request),
            input.scenarioId,
            input.candidateDigest,
          ),
        ),
      );
  });
  app.post("/v1/repairs/:id/human-observations", async (request) => {
    store.run(runId(request));
    throw new AppError(
      "USE_BOUND_ASSISTIVE_SESSION",
      "Create a consented /v1/assistive-sessions capture bound to this candidate, build and contract. Legacy run notes are retained as historical evidence; new private observations require revocable capture storage.",
      410,
    );
  });
  app.get("/v1/repairs/:id/export", async (request, reply) => {
    const base = await orchestrator.export(runId(request));
    const evidence = captures.evidence(base.run.id);
    const manifest = { ...base, ...evidence };
    const content = JSON.stringify(manifest, null, 2);
    const artifact = store.artifact(content);
    captures.linkExport(
      evidence.assistiveSessions
        .filter((value) => ["pending", "imported"].includes(value.status))
        .map((value) => value.id),
      artifact.digest,
    );
    return reply
      .type("application/json; charset=utf-8")
      .header(
        "Content-Disposition",
        `attachment; filename="passage-${manifest.run.id}-evidence.json"`,
      )
      .header("X-Content-SHA256", artifact.digest)
      .send(content);
  });
  app.get("/v1/repairs/:id/patch", async (request, reply) => {
    const run = store.run(runId(request));
    const candidate = run.candidates.find(
      (value) => value.id === run.activeCandidateId,
    );
    if (!candidate)
      throw new AppError(
        "PATCH_UNAVAILABLE",
        "No candidate patch is available for this run yet.",
        404,
      );
    return reply
      .type("text/x-diff; charset=utf-8")
      .header(
        "Content-Disposition",
        `attachment; filename="passage-${run.id}.patch"`,
      )
      .header("X-Content-SHA256", sha256(candidate.patch))
      .send(candidate.patch);
  });
  app.get("/v1/repairs/:id/bundle", async (request, reply) => {
    const archive = await buildEvidenceBundle(
      store,
      orchestrator,
      captures,
      runId(request),
    );
    return reply
      .type("application/zip")
      .header(
        "Content-Disposition",
        `attachment; filename="${archive.filename}"`,
      )
      .header("X-Content-SHA256", archive.digest)
      .send(archive.content);
  });
  app.get("/v1/artifacts/:digest", async (request, reply) =>
    reply
      .type("application/octet-stream")
      .header("Content-Disposition", "attachment")
      .send(store.readArtifact((request.params as { digest: string }).digest)),
  );
  app.put("/v1/settings", async (request) => {
    const updates = settingsSchema.partial().parse(request.body);
    const settings = settingsSchema.parse({ ...store.settings(), ...updates });
    store.saveSettings(settings);
    return settings;
  });
  app.get("/v1/provider/usage", async () => provider.usage());
  app.post("/v1/assistive-sessions", async (request, reply) =>
    reply
      .status(201)
      .send(captures.create(captureCreateSchema.parse(request.body))),
  );
  const boundCapture = () => {
    if (!captureReview) throw new AppError("CAPTURE_HOST_UNAVAILABLE", "A real protected fixture host is required to bind an operator attempt.", 503);
    return captureReview;
  };
  app.post("/v1/assistive-sessions/bound", async (request, reply) => reply.status(201).send(await boundCapture().start(captureReviewStartSchema.parse(request.body))));
  app.post("/v1/assistive-sessions/:id/verify-outcome", async request => { captureReviewVerifySchema.parse(request.body); return boundCapture().verify(runId(request)); });
  app.post("/v1/assistive-sessions/:id/review", request => boundCapture().review(runId(request), captureReviewDecisionSchema.parse(request.body)));
  app.get("/v1/assistive-sessions", async (request) => {
    const query = z
      .object({ runId: idSchema.optional() })
      .strict()
      .parse(request.query);
    return { sessions: captures.list(query.runId) };
  });
  app.get("/v1/assistive-sessions/:id", async (request) =>
    captures.read(runId(request)),
  );
  app.post("/v1/assistive-sessions/:id/import", async (request) =>
    captures.import(runId(request), captureImportSchema.parse(request.body)),
  );
  app.get(
    "/v1/assistive-sessions/:id/artifacts/:digest",
    async (request, reply) =>
      reply
        .type("text/plain; charset=utf-8")
        .header("Content-Disposition", "attachment")
        .send(
          captures.artifact(
            runId(request),
            (request.params as { digest: string }).digest,
          ),
        ),
  );
  app.delete("/v1/captures/:id", async (request) =>
    captures.delete(runId(request)),
  );
  app.get("/v1/captures/status", async () => captures.status());
  app.post("/v1/provider/reset-credit-error", async (request) => {
    z.object({ acknowledgeFundingRestored: z.literal(true) })
      .strict()
      .parse(request.body);
    return provider.resetCreditError();
  });
  app.post("/v1/repositories/import", async () => {
    throw new AppError(
      "UNSUPPORTED_REPOSITORY_IMPORT",
      "Use the Journey Compiler repository workspace with an immutable reviewed public-source manifest and the qualified fixed-dependency worker. Arbitrary repository scripts are not supported by this legacy endpoint.",
      422,
    );
  });
  app.post("/v1/repairs/:id/pull-request", async (request) => {
    store.run(runId(request));
    throw new AppError(
      "PUBLICATION_NOT_CONFIGURED",
      "Download the exact patch and evidence bundle for maintainer review. Repository publication is not configured in this local release.",
      422,
    );
  });
  app.get("/v1/repairs/:id/events", async (request, reply) => {
    const targetId = runId(request);
    store.run(targetId);
    const query = z
      .object({
        after: z.coerce
          .number()
          .int()
          .nonnegative()
          .max(Number.MAX_SAFE_INTEGER)
          .optional(),
        cursor: z.coerce
          .number()
          .int()
          .nonnegative()
          .max(Number.MAX_SAFE_INTEGER)
          .optional(),
      })
      .parse(request.query);
    const header = request.headers["last-event-id"];
    const after =
      query.after ??
      query.cursor ??
      (header === undefined
        ? 0
        : z.coerce
            .number()
            .int()
            .nonnegative()
            .max(Number.MAX_SAFE_INTEGER)
            .parse(header));
    if (openStreams >= 20)
      throw new AppError(
        "STREAM_LIMIT",
        "Too many event streams are open. Close an unused repair tab and reconnect.",
        429,
      );
    openStreams++;
    const headers: Record<string, string> = {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    };
    if (request.headers.origin) {
      headers["Access-Control-Allow-Origin"] = request.headers.origin;
      headers.Vary = "Origin";
    }
    reply.hijack();
    streams.add(reply.raw);
    reply.raw.writeHead(200, headers);
    reply.raw.write("retry: 1500\n\n");
    let cursor = after;
    let closed = false;
    const send = (event: ReturnType<Store["events"]>[number]) => {
      if (closed || event.runId !== targetId || event.id <= cursor) return;
      if (reply.raw.writableLength > 1024 * 1024) {
        reply.raw.destroy();
        return;
      }
      cursor = event.id;
      reply.raw.write(
        `id: ${event.id}\nevent: progress\ndata: ${JSON.stringify(event)}\n\n`,
      );
    };
    const unsubscribe = store.subscribe(send);
    for (const event of store.events(targetId, after)) send(event);
    const keepalive = setInterval(() => {
      if (!closed) reply.raw.write(": keepalive\n\n");
    }, 15000);
    keepalive.unref();
    reply.raw.once("close", () => {
      closed = true;
      openStreams--;
      streams.delete(reply.raw);
      clearInterval(keepalive);
      unsubscribe();
    });
  });
  app.addHook("preClose", async () => {
    for (const stream of streams) stream.end();
  });
  app.addHook("onClose", async () => {
    clearInterval(retentionTimer);
    await repository.close();
    await stopRepositoryPreview();
    await compiler.close();
    await orchestrator.close();
    store.close();
  });
  try {
    await orchestrator.start();
    await compiler.start();
    repository.start();
    if (!options.dataDir && repository.sessions().some(session => session.build || session.replays.length))
      await startRepositoryPreview();
    await app.ready();
  } catch (error) {
    clearInterval(retentionTimer);
    await repository.close().catch(() => undefined);
    await stopRepositoryPreview().catch(() => undefined);
    await compiler.close().catch(() => undefined);
    await orchestrator.close().catch(() => undefined);
    store.close();
    throw error;
  }
  return { app, store, provider, orchestrator, captures, compiler, repository };
}
