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
import http from 'node:http';
import { ulid } from 'ulid';
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
  transcriptMessages,
  agentRuns,
  agentOutputs,
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
let otherToken: string;
let inviteeWithInsightsToken: string;
let inviteeWithoutInsightsToken: string;
let hostUserId: string;
let inviteeWithInsightsUserId: string;
let inviteeWithoutInsightsUserId: string;

const HOST = {
  email: 'stream-host@example.com',
  password: 'securepassword123',
  display_name: 'Stream Host',
};
const OTHER = {
  email: 'stream-other@example.com',
  password: 'securepassword123',
  display_name: 'Stream Other',
};
const INVITEE_WITH_INSIGHTS = {
  email: 'stream-invitee-insights@example.com',
  password: 'securepassword123',
  display_name: 'Invitee With Insights',
};
const INVITEE_WITHOUT_INSIGHTS = {
  email: 'stream-invitee-no-insights@example.com',
  password: 'securepassword123',
  display_name: 'Invitee Without Insights',
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

  const resHost = await app.inject({
    method: 'POST',
    url: '/auth/signup',
    payload: HOST,
  });
  hostToken = resHost.json().access;
  hostUserId = resHost.json().user.id;

  const resOther = await app.inject({
    method: 'POST',
    url: '/auth/signup',
    payload: OTHER,
  });
  otherToken = resOther.json().access;

  const resInviteeInsights = await app.inject({
    method: 'POST',
    url: '/auth/signup',
    payload: INVITEE_WITH_INSIGHTS,
  });
  inviteeWithInsightsToken = resInviteeInsights.json().access;
  inviteeWithInsightsUserId = resInviteeInsights.json().user.id;

  const resInviteeNoInsights = await app.inject({
    method: 'POST',
    url: '/auth/signup',
    payload: INVITEE_WITHOUT_INSIGHTS,
  });
  inviteeWithoutInsightsToken = resInviteeNoInsights.json().access;
  inviteeWithoutInsightsUserId = resInviteeNoInsights.json().user.id;
});

afterAll(async () => {
  delete process.env.LIVEKIT_URL;
  await db.delete(agentOutputs);
  await db.delete(agentRuns);
  await db.delete(transcriptMessages);
  await db.delete(meetingInvites);
  await db.delete(meetings);
  await db.delete(meetingTypeAgents);
  await db.delete(meetingTypes);
  await db.delete(agents);
  await db.delete(sessions);
  await db.delete(users);
  await app.close();
  const { pool } = await import('../../db/client.js');
  await pool.end();
});

afterEach(async () => {
  await db.delete(agentOutputs);
  await db.delete(agentRuns);
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

async function createMeeting(token: string): Promise<{ id: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/meetings',
    headers: authHeader(token),
    payload: { title: 'Stream Test' },
  });
  return res.json();
}

async function seedTranscript(meetingId: string, text: string): Promise<void> {
  await db.insert(transcriptMessages).values({
    meetingId,
    speakerIdentity: 'test-speaker',
    speakerName: 'Test Speaker',
    text,
    startTsMs: 0,
    endTsMs: 1000,
  });
}

async function seedAgentOutput(
  meetingId: string,
  agentId: string,
  content: string,
): Promise<void> {
  const runResult = await db.insert(agentRuns).values({
    meetingId,
    agentId,
    bufferStartMsgId: 1,
    bufferEndMsgId: 2,
    status: 'done',
    finishedAt: new Date(),
  });
  const runId = Number(
    (runResult as unknown as [{ insertId: number }])[0].insertId,
  );
  await db.insert(agentOutputs).values({
    agentRunId: runId,
    meetingId,
    agentId,
    content,
    metadata: null,
  });
}

async function createAgent(name = 'Summary Agent'): Promise<string> {
  const id = ulid();
  await db.insert(agents).values({
    id,
    userId: hostUserId,
    orgId: null,
    name,
    systemPrompt: 'Summarize the conversation.',
    provider: 'openai',
    model: 'gpt-4o-mini',
  });
  return id;
}

async function createMeetingTypeWithAgents(
  agentIds: string[],
): Promise<string> {
  const id = ulid();
  await db.insert(meetingTypes).values({
    id,
    userId: hostUserId,
    orgId: null,
    name: 'Type with agents',
    description: null,
    agendaItems: null,
    bufferSize: 10,
  });
  if (agentIds.length > 0) {
    await db
      .insert(meetingTypeAgents)
      .values(agentIds.map((agentId) => ({ meetingTypeId: id, agentId })));
  }
  return id;
}

async function createMeetingWithType(
  token: string,
  meetingTypeId: string,
): Promise<{ id: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/meetings',
    headers: authHeader(token),
    payload: { title: 'Stream Test', meeting_type_id: meetingTypeId },
  });
  return res.json();
}

