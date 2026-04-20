import { and, asc, eq, gt } from 'drizzle-orm';
import { db } from '../db/client.js';
import { agentOutputs, agents } from '../db/schema.js';
import type { AgentOutputSchema } from '@meeting-app/shared';

type JoinedRow = {
  output: typeof agentOutputs.$inferSelect;
  agent: typeof agents.$inferSelect | null;
};

export function toInsightResponse(row: JoinedRow): AgentOutputSchema {
  const { output, agent } = row;
  return {
    id: output.id,
    agent_run_id: output.agentRunId,
    meeting_id: output.meetingId,
    agent_id: output.agentId,
    agent_name: agent?.name ?? '(deleted)',
    content: output.content,
    metadata: (output.metadata as Record<string, unknown> | null) ?? null,
    created_at: output.createdAt.toISOString(),
  };
}

export async function getInsights(
  meetingId: string,
): Promise<AgentOutputSchema[]> {
  const rows = await db
    .select({ output: agentOutputs, agent: agents })
    .from(agentOutputs)
    .leftJoin(agents, eq(agents.id, agentOutputs.agentId))
    .where(eq(agentOutputs.meetingId, meetingId))
    .orderBy(asc(agentOutputs.id));
  return rows.map(toInsightResponse);
}

export async function getInsightsSince(
  meetingId: string,
  lastId: number,
  limit = 500,
): Promise<AgentOutputSchema[]> {
  const rows = await db
    .select({ output: agentOutputs, agent: agents })
    .from(agentOutputs)
    .leftJoin(agents, eq(agents.id, agentOutputs.agentId))
    .where(
      and(
        eq(agentOutputs.meetingId, meetingId),
        gt(agentOutputs.id, lastId),
      ),
    )
    .orderBy(asc(agentOutputs.id))
    .limit(limit);
  return rows.map(toInsightResponse);
}
