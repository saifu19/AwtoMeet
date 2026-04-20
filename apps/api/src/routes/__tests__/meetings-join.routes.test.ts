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
} from '../../db/schema.js';
import { errorHandler } from '../../plugins/error-handler.js';
import authRoutes from '../auth.js';
import meetingRoutes from '../meetings.js';

// Mock the LiveKit token minting — no real credentials in tests
vi.mock('../../livekit/token.js', () => ({
  mintLivekitAccessToken: vi.fn().mockResolvedValue('mock-livekit-token-xyz'),
}));

vi.mock('../../livekit/dispatch.js', () => ({
  dispatchMeetingWorker: vi.fn().mockResolvedValue(undefined),
}));

let app: FastifyInstance;
let accessTokenA: string;
let accessTokenB: string;

const USER_A = {
  email: 'join-tester-a@example.com',
  password: 'securepassword123',
  display_name: 'Join Tester A',
};
const USER_B = {
  email: 'join-tester-b@example.com',
  password: 'securepassword123',
  display_name: 'Join Tester B',
};

beforeAll(async () => {
  // Set LIVEKIT_URL for the join handler
  process.env.LIVEKIT_URL = 'wss://test.livekit.cloud';

  app = Fastify();
  await app.register(cookie);
  app.decorateRequest('user', undefined);
  app.setErrorHandler(errorHandler);
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(meetingRoutes, { prefix: '/meetings' });
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
});

afterAll(async () => {
  delete process.env.LIVEKIT_URL;
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
  await db.delete(meetings);
});

function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function createMeeting(token: string, title = 'Test Meeting') {
  const res = await app.inject({
    method: 'POST',
    url: '/meetings',
    headers: authHeader(token),
    payload: { title },
  });
  return res.json();
}

describe('POST /meetings/:id/join', () => {
  it('returns livekit_url and livekit_token', async () => {
    const meeting = await createMeeting(accessTokenA);

    const res = await app.inject({
      method: 'POST',
      url: `/meetings/${meeting.id}/join`,
      headers: authHeader(accessTokenA),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.livekit_url).toBe('wss://test.livekit.cloud');
    expect(body.livekit_token).toBe('mock-livekit-token-xyz');
  });

  it('host join opens scheduled meeting (sets started_at, status stays scheduled)', async () => {
    const meeting = await createMeeting(accessTokenA);
    expect(meeting.status).toBe('scheduled');

    await app.inject({
      method: 'POST',
      url: `/meetings/${meeting.id}/join`,
      headers: authHeader(accessTokenA),
    });

    // started_at set by host open; status transitions to 'live' only when
    // the worker observes a real participant.
    const getRes = await app.inject({
      method: 'GET',
      url: `/meetings/${meeting.id}`,
      headers: authHeader(accessTokenA),
    });
    const updated = getRes.json();
    expect(updated.status).toBe('scheduled');
    expect(updated.started_at).not.toBeNull();
  });

  it('is idempotent on already-live meeting', async () => {
    const meeting = await createMeeting(accessTokenA);

    // First join → transitions to live
    await app.inject({
      method: 'POST',
      url: `/meetings/${meeting.id}/join`,
      headers: authHeader(accessTokenA),
    });

    // Second join → should still work, no error
    const res = await app.inject({
      method: 'POST',
      url: `/meetings/${meeting.id}/join`,
      headers: authHeader(accessTokenA),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().livekit_token).toBe('mock-livekit-token-xyz');
  });

  it('returns 409 for ended meeting', async () => {
    const meeting = await createMeeting(accessTokenA);

    // Manually set status to ended
    await db
      .update(meetings)
      .set({ status: 'ended', endedAt: new Date() })
      .where(eq(meetings.id, meeting.id));

    const res = await app.inject({
      method: 'POST',
      url: `/meetings/${meeting.id}/join`,
      headers: authHeader(accessTokenA),
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('Conflict');
  });

  it('returns 409 for cancelled meeting', async () => {
    const meeting = await createMeeting(accessTokenA);

    await db
      .update(meetings)
      .set({ status: 'cancelled' })
      .where(eq(meetings.id, meeting.id));

    const res = await app.inject({
      method: 'POST',
      url: `/meetings/${meeting.id}/join`,
      headers: authHeader(accessTokenA),
    });

    expect(res.statusCode).toBe(409);
  });

  it('returns 404 for a different user', async () => {
    const meeting = await createMeeting(accessTokenA);

    const res = await app.inject({
      method: 'POST',
      url: `/meetings/${meeting.id}/join`,
      headers: authHeader(accessTokenB),
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 401 without token', async () => {
    const meeting = await createMeeting(accessTokenA);

    const res = await app.inject({
      method: 'POST',
      url: `/meetings/${meeting.id}/join`,
    });

    expect(res.statusCode).toBe(401);
  });

  it('dispatches worker on join', async () => {
    const { dispatchMeetingWorker } = await import(
      '../../livekit/dispatch.js'
    );
    const meeting = await createMeeting(accessTokenA);

    await app.inject({
      method: 'POST',
      url: `/meetings/${meeting.id}/join`,
      headers: authHeader(accessTokenA),
    });

    expect(dispatchMeetingWorker).toHaveBeenCalledWith({
      meetingId: meeting.id,
      roomName: expect.stringContaining('meeting-'),
    });
  });

  it('returns 500 when dispatch fails', async () => {
    const { dispatchMeetingWorker } = await import(
      '../../livekit/dispatch.js'
    );
    (
      dispatchMeetingWorker as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new Error('dispatch failed'));

    const meeting = await createMeeting(accessTokenA);

    const res = await app.inject({
      method: 'POST',
      url: `/meetings/${meeting.id}/join`,
      headers: authHeader(accessTokenA),
    });

    expect(res.statusCode).toBe(500);
  });
});

describe('POST /meetings/:id/leave', () => {
  it('returns 204', async () => {
    const meeting = await createMeeting(accessTokenA);

    const res = await app.inject({
      method: 'POST',
      url: `/meetings/${meeting.id}/leave`,
      headers: authHeader(accessTokenA),
    });

    expect(res.statusCode).toBe(204);
  });
});
