import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { db } from '../../db/client.js';
import { ulid } from 'ulid';
import {
  users,
  sessions,
  agents,
  meetingTypes,
  meetingTypeAgents,
  meetings,
  meetingInvites,
  transcriptMessages,
  agentRuns,
  agentOutputs,
  meetingSummaries,
} from '../../db/schema.js';
import { errorHandler } from '../../plugins/error-handler.js';
import authRoutes from '../auth.js';
import meetingRoutes from '../meetings.js';
import meetingTypeRoutes from '../meeting-types.js';
import { eq } from 'drizzle-orm';

let app: FastifyInstance;
let accessTokenA: string;
let accessTokenB: string;
let userIdB: string;

const USER_A = {
  email: 'meeting-tester-a@example.com',
  password: 'securepassword123',
  display_name: 'Meeting Tester A',
};
const USER_B = {
  email: 'meeting-tester-b@example.com',
  password: 'securepassword123',
  display_name: 'Meeting Tester B',
};

beforeAll(async () => {
  app = Fastify();
  await app.register(cookie);
  app.decorateRequest('user', undefined);
  app.setErrorHandler(errorHandler);
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(meetingRoutes, { prefix: '/meetings' });
  await app.register(meetingTypeRoutes, { prefix: '/meeting-types' });
  await app.ready();

  const resA = await app.inject({
    method: 'POST',
    url: '/auth/signup',
    payload: USER_A,
  });
  accessTokenA = resA.json().access;

  const resB = await app.inject({
    method: 'POST',
    url: '/auth/signup',
    payload: USER_B,
  });
  accessTokenB = resB.json().access;
  userIdB = resB.json().user.id;
});

afterAll(async () => {
  await db.delete(agentOutputs);
  await db.delete(agentRuns);
  await db.delete(meetingSummaries);
  await db.delete(transcriptMessages);
  await db.delete(meetingInvites);
  await db.delete(meetings);
  await db.delete(meetingTypeAgents);
  await db.delete(meetingTypes);
  await db.delete(agents);
  await db.delete(sessions);
  await db.delete(users);
  const { pool } = await import('../../db/client.js');
  await pool.end();
});

afterEach(async () => {
  // Delete in dependency order so FK constraints don't block cleanup
  await db.delete(agentOutputs);
  await db.delete(agentRuns);
  await db.delete(meetingSummaries);
  await db.delete(transcriptMessages);
  await db.delete(meetingInvites);
  await db.delete(meetings);
  await db.delete(meetingTypeAgents);
  await db.delete(meetingTypes);
  await db.delete(agents);
});

function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}

const MEETING_PAYLOAD = {
  title: 'Sprint Planning',
  description: 'Biweekly sprint planning session',
  scheduled_at: new Date(Date.now() + 86400000).toISOString(),
};

describe('GET /meetings', () => {
  it('returns empty array for new user', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/meetings',
      headers: authHeader(accessTokenA),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });

  it('returns 401 without token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/meetings',
    });

    expect(res.statusCode).toBe(401);
  });

  it('filters by status', async () => {
    // Create a meeting (status=scheduled)
    await app.inject({
      method: 'POST',
      url: '/meetings',
      headers: authHeader(accessTokenA),
      payload: MEETING_PAYLOAD,
    });

    const scheduledRes = await app.inject({
      method: 'GET',
      url: '/meetings?status=scheduled',
      headers: authHeader(accessTokenA),
    });
    expect(scheduledRes.statusCode).toBe(200);
    expect(scheduledRes.json().data).toHaveLength(1);

    const endedRes = await app.inject({
      method: 'GET',
      url: '/meetings?status=ended',
      headers: authHeader(accessTokenA),
    });
    expect(endedRes.statusCode).toBe(200);
    expect(endedRes.json().data).toHaveLength(0);
  });
});

describe('POST /meetings', () => {
  it('creates a meeting with 201 and correct shape', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/meetings',
      headers: authHeader(accessTokenA),
      payload: MEETING_PAYLOAD,
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toHaveLength(26);
    expect(body.title).toBe(MEETING_PAYLOAD.title);
    expect(body.description).toBe(MEETING_PAYLOAD.description);
    expect(body.status).toBe('scheduled');
    expect(body.livekit_room).toBe(`meeting-${body.id}`);
    expect(body.org_id).toBeNull();
    expect(body.meeting_type_id).toBeNull();
  });

  it('generates livekit_room as meeting-{id}', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/meetings',
      headers: authHeader(accessTokenA),
      payload: { title: 'Room Test' },
    });

    const body = res.json();
    expect(body.livekit_room).toBe(`meeting-${body.id}`);
  });

  it('returns 400 on invalid body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/meetings',
      headers: authHeader(accessTokenA),
      payload: { title: '' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('validates meeting_type_id ownership', async () => {
    // Create a meeting type as user B
    const mtRes = await app.inject({
      method: 'POST',
      url: '/meeting-types',
      headers: authHeader(accessTokenB),
      payload: { name: 'B-only type' },
    });
    const mtId = mtRes.json().id;

    // Try to create a meeting as user A with B's meeting type
    const res = await app.inject({
      method: 'POST',
      url: '/meetings',
      headers: authHeader(accessTokenA),
      payload: { title: 'Test', meeting_type_id: mtId },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain('meeting_type_id');
  });

  it('auto_classify with no meeting types leaves meeting_type_id null', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/meetings',
      headers: authHeader(accessTokenA),
      payload: { title: 'Auto test', auto_classify: true },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().meeting_type_id).toBeNull();
  });
});

