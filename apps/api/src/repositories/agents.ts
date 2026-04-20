import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { agents, meetingTypeAgents } from '../db/schema.js';

type AgentRow = typeof agents.$inferSelect;

export function toAgentResponse(row: AgentRow) {
  return {
    id: row.id,
    user_id: row.userId,
    org_id: row.orgId ?? null,
    name: row.name,
    system_prompt: row.systemPrompt,
    provider: row.provider ?? null,
    model: row.model ?? null,
    created_at: row.createdAt.toISOString(),
  };
}

export async function listByOwner(userId: string, _orgId?: string | null) {
  const rows = await db.select().from(agents).where(eq(agents.userId, userId));
  return rows.map(toAgentResponse);
}

export async function getById(id: string) {
  const rows = await db.select().from(agents).where(eq(agents.id, id));
  const row = rows[0];
  if (!row) return null;
  return toAgentResponse(row);
}

export async function create(data: {
  id: string;
  userId: string;
  orgId: string | null;
  name: string;
  systemPrompt: string;
  provider: string | null;
  model: string | null;
}) {
  await db.insert(agents).values(data);
}

export async function update(
  id: string,
  patch: Partial<Pick<AgentRow, 'name' | 'systemPrompt' | 'provider' | 'model'>>,
) {
  await db.update(agents).set(patch).where(eq(agents.id, id));
}

export async function remove(id: string) {
  await db.delete(agents).where(eq(agents.id, id));
}

export async function isReferencedByMeetingType(id: string): Promise<boolean> {
  const rows = await db
    .select()
    .from(meetingTypeAgents)
    .where(eq(meetingTypeAgents.agentId, id))
    .limit(1);
  return rows.length > 0;
}