import type { FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { meetings } from '../db/schema.js';
import { getTranscriptSince } from '../repositories/transcript.js';
import { getInsightsSince } from '../repositories/insights.js';
import type {
  TranscriptMessageSchema,
  AgentOutputSchema,
} from '@meeting-app/shared';

const POLL_INTERVAL_MS = 500;
const PAGE_SIZE = 500;
const HEARTBEAT_INTERVAL_MS = 15000;
const STATUS_CHECK_EVERY_N_POLLS = 10;
// Hard cap on a single SSE connection lifetime. Protects against abandoned
// clients holding a connection indefinitely (slowloris-style). The frontend
// EventSource will auto-reconnect on close, so this is transparent to users.
const MAX_STREAM_MS = 30 * 60 * 1000;

export interface StreamMeetingEventsOptions {
  meetingId: string;
  lastTranscriptId: number;
  lastInsightId: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function streamMeetingEvents(
  request: FastifyRequest,
  reply: FastifyReply,
  opts: StreamMeetingEventsOptions,
): Promise<void> {
  reply.hijack();

  const raw = reply.raw;
  raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  request.raw.on('close', stop);
  request.raw.on('error', stop);

  const writeFrame = (event: string, data: unknown): void => {
    if (raw.destroyed) {
      stop();
      return;
    }
    try {
      raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      stop();
    }
  };

  const writePing = (): void => {
    if (raw.destroyed) {
      stop();
      return;
    }
    try {
      raw.write('event: ping\ndata: {}\n\n');
    } catch {
      stop();
    }
  };

  writePing();

  let lastT = opts.lastTranscriptId;
  let lastI = opts.lastInsightId;
  const connectedAt = Date.now();
  let lastHeartbeatAt = connectedAt;
  let pollCount = 0;

  const emitTranscripts = async (): Promise<number> => {
    const rows: TranscriptMessageSchema[] = await getTranscriptSince(
      opts.meetingId,
      lastT,
      PAGE_SIZE,
    );
    for (const row of rows) {
      writeFrame('transcript', { type: 'transcript', data: row });
      lastT = row.id;
      if (stopped) break;
    }
    return rows.length;
  };

  const emitInsights = async (): Promise<number> => {
    const rows: AgentOutputSchema[] = await getInsightsSince(
      opts.meetingId,
      lastI,
      PAGE_SIZE,
    );
    for (const row of rows) {
      writeFrame('insight', { type: 'insight', data: row });
      lastI = row.id;
      if (stopped) break;
    }
    return rows.length;
  };

  try {
    while (!stopped) {
      if (raw.destroyed) break;
      if (Date.now() - connectedAt >= MAX_STREAM_MS) break;

      await sleep(POLL_INTERVAL_MS);
      if (stopped || raw.destroyed) break;

      let tCount = 0;
      let iCount = 0;
      try {
        tCount = await emitTranscripts();
        if (stopped) break;
        iCount = await emitInsights();
      } catch (err) {
        request.log.error({ err, meetingId: opts.meetingId }, 'sse poll failed');
      }

      // Drain mode: if a page filled, loop again without sleeping
      if (tCount === PAGE_SIZE || iCount === PAGE_SIZE) continue;

      const now = Date.now();
      if (now - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
        writePing();
        lastHeartbeatAt = now;
      }

      pollCount += 1;
      if (pollCount % STATUS_CHECK_EVERY_N_POLLS === 0) {
        const [m] = await db
          .select({ status: meetings.status })
          .from(meetings)
          .where(eq(meetings.id, opts.meetingId))
          .limit(1);
        if (m?.status === 'ended') {
          // Final drain pass to flush any late-arriving rows, then exit.
          await emitTranscripts();
          await emitInsights();
          break;
        }
      }
    }
  } finally {
    request.raw.off('close', stop);
    request.raw.off('error', stop);
    if (!raw.destroyed) {
      try {
        raw.end();
      } catch {
        // swallow — client already gone
      }
    }
  }
}
