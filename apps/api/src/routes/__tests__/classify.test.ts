import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';

// ── Mock OpenAI before any imports that use it ──────────────────────
const mockParse = vi.fn();

vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      chat = {
        completions: {
          parse: mockParse,
        },
      };
      constructor() {}
    },
  };
});

// Stub zodResponseFormat — the mock never reaches OpenAI so we don't
// need the real helper, just a passthrough.
vi.mock('openai/helpers/zod', () => ({
  zodResponseFormat: (_schema: unknown, name: string) => ({
    type: 'json_schema',
    json_schema: { name },
  }),
}));

import Fastify, { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { db } from '../../db/client.js';
import { ulid } from 'ulid';
import {
  users,
  sessions,
  meetingTypes,
  meetingTypeAgents,
  meetings,
} from '../../db/schema.js';
import { errorHandler } from '../../plugins/error-handler.js';
import authRoutes from '../auth.js';
import meetingRoutes from '../meetings.js';
import meetingTypeRoutes from '../meeting-types.js';
import { classifyMeetingType } from '../../services/classify.js';

let app: FastifyInstance;
let accessToken: string;
let userId: string;

const TEST_USER = {
  email: 'classify-tester@example.com',
  password: 'securepassword123',
  display_name: 'Classify Tester',
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

  const res = await app.inject({
    method: 'POST',
    url: '/auth/signup',
    payload: TEST_USER,
  });
  accessToken = res.json().access;
  userId = res.json().user.id;
});

afterAll(async () => {
  await db.delete(meetings);
  await db.delete(meetingTypeAgents);
  await db.delete(meetingTypes);
  await db.delete(sessions);
  await db.delete(users);
  const { pool } = await import('../../db/client.js');
  await pool.end();
});

afterEach(async () => {
  await db.delete(meetings);
  await db.delete(meetingTypeAgents);
  await db.delete(meetingTypes);
  mockParse.mockReset();
});

function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}

// Helper: create a meeting type directly in DB
async function createMeetingType(name: string, description: string | null = null) {
  const id = ulid();
  await db.insert(meetingTypes).values({
    id,
    userId,
    orgId: null,
    name,
    description,
    agendaItems: null,
    bufferSize: 10,
  });
  return id;
}

// Helper: build mock response matching OpenAI structured output shape
function mockClassifyResponse(meetingTypeId: string | null, confidence: number, reason: string) {
  return {
    choices: [
      {
        message: {
          parsed: { meeting_type_id: meetingTypeId, confidence, reason },
          content: JSON.stringify({ meeting_type_id: meetingTypeId, confidence, reason }),
          refusal: null,
        },
      },
    ],
  };
}

// ── Service unit tests ──────────────────────────────────────────────

describe('classifyMeetingType service', () => {
  it('returns null when user has zero meeting types', async () => {
    const result = await classifyMeetingType(userId, { title: 'Standup' });
    expect(result).toBeNull();
    expect(mockParse).not.toHaveBeenCalled();
  });

  it('returns the matched meeting type id on high confidence', async () => {
    const mtId = await createMeetingType('Sales Discovery', 'Intro calls and demos');

    mockParse.mockResolvedValueOnce(
      mockClassifyResponse(mtId, 0.92, 'Title matches Sales Discovery'),
    );

    const result = await classifyMeetingType(userId, {
      title: 'Intro call with Acme',
      description: 'pricing discussion',
    });

    expect(result).toBe(mtId);
    expect(mockParse).toHaveBeenCalledOnce();
  });

  it('returns null when confidence is below 0.5', async () => {
    const mtId = await createMeetingType('Standup', 'Daily sync');

    mockParse.mockResolvedValueOnce(
      mockClassifyResponse(mtId, 0.3, 'Weak match'),
    );

    const result = await classifyMeetingType(userId, { title: 'Random chat' });
    expect(result).toBeNull();
  });

  it('returns null when LLM returns an id not in the user list', async () => {
    await createMeetingType('Standup', 'Daily sync');

    mockParse.mockResolvedValueOnce(
      mockClassifyResponse('01HALLUCINATED_ID_NOT_REAL', 0.95, 'Hallucinated'),
    );

    const result = await classifyMeetingType(userId, { title: 'Test' });
    expect(result).toBeNull();
  });

  it('returns null on LLM timeout/error without throwing', async () => {
    await createMeetingType('Standup', 'Daily sync');

    mockParse.mockRejectedValueOnce(new Error('Request timed out'));

    const result = await classifyMeetingType(userId, { title: 'Test' });
    expect(result).toBeNull();
  });

  it('returns null when LLM returns null meeting_type_id', async () => {
    await createMeetingType('Standup', 'Daily sync');

    mockParse.mockResolvedValueOnce(
      mockClassifyResponse(null, 0.8, 'No good match'),
    );

    const result = await classifyMeetingType(userId, { title: 'Lunch with friends' });
    expect(result).toBeNull();
  });
});

// ── Route integration tests ─────────────────────────────────────────

describe('POST /meetings with auto_classify', () => {
  it('creates meeting with classified meeting_type_id', async () => {
    // Create a meeting type via API
    const mtRes = await app.inject({
      method: 'POST',
      url: '/meeting-types',
      headers: authHeader(accessToken),
      payload: { name: 'Sales Discovery', description: 'Intro calls' },
    });
    const mtId = mtRes.json().id;

    mockParse.mockResolvedValueOnce(
      mockClassifyResponse(mtId, 0.9, 'Sales match'),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/meetings',
      headers: authHeader(accessToken),
      payload: {
        title: 'Intro call with Acme',
        description: 'pricing discussion',
        auto_classify: true,
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().meeting_type_id).toBe(mtId);
    expect(mockParse).toHaveBeenCalledOnce();
  });

  it('ignores auto_classify when meeting_type_id is explicitly provided', async () => {
    const mtRes = await app.inject({
      method: 'POST',
      url: '/meeting-types',
      headers: authHeader(accessToken),
      payload: { name: 'Standup' },
    });
    const mtId = mtRes.json().id;

    const res = await app.inject({
      method: 'POST',
      url: '/meetings',
      headers: authHeader(accessToken),
      payload: {
        title: 'Daily standup',
        meeting_type_id: mtId,
        auto_classify: true,
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().meeting_type_id).toBe(mtId);
    expect(mockParse).not.toHaveBeenCalled();
  });

  it('creates meeting with null type when classification fails', async () => {
    await app.inject({
      method: 'POST',
      url: '/meeting-types',
      headers: authHeader(accessToken),
      payload: { name: 'Sales Discovery' },
    });

    mockParse.mockRejectedValueOnce(new Error('API unreachable'));

    const res = await app.inject({
      method: 'POST',
      url: '/meetings',
      headers: authHeader(accessToken),
      payload: {
        title: 'Intro call',
        auto_classify: true,
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().meeting_type_id).toBeNull();
  });
});
