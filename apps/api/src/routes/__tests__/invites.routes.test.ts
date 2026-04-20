import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  users,
  sessions,
  meetings,
  meetingTypes,
  meetingTypeAgents,
  agents,
  meetingInvites,
} from '../../db/schema.js';
import { errorHandler } from '../../plugins/error-handler.js';
import authRoutes from '../auth.js';
import meetingRoutes from '../meetings.js';
import { meetingInviteRoutes, inviteAcceptRoutes } from '../invites.js';

// Mock LiveKit token
vi.mock('../../livekit/token.js', () => ({
  mintLivekitAccessToken: vi.fn().mockResolvedValue('mock-livekit-token-xyz'),
}));

// Mock worker dispatch
vi.mock('../../livekit/dispatch.js', () => ({
  dispatchMeetingWorker: vi.fn().mockResolvedValue(undefined),
}));

let app: FastifyInstance;
let hostToken: string;
let inviteeToken: string;
let otherToken: string;
let hostUserId: string;

const HOST = {
  email: 'invite-host@example.com',
  password: 'securepassword123',
  display_name: 'Invite Host',
};
const INVITEE = {
  email: 'invite-invitee@example.com',
  password: 'securepassword123',
  display_name: 'Invite Invitee',
};
const OTHER = {
  email: 'invite-other@example.com',
  password: 'securepassword123',
  display_name: 'Other Person',
};

beforeAll(async () => {
  process.env.LIVEKIT_URL = 'wss://test.livekit.cloud';

  app = Fastify();
  await app.register(cookie);
  app.decorateRequest('user', undefined);
  app.setErrorHandler(errorHandler);
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(meetingRoutes, { prefix: '/meetings' });
  await app.register(meetingInviteRoutes, { prefix: '/meetings' });
  await app.register(inviteAcceptRoutes, { prefix: '/invites' });
  await app.ready();

  const resHost = await app.inject({
    method: 'POST',
    url: '/auth/signup',
    payload: HOST,
  });
  hostToken = resHost.json().access;
  hostUserId = resHost.json().user.id;

  const resInvitee = await app.inject({
    method: 'POST',
    url: '/auth/signup',
    payload: INVITEE,
  });
  inviteeToken = resInvitee.json().access;

  const resOther = await app.inject({
    method: 'POST',
    url: '/auth/signup',
    payload: OTHER,
  });
  otherToken = resOther.json().access;
});

afterAll(async () => {
  delete process.env.LIVEKIT_URL;
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
  await db.delete(meetingInvites);
  await db.delete(meetings);
});

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function createMeeting(token: string, title = 'Invite Test Meeting') {
  const res = await app.inject({
    method: 'POST',
    url: '/meetings',
    headers: auth(token),
    payload: { title },
  });
  return res.json();
}

// ── Invite CRUD ──────────────────────────────────────────────────

