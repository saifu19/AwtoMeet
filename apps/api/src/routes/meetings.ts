import { FastifyInstance } from 'fastify';
import { ulid } from 'ulid';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import {
  CreateMeetingReq,
  UpdateMeetingReq,
  ListMeetingsQuery,
  GuestJoinReq,
  UlidSchema,
} from '@meeting-app/shared';
import { requireAuth } from '../plugins/auth.js';
import { requireStreamAuth } from '../plugins/stream-auth.js';
import { classifyMeetingType } from '../services/classify.js';
import {
  assertCanAccess,
  assertCanViewInsights,
  ForbiddenError,
} from '../authz/index.js';
import * as meetingsRepo from '../repositories/meetings.js';
import { crossSiteCookieOpts } from '../auth/cookie-opts.js';
import * as meetingTypesRepo from '../repositories/meeting-types.js';
import * as invitesRepo from '../repositories/invites.js';
import { getTranscript } from '../repositories/transcript.js';
import { getInsights } from '../repositories/insights.js';
import { getSummaryForMeeting } from '../repositories/summaries.js';
import { streamMeetingEvents } from '../sse/stream.js';
import { signStreamSession } from '../auth/stream-session.js';
import { mintLivekitAccessToken } from '../livekit/token.js';
import { dispatchMeetingWorker } from '../livekit/dispatch.js';
import { requireInternalAuth } from '../plugins/internal-auth.js';
import { sendSummaryReadyEmail } from '../services/email.js';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';

const IdParam = z.object({ id: UlidSchema });

const StreamQuery = z.object({
  last_transcript_id: z.coerce.number().int().nonnegative().default(0),
  last_insight_id: z.coerce.number().int().nonnegative().default(0),
});

