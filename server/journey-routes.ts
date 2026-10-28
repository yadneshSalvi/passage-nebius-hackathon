import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { JourneyService } from "./journey-service.js";
import { buildJourneyGuardBundle } from "./journey-guard.js";

const sessionId = (params: unknown) => z.object({ id: z.string().min(1).max(180) }).parse(params).id;
const scheduleId = z.enum(["baseline", "cancel-pending", "modal-boundary"]);
const execution = z.object({ variant: z.enum(["original", "reference", "candidate"]), scheduleId }).strict();
export function registerJourneyRoutes(app: FastifyInstance, compiler: JourneyService) {
  app.get("/v1/compiler/bootstrap", () => compiler.bootstrap());
  app.get("/v1/compiler/story", () => compiler.story());
  app.post("/v1/compiler/sessions", async (request, reply) => {
    const input = z.object({ fixtureId: z.string().min(1).max(180), task: z.string().trim().min(8).max(2000).optional(), captureConsent: z.literal(true) }).strict().parse(request.body);
    return reply.status(201).send(compiler.create(input));
  });
  app.get("/v1/compiler/sessions/:id", request => compiler.session(sessionId(request.params)));
  app.get("/v1/compiler/sessions/:id/previews/:captureId", async (request, reply) => {
    const input = z.object({ id: z.string().min(1).max(180), captureId: z.string().min(1).max(180) }).parse(request.params);
    return reply.redirect(await compiler.preview(input.id, input.captureId));
  });
  app.post("/v1/compiler/sessions/:id/capture", (request, reply) => reply.status(202).send(compiler.capture(sessionId(request.params), execution.parse(request.body))));
  app.post("/v1/compiler/sessions/:id/draft", (request, reply) => {
    const input = z.object({ mode: z.enum(["observed", "live"]), reviewNotes: z.string().trim().max(5000).optional() }).strict().parse(request.body);
    return reply.status(202).send(compiler.draft(sessionId(request.params), input));
  });
  app.post("/v1/compiler/sessions/:id/review", request => compiler.review(sessionId(request.params), request.body));
  app.post("/v1/compiler/sessions/:id/verify", (request, reply) => reply.status(202).send(compiler.verify(sessionId(request.params), execution.parse(request.body))));
  app.post("/v1/compiler/sessions/:id/reduce", (request, reply) => { const input = z.object({ captureId: z.string().min(1).max(180) }).strict().parse(request.body); return reply.status(202).send(compiler.reduce(sessionId(request.params), input.captureId)); });
  app.post("/v1/compiler/sessions/:id/probe", (request, reply) => { const input = execution.extend({ label: z.string().min(3).max(200), steps: z.array(z.string().min(1).max(120)).min(1).max(200) }).strict().parse(request.body); return reply.status(202).send(compiler.probe(sessionId(request.params), input)); });
  app.post("/v1/compiler/sessions/:id/explore", (request, reply) => {
    const { mode: _mode, ...input } = execution.extend({ mode: z.literal("live") }).strict().parse(request.body);
    return reply.status(202).send(compiler.explore(sessionId(request.params), input));
  });
  app.post("/v1/compiler/sessions/:id/repair", (request, reply) => {
    const input = z.object({ mode: z.literal("live"), additionalObservation: z.unknown().optional() }).strict().parse(request.body);
    return reply.status(202).send(compiler.repair(sessionId(request.params), input.additionalObservation));
  });
  app.post("/v1/compiler/sessions/:id/preservation", (request, reply) => {
    const input = z.object({ repairId: z.string().min(1).max(180) }).strict().parse(request.body);
    return reply.status(202).send(compiler.preservation(sessionId(request.params), input.repairId));
  });
  app.post("/v1/compiler/sessions/:id/cancel", request => compiler.cancel(sessionId(request.params)));
  app.post("/v1/compiler/sessions/:id/revisions", (request, reply) => {
    const input = z.object({ label: z.string().trim().min(3).max(180), classification: z.enum(["harmless-refactor", "declared-regression", "external-revision"]), source: z.string().min(100).max(24000) }).strict().parse(request.body);
    return reply.status(202).send(compiler.revision(sessionId(request.params), input));
  });
  app.get("/v1/compiler/sessions/:id/export", request => compiler.export(sessionId(request.params)));
  app.get("/v1/compiler/sessions/:id/guard.zip", async (request, reply) => {
    const artifact = await buildJourneyGuardBundle(compiler.export(sessionId(request.params)));
    reply.header("Content-Type", "application/zip");
    reply.header("Content-Disposition", 'attachment; filename="passage-journey-guard.zip"');
    return reply.send(artifact);
  });
}