describe('POST /meetings/:id/invites', () => {
  it('host creates an invite and returns 201', async () => {
    const meeting = await createMeeting(hostToken);

    const res = await app.inject({
      method: 'POST',
      url: `/meetings/${meeting.id}/invites`,
      headers: auth(hostToken),
      payload: { invited_email: INVITEE.email, can_view_insights: false },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.invited_email).toBe(INVITEE.email);
    expect(body.invite_token).toBeTruthy();
    expect(body.can_view_insights).toBe(false);
    expect(body.role).toBe('participant');
  });

  it('non-host cannot create invites (404)', async () => {
    const meeting = await createMeeting(hostToken);

    const res = await app.inject({
      method: 'POST',
      url: `/meetings/${meeting.id}/invites`,
      headers: auth(inviteeToken),
      payload: { invited_email: 'someone@example.com', can_view_insights: false },
    });

    expect(res.statusCode).toBe(404);
  });

  it('rejects invites on ended meeting (409)', async () => {
    const meeting = await createMeeting(hostToken);
    await db
      .update(meetings)
      .set({ status: 'ended', endedAt: new Date() })
      .where(eq(meetings.id, meeting.id));

    const res = await app.inject({
      method: 'POST',
      url: `/meetings/${meeting.id}/invites`,
      headers: auth(hostToken),
      payload: { invited_email: INVITEE.email, can_view_insights: false },
    });

    expect(res.statusCode).toBe(409);
  });
});

describe('GET /meetings/:id/invites', () => {
  it('host can list invites', async () => {
    const meeting = await createMeeting(hostToken);

    await app.inject({
      method: 'POST',
      url: `/meetings/${meeting.id}/invites`,
      headers: auth(hostToken),
      payload: { invited_email: INVITEE.email, can_view_insights: true },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/meetings/${meeting.id}/invites`,
      headers: auth(hostToken),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
    expect(res.json().data[0].invited_email).toBe(INVITEE.email);
  });
});

describe('PATCH /meetings/:id/invites/:inviteId', () => {
  it('host can update can_view_insights', async () => {
    const meeting = await createMeeting(hostToken);

    const createRes = await app.inject({
      method: 'POST',
      url: `/meetings/${meeting.id}/invites`,
      headers: auth(hostToken),
      payload: { invited_email: INVITEE.email, can_view_insights: false },
    });
    const inviteId = createRes.json().id;
    expect(createRes.json().can_view_insights).toBe(false);

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/meetings/${meeting.id}/invites/${inviteId}`,
      headers: auth(hostToken),
      payload: { can_view_insights: true },
    });

    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().can_view_insights).toBe(true);
  });
});

