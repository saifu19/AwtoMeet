import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { meetingSummaries, meetings, meetingTypes } from '../db/schema.js';
import type { MeetingSummaryResponseSchema } from '@meeting-app/shared';

export async function getSummaryForMeeting(
  meetingId: string,
): Promise<MeetingSummaryResponseSchema | null> {
  const rows = await db
    .select({
      id: meetingSummaries.id,
      meetingId: meetingSummaries.meetingId,
      agendaFindings: meetingSummaries.agendaFindings,
      rawSummary: meetingSummaries.rawSummary,
      generatedAt: meetingSummaries.generatedAt,
      title: meetings.title,
      agendaItems: meetingTypes.agendaItems,
    })
    .from(meetingSummaries)
    .innerJoin(meetings, eq(meetings.id, meetingSummaries.meetingId))
    .leftJoin(meetingTypes, eq(meetingTypes.id, meetings.meetingTypeId))
    .where(eq(meetingSummaries.meetingId, meetingId));

  if (rows.length === 0) return null;

  const row = rows[0]!;
  return {
    id: row.id,
    meeting_id: row.meetingId,
    title: row.title,
    agenda_items: (row.agendaItems as string[] | null) ?? null,
    agenda_findings:
      (row.agendaFindings as Record<string, string> | null) ?? null,
    raw_summary: row.rawSummary,
    generated_at: row.generatedAt.toISOString(),
  };
}
