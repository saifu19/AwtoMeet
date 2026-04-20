import { FastifyInstance } from 'fastify';
import { ulid } from 'ulid';
import { z } from 'zod';
import { CreateAgentReq, UpdateAgentReq, UlidSchema } from '@meeting-app/shared';
import { requireAuth } from '../plugins/auth.js';
import { assertCanAccess } from '../authz/index.js';
import * as agentsRepo from '../repositories/agents.js';

const IdParam = z.object({ id: UlidSchema });

export default async function agentRoutes(app: FastifyInstance) {
  // ── GET /agents ────────────────────────────────────────────────────
  app.get('/', { preHandler: [requireAuth] }, async (request) => {
    const userId = request.user!.id;
    const data = await agentsRepo.listByOwner(userId);
    return { data };
  });

  // ── POST /agents ───────────────────────────────────────────────────
  app.post('/', { preHandler: [requireAuth] }, async (request, reply) => {
    const body = CreateAgentReq.parse(request.body);
    const id = ulid();

    await agentsRepo.create({
      id,
      userId: request.user!.id,
      orgId: null,
      name: body.name,
      systemPrompt: body.system_prompt,
      provider: body.provider ?? null,
      model: body.model ?? null,
    });

    const agent = await agentsRepo.getById(id);
    return reply.code(201).send(agent);
  });

  // ── GET /agents/:id ────────────────────────────────────────────────
  app.get('/:id', { preHandler: [requireAuth] }, async (request) => {
    const { id } = IdParam.parse(request.params);
    const agent = await agentsRepo.getById(id);
    assertCanAccess(request.user!, agent);
    return agent;
  });

  // ── PATCH /agents/:id ──────────────────────────────────────────────
  app.patch('/:id', { preHandler: [requireAuth] }, async (request) => {
    const { id } = IdParam.parse(request.params);
    const existing = await agentsRepo.getById(id);
    assertCanAccess(request.user!, existing);

    const body = UpdateAgentReq.parse(request.body);

    // Map snake_case request fields to camelCase Drizzle fields
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.system_prompt !== undefined) patch.systemPrompt = body.system_prompt;
    if (body.provider !== undefined) patch.provider = body.provider;
    if (body.model !== undefined) patch.model = body.model;

    if (Object.keys(patch).length > 0) {
      await agentsRepo.update(id, patch);
    }

    const updated = await agentsRepo.getById(id);
    return updated;
  });

  // ── DELETE /agents/:id ─────────────────────────────────────────────
  app.delete('/:id', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = IdParam.parse(request.params);
    const existing = await agentsRepo.getById(id);
    assertCanAccess(request.user!, existing);

    const inUse = await agentsRepo.isReferencedByMeetingType(id);
    if (inUse) {
      return reply.code(409).send({
        error: 'Conflict',
        message: 'Agent is in use by a meeting type. Detach it first.',
        status_code: 409,
      });
    }

    await agentsRepo.remove(id);
    return reply.code(204).send();
  });
}