describe('DELETE /meetings/:id/invites/:inviteId', () => {
  it('host can delete an invite', async () => {
    const meeting = await createMeeting(hostToken);

    const createRes = await app.inject({
      method: 'POST',
      url: `/meetings/${meeting.id}/invites`,
      headers: auth(hostToken),
      payload: { invited_email: INVITEE.email, can_view_insights: false },
    });
    const inviteId = createRes.json().id;

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/meetings/${meeting.id}/invites/${inviteId}`,
      headers: auth(hostToken),
    });

    expect(deleteRes.statusCode).toBe(204);
  });
});

// ── Accept flow ──────────────────────────────────────────────────

describe('POST /invites/:token/accept', () => {
  it('invitee accepts invite and gets meeting_id', async () => {
    const meeting = await createMeeting(hostToken);

    const createRes = await app.inject({
      method: 'POST',
      url: `/meetings/${meeting.id}/invites`,
      headers: auth(hostToken),
      payload: { invited_email: INVITEE.email, can_view_insights: false },
    });
    const inviteToken = createRes.json().invite_token;

    const res = await app.inject({
      method: 'POST',
      url: `/invites/${inviteToken}/accept`,
      headers: auth(inviteeToken),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().meeting_id).toBe(meeting.id);
    expect(res.json().role).toBe('participant');
  });

  it('wrong email returns 403', async () => {
    const meeting = await createMeeting(hostToken);

    const createRes = await app.inject({
      method: 'POST',
      url: `/meetings/${meeting.id}/invites`,
      headers: auth(hostToken),
      payload: { invited_email: INVITEE.email, can_view_insights: false },
    });
    const inviteToken = createRes.json().invite_token;

    // OTHER user tries to accept INVITEE's invite
    const res = await app.inject({
      method: 'POST',
      url: `/invites/${inviteToken}/accept`,
      headers: auth(otherToken),
    });

    expect(res.statusCode).toBe(403);
  });

  it('invalid token returns 404', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/invites/invalid-token-xyz/accept',
      headers: auth(inviteeToken),
    });

    expect(res.statusCode).toBe(404);
  });

  it('idempotent accept (calling twice is fine)', async () => {
    const meeting = await createMeeting(hostToken);

    const createRes = await app.inject({
      method: 'POST',
      url: `/meetings/${meeting.id}/invites`,
      headers: auth(hostToken),
      payload: { invited_email: INVITEE.email, can_view_insights: false },
    });
    const inviteToken = createRes.json().invite_token;

    await app.inject({
      method: 'POST',
      url: `/invites/${inviteToken}/accept`,
      headers: auth(inviteeToken),
    });

    const res = await app.inject({
      method: 'POST',
      url: `/invites/${inviteToken}/accept`,
      headers: auth(inviteeToken),
    });

    expect(res.statusCode).toBe(200);
  });
});

// ── Join with invite ─────────────────────────────────────────────

describe('POST /meetings/:id/join (with invites)', () => {
  it('accepted invitee can join a live meeting', async () => {
    const meeting = await createMeeting(hostToken);

    // Host starts the meeting
    await app.inject({
      method: 'POST',
      url: `/meetings/${meeting.id}/join`,
      headers: auth(hostToken),
    });

    // Create and accept invite
    const createRes = await app.inject({
      method: 'POST',
      url: `/meetings/${meeting.id}/invites`,
      headers: auth(hostToken),
      payload: { invited_email: INVITEE.email, can_view_insights: false },
    });
    const inviteToken = createRes.json().invite_token;

    await app.inject({
      method: 'POST',
      url: `/invites/${inviteToken}/accept`,
      headers: auth(inviteeToken),
    });

    // Invitee joins
    const joinRes = await app.inject({
      method: 'POST',
      url: `/meetings/${meeting.id}/join`,
      headers: auth(inviteeToken),
    });

    expect(joinRes.statusCode).toBe(200);
    expect(joinRes.json().livekit_token).toBeTruthy();
  });

  it('non-invited user still gets 404', async () => {
    const meeting = await createMeeting(hostToken);

    const res = await app.inject({
      method: 'POST',
      url: `/meetings/${meeting.id}/join`,
      headers: auth(otherToken),
    });

    expect(res.statusCode).toBe(404);
  });

  it('invitee cannot start a scheduled meeting (409)', async () => {
    const meeting = await createMeeting(hostToken);

    // Create and accept invite
    const createRes = await app.inject({
      method: 'POST',
      url: `/meetings/${meeting.id}/invites`,
      headers: auth(hostToken),
      payload: { invited_email: INVITEE.email, can_view_insights: false },
    });
    await app.inject({
      method: 'POST',
      url: `/invites/${createRes.json().invite_token}/accept`,
      headers: auth(inviteeToken),
    });

    // Invitee tries to join scheduled meeting
    const res = await app.inject({
      method: 'POST',
      url: `/meetings/${meeting.id}/join`,
      headers: auth(inviteeToken),
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().message).toContain('not started');
  });
});

// ── Guest join ───────────────────────────────────────────────────

describe('POST /meetings/:id/join-guest', () => {
  it('guest can join a live meeting', async () => {
    const meeting = await createMeeting(hostToken);

    // Host starts it
    await app.inject({
      method: 'POST',
      url: `/meetings/${meeting.id}/join`,
      headers: auth(hostToken),
    });

    const res = await app.inject({
      method: 'POST',
      url: `/meetings/${meeting.id}/join-guest`,
      payload: { display_name: 'Guest Bob' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().livekit_url).toBe('wss://test.livekit.cloud');
    expect(res.json().livekit_token).toBeTruthy();
  });

  it('guest cannot join a scheduled meeting (409)', async () => {
    const meeting = await createMeeting(hostToken);

    const res = await app.inject({
      method: 'POST',
      url: `/meetings/${meeting.id}/join-guest`,
      payload: { display_name: 'Guest Bob' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().message).toContain('not started');
  });

  it('guest cannot join ended meeting (409)', async () => {
    const meeting = await createMeeting(hostToken);
    await db
      .update(meetings)
      .set({ status: 'ended', endedAt: new Date() })
      .where(eq(meetings.id, meeting.id));

    const res = await app.inject({
      method: 'POST',
      url: `/meetings/${meeting.id}/join-guest`,
      payload: { display_name: 'Guest Bob' },
    });

    expect(res.statusCode).toBe(409);
  });

  it('returns 400 on missing display_name', async () => {
    const meeting = await createMeeting(hostToken);

    const res = await app.inject({
      method: 'POST',
      url: `/meetings/${meeting.id}/join-guest`,
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for nonexistent meeting', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/meetings/01AAAAAAAAAAAAAAAAAAAAAAAA/join-guest',
      payload: { display_name: 'Guest' },
    });

    expect(res.statusCode).toBe(404);
  });
});
