# M01 — DB Schema (Drizzle)
Wave: 0    Owner: <unassigned>    Branch: feat/m01-db-schema
Depends on: M00    Blocks: M10, M12, M13, M14, M15, all worker modules, all DB consumers    plan.md refs: §4, §15, §16

## Goal
Implement the full MySQL schema in `apps/api/src/db/schema.ts` using Drizzle ORM (mysql2 driver), covering every table in plan.md §4, including **nullable `org_id` columns on every user-scoped table** (§15) and the full `usage_counters` / `usage_limits` tables (§16). `pnpm --filter api db:push` must succeed against the local MySQL from M00.

## Context (inlined from plan.md)
Drizzle schema lives in `apps/api/src/db/schema.ts`. The Python worker reads/writes the same tables via `sqlalchemy` (read-only for most; writes `transcript_messages`, `agent_runs`, `agent_outputs`). LangGraph's MySQL checkpointer creates its own tables on first worker start via `.setup()` — do NOT model those in Drizzle.

All user-scoped tables (`agents`, `meeting_types`, `meetings`, `usage_counters`, `usage_limits`) MUST have a nullable `org_id char(26)` column from day one (§15). Also add `users.is_superadmin boolean default false` (§16).

Tables (§4, verbatim field list — use this as the source of truth):

```
users(id char(26) pk, email varchar(255) unique, password_hash varchar(255) null,
      google_sub varchar(255) unique null, display_name varchar(255),
      is_superadmin boolean default false, created_at datetime)

sessions(id char(26) pk, user_id fk, refresh_token_hash varchar(255),
         expires_at datetime, created_at datetime)

meeting_types(id char(26) pk, user_id fk, org_id char(26) null,
              name varchar(255), description text, agenda_items json,
              buffer_size int default 10, created_at datetime)

meeting_type_agents(meeting_type_id fk, agent_id fk, pk(both))

agents(id char(26) pk, user_id fk, org_id char(26) null,
       name varchar(255), system_prompt text,
       provider varchar(32) null, model varchar(64) null, created_at datetime)

meetings(id char(26) pk, user_id fk, org_id char(26) null,
         meeting_type_id fk null, title varchar(255), description text,
         scheduled_at datetime null, google_event_id varchar(255) null,
         livekit_room varchar(255) unique,
         status enum('scheduled','live','ended','cancelled'),
         worker_job_id varchar(255) null,   -- active LiveKit dispatch id; used for idempotent dispatch (§6)
         started_at datetime null, ended_at datetime null)

meeting_invites(id char(26) pk, meeting_id fk, invited_email varchar(255),
                invited_user_id fk null,
                role enum('host','participant','observer') default 'participant',
                can_view_insights boolean default false,
                invite_token varchar(64) unique, accepted_at datetime null,
                created_at datetime,
                index(meeting_id), index(invited_user_id),
                unique(meeting_id, invited_email))

transcript_messages(id bigint pk auto_increment, meeting_id fk,
                    speaker_identity varchar(255), speaker_name varchar(255),
                    text text, start_ts_ms bigint, end_ts_ms bigint,
                    created_at datetime, index(meeting_id, id))

agent_runs(id bigint pk auto_increment, meeting_id fk, agent_id fk,
           buffer_start_msg_id bigint, buffer_end_msg_id bigint,
           status enum('pending','running','done','error'), error text null,
           prompt_tokens int null, completion_tokens int null,
           cost_usd decimal(10,6) null,
           started_at datetime, finished_at datetime null,
           index(meeting_id, agent_id))

agent_outputs(id bigint pk auto_increment, agent_run_id fk, meeting_id fk,
              agent_id fk, content text, metadata json, created_at datetime,
              index(meeting_id, created_at))

meeting_summaries(id bigint pk auto_increment, meeting_id fk unique,
                  agenda_findings json, raw_summary text, generated_at datetime)

usage_counters(id bigint pk auto_increment, user_id fk, org_id char(26) null,
               period char(7),  -- "2026-04"
               meeting_minutes int default 0, prompt_tokens bigint default 0,
               completion_tokens bigint default 0,
               cost_usd decimal(12,6) default 0,
               unique(user_id, period))

usage_limits(id bigint pk auto_increment, user_id fk null, org_id char(26) null,
             max_meeting_minutes_per_month int null,
             max_cost_usd_per_month decimal(12,2) null,
             max_agents int null, updated_at datetime,
             index(user_id), index(org_id))
```

IDs are ULIDs stored as `char(26)`. Use a ULID helper (`ulid` npm package) in the repository layer later — schema-side just declare `char(26)`.

