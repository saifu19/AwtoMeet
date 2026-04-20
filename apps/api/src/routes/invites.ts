import { FastifyInstance } from 'fastify';
import { ulid } from 'ulid';
import { z } from 'zod';
import {
  CreateInviteReq,
  UpdateInviteReq,
  UlidSchema,
} from '@meeting-app/shared';
import { requireAuth } from '../plugins/auth.js';
import { assertCanAccess } from '../authz/index.js';
import * as meetingsRepo from '../repositories/meetings.js';
import * as invitesRepo from '../repositories/invites.js';
import { sendInviteEmail } from '../services/email.js';

const MeetingIdParam = z.object({ id: UlidSchema });
const InviteParams = z.object({ id: UlidSchema, inviteId: UlidSchema });
const TokenParam = z.object({ token: z.string().min(1) });

/**
 * CRUD endpoints for meeting invites — registered under /meetings
 * GET    /meetings/:id/invites
 * POST   /meetings/:id/invites
 * PATCH  /meetings/:id/invites/:inviteId
 * DELETE /meetings/:id/invites/:inviteId
 */
export async function meetingInviteRoutes(app: FastifyInstance) {
  // ── GET /meetings/:id/invites ──────────────────────────────────────
  app.get(
    '/:id/invites',
    { preHandler: [requireAuth] },
    async (request) => {
      const { id } = MeetingIdParam.parse(request.params);
      const meeting = await meetingsRepo.getById(id);
      assertCanAccess(request.user!, meeting); // host only
      const data = await invitesRepo.listByMeeting(id);
      return { data };
    },
  );

  // ── POST /meetings/:id/invites ─────────────────────────────────────
  // Rate-limited to prevent invite-email spam (each invite triggers an
  // outbound email). Picked up by @fastify/rate-limit when registered;
  // harmless no-op in the test harness.
  app.post(
    '/:id/invites',
    {
      preHandler: [requireAuth],
      config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
    },
    async (request, reply) => {
      const { id } = MeetingIdParam.parse(request.params);
      const meeting = await meetingsRepo.getById(id);
      assertCanAccess(request.user!, meeting);

      if (
        meeting!.status === 'ended' ||
        meeting!.status === 'cancelled'
      ) {
        return reply.code(409).send({
          error: 'Conflict',
          message: 'Cannot invite to an ended or cancelled meeting.',
          status_code: 409,
        });
      }

      const body = CreateInviteReq.parse(request.body);
      const inviteToken = invitesRepo.generateInviteToken();
      const inviteId = ulid();

      // Pre-bind if the invited email already has an account
      const existingUser = await invitesRepo.findUserByEmail(
        body.invited_email,
      );

      await invitesRepo.create({
        id: inviteId,
        meetingId: id,
        invitedEmail: body.invited_email,
        role: body.role ?? 'participant',
        canViewInsights: body.can_view_insights,
        inviteToken,
        invitedUserId: existingUser?.id ?? null,
      });

      const invite = await invitesRepo.getById(inviteId);

      const webUrl = process.env.WEB_URL ?? 'http://localhost:5173';
      const inviteUrl = `${webUrl}/invites/${inviteToken}`;
      sendInviteEmail({
        inviteeEmail: body.invited_email,
        hostName: request.user!.email,
        meetingTitle: meeting!.title,
        inviteUrl,
        scheduledAt: meeting!.scheduled_at ?? undefined,
      }).catch(() => {});

      return reply.code(201).send(invite);
    },
  );

  // ── PATCH /meetings/:id/invites/:inviteId ──────────────────────────
  app.patch(
    '/:id/invites/:inviteId',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id, inviteId } = InviteParams.parse(request.params);
      const meeting = await meetingsRepo.getById(id);
      assertCanAccess(request.user!, meeting);

      if (
        meeting!.status === 'ended' ||
        meeting!.status === 'cancelled'
      ) {
        return reply.code(409).send({
          error: 'Conflict',
          message: 'Cannot edit invites for an ended or cancelled meeting.',
          status_code: 409,
        });
      }

      const invite = await invitesRepo.getById(inviteId);
      if (!invite || invite.meeting_id !== id) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Invite not found.',
          status_code: 404,
        });
      }

      const body = UpdateInviteReq.parse(request.body);
      const patch: Record<string, unknown> = {};
      if (body.role !== undefined) patch.role = body.role;
      if (body.can_view_insights !== undefined)
        patch.canViewInsights = body.can_view_insights;

      if (Object.keys(patch).length > 0) {
        await invitesRepo.update(inviteId, patch);
      }

      const updated = await invitesRepo.getById(inviteId);
      return updated;
    },
  );

  // ── DELETE /meetings/:id/invites/:inviteId ─────────────────────────
  app.delete(
    '/:id/invites/:inviteId',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id, inviteId } = InviteParams.parse(request.params);
      const meeting = await meetingsRepo.getById(id);
      assertCanAccess(request.user!, meeting);

      if (
        meeting!.status === 'ended' ||
        meeting!.status === 'cancelled'
      ) {
        return reply.code(409).send({
          error: 'Conflict',
          message: 'Cannot delete invites for an ended or cancelled meeting.',
          status_code: 409,
        });
      }

      const invite = await invitesRepo.getById(inviteId);
      if (!invite || invite.meeting_id !== id) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Invite not found.',
          status_code: 404,
        });
      }

      await invitesRepo.remove(inviteId);
      return reply.code(204).send();
    },
  );
}

/**
 * User-facing invite endpoints — registered under /invites
 * GET  /invites/pending          — list pending invites for the current user
 * POST /invites/:token/accept    — accept an invite
 */
export async function inviteAcceptRoutes(app: FastifyInstance) {
  // ── GET /invites/pending ───────────────────────────────────────────
  app.get(
    '/pending',
    { preHandler: [requireAuth] },
    async (request) => {
      const data = await invitesRepo.listPendingForUser(request.user!.id);
      return { data };
    },
  );

  // ── POST /invites/:token/accept ────────────────────────────────────
  app.post(
    '/:token/accept',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { token } = TokenParam.parse(request.params);
      const invite = await invitesRepo.getByToken(token);

      if (!invite) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Invite not found or expired.',
          status_code: 404,
        });
      }

      // Case-insensitive email match
      if (
        invite.invited_email.toLowerCase() !==
        request.user!.email.toLowerCase()
      ) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'This invite is for a different email address.',
          status_code: 403,
        });
      }

      // Idempotent: if already accepted, just return
      if (!invite.accepted_at) {
        await invitesRepo.acceptInvite(invite.id, request.user!.id);
      }

      return { meeting_id: invite.meeting_id, role: invite.role };
    },
  );
}
