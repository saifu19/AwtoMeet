import { FastifyInstance } from 'fastify';
import { ulid } from 'ulid';
import { z } from 'zod';
import {
  CreateMeetingTypeReq,
  UpdateMeetingTypeReq,
  UlidSchema,
} from '@meeting-app/shared';
import { requireAuth } from '../plugins/auth.js';
import { assertCanAccess } from '../authz/index.js';
import * as meetingTypesRepo from '../repositories/meeting-types.js';

const IdParam = z.object({ id: UlidSchema });

export default async function meetingTypeRoutes(app: FastifyInstance) {
  // ── GET /meeting-types ─────────────────────────────────────────
  app.get('/', { preHandler: [requireAuth] }, async (request) => {
    const userId = request.user!.id;
    const data = await meetingTypesRepo.listByOwner(userId);
    return { data };
  });

  // ── POST /meeting-types ────────────────────────────────────────
  app.post('/', { preHandler: [requireAuth] }, async (request, reply) => {
    const body = CreateMeetingTypeReq.parse(request.body);
    const userId = request.user!.id;
    const agentIds = body.agent_ids ?? [];

    // Validate agent ownership
    if (agentIds.length > 0) {
      const allOwned = await meetingTypesRepo.validateAgentOwnership(
        agentIds,
        userId,
      );
      if (!allOwned) {
        return reply.code(400).send({
          error: 'Validation',
          message:
            'One or more agent_ids do not exist or do not belong to you.',
          status_code: 400,
        });
      }
    }

    const id = ulid();
    await meetingTypesRepo.create(
      {
        id,
        userId,
        orgId: null,
        name: body.name,
        description: body.description ?? null,
        agendaItems: body.agenda_items ?? null,
        bufferSize: body.buffer_size ?? 10,
      },
      agentIds,
    );

    const created = await meetingTypesRepo.getByIdWithAgents(id);
    return reply.code(201).send(created);
  });

  // ── GET /meeting-types/:id ─────────────────────────────────────
  app.get('/:id', { preHandler: [requireAuth] }, async (request) => {
    const { id } = IdParam.parse(request.params);
    const mt = await meetingTypesRepo.getByIdWithAgents(id);
    assertCanAccess(request.user!, mt);
    return mt;
  });

  // ── PATCH /meeting-types/:id ───────────────────────────────────
  app.patch('/:id', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = IdParam.parse(request.params);
    const existing = await meetingTypesRepo.getByIdWithAgents(id);
    assertCanAccess(request.user!, existing);

    const body = UpdateMeetingTypeReq.parse(request.body);
    const userId = request.user!.id;

    // Validate agent ownership if agent_ids provided
    if (body.agent_ids !== undefined && body.agent_ids.length > 0) {
      const allOwned = await meetingTypesRepo.validateAgentOwnership(
        body.agent_ids,
        userId,
      );
      if (!allOwned) {
        return reply.code(400).send({
          error: 'Validation',
          message:
            'One or more agent_ids do not exist or do not belong to you.',
          status_code: 400,
        });
      }
    }

    // Map snake_case request fields to camelCase Drizzle fields
    const patch: Parameters<typeof meetingTypesRepo.update>[1] = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.description !== undefined) patch.description = body.description;
    if (body.agenda_items !== undefined) patch.agendaItems = body.agenda_items;
    if (body.buffer_size !== undefined) patch.bufferSize = body.buffer_size;

    await meetingTypesRepo.update(id, patch, body.agent_ids);

    const updated = await meetingTypesRepo.getByIdWithAgents(id);
    return updated;
  });

  // ── DELETE /meeting-types/:id ──────────────────────────────────
  app.delete('/:id', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = IdParam.parse(request.params);
    const existing = await meetingTypesRepo.getByIdWithAgents(id);
    assertCanAccess(request.user!, existing);

    await meetingTypesRepo.deleteWithDetach(id);
    return reply.code(204).send();
  });
}