describe('GET /meetings/:id', () => {
  it('returns meeting for the owner', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/meetings',
      headers: authHeader(accessTokenA),
      payload: MEETING_PAYLOAD,
    });
    const meetingId = createRes.json().id;

    const res = await app.inject({
      method: 'GET',
      url: `/meetings/${meetingId}`,
      headers: authHeader(accessTokenA),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(meetingId);
    expect(res.json().title).toBe(MEETING_PAYLOAD.title);
  });

  it('returns 404 for a different user', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/meetings',
      headers: authHeader(accessTokenA),
      payload: MEETING_PAYLOAD,
    });
    const meetingId = createRes.json().id;

    const res = await app.inject({
      method: 'GET',
      url: `/meetings/${meetingId}`,
      headers: authHeader(accessTokenB),
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for nonexistent id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/meetings/01AAAAAAAAAAAAAAAAAAAAAAAA',
      headers: authHeader(accessTokenA),
    });

    expect(res.statusCode).toBe(404);
  });

  it('sets viewer_can_view_insights=true for the host', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/meetings',
      headers: authHeader(accessTokenA),
      payload: MEETING_PAYLOAD,
    });
    const meetingId = createRes.json().id;

    const res = await app.inject({
      method: 'GET',
      url: `/meetings/${meetingId}`,
      headers: authHeader(accessTokenA),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().viewer_can_view_insights).toBe(true);
  });

  it('sets viewer_can_view_insights=true for an invitee with the flag', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/meetings',
      headers: authHeader(accessTokenA),
      payload: MEETING_PAYLOAD,
    });
    const meetingId = createRes.json().id;

    await db.insert(meetingInvites).values({
      id: ulid(),
      meetingId,
      invitedEmail: USER_B.email,
      invitedUserId: userIdB,
      role: 'participant',
      canViewInsights: true,
      inviteToken: ulid(),
      acceptedAt: new Date(),
    });

    const res = await app.inject({
      method: 'GET',
      url: `/meetings/${meetingId}`,
      headers: authHeader(accessTokenB),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().viewer_can_view_insights).toBe(true);
  });

  it('sets viewer_can_view_insights=false for an invitee without the flag', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/meetings',
      headers: authHeader(accessTokenA),
      payload: MEETING_PAYLOAD,
    });
    const meetingId = createRes.json().id;

    await db.insert(meetingInvites).values({
      id: ulid(),
      meetingId,
      invitedEmail: USER_B.email,
      invitedUserId: userIdB,
      role: 'participant',
      canViewInsights: false,
      inviteToken: ulid(),
      acceptedAt: new Date(),
    });

    const res = await app.inject({
      method: 'GET',
      url: `/meetings/${meetingId}`,
      headers: authHeader(accessTokenB),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().viewer_can_view_insights).toBe(false);
  });
});

describe('PATCH /meetings/:id', () => {
  it('updates fields and returns updated meeting', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/meetings',
      headers: authHeader(accessTokenA),
      payload: MEETING_PAYLOAD,
    });
    const meetingId = createRes.json().id;

    const res = await app.inject({
      method: 'PATCH',
      url: `/meetings/${meetingId}`,
      headers: authHeader(accessTokenA),
      payload: { title: 'Renamed Meeting', description: 'New desc' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().title).toBe('Renamed Meeting');
    expect(res.json().description).toBe('New desc');
  });

  it('returns 404 for a different user', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/meetings',
      headers: authHeader(accessTokenA),
      payload: MEETING_PAYLOAD,
    });
    const meetingId = createRes.json().id;

    const res = await app.inject({
      method: 'PATCH',
      url: `/meetings/${meetingId}`,
      headers: authHeader(accessTokenB),
      payload: { title: 'Hacked' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 409 for live meeting', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/meetings',
      headers: authHeader(accessTokenA),
      payload: MEETING_PAYLOAD,
    });
    const meetingId = createRes.json().id;

    // Manually set status to live
    await db
      .update(meetings)
      .set({ status: 'live', startedAt: new Date() })
      .where(eq(meetings.id, meetingId));

    const res = await app.inject({
      method: 'PATCH',
      url: `/meetings/${meetingId}`,
      headers: authHeader(accessTokenA),
      payload: { title: 'Cannot update' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('Conflict');
  });
});