## Files to create / modify
- `apps/api/src/db/schema.ts` — full Drizzle schema as above.
- `apps/api/src/db/client.ts` — exports `db` = drizzle(mysql2 pool) from `MYSQL_URL`.
- `apps/api/drizzle.config.ts` — schema path, dialect `mysql`, `dbCredentials.url` from env.
- `apps/api/package.json` — ensure scripts: `"db:push": "drizzle-kit push"`, `"db:studio": "drizzle-kit studio"`; devDep `drizzle-kit`.
- `apps/api/src/db/seed.ts` — inserts the global default `usage_limits` row with `user_id=NULL, org_id=NULL` and all limits NULL (§16). Call it from `db:push` or document as a separate `pnpm --filter api db:seed`.

## Implementation notes
1. Use Drizzle mysql-core helpers: `mysqlTable`, `char`, `varchar`, `text`, `mysqlEnum`, `datetime`, `json`, `int`, `bigint`, `boolean`, `decimal`, `unique`, `index`, `primaryKey`.
2. For enums: `status: mysqlEnum('status', ['scheduled','live','ended','cancelled']).notNull()`.
3. `created_at`: `datetime('created_at').notNull().default(sql\`CURRENT_TIMESTAMP\`)`.
4. `char(26)` for all ULID fields. Foreign keys via `.references(() => users.id)`.
5. `meeting_type_agents` composite PK: `primaryKey({ columns: [t.meeting_type_id, t.agent_id] })`.
6. `meetings.livekit_room` is UNIQUE and always `"meeting-{id}"` — generated in application code, not a DB default.
7. The LangGraph MySQL checkpointer will create `checkpoints`, `checkpoint_writes`, etc. on first worker run. DO NOT model these in Drizzle; DO NOT try to manage their migrations.
8. Seed script:
   ```ts
   await db.insert(usageLimits).values({
     userId: null, orgId: null,
     maxMeetingMinutesPerMonth: null,
     maxCostUsdPerMonth: null,
     maxAgents: null,
     updatedAt: new Date(),
   });
   ```
9. Run `pnpm --filter api db:push` against the host's local MySQL instance (configured in `apps/api/.env` as `MYSQL_URL`). Verify with any DB GUI (MySQL Workbench, DBeaver, TablePlus) or `mysql` CLI.

## Acceptance criteria
- [ ] `apps/api/src/db/schema.ts` defines every table in §4 with correct types, enums, indexes, and unique constraints.
- [ ] Every user-scoped table (`agents`, `meeting_types`, `meetings`, `usage_counters`, `usage_limits`) has a nullable `org_id char(26)` column.
- [ ] `meetings.worker_job_id varchar(255) null` exists (used for worker dispatch idempotency — see plan.md §6).
- [ ] `users.is_superadmin boolean default false` exists.
- [ ] `pnpm --filter api db:push` succeeds against local MySQL with zero errors and zero prompts.
- [ ] Seed inserts the global default `usage_limits` row with all limits NULL.
- [ ] A DB GUI / `mysql` CLI shows all tables with the expected columns.
- [ ] `pnpm --filter api typecheck` passes.

## Smoke test
```bash
# Ensure host MySQL is running and meeting_app db exists
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS meeting_app;"
pnpm --filter api db:push
pnpm --filter api db:seed    # or run once inline
# Open your DB GUI (MySQL Workbench / DBeaver / TablePlus) or use the mysql CLI:
#   mysql -u root -p meeting_app -e "SHOW TABLES;"
# Verify: users, sessions, meeting_types, meeting_type_agents, agents, meetings,
#         meeting_invites, transcript_messages, agent_runs, agent_outputs,
#         meeting_summaries, usage_counters, usage_limits
# Verify: agents.org_id exists and is NULL-able
# Verify: usage_limits has one row with all NULLs
```

## Do NOT
- Do NOT omit `org_id` columns "because we don't need them yet" — §15 explicitly forbids this; adding them later is the painful version.
- Do NOT model LangGraph checkpointer tables — they're auto-created by the Python worker.
- Do NOT use Prisma. Drizzle only.
- Do NOT swap MySQL for Postgres "because LangGraph docs use Postgres." `langgraph-checkpoint-mysql` exists (§12).
- Do NOT add `orgs` / `org_members` tables now — just leave the `org_id` columns NULL-able (§15).

## Hand-off
- Exported table objects: `users`, `sessions`, `meetingTypes`, `meetingTypeAgents`, `agents`, `meetings`, `meetingInvites`, `transcriptMessages`, `agentRuns`, `agentOutputs`, `meetingSummaries`, `usageCounters`, `usageLimits`.
- `apps/api/src/db/client.ts` exports `db` — imported by every repository/route module downstream.
- Schema is consumed by M10 (users/sessions), M12 (agents), M13 (meeting_types, meeting_type_agents), M14 (meetings), M15 (all), and worker modules (transcript_messages, agent_runs, agent_outputs, usage_counters).
