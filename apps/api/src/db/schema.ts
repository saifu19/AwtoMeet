import { sql } from 'drizzle-orm';
import {
  mysqlTable,
  char,
  varchar,
  text,
  mysqlEnum,
  datetime,
  json,
  int,
  bigint,
  boolean,
  decimal,
  unique,
  index,
  primaryKey,
} from 'drizzle-orm/mysql-core';

export const users = mysqlTable('users', {
  id: char('id', { length: 26 }).primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }),
  googleSub: varchar('google_sub', { length: 255 }).unique(),
  displayName: varchar('display_name', { length: 255 }).notNull(),
  isSuperadmin: boolean('is_superadmin').notNull().default(false),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const sessions = mysqlTable('sessions', {
  id: char('id', { length: 26 }).primaryKey(),
  userId: char('user_id', { length: 26 })
    .notNull()
    .references(() => users.id),
  refreshTokenHash: varchar('refresh_token_hash', { length: 255 }).notNull(),
  expiresAt: datetime('expires_at').notNull(),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const meetingTypes = mysqlTable('meeting_types', {
  id: char('id', { length: 26 }).primaryKey(),
  userId: char('user_id', { length: 26 })
    .notNull()
    .references(() => users.id),
  orgId: char('org_id', { length: 26 }),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  agendaItems: json('agenda_items'),
  bufferSize: int('buffer_size').notNull().default(10),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const agents = mysqlTable('agents', {
  id: char('id', { length: 26 }).primaryKey(),
  userId: char('user_id', { length: 26 })
    .notNull()
    .references(() => users.id),
  orgId: char('org_id', { length: 26 }),
  name: varchar('name', { length: 255 }).notNull(),
  systemPrompt: text('system_prompt').notNull(),
  provider: varchar('provider', { length: 32 }),
  model: varchar('model', { length: 64 }),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const meetingTypeAgents = mysqlTable(
  'meeting_type_agents',
  {
    meetingTypeId: char('meeting_type_id', { length: 26 })
      .notNull()
      .references(() => meetingTypes.id),
    agentId: char('agent_id', { length: 26 })
      .notNull()
      .references(() => agents.id),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.meetingTypeId, t.agentId] }),
  }),
);

export const meetings = mysqlTable('meetings', {
  id: char('id', { length: 26 }).primaryKey(),
  userId: char('user_id', { length: 26 })
    .notNull()
    .references(() => users.id),
  orgId: char('org_id', { length: 26 }),
  meetingTypeId: char('meeting_type_id', { length: 26 }).references(
    () => meetingTypes.id,
  ),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  scheduledAt: datetime('scheduled_at'),
  googleEventId: varchar('google_event_id', { length: 255 }),
  livekitRoom: varchar('livekit_room', { length: 255 }).notNull().unique(),
  status: mysqlEnum('status', ['scheduled', 'live', 'summarizing', 'ended', 'cancelled']).notNull(),
  workerJobId: varchar('worker_job_id', { length: 255 }),
  startedAt: datetime('started_at'),
  endedAt: datetime('ended_at'),
});

export const meetingInvites = mysqlTable(
  'meeting_invites',
  {
    id: char('id', { length: 26 }).primaryKey(),
    meetingId: char('meeting_id', { length: 26 })
      .notNull()
      .references(() => meetings.id),
    invitedEmail: varchar('invited_email', { length: 255 }).notNull(),
    invitedUserId: char('invited_user_id', { length: 26 }).references(
      () => users.id,
    ),
    role: mysqlEnum('role', ['host', 'participant', 'observer'])
      .notNull()
      .default('participant'),
    canViewInsights: boolean('can_view_insights').notNull().default(false),
    inviteToken: varchar('invite_token', { length: 64 }).notNull().unique(),
    acceptedAt: datetime('accepted_at'),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => ({
    meetingIdx: index('meeting_invites_meeting_idx').on(t.meetingId),
    invitedUserIdx: index('meeting_invites_invited_user_idx').on(t.invitedUserId),
    meetingEmailUnique: unique('meeting_invites_meeting_email_unique').on(
      t.meetingId,
      t.invitedEmail,
    ),
  }),
);

export const transcriptMessages = mysqlTable(
  'transcript_messages',
  {
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    meetingId: char('meeting_id', { length: 26 })
      .notNull()
      .references(() => meetings.id),
    speakerIdentity: varchar('speaker_identity', { length: 255 }).notNull(),
    speakerName: varchar('speaker_name', { length: 255 }).notNull(),
    text: text('text').notNull(),
    startTsMs: bigint('start_ts_ms', { mode: 'number' }).notNull(),
    endTsMs: bigint('end_ts_ms', { mode: 'number' }).notNull(),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => ({
    meetingIdIdx: index('transcript_messages_meeting_id_idx').on(t.meetingId, t.id),
  }),
);

export const agentRuns = mysqlTable(
  'agent_runs',
  {
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    meetingId: char('meeting_id', { length: 26 })
      .notNull()
      .references(() => meetings.id),
    agentId: char('agent_id', { length: 26 })
      .notNull()
      .references(() => agents.id),
    bufferStartMsgId: bigint('buffer_start_msg_id', { mode: 'number' }).notNull(),
    bufferEndMsgId: bigint('buffer_end_msg_id', { mode: 'number' }).notNull(),
    status: mysqlEnum('status', ['pending', 'running', 'done', 'error']).notNull(),
    error: text('error'),
    promptTokens: int('prompt_tokens'),
    completionTokens: int('completion_tokens'),
    costUsd: decimal('cost_usd', { precision: 10, scale: 6 }),
    startedAt: datetime('started_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    finishedAt: datetime('finished_at'),
  },
  (t) => ({
    meetingAgentIdx: index('agent_runs_meeting_agent_idx').on(t.meetingId, t.agentId),
  }),
);

export const agentOutputs = mysqlTable(
  'agent_outputs',
  {
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    agentRunId: bigint('agent_run_id', { mode: 'number' })
      .notNull()
      .references(() => agentRuns.id),
    meetingId: char('meeting_id', { length: 26 })
      .notNull()
      .references(() => meetings.id),
    agentId: char('agent_id', { length: 26 })
      .notNull()
      .references(() => agents.id),
    content: text('content').notNull(),
    metadata: json('metadata'),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => ({
    meetingCreatedIdx: index('agent_outputs_meeting_created_idx').on(
      t.meetingId,
      t.createdAt,
    ),
  }),
);

export const meetingSummaries = mysqlTable('meeting_summaries', {
  id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
  meetingId: char('meeting_id', { length: 26 })
    .notNull()
    .unique()
    .references(() => meetings.id),
  agendaFindings: json('agenda_findings'),
  rawSummary: text('raw_summary'),
  generatedAt: datetime('generated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const usageCounters = mysqlTable(
  'usage_counters',
  {
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    userId: char('user_id', { length: 26 })
      .notNull()
      .references(() => users.id),
    orgId: char('org_id', { length: 26 }),
    period: char('period', { length: 7 }).notNull(),
    meetingMinutes: int('meeting_minutes').notNull().default(0),
    promptTokens: bigint('prompt_tokens', { mode: 'number' }).notNull().default(0),
    completionTokens: bigint('completion_tokens', { mode: 'number' })
      .notNull()
      .default(0),
    costUsd: decimal('cost_usd', { precision: 12, scale: 6 }).notNull().default('0'),
  },
  (t) => ({
    userPeriodUnique: unique('usage_counters_user_period_unique').on(
      t.userId,
      t.period,
    ),
  }),
);

export const usageLimits = mysqlTable(
  'usage_limits',
  {
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    userId: char('user_id', { length: 26 }).references(() => users.id),
    orgId: char('org_id', { length: 26 }),
    maxMeetingMinutesPerMonth: int('max_meeting_minutes_per_month'),
    maxCostUsdPerMonth: decimal('max_cost_usd_per_month', { precision: 12, scale: 2 }),
    maxAgents: int('max_agents'),
    updatedAt: datetime('updated_at').notNull(),
  },
  (t) => ({
    userIdx: index('usage_limits_user_idx').on(t.userId),
    orgIdx: index('usage_limits_org_idx').on(t.orgId),
  }),
);