export default async function meetingRoutes(app: FastifyInstance) {
  // ── GET /meetings ──────────────────────────────────────────────────
  app.get('/', { preHandler: [requireAuth] }, async (request) => {
    const query = ListMeetingsQuery.parse(request.query);
    const userId = request.user!.id;
    const data = await meetingsRepo.listAccessible(userId, query.status);
    return { data };
  });

  // ── POST /meetings ─────────────────────────────────────────────────
  app.post('/', { preHandler: [requireAuth] }, async (request, reply) => {
    const body = CreateMeetingReq.parse(request.body);
    const userId = request.user!.id;

    let meetingTypeId = body.meeting_type_id ?? null;

    if (!meetingTypeId && body.auto_classify) {
      meetingTypeId = await classifyMeetingType(userId, {
        title: body.title,
        description: body.description,
      });
    }

    // Validate meeting type ownership if provided
    if (meetingTypeId) {
      const mt = await meetingTypesRepo.getByIdWithAgents(meetingTypeId);
      if (!mt || mt.user_id !== userId) {
        return reply.code(400).send({
          error: 'Validation',
          message: 'Invalid meeting_type_id or it does not belong to you.',
          status_code: 400,
        });
      }
    }

    const id = ulid();
    await meetingsRepo.create({
      id,
      userId,
      orgId: null,
      meetingTypeId,
      title: body.title,
      description: body.description ?? null,
      scheduledAt: body.scheduled_at ? new Date(body.scheduled_at) : null,
      livekitRoom: `meeting-${id}`,
      status: 'scheduled',
    });

    const meeting = await meetingsRepo.getById(id);
    return reply.code(201).send(meeting);
  });

  // ── GET /meetings/:id ──────────────────────────────────────────────
  app.get('/:id', { preHandler: [requireAuth] }, async (request) => {
    const { id } = IdParam.parse(request.params);
    const meeting = await meetingsRepo.getById(id);
    if (!meeting) throw new ForbiddenError();

    // Allow host OR accepted invitee to view meeting details
    const userId = request.user!.id;
    const isHost = meeting.user_id === userId;
    if (!isHost) {
      const hasInvite = await invitesRepo.hasAcceptedInvite(userId, id);
      if (!hasInvite) throw new ForbiddenError();
    }

    // Compute per-viewer insights capability: host always gets true; invitees
    // need the can_view_insights flag on their accepted invite row. Returned
    // on the meeting response so the frontend can gate "Open Insights" UI
    // without a second round-trip.
    const viewer_can_view_insights = isHost
      ? true
      : await invitesRepo.hasAcceptedInviteWithInsights(userId, id);

    return { ...meeting, viewer_can_view_insights };
  });

  // ── PATCH /meetings/:id ────────────────────────────────────────────
  app.patch('/:id', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = IdParam.parse(request.params);
    const existing = await meetingsRepo.getById(id);
    assertCanAccess(request.user!, existing);

    if (existing!.status === 'live' || existing!.status === 'summarizing') {
      return reply.code(409).send({
        error: 'Conflict',
        message: 'Cannot update a live or summarizing meeting.',
        status_code: 409,
      });
    }

    const body = UpdateMeetingReq.parse(request.body);
    const userId = request.user!.id;

    // Auto-classify: if user requests it and isn't setting an explicit type
    let classifiedTypeId: string | null | undefined;
    if (body.auto_classify && !body.meeting_type_id) {
      const title = body.title ?? existing!.title;
      const description = body.description ?? existing!.description;
      classifiedTypeId = await classifyMeetingType(userId, { title, description });
    }

    // Determine the effective meeting_type_id
    // If auto_classify produced a result, it takes priority over an explicit null
    // (the user cleared the type and asked for reclassification)
    const effectiveMeetingTypeId = classifiedTypeId !== undefined
      ? classifiedTypeId
      : body.meeting_type_id !== undefined
        ? body.meeting_type_id
        : undefined;

    // Validate meeting type ownership if changing it
    if (effectiveMeetingTypeId !== undefined && effectiveMeetingTypeId !== null) {
      const mt = await meetingTypesRepo.getByIdWithAgents(effectiveMeetingTypeId);
      if (!mt || mt.user_id !== userId) {
        return reply.code(400).send({
          error: 'Validation',
          message: 'Invalid meeting_type_id or it does not belong to you.',
          status_code: 400,
        });
      }
    }

    // Map snake_case request fields to camelCase Drizzle fields
    const patch: Record<string, unknown> = {};
    if (body.title !== undefined) patch.title = body.title;
    if (body.description !== undefined) patch.description = body.description;
    if (body.scheduled_at !== undefined)
      patch.scheduledAt = body.scheduled_at ? new Date(body.scheduled_at) : null;
    if (effectiveMeetingTypeId !== undefined)
      patch.meetingTypeId = effectiveMeetingTypeId;
    if (body.status !== undefined) patch.status = body.status;

    if (Object.keys(patch).length > 0) {
      await meetingsRepo.update(id, patch);
    }

    const updated = await meetingsRepo.getById(id);
    return updated;
  });

  // ── DELETE /meetings/:id ───────────────────────────────────────────
  app.delete(
    '/:id',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = IdParam.parse(request.params);
      const existing = await meetingsRepo.getById(id);
      assertCanAccess(request.user!, existing);

      if (existing!.status === 'live' || existing!.status === 'summarizing') {
        return reply.code(409).send({
          error: 'Conflict',
          message: 'Cannot delete a live or summarizing meeting.',
          status_code: 409,
        });
      }

      await meetingsRepo.remove(id);
      return reply.code(204).send();
    },
  );

  // ── GET /meetings/:id/transcript ───────────────────────────────────
  app.get(
    '/:id/transcript',
    { preHandler: [requireAuth] },
    async (request) => {
      const { id } = IdParam.parse(request.params);
      await assertCanViewInsights(request.user!.id, id);
      const messages = await getTranscript(id);
      return { messages };
    },
  );

  // ── GET /meetings/:id/insights ─────────────────────────────────────
  app.get(
    '/:id/insights',
    { preHandler: [requireAuth] },
    async (request) => {
      const { id } = IdParam.parse(request.params);
      await assertCanViewInsights(request.user!.id, id);
      const insights = await getInsights(id);
      return { insights };
    },
  );

  // ── GET /meetings/:id/summary ──────────────────────────────────────
  app.get(
    '/:id/summary',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = IdParam.parse(request.params);
      await assertCanViewInsights(request.user!.id, id);
      const summary = await getSummaryForMeeting(id);
      if (!summary) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'No summary available for this meeting.',
          status_code: 404,
        });
      }
      return summary;
    },
  );

  // ── GET /meetings/:id/agents ───────────────────────────────────────
  // Returns the agents attached to this meeting's meeting_type. Gated by
  // assertCanViewInsights so invited viewers (not just the host) can
  // populate the insights dashboard tab list.
  app.get(
    '/:id/agents',
    { preHandler: [requireAuth] },
    async (request) => {
      const { id } = IdParam.parse(request.params);
      await assertCanViewInsights(request.user!.id, id);
      const agents = await meetingsRepo.getAgentsForMeeting(id);
      return { agents };
    },
  );

  // ── POST /meetings/:id/stream-session ──────────────────────────────
  // Mints a short-lived (60s), meeting-scoped, HttpOnly cookie that
  // authorizes ONE subsequent SSE handshake against GET /:id/stream.
  // Native EventSource cannot set an Authorization header, so the cookie
  // is the only way to carry auth into the SSE connection without leaking
  // the bearer token into URLs or logs. Once the stream is established
  // the cookie is no longer needed — the open TCP connection is itself
  // self-authorized for the remaining stream lifetime.
  app.post(
    '/:id/stream-session',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = IdParam.parse(request.params);
      await assertCanViewInsights(request.user!.id, id);

      const token = await signStreamSession(request.user!.id, id);

      // app.prefix resolves to "/api/v0/meetings" here (Fastify accumulates
      // parent prefixes), so the final cookie path is precisely the stream
      // endpoint for this one meeting — no other route sees the cookie.
      const cookiePath = `${app.prefix}/${id}/stream`;

      reply.setCookie(
        'stream_session',
        token,
        crossSiteCookieOpts(cookiePath, 60),
      );

      return reply.code(204).send();
    },
  );

  // ── GET /meetings/:id/stream (SSE) ─────────────────────────────────
  // Auth is provided by the stream_session cookie minted above, NOT the
  // normal bearer header — requireStreamAuth validates the cookie once at
  // handshake time, then the hijacked SSE loop runs without further checks.
  app.get(
    '/:id/stream',
    { preHandler: [requireStreamAuth] },
    async (request, reply) => {
      const { id } = IdParam.parse(request.params);
      const query = StreamQuery.parse(request.query);
      await streamMeetingEvents(request, reply, {
        meetingId: id,
        lastTranscriptId: query.last_transcript_id,
        lastInsightId: query.last_insight_id,
      });
    },
  );

  // ── POST /meetings/:id/join ────────────────────────────────────────
  app.post(
    '/:id/join',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = IdParam.parse(request.params);
      const meeting = await meetingsRepo.getById(id);
      if (!meeting) throw new ForbiddenError();

      // Authorization: host OR accepted invitee
      const isHost = meeting.user_id === request.user!.id;
      if (!isHost) {
        const hasInvite = await invitesRepo.hasAcceptedInvite(
          request.user!.id,
          id,
        );
        if (!hasInvite) throw new ForbiddenError();
      }

      // Reject ended/summarizing/cancelled meetings
      if (meeting.status === 'ended' || meeting.status === 'summarizing' || meeting.status === 'cancelled') {
        return reply.code(409).send({
          error: 'Conflict',
          message: 'Meeting has already ended or been cancelled.',
          status_code: 409,
        });
      }

      // Only the host can open a scheduled meeting. Status stays 'scheduled'
      // until the worker observes a real participant; started_at acts as the
      // "host has opened the room" signal so non-hosts can join.
      if (meeting.status === 'scheduled') {
        if (!isHost && !meeting.started_at) {
          return reply.code(409).send({
            error: 'Conflict',
            message: 'Meeting has not started yet. Ask the host to start it.',
            status_code: 409,
          });
        }
        if (isHost && !meeting.started_at) {
          await meetingsRepo.update(id, { startedAt: new Date() });
        }
      }

      // Dispatch worker if none is active for this meeting
      if (!meeting.worker_job_id) {
        const dispatchId = await dispatchMeetingWorker({
          meetingId: meeting.id,
          roomName: meeting.livekit_room,
        });
        if (dispatchId) {
          await meetingsRepo.update(id, { workerJobId: dispatchId });
        }
      }

      // Look up user display_name (not on JWT — AuthUser only has id + email)
      const [userRow] = await db
        .select({ displayName: users.displayName })
        .from(users)
        .where(eq(users.id, request.user!.id));
      const displayName = userRow?.displayName ?? request.user!.email;

      const livekitUrl = process.env.LIVEKIT_URL_PUBLIC ?? process.env.LIVEKIT_URL;
      if (!livekitUrl) {
        throw new Error('LIVEKIT_URL must be set');
      }

      const token = await mintLivekitAccessToken({
        identity: request.user!.id,
        name: displayName,
        roomName: meeting.livekit_room,
      });

      return { livekit_url: livekitUrl, livekit_token: token };
    },
  );

  // ── POST /meetings/:id/join-guest ──────────────────────────────────
  app.post('/:id/join-guest', async (request, reply) => {
    const { id } = IdParam.parse(request.params);
    const body = GuestJoinReq.parse(request.body);

    const meeting = await meetingsRepo.getById(id);
    if (!meeting) {
      return reply.code(404).send({
        error: 'Not Found',
        message: 'Meeting not found.',
        status_code: 404,
      });
    }

    if (meeting.status === 'ended' || meeting.status === 'summarizing' || meeting.status === 'cancelled') {
      return reply.code(409).send({
        error: 'Conflict',
        message: 'Meeting has already ended or been cancelled.',
        status_code: 409,
      });
    }

    // Guests can join once the host has opened the room (started_at set),
    // regardless of whether a real participant has arrived yet.
    if (meeting.status === 'scheduled' && !meeting.started_at) {
      return reply.code(409).send({
        error: 'Conflict',
        message: 'Meeting has not started yet. Please wait for the host.',
        status_code: 409,
      });
    }

    const guestIdentity = `guest-${ulid()}`;
    const livekitUrl = process.env.LIVEKIT_URL_PUBLIC ?? process.env.LIVEKIT_URL;
    if (!livekitUrl) {
      throw new Error('LIVEKIT_URL must be set');
    }

    const token = await mintLivekitAccessToken({
      identity: guestIdentity,
      name: body.display_name,
      roomName: meeting.livekit_room,
    });

    return { livekit_url: livekitUrl, livekit_token: token };
  });

  // ── POST /meetings/:id/leave ───────────────────────────────────────
  app.post(
    '/:id/leave',
    { preHandler: [requireAuth] },
    async (_request, reply) => {
      // No-op placeholder — status is not flipped back on leave.
      // Room cleanup happens when the room empties (handled by worker in M22+).
      return reply.code(204).send();
    },
  );

  // ── POST /meetings/:id/notify-summary (internal, worker → API) ────
  app.post(
    '/:id/notify-summary',
    { preHandler: [requireInternalAuth] },
    async (request, reply) => {
      const { id } = IdParam.parse(request.params);
      const meeting = await meetingsRepo.getById(id);
      if (!meeting) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Meeting not found.',
          status_code: 404,
        });
      }

      const webUrl = process.env.WEB_URL ?? 'http://localhost:5173';
      const summaryUrl = `${webUrl}/meetings/${id}/summary`;

      // Notify meeting host
      const host = await db.query.users.findFirst({
        where: eq(users.id, meeting.user_id),
      });
      if (host) {
        sendSummaryReadyEmail(host.email, {
          recipientName: host.displayName,
          meetingTitle: meeting.title,
          summaryUrl,
        }).catch(() => {});
      }

      // Notify accepted invitees with insights access
      const invitees =
        await invitesRepo.listAcceptedInviteesWithInsights(id);
      for (const invitee of invitees) {
        sendSummaryReadyEmail(invitee.email, {
          recipientName: invitee.displayName,
          meetingTitle: meeting.title,
          summaryUrl,
        }).catch(() => {});
      }

      return reply.code(204).send();
    },
  );
}
