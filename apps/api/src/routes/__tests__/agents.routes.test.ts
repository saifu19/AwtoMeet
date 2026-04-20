import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { users, sessions, agents, meetingTypes, meetingTypeAgents } from '../../db/schema.js';
import { errorHandler } from '../../plugins/error-handler.js';
import authRoutes from '../auth.js';
import agentRoutes from '../agents.js';

let app: FastifyInstance;
let accessTokenA: string;
let accessTokenB: string;

const USER_A = {
  email: 'agent-tester-a@example.com',
  password: 'securepassword123',
  display_name: 'Agent Tester A',
};
const USER_B = {
  email: 'agent-tester-b@example.com',
  password: 'securepassword123',
  display_name: 'Agent Tester B',
};

beforeAll(async () => {
  app = Fastify();
  await app.register(cookie);
  app.decorateRequest('user', undefined);
  app.setErrorHandler(errorHandler);
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(agentRoutes, { prefix: '/agents' });
  await app.ready();

  // Create two users for ownership tests
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
  await db.delete(agents);
  await db.delete(meetingTypes);
  await db.delete(sessions);
  await db.delete(users);
  const { pool } = await import('../../db/client.js');
  await pool.end();
});

afterEach(async () => {
  await db.delete(meetingTypeAgents);
  await db.delete(agents);
  await db.delete(meetingTypes);
});

function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}

const AGENT_PAYLOAD = {
  name: 'Summarizer',
  system_prompt: 'You summarize meetings concisely.',
  provider: 'openai',
  model: 'gpt-4o-mini',
};

describe('GET /agents', () => {
  it('returns empty array for new user', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/agents',
      headers: authHeader(accessTokenA),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });

  it('returns 401 without token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/agents',
    });

    expect(res.statusCode).toBe(401);
  });
});

describe('POST /agents', () => {
  it('creates an agent and returns 201 with correct shape', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      headers: authHeader(accessTokenA),
      payload: AGENT_PAYLOAD,
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toHaveLength(26);
    expect(body.name).toBe(AGENT_PAYLOAD.name);
    expect(body.system_prompt).toBe(AGENT_PAYLOAD.system_prompt);
    expect(body.provider).toBe('openai');
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.org_id).toBeNull();
    expect(body.created_at).toBeDefined();
  });

  it('stores null for provider and model when omitted', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      headers: authHeader(accessTokenA),
      payload: {
        name: 'Default Agent',
        system_prompt: 'Uses default provider.',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.provider).toBeNull();
    expect(body.model).toBeNull();
  });

  it('returns 400 on invalid body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      headers: authHeader(accessTokenA),
      payload: { name: '' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Validation');
  });
});

describe('GET /agents/:id', () => {
  it('returns agent for the owner', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/agents',
      headers: authHeader(accessTokenA),
      payload: AGENT_PAYLOAD,
    });
    const agentId = createRes.json().id;

    const res = await app.inject({
      method: 'GET',
      url: `/agents/${agentId}`,
      headers: authHeader(accessTokenA),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(agentId);
    expect(res.json().name).toBe(AGENT_PAYLOAD.name);
  });

  it('returns 404 for a different user', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/agents',
      headers: authHeader(accessTokenA),
      payload: AGENT_PAYLOAD,
    });
    const agentId = createRes.json().id;

    const res = await app.inject({
      method: 'GET',
      url: `/agents/${agentId}`,
      headers: authHeader(accessTokenB),
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('Not Found');
  });

  it('returns 404 for nonexistent id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/agents/01AAAAAAAAAAAAAAAAAAAAAAAA',
      headers: authHeader(accessTokenA),
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('PATCH /agents/:id', () => {
  it('updates fields and returns updated agent', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/agents',
      headers: authHeader(accessTokenA),
      payload: AGENT_PAYLOAD,
    });
    const agentId = createRes.json().id;

    const res = await app.inject({
      method: 'PATCH',
      url: `/agents/${agentId}`,
      headers: authHeader(accessTokenA),
      payload: { name: 'Renamed Agent', system_prompt: 'New prompt.' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('Renamed Agent');
    expect(res.json().system_prompt).toBe('New prompt.');
    // Unchanged fields remain
    expect(res.json().provider).toBe('openai');
  });

  it('returns 404 for a different user', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/agents',
      headers: authHeader(accessTokenA),
      payload: AGENT_PAYLOAD,
    });
    const agentId = createRes.json().id;

    const res = await app.inject({
      method: 'PATCH',
      url: `/agents/${agentId}`,
      headers: authHeader(accessTokenB),
      payload: { name: 'Hacked' },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /agents/:id', () => {
  it('deletes agent and returns 204', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/agents',
      headers: authHeader(accessTokenA),
      payload: AGENT_PAYLOAD,
    });
    const agentId = createRes.json().id;

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/agents/${agentId}`,
      headers: authHeader(accessTokenA),
    });

    expect(deleteRes.statusCode).toBe(204);

    // Verify it's gone
    const getRes = await app.inject({
      method: 'GET',
      url: `/agents/${agentId}`,
      headers: authHeader(accessTokenA),
    });
    expect(getRes.statusCode).toBe(404);
  });

  it('returns 404 for a different user', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/agents',
      headers: authHeader(accessTokenA),
      payload: AGENT_PAYLOAD,
    });
    const agentId = createRes.json().id;

    const res = await app.inject({
      method: 'DELETE',
      url: `/agents/${agentId}`,
      headers: authHeader(accessTokenB),
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 409 when agent is referenced by a meeting type', async () => {
    // Create an agent
    const createRes = await app.inject({
      method: 'POST',
      url: '/agents',
      headers: authHeader(accessTokenA),
      payload: AGENT_PAYLOAD,
    });
    const agentId = createRes.json().id;

    // Get user id for meeting type creation
    const meRes = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: authHeader(accessTokenA),
    });
    const userId = meRes.json().id;

    // Manually create a meeting type and link it to the agent
    const { ulid } = await import('ulid');
    const mtId = ulid();
    await db.insert(meetingTypes).values({
      id: mtId,
      userId,
      name: 'Test Meeting Type',
    });
    await db.insert(meetingTypeAgents).values({
      meetingTypeId: mtId,
      agentId,
    });

    // Try to delete
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/agents/${agentId}`,
      headers: authHeader(accessTokenA),
    });

    expect(deleteRes.statusCode).toBe(409);
    expect(deleteRes.json().error).toBe('Conflict');
    expect(deleteRes.json().message).toContain('in use');
  });
});
