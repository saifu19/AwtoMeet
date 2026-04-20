import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  meetingTypes,
  meetingTypeAgents,
  meetings,
  agents,
} from '../db/schema.js';

type MeetingTypeRow = typeof meetingTypes.$inferSelect;

export function toMeetingTypeResponse(
  row: MeetingTypeRow,
  agentIds: string[] = [],
) {
  return {
    id: row.id,
    user_id: row.userId,
    org_id: row.orgId ?? null,
    name: row.name,
    description: row.description ?? null,
    agenda_items: (row.agendaItems as string[] | null) ?? null,
    buffer_size: row.bufferSize,
    created_at: row.createdAt.toISOString(),
    agent_ids: agentIds,
  };
}

export async function listByOwner(userId: string, _orgId?: string | null) {
  const rows = await db
    .select()
    .from(meetingTypes)
    .where(eq(meetingTypes.userId, userId));

  if (rows.length === 0) return [];

  // Batch-fetch all join rows for the user's meeting types
  const mtIds = rows.map((r) => r.id);
  const joinRows = await db
    .select()
    .from(meetingTypeAgents)
    .where(inArray(meetingTypeAgents.meetingTypeId, mtIds));

  // Group agent IDs by meeting type ID
  const agentMap = new Map<string, string[]>();
  for (const jr of joinRows) {
    const arr = agentMap.get(jr.meetingTypeId) ?? [];
    arr.push(jr.agentId);
    agentMap.set(jr.meetingTypeId, arr);
  }

  return rows.map((row) =>
    toMeetingTypeResponse(row, agentMap.get(row.id) ?? []),
  );
}

export async function getByIdWithAgents(id: string) {
  const rows = await db
    .select()
    .from(meetingTypes)
    .where(eq(meetingTypes.id, id));
  const row = rows[0];
  if (!row) return null;

  const joinRows = await db
    .select()
    .from(meetingTypeAgents)
    .where(eq(meetingTypeAgents.meetingTypeId, id));
  const agentIds = joinRows.map((jr) => jr.agentId);

  return toMeetingTypeResponse(row, agentIds);
}

export async function validateAgentOwnership(
  agentIds: string[],
  userId: string,
): Promise<boolean> {
  if (agentIds.length === 0) return true;
  const owned = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.userId, userId), inArray(agents.id, agentIds)));
  return owned.length === agentIds.length;
}

export async function create(
  data: {
    id: string;
    userId: string;
    orgId: string | null;
    name: string;
    description: string | null;
    agendaItems: string[] | null;
    bufferSize: number;
  },
  agentIds: string[],
) {
  await db.transaction(async (tx) => {
    await tx.insert(meetingTypes).values(data);
    if (agentIds.length > 0) {
      await tx.insert(meetingTypeAgents).values(
        agentIds.map((agentId) => ({
          meetingTypeId: data.id,
          agentId,
        })),
      );
    }
  });
}

export async function update(
  id: string,
  patch: Partial<
    Pick<MeetingTypeRow, 'name' | 'description' | 'agendaItems' | 'bufferSize'>
  >,
  agentIds?: string[],
) {
  await db.transaction(async (tx) => {
    if (Object.keys(patch).length > 0) {
      await tx.update(meetingTypes).set(patch).where(eq(meetingTypes.id, id));
    }
    if (agentIds !== undefined) {
      await tx
        .delete(meetingTypeAgents)
        .where(eq(meetingTypeAgents.meetingTypeId, id));
      if (agentIds.length > 0) {
        await tx.insert(meetingTypeAgents).values(
          agentIds.map((agentId) => ({
            meetingTypeId: id,
            agentId,
          })),
        );
      }
    }
  });
}

export async function deleteWithDetach(id: string) {
  await db.transaction(async (tx) => {
    // Soft-detach: set meeting_type_id = NULL on referencing meetings
    await tx
      .update(meetings)
      .set({ meetingTypeId: null })
      .where(eq(meetings.meetingTypeId, id));
    // Delete join rows
    await tx
      .delete(meetingTypeAgents)
      .where(eq(meetingTypeAgents.meetingTypeId, id));
    // Delete the meeting type
    await tx.delete(meetingTypes).where(eq(meetingTypes.id, id));
  });
}