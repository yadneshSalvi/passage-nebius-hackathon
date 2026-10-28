import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PublicRepositorySnapshot } from "../shared/repository-journey.js";
import type { TemporalContractBody } from "../shared/temporal.js";
import { temporalContractBodySchema } from "../engine/contract-interpreter.js";
import { RepositoryJourneyService } from "./repository-journey-service.js";
import { buildRepositoryGuardBundle } from "./repository-guard.js";
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const repositorySnapshotSchema = z.object({
  schema: z.literal("passage.repository.v1"), repositoryUrl: z.string().min(1).max(500), revision: z.string().regex(/^[a-f0-9]{40}$/),
  sourceDigest: digest, entryPoint: z.string().min(1).max(500), rootElementId: z.string().min(1).max(80), rootElementClass: z.string().max(160).optional(),
  files: z.array(z.object({ path: z.string().min(1).max(500), sha256: digest, content: z.string().max(524288) }).strict()).min(1).max(200),
  disclosure: z.literal("public-source"), bootstrap: z.object({ source: z.string().max(10000), sha256: digest, description: z.string().min(1).max(1000) }).strict().optional(),
  moduleAliases: z.record(z.string().min(1).max(200), z.string().min(1).max(500)).optional(),
}).strict();
const sessionId = (params: unknown) => z.object({ id: z.string().min(1).max(180) }).parse(params).id;
const prefix = "/v1/compiler/repositories";
export function registerRepositoryJourneyRoutes(app: FastifyInstance, repository: RepositoryJourneyService) {
  app.get(`${prefix}/bootstrap`, () => repository.bootstrap());
  app.post(`${prefix}/inspect`, request => {
    const input = z.object({ rootPath: z.string().min(1).max(2000), repositoryUrl: z.string().min(1).max(500), revision: z.string().regex(/^[a-f0-9]{40}$/),
      sourcePaths: z.array(z.string().min(1).max(500)).min(1).max(200), entryPoint: z.string().min(1).max(500), rootElementId: z.string().max(80).optional(), rootElementClass: z.string().max(160).optional(),
      bootstrap: z.object({ source: z.string().max(10000), description: z.string().min(1).max(1000) }).strict().optional(), moduleAliases: z.record(z.string(), z.string()).optional() }).strict().parse(request.body);
    return repository.inspect(input);
  });
  app.post(prefix, { bodyLimit: 9 * 1024 * 1024 }, (request, reply) => {
    const input = z.object({ label: z.string().trim().min(3).max(180), task: z.string().trim().min(8).max(2000),
      snapshot: repositorySnapshotSchema, contract: temporalContractBodySchema, sourcePermission: z.literal("public-source-development"),
      outcomeObserverId: z.string().min(1).max(180).optional() }).strict().parse(request.body);
    return reply.status(201).send(repository.create({ ...input, snapshot: input.snapshot as PublicRepositorySnapshot, contract: input.contract as TemporalContractBody }));
  });
  app.get(`${prefix}/:id`, request => repository.session(sessionId(request.params)));
  app.post(`${prefix}/:id/build`, (request, reply) => reply.status(202).send(repository.build(sessionId(request.params))));
  app.post(`${prefix}/:id/capture`, (request, reply) => reply.status(202).send(repository.capture(sessionId(request.params))));
  app.post(`${prefix}/:id/draft`, (request, reply) => { const input = z.object({ mode: z.enum(["observed", "live"]) }).strict().parse(request.body); return reply.status(202).send(repository.draft(sessionId(request.params), input.mode)); });
  app.post(`${prefix}/:id/review`, request => repository.review(sessionId(request.params), request.body));
  app.post(`${prefix}/:id/revise`, request => repository.revise(sessionId(request.params), request.body));
  app.post(`${prefix}/:id/repair`, (request, reply) => { z.object({ mode: z.literal("live") }).strict().parse(request.body); return reply.status(202).send(repository.repair(sessionId(request.params))); });
  app.post(`${prefix}/:id/verify`, (request, reply) => { const input = z.object({ variant: z.enum(["original", "candidate"]) }).strict().parse(request.body); return reply.status(202).send(repository.verify(sessionId(request.params), input.variant)); });
  app.post(`${prefix}/:id/revision`, { bodyLimit: 9 * 1024 * 1024 }, (request, reply) => { const input = z.object({ label: z.string().trim().min(3).max(180), snapshot: repositorySnapshotSchema }).strict().parse(request.body); return reply.status(202).send(repository.revision(sessionId(request.params), input)); });
  app.post(`${prefix}/:id/cancel`, request => repository.cancel(sessionId(request.params)));
  app.post(`${prefix}/:id/assistive-evidence`, { bodyLimit: 300000 }, request => repository.attachAT(sessionId(request.params), request.body));
  app.get(`${prefix}/:id/export`, request => repository.export(sessionId(request.params)));
  app.get(`${prefix}/:id/guard.zip`, async (request, reply) => {
    const zip = await buildRepositoryGuardBundle(repository.export(sessionId(request.params)));
    reply.header("Content-Type", "application/zip"); reply.header("Content-Disposition", 'attachment; filename="passage-repository-guard.zip"'); return reply.send(zip);
  });
}