async function inviteUser(
  meetingId: string,
  invitedUserId: string,
  email: string,
  canViewInsights: boolean,
): Promise<void> {
  await db.insert(meetingInvites).values({
    id: ulid(),
    meetingId,
    invitedEmail: email,
    invitedUserId,
    role: 'participant',
    canViewInsights,
    inviteToken: ulid(),
    acceptedAt: new Date(),
  });
}

async function mintStreamCookie(
  meetingId: string,
  token: string,
): Promise<{
  statusCode: number;
  cookieHeader: string | null;
  streamSession: string | null;
}> {
  const res = await app.inject({
    method: 'POST',
    url: `/meetings/${meetingId}/stream-session`,
    headers: authHeader(token),
  });
  const rawCookies = res.headers['set-cookie'];
  const cookieHeader = Array.isArray(rawCookies)
    ? rawCookies.join('; ')
    : (rawCookies ?? null);
  const match = cookieHeader?.match(/stream_session=([^;]+)/);
  return {
    statusCode: res.statusCode,
    cookieHeader,
    streamSession: match ? decodeURIComponent(match[1]!) : null,
  };
}

describe('GET /meetings/:id/transcript', () => {
  it('returns seeded transcript rows ordered by id', async () => {
    const meeting = await createMeeting(hostToken);
    await seedTranscript(meeting.id, 'hello');
    await seedTranscript(meeting.id, 'world');

    const res = await app.inject({
      method: 'GET',
      url: `/meetings/${meeting.id}/transcript`,
      headers: authHeader(hostToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].text).toBe('hello');
    expect(body.messages[1].text).toBe('world');
    expect(body.messages[0].id).toBeLessThan(body.messages[1].id);
    expect(body.messages[0].meeting_id).toBe(meeting.id);
  });

  it('returns empty array for meeting with no transcripts', async () => {
    const meeting = await createMeeting(hostToken);

    const res = await app.inject({
      method: 'GET',
      url: `/meetings/${meeting.id}/transcript`,
      headers: authHeader(hostToken),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().messages).toEqual([]);
  });

  it('returns 404 for non-host non-invitee', async () => {
    const meeting = await createMeeting(hostToken);

    const res = await app.inject({
      method: 'GET',
      url: `/meetings/${meeting.id}/transcript`,
      headers: authHeader(otherToken),
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 401 without token', async () => {
    const meeting = await createMeeting(hostToken);

    const res = await app.inject({
      method: 'GET',
      url: `/meetings/${meeting.id}/transcript`,
    });

    expect(res.statusCode).toBe(401);
  });
});

describe('GET /meetings/:id/insights', () => {
  it('returns empty array when no agent outputs exist', async () => {
    const meeting = await createMeeting(hostToken);

    const res = await app.inject({
      method: 'GET',
      url: `/meetings/${meeting.id}/insights`,
      headers: authHeader(hostToken),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().insights).toEqual([]);
  });

  it('joins agent_name from agents table', async () => {
    const meeting = await createMeeting(hostToken);
    const agentId = await createAgent();
    await seedAgentOutput(meeting.id, agentId, 'first finding');

    const res = await app.inject({
      method: 'GET',
      url: `/meetings/${meeting.id}/insights`,
      headers: authHeader(hostToken),
    });

    expect(res.statusCode).toBe(200);
    const { insights } = res.json();
    expect(insights).toHaveLength(1);
    expect(insights[0].content).toBe('first finding');
    expect(insights[0].agent_name).toBe('Summary Agent');
    expect(insights[0].agent_id).toBe(agentId);
  });

  it('returns 404 for non-host non-invitee', async () => {
    const meeting = await createMeeting(hostToken);

    const res = await app.inject({
      method: 'GET',
      url: `/meetings/${meeting.id}/insights`,
      headers: authHeader(otherToken),
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('POST /meetings/:id/stream-session', () => {
  it('sets a hardened stream_session cookie for the host', async () => {
    const meeting = await createMeeting(hostToken);
    const res = await app.inject({
      method: 'POST',
      url: `/meetings/${meeting.id}/stream-session`,
      headers: authHeader(hostToken),
    });
    expect(res.statusCode).toBe(204);

    const rawCookies = res.headers['set-cookie'];
    const cookieHeader = Array.isArray(rawCookies)
      ? rawCookies.join('\n')
      : String(rawCookies ?? '');
    expect(cookieHeader).toContain('stream_session=');
    expect(cookieHeader).toContain('HttpOnly');
    expect(cookieHeader).toMatch(/SameSite=Lax/i);
    expect(cookieHeader).toContain(
      `Path=/meetings/${meeting.id}/stream`,
    );
    // Max-Age=60 second TTL decouples cookie lifetime from the 30-min stream.
    expect(cookieHeader).toMatch(/Max-Age=60\b/);
    // In test env NODE_ENV !== 'production' so Secure must be absent.
    expect(cookieHeader).not.toMatch(/; ?Secure/i);
  });

  it('sets Secure flag when NODE_ENV=production', async () => {
    const meeting = await createMeeting(hostToken);
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/meetings/${meeting.id}/stream-session`,
        headers: authHeader(hostToken),
      });
      expect(res.statusCode).toBe(204);
      const rawCookies = res.headers['set-cookie'];
      const cookieHeader = Array.isArray(rawCookies)
        ? rawCookies.join('\n')
        : String(rawCookies ?? '');
      expect(cookieHeader).toMatch(/; ?Secure/i);
    } finally {
      process.env.NODE_ENV = original;
    }
  });

  it('flips to SameSite=None; Secure when CROSS_SITE_COOKIES=true', async () => {
    const meeting = await createMeeting(hostToken);
    const original = process.env.CROSS_SITE_COOKIES;
    process.env.CROSS_SITE_COOKIES = 'true';
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/meetings/${meeting.id}/stream-session`,
        headers: authHeader(hostToken),
      });
      expect(res.statusCode).toBe(204);
      const rawCookies = res.headers['set-cookie'];
      const cookieHeader = Array.isArray(rawCookies)
        ? rawCookies.join('\n')
        : String(rawCookies ?? '');
      expect(cookieHeader).toMatch(/SameSite=None/i);
      expect(cookieHeader).toMatch(/; ?Secure/i);
    } finally {
      process.env.CROSS_SITE_COOKIES = original;
    }
  });

  it('allows an invitee with can_view_insights to mint', async () => {
    const meeting = await createMeeting(hostToken);
    await inviteUser(
      meeting.id,
      inviteeWithInsightsUserId,
      INVITEE_WITH_INSIGHTS.email,
      true,
    );
    const res = await app.inject({
      method: 'POST',
      url: `/meetings/${meeting.id}/stream-session`,
      headers: authHeader(inviteeWithInsightsToken),
    });
    expect(res.statusCode).toBe(204);
  });

  it('denies an invitee without can_view_insights (404)', async () => {
    const meeting = await createMeeting(hostToken);
    await inviteUser(
      meeting.id,
      inviteeWithoutInsightsUserId,
      INVITEE_WITHOUT_INSIGHTS.email,
      false,
    );
    const res = await app.inject({
      method: 'POST',
      url: `/meetings/${meeting.id}/stream-session`,
      headers: authHeader(inviteeWithoutInsightsToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it('denies a non-invitee (404)', async () => {
    const meeting = await createMeeting(hostToken);
    const res = await app.inject({
      method: 'POST',
      url: `/meetings/${meeting.id}/stream-session`,
      headers: authHeader(otherToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 401 without a bearer token', async () => {
    const meeting = await createMeeting(hostToken);
    const res = await app.inject({
      method: 'POST',
      url: `/meetings/${meeting.id}/stream-session`,
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /meetings/:id/agents', () => {
  it('returns empty array when meeting has no meeting_type', async () => {
    const meeting = await createMeeting(hostToken);
    const res = await app.inject({
      method: 'GET',
      url: `/meetings/${meeting.id}/agents`,
      headers: authHeader(hostToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ agents: [] });
  });

  it('returns agents attached to the meeting_type', async () => {
    const agentIdA = await createAgent('Agent A');
    const agentIdB = await createAgent('Agent B');
    const meetingTypeId = await createMeetingTypeWithAgents([
      agentIdA,
      agentIdB,
    ]);
    const meeting = await createMeetingWithType(hostToken, meetingTypeId);

    const res = await app.inject({
      method: 'GET',
      url: `/meetings/${meeting.id}/agents`,
      headers: authHeader(hostToken),
    });
    expect(res.statusCode).toBe(200);
    const { agents: returned } = res.json() as {
      agents: Array<{ id: string; name: string }>;
    };
    expect(returned).toHaveLength(2);
    const names = returned.map((a) => a.name).sort();
    expect(names).toEqual(['Agent A', 'Agent B']);
  });

  it('allows an invitee with can_view_insights', async () => {
    const agentId = await createAgent('Solo Agent');
    const meetingTypeId = await createMeetingTypeWithAgents([agentId]);
    const meeting = await createMeetingWithType(hostToken, meetingTypeId);
    await inviteUser(
      meeting.id,
      inviteeWithInsightsUserId,
      INVITEE_WITH_INSIGHTS.email,
      true,
    );

    const res = await app.inject({
      method: 'GET',
      url: `/meetings/${meeting.id}/agents`,
      headers: authHeader(inviteeWithInsightsToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().agents).toHaveLength(1);
  });

  it('denies an invitee without can_view_insights (404)', async () => {
    const meeting = await createMeeting(hostToken);
    await inviteUser(
      meeting.id,
      inviteeWithoutInsightsUserId,
      INVITEE_WITHOUT_INSIGHTS.email,
      false,
    );
    const res = await app.inject({
      method: 'GET',
      url: `/meetings/${meeting.id}/agents`,
      headers: authHeader(inviteeWithoutInsightsToken),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /meetings/:id/stream (SSE)', () => {
  let serverUrl: string;

  beforeAll(async () => {
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('failed to bind test server');
    }
    serverUrl = `http://127.0.0.1:${address.port}`;
  });

  function openStream(
    meetingId: string,
    cookieValue: string | null,
    query = '',
  ): Promise<{
    statusCode: number;
    headers: http.IncomingHttpHeaders;
    chunks: string[];
    req: http.ClientRequest;
    done: Promise<void>;
  }> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {};
      if (cookieValue) {
        headers.cookie = `stream_session=${encodeURIComponent(cookieValue)}`;
      }
      const req = http.request(
        `${serverUrl}/meetings/${meetingId}/stream${query}`,
        { method: 'GET', headers },
        (res) => {
          const chunks: string[] = [];
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            chunks.push(chunk);
          });
          const done = new Promise<void>((resolveDone) => {
            res.on('end', () => resolveDone());
            res.on('close', () => resolveDone());
          });
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            chunks,
            req,
            done,
          });
        },
      );
      req.on('error', reject);
      req.end();
    });
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  it('returns 401 without a stream_session cookie', async () => {
    const meeting = await createMeeting(hostToken);
    const stream = await openStream(meeting.id, null);
    expect(stream.statusCode).toBe(401);
    stream.req.destroy();
    await stream.done;
  });

  it('returns 401 when cookie is bound to a different meeting', async () => {
    const meetingA = await createMeeting(hostToken);
    const meetingB = await createMeeting(hostToken);
    const mint = await mintStreamCookie(meetingA.id, hostToken);
    expect(mint.statusCode).toBe(204);
    expect(mint.streamSession).toBeTruthy();

    const stream = await openStream(meetingB.id, mint.streamSession);
    expect(stream.statusCode).toBe(401);
    stream.req.destroy();
    await stream.done;
  });

  it(
    'sets text/event-stream and emits an immediate ping',
    async () => {
      const meeting = await createMeeting(hostToken);
      const mint = await mintStreamCookie(meeting.id, hostToken);
      expect(mint.streamSession).toBeTruthy();

      const stream = await openStream(meeting.id, mint.streamSession);
      expect(stream.statusCode).toBe(200);
      expect(stream.headers['content-type']).toMatch(/text\/event-stream/);

      await sleep(200);
      const joined = stream.chunks.join('');
      expect(joined).toMatch(/event: ping/);

      stream.req.destroy();
      await stream.done;
    },
    15_000,
  );

  it(
    'emits transcript event for rows inserted after connect',
    async () => {
      const meeting = await createMeeting(hostToken);
      const mint = await mintStreamCookie(meeting.id, hostToken);

      const stream = await openStream(meeting.id, mint.streamSession);
      expect(stream.statusCode).toBe(200);

      await sleep(100);
      await seedTranscript(meeting.id, 'live message');

      const deadline = Date.now() + 3500;
      let joined = '';
      while (Date.now() < deadline) {
        joined = stream.chunks.join('');
        if (/event: transcript/.test(joined)) break;
        await sleep(100);
      }

      expect(joined).toMatch(/event: transcript/);
      expect(joined).toContain('"type":"transcript"');
      expect(joined).toContain('"text":"live message"');

      stream.req.destroy();
      await stream.done;
    },
    15_000,
  );

  it(
    'honors last_transcript_id query param on reconnect',
    async () => {
      const meeting = await createMeeting(hostToken);
      await seedTranscript(meeting.id, 'old message');
      const rows = await db
        .select()
        .from(transcriptMessages)
        .where(eq(transcriptMessages.meetingId, meeting.id));
      const maxId = Math.max(...rows.map((r) => r.id));

      const mint = await mintStreamCookie(meeting.id, hostToken);
      const stream = await openStream(
        meeting.id,
        mint.streamSession,
        `?last_transcript_id=${maxId}`,
      );
      expect(stream.statusCode).toBe(200);

      await sleep(1500);
      const joined = stream.chunks.join('');
      expect(joined).not.toContain('"text":"old message"');

      stream.req.destroy();
      await stream.done;
    },
    15_000,
  );
});
