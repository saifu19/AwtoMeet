import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { db } from '../../db/client.js';
import {
  users,
  sessions,
  agents,
  meetingTypes,
  meetingTypeAgents,
  meetings,
} from '../../db/schema.js';
import { errorHandler } from '../../plugins/error-handler.js';
import authRoutes from '../auth.js';
import agentRoutes from '../agents.js';
import meetingTypeRoutes from '../meeting-types.js';

let app: FastifyInstance;
let accessTokenA: string;
let accessTokenB: string;

const USER_A = {
  email: 'mt-tester-a@example.com',
  password: 'securepassword123',
  display_name: 'MT Tester A',
};
const USER_B = {
  email: 'mt-tester-b@example.com',
  password: 'securepassword123',
  display_name: 'MT Tester B',
};

beforeAll(async () => {
  app = Fastify();
  await app.register(cookie);
  app.decorateRequest('user', undefined);
  app.setErrorHandler(errorHandler);
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(agentRoutes, { prefix: '/agents' });
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
});

afterAll(async () => {
  await db.delete(meetingTypeAgents);
  await db.delete(meetings);
  await db.delete(meetingTypes);
  await db.delete(agents);
  await db.delete(sessions);
  await db.delete(users);
  const { pool } = await import('../../db/client.js');
  await pool.end();
});

afterEach(async () => {
  await db.delete(meetingTypeAgents);
  await db.delete(meetings);
  await db.delete(meetingTypes);
  await db.delete(agents);
});

function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}

const MT_PAYLOAD = {
  name: 'Standup',
  description: 'Daily standup meeting',
  agenda_items: ['Progress update', 'Blockers'],
  buffer_size: 5,
};

describe('GET /meeting-types', () => {
  it('returns empty array for new user', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/meeting-types',
      headers: authHeader(accessTokenA),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });

  it('returns 401 without token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/meeting-types',
    });

    expect(res.statusCode).toBe(401);
  });
});

describe('POST /meeting-types', () => {
  it('creates a meeting type and returns 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/meeting-types',
      headers: authHeader(accessTokenA),
      payload: MT_PAYLOAD,
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toHaveLength(26);
    expect(body.name).toBe(MT_PAYLOAD.name);
    expect(body.description).toBe(MT_PAYLOAD.description);
    expect(body.agenda_items).toEqual(MT_PAYLOAD.agenda_items);
    expect(body.buffer_size).toBe(MT_PAYLOAD.buffer_size);
    expect(body.org_id).toBeNull();
  });

  it('creates a meeting type with linked agents', async () => {
    // Create an agent first
    const agentRes = await app.inject({
      method: 'POST',
      url: '/agents',
      headers: authHeader(accessTokenA),
      payload: {
        name: 'Test Agent',
        system_prompt: 'Test prompt',
      },
    });
    const agentId = agentRes.json().id;

    const res = await app.inject({
      method: 'POST',
      url: '/meeting-types',
      headers: authHeader(accessTokenA),
      payload: { ...MT_PAYLOAD, agent_ids: [agentId] },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().agent_ids).toContain(agentId);
  });

  it('returns 400 on invalid body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/meeting-types',
      headers: authHeader(accessTokenA),
      payload: { name: '' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Validation');
  });
});

describe('GET /meeting-types/:id', () => {
  it('returns meeting type for the owner', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/meeting-types',
      headers: authHeader(accessTokenA),
      payload: MT_PAYLOAD,
    });
    const mtId = createRes.json().id;

    const res = await app.inject({
      method: 'GET',
      url: `/meeting-types/${mtId}`,
      headers: authHeader(accessTokenA),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(mtId);
  });

  it('returns 404 for a different user', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/meeting-types',
      headers: authHeader(accessTokenA),
      payload: MT_PAYLOAD,
    });
    const mtId = createRes.json().id;

    const res = await app.inject({
      method: 'GET',
      url: `/meeting-types/${mtId}`,
      headers: authHeader(accessTokenB),
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('Not Found');
  });

  it('returns 404 for nonexistent id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/meeting-types/01AAAAAAAAAAAAAAAAAAAAAAAA',
      headers: authHeader(accessTokenA),
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('PATCH /meeting-types/:id', () => {
  it('updates fields and returns updated meeting type', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/meeting-types',
      headers: authHeader(accessTokenA),
      payload: MT_PAYLOAD,
    });
    const mtId = createRes.json().id;

    const res = await app.inject({
      method: 'PATCH',
      url: `/meeting-types/${mtId}`,
      headers: authHeader(accessTokenA),
      payload: { name: 'Renamed Standup', buffer_size: 15 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('Renamed Standup');
    expect(res.json().buffer_size).toBe(15);
    expect(res.json().description).toBe(MT_PAYLOAD.description);
  });

  it('returns 404 for a different user', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/meeting-types',
      headers: authHeader(accessTokenA),
      payload: MT_PAYLOAD,
    });
    const mtId = createRes.json().id;

    const res = await app.inject({
      method: 'PATCH',
      url: `/meeting-types/${mtId}`,
      headers: authHeader(accessTokenB),
      payload: { name: 'Hacked' },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /meeting-types/:id', () => {
  it('deletes meeting type and returns 204', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/meeting-types',
      headers: authHeader(accessTokenA),
      payload: MT_PAYLOAD,
    });
    const mtId = createRes.json().id;

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/meeting-types/${mtId}`,
      headers: authHeader(accessTokenA),
    });

    expect(deleteRes.statusCode).toBe(204);

    // Verify it's gone
    const getRes = await app.inject({
      method: 'GET',
      url: `/meeting-types/${mtId}`,
      headers: authHeader(accessTokenA),
    });
    expect(getRes.statusCode).toBe(404);
  });

  it('returns 404 for a different user', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/meeting-types',
      headers: authHeader(accessTokenA),
      payload: MT_PAYLOAD,
    });
    const mtId = createRes.json().id;

    const res = await app.inject({
      method: 'DELETE',
      url: `/meeting-types/${mtId}`,
      headers: authHeader(accessTokenB),
    });

    expect(res.statusCode).toBe(404);
  });
});
