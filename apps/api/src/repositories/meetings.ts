import { and, asc, desc, eq, ne, or, inArray, isNotNull, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  meetings,
  meetingInvites,
  meetingTypeAgents,
  agents,
  agentOutputs,
  agentRuns,
  transcriptMessages,
  meetingSummaries,
} from '../db/schema.js';

type MeetingRow = typeof meetings.$inferSelect;

export function toMeetingResponse(row: MeetingRow) {
  return {
    id: row.id,
    user_id: row.userId,
    org_id: row.orgId ?? null,
    meeting_type_id: row.meetingTypeId ?? null,
    title: row.title,
    description: row.description ?? null,
    scheduled_at: row.scheduledAt?.toISOString() ?? null,
    google_event_id: row.googleEventId ?? null,
    livekit_room: row.livekitRoom,
    status: row.status,
    worker_job_id: row.workerJobId ?? null,
    started_at: row.startedAt?.toISOString() ?? null,
    ended_at: row.endedAt?.toISOString() ?? null,
  };
}

export async function listByOwner(
  userId: string,
  status?: string,
  _orgId?: string | null,
) {
  const conditions = [eq(meetings.userId, userId)];

  if (status) {
    // 'ended' filter includes 'summarizing' — from the user's perspective
    // the meeting has ended, the worker is just generating the summary.
    if (status === 'ended') {
      conditions.push(sql`${meetings.status} IN ('ended', 'summarizing')`);
    } else {
      conditions.push(eq(meetings.status, status as MeetingRow['status']));
    }
  } else {
    // Default: exclude cancelled
    conditions.push(ne(meetings.status, 'cancelled'));
  }

  const orderBy =
    status === 'ended'
      ? [desc(meetings.endedAt)]
      : [asc(meetings.scheduledAt)];

  const rows = await db
    .select()
    .from(meetings)
    .where(and(...conditions))
    .orderBy(...orderBy);

  return rows.map(toMeetingResponse);
}

/**
 * Returns meetings the user owns OR has an accepted invite to.
 * Uses a subquery to find invited meeting IDs via raw SQL to avoid
 * ORM abstraction issues with NULL datetime comparisons.
 */
export async function listAccessible(
  userId: string,
  status?: string,
) {
  // Get meeting IDs the user is invited to (accepted only)
  const inviteRows = await db
    .select({ meetingId: meetingInvites.meetingId })
    .from(meetingInvites)
    .where(
      and(
        eq(meetingInvites.invitedUserId, userId),
        isNotNull(meetingInvites.acceptedAt),
      ),
    );
  const invitedMeetingIds = inviteRows.map((r) => r.meetingId);

  // Step 2: build conditions for owned OR invited meetings
  const accessCondition =
    invitedMeetingIds.length > 0
      ? or(eq(meetings.userId, userId), inArray(meetings.id, invitedMeetingIds))!
      : eq(meetings.userId, userId);

  const conditions = [accessCondition];
  if (status) {
    // 'ended' filter includes 'summarizing' — from the user's perspective
    // the meeting has ended, the worker is just generating the summary.
    if (status === 'ended') {
      conditions.push(sql`${meetings.status} IN ('ended', 'summarizing')`);
    } else {
      conditions.push(eq(meetings.status, status as MeetingRow['status']));
    }
  } else {
    conditions.push(ne(meetings.status, 'cancelled'));
  }

  const orderBy =
    status === 'ended'
      ? [desc(meetings.endedAt)]
      : [asc(meetings.scheduledAt)];

  const rows = await db
    .select()
    .from(meetings)
    .where(and(...conditions))
    .orderBy(...orderBy);

  return rows.map(toMeetingResponse);
}

export async function getById(id: string) {
  const rows = await db.select().from(meetings).where(eq(meetings.id, id));
  const row = rows[0];
  if (!row) return null;
  return toMeetingResponse(row);
}

export async function create(data: {
  id: string;
  userId: string;
  orgId: string | null;
  meetingTypeId: string | null;
  title: string;
  description: string | null;
  scheduledAt: Date | null;
  livekitRoom: string;
  status: 'scheduled' | 'live' | 'summarizing' | 'ended' | 'cancelled';
}) {
  await db.insert(meetings).values(data);
}

export async function update(
  id: string,
  patch: Partial<
    Pick<
      MeetingRow,
      | 'title'
      | 'description'
      | 'scheduledAt'
      | 'meetingTypeId'
      | 'status'
      | 'workerJobId'
      | 'startedAt'
      | 'endedAt'
    >
  >,
) {
  await db.update(meetings).set(patch).where(eq(meetings.id, id));
}

/**
 * Hard-deletes a meeting and all dependent rows in a single transaction.
 *
 * Five tables FK-reference meetings.id without ON DELETE CASCADE
 * (per schema.ts), so a naive DELETE FROM meetings would fail with a
 * foreign-key constraint violation if any child rows exist. We delete in
 * dependency order, atomically.
 *
 * Note: LangGraph checkpointer tables (langgraph-checkpoint-mysql) live
 * outside this schema and use thread_id="{meetingId}:{agentId}". They have
 * no FK to meetings, so they are NOT cleaned up here. They are orphaned
 * harmlessly until a future cleanup job is added.
 */
export async function remove(id: string) {
  await db.transaction(async (tx) => {
    // 1. agent_outputs (FK → agent_runs AND meetings)
    await tx.delete(agentOutputs).where(eq(agentOutputs.meetingId, id));
    // 2. agent_runs (FK → meetings)
    await tx.delete(agentRuns).where(eq(agentRuns.meetingId, id));
    // 3. transcript_messages (FK → meetings)
    await tx
      .delete(transcriptMessages)
      .where(eq(transcriptMessages.meetingId, id));
    // 4. meeting_summaries (FK → meetings, unique on meeting_id)
    await tx
      .delete(meetingSummaries)
      .where(eq(meetingSummaries.meetingId, id));
    // 5. meeting_invites (FK → meetings)
    await tx.delete(meetingInvites).where(eq(meetingInvites.meetingId, id));
    // 6. meetings (parent)
    await tx.delete(meetings).where(eq(meetings.id, id));
  });
}

// Returns the agents attached to a meeting's meeting_type. Used by
// GET /meetings/:id/agents to populate the insights dashboard tab list
// without exposing the ownership-gated /meeting-types/:id or /agents/:id
// endpoints to invited viewers.
export async function getAgentsForMeeting(
  meetingId: string,
): Promise<Array<{ id: string; name: string }>> {
  const meetingRows = await db
    .select({ meetingTypeId: meetings.meetingTypeId })
    .from(meetings)
    .where(eq(meetings.id, meetingId));

  const meetingTypeId = meetingRows[0]?.meetingTypeId;
  if (!meetingTypeId) return [];

  const rows = await db
    .select({ id: agents.id, name: agents.name })
    .from(meetingTypeAgents)
    .innerJoin(agents, eq(meetingTypeAgents.agentId, agents.id))
    .where(eq(meetingTypeAgents.meetingTypeId, meetingTypeId));

  return rows;
}