describe('DELETE /meetings/:id', () => {
  it('deletes scheduled meeting and returns 204', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/meetings',
      headers: authHeader(accessTokenA),
      payload: MEETING_PAYLOAD,
    });
    const meetingId = createRes.json().id;

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/meetings/${meetingId}`,
      headers: authHeader(accessTokenA),
    });

    expect(deleteRes.statusCode).toBe(204);

    // Verify it's gone
    const getRes = await app.inject({
      method: 'GET',
      url: `/meetings/${meetingId}`,
      headers: authHeader(accessTokenA),
    });
    expect(getRes.statusCode).toBe(404);
  });

  it('returns 404 for a different user', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/meetings',
      headers: authHeader(accessTokenA),
      payload: MEETING_PAYLOAD,
    });
    const meetingId = createRes.json().id;

    const res = await app.inject({
      method: 'DELETE',
      url: `/meetings/${meetingId}`,
      headers: authHeader(accessTokenB),
    });

    expect(res.statusCode).toBe(404);
  });

  it('cascade-deletes invites, transcripts, agent runs, outputs, and summary', async () => {
    // Create meeting
    const createRes = await app.inject({
      method: 'POST',
      url: '/meetings',
      headers: authHeader(accessTokenA),
      payload: MEETING_PAYLOAD,
    });
    const meetingId = createRes.json().id;

    // Create an agent (needed for agent_runs FK)
    const agentId = ulid();
    const userIdA = createRes.json().user_id;
    await db.insert(agents).values({
      id: agentId,
      userId: userIdA,
      name: 'Test Agent',
      systemPrompt: 'test',
    });

    // Insert child rows directly to simulate a meeting with full history
    await db.insert(meetingInvites).values({
      id: ulid(),
      meetingId,
      invitedEmail: 'invitee@example.com',
      role: 'participant',
      canViewInsights: false,
      inviteToken: `tok_${ulid()}`,
    });
    await db.insert(transcriptMessages).values({
      meetingId,
      speakerIdentity: 'spk1',
      speakerName: 'Speaker 1',
      text: 'hello',
      startTsMs: 0,
      endTsMs: 1000,
    });
    await db.insert(agentRuns).values({
      meetingId,
      agentId,
      bufferStartMsgId: 1,
      bufferEndMsgId: 2,
      status: 'done',
    });
    const [runRow] = await db
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(eq(agentRuns.meetingId, meetingId))
      .limit(1);
    await db.insert(agentOutputs).values({
      agentRunId: runRow!.id,
      meetingId,
      agentId,
      content: 'output text',
    });
    await db.insert(meetingSummaries).values({
      meetingId,
      rawSummary: 'summary text',
    });

    // Delete should succeed (was failing before with FK constraint)
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/meetings/${meetingId}`,
      headers: authHeader(accessTokenA),
    });
    expect(deleteRes.statusCode).toBe(204);

    // Verify all child rows are gone
    const invitesAfter = await db
      .select()
      .from(meetingInvites)
      .where(eq(meetingInvites.meetingId, meetingId));
    expect(invitesAfter).toHaveLength(0);
    const transcriptsAfter = await db
      .select()
      .from(transcriptMessages)
      .where(eq(transcriptMessages.meetingId, meetingId));
    expect(transcriptsAfter).toHaveLength(0);
    const runsAfter = await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.meetingId, meetingId));
    expect(runsAfter).toHaveLength(0);
    const outputsAfter = await db
      .select()
      .from(agentOutputs)
      .where(eq(agentOutputs.meetingId, meetingId));
    expect(outputsAfter).toHaveLength(0);
    const summariesAfter = await db
      .select()
      .from(meetingSummaries)
      .where(eq(meetingSummaries.meetingId, meetingId));
    expect(summariesAfter).toHaveLength(0);
  });

  it('returns 409 for live meeting', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/meetings',
      headers: authHeader(accessTokenA),
      payload: MEETING_PAYLOAD,
    });
    const meetingId = createRes.json().id;

    // Manually set status to live
    await db
      .update(meetings)
      .set({ status: 'live', startedAt: new Date() })
      .where(eq(meetings.id, meetingId));

    const res = await app.inject({
      method: 'DELETE',
      url: `/meetings/${meetingId}`,
      headers: authHeader(accessTokenA),
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('Conflict');
  });
});
