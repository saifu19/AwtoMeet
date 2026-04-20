import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
  vi,
} from 'vitest';
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

vi.mock('../../livekit/token.js', () => ({
  mintLivekitAccessToken: vi.fn().mockResolvedValue('mock-livekit-token-xyz'),
}));

vi.mock('../../livekit/dispatch.js', () => ({
  dispatchMeetingWorker: vi.fn().mockResolvedValue(undefined),
}));

let app: FastifyInstance;
let hostToken: string;

const HOST = {
  email: 'guest-join-host@example.com',
  password: 'securepassword123',
  display_name: 'Guest Join Host',
};

beforeAll(async () => {
  process.env.LIVEKIT_URL = 'wss://test.livekit.cloud';

  app = Fastify();
  await app.register(cookie);
  app.decorateRequest('user', undefined);
  app.setErrorHandler(errorHandler);
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(meetingRoutes, { prefix: '/meetings' });
  await app.ready();

  const res = await app.inject({
    method: 'POST',
    url: '/auth/signup',
    payload: HOST,
  });
  hostToken = res.json().access;
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

async function createMeeting(): Promise<{ id: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/meetings',
    headers: authHeader(hostToken),
    payload: { title: 'Guest Test' },
  });
  return res.json();
}

async function hostOpensMeeting(meetingId: string): Promise<void> {
  // Host join flips started_at so guests can join.
  await app.inject({
    method: 'POST',
    url: `/meetings/${meetingId}/join`,
    headers: authHeader(hostToken),
  });
}

describe('POST /meetings/:id/join-guest', () => {
  it('issues a token when the host has opened the meeting', async () => {
    const meeting = await createMeeting();
    await hostOpensMeeting(meeting.id);

    const res = await app.inject({
      method: 'POST',
      url: `/meetings/${meeting.id}/join-guest`,
      payload: { display_name: 'Alice Guest' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.livekit_url).toBe('wss://test.livekit.cloud');
    expect(body.livekit_token).toBe('mock-livekit-token-xyz');
  });

  it('does not require an Authorization header', async () => {
    const meeting = await createMeeting();
    await hostOpensMeeting(meeting.id);

    const res = await app.inject({
      method: 'POST',
      url: `/meetings/${meeting.id}/join-guest`,
      payload: { display_name: 'Unauth Guest' },
    });

    expect(res.statusCode).toBe(200);
  });

  it('rejects a scheduled meeting the host has not opened yet with 409', async () => {
    const meeting = await createMeeting();
    // Not calling hostOpensMeeting — started_at is null.

    const res = await app.inject({
      method: 'POST',
      url: `/meetings/${meeting.id}/join-guest`,
      payload: { display_name: 'Too Early Guest' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('Conflict');
  });

  it('rejects an ended meeting with 409', async () => {
    const meeting = await createMeeting();
    await db
      .update(meetings)
      .set({ status: 'ended', endedAt: new Date() })
      .where(eq(meetings.id, meeting.id));

    const res = await app.inject({
      method: 'POST',
      url: `/meetings/${meeting.id}/join-guest`,
      payload: { display_name: 'Late Guest' },
    });

    expect(res.statusCode).toBe(409);
  });

  it('rejects a cancelled meeting with 409', async () => {
    const meeting = await createMeeting();
    await db
      .update(meetings)
      .set({ status: 'cancelled' })
      .where(eq(meetings.id, meeting.id));

    const res = await app.inject({
      method: 'POST',
      url: `/meetings/${meeting.id}/join-guest`,
      payload: { display_name: 'Cancelled Guest' },
    });

    expect(res.statusCode).toBe(409);
  });

  it('returns 404 for a missing meeting id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/meetings/01ARZ3NDEKTSV4RRFFQ69G5FAV/join-guest`,
      payload: { display_name: 'Ghost' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('rejects a missing display_name with 400', async () => {
    const meeting = await createMeeting();
    await hostOpensMeeting(meeting.id);

    const res = await app.inject({
      method: 'POST',
      url: `/meetings/${meeting.id}/join-guest`,
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  it('rejects an empty display_name with 400', async () => {
    const meeting = await createMeeting();
    await hostOpensMeeting(meeting.id);

    const res = await app.inject({
      method: 'POST',
      url: `/meetings/${meeting.id}/join-guest`,
      payload: { display_name: '' },
    });

    expect(res.statusCode).toBe(400);
  });
});
