import { and, asc, eq, gt } from 'drizzle-orm';
import { db } from '../db/client.js';
import { transcriptMessages } from '../db/schema.js';
import type { TranscriptMessageSchema } from '@meeting-app/shared';

type TranscriptRow = typeof transcriptMessages.$inferSelect;

export function toTranscriptResponse(
  row: TranscriptRow,
): TranscriptMessageSchema {
  return {
    id: row.id,
    meeting_id: row.meetingId,
    speaker_identity: row.speakerIdentity,
    speaker_name: row.speakerName,
    text: row.text,
    start_ts_ms: row.startTsMs,
    end_ts_ms: row.endTsMs,
    created_at: row.createdAt.toISOString(),
  };
}

export async function getTranscript(
  meetingId: string,
): Promise<TranscriptMessageSchema[]> {
  const rows = await db
    .select()
    .from(transcriptMessages)
    .where(eq(transcriptMessages.meetingId, meetingId))
    .orderBy(asc(transcriptMessages.id));
  return rows.map(toTranscriptResponse);
}

export async function getTranscriptSince(
  meetingId: string,
  lastId: number,
  limit = 500,
): Promise<TranscriptMessageSchema[]> {
  const rows = await db
    .select()
    .from(transcriptMessages)
    .where(
      and(
        eq(transcriptMessages.meetingId, meetingId),
        gt(transcriptMessages.id, lastId),
      ),
    )
    .orderBy(asc(transcriptMessages.id))
    .limit(limit);
  return rows.map(toTranscriptResponse);
}
