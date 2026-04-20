# M02 — Shared Contracts (zod + TS types)
Wave: 0    Owner: <unassigned>    Branch: feat/m02-shared-contracts
Depends on: M00    Blocks: all api and web modules that share types (M10, M11, M12, M13, M14, M15, Wave 2+)    plan.md refs: §6

## Goal
Populate `packages/shared` with zod schemas and inferred TypeScript types covering every request and response body in plan.md §6. Both `apps/api` (Fastify route validation) and `apps/web` (forms + fetch) import from `@meeting-app/shared`. A change to an endpoint contract = a single edit in this package.

## Context (inlined from plan.md)
All routes except `/auth/*` and `/health` require a valid access JWT. All request/response bodies are validated with zod schemas in `packages/shared`. The full Fastify API surface (§6):

```
GET    /health
GET    /me

# Meeting types
GET    /meeting-types
POST   /meeting-types          { name, description, agenda_items, agent_ids }
GET    /meeting-types/:id
PATCH  /meeting-types/:id
DELETE /meeting-types/:id

# Agents
GET    /agents
POST   /agents                 { name, system_prompt, provider?, model?, buffer_size? }
GET    /agents/:id
PATCH  /agents/:id
DELETE /agents/:id

# Meetings
GET    /meetings               ?status=scheduled|live|ended
POST   /meetings               { title, description, scheduled_at?, meeting_type_id?, auto_classify? }
GET    /meetings/:id
PATCH  /meetings/:id
DELETE /meetings/:id
POST   /meetings/:id/join      → { livekit_url, livekit_token }
POST   /meetings/:id/leave     → 204
POST   /meetings/:id/end

# Meeting invites
GET    /meetings/:id/invites
POST   /meetings/:id/invites              { invited_email, role?, can_view_insights }
PATCH  /meetings/:id/invites/:inviteId    { role?, can_view_insights? }
DELETE /meetings/:id/invites/:inviteId
POST   /invites/:token/accept

# Superadmin
GET    /admin/users
GET    /admin/users/:id/usage
PATCH  /admin/users/:id/limits   { max_meeting_minutes_per_month?, max_cost_usd_per_month?, max_agents? }
GET    /admin/usage

# Live insights
GET    /meetings/:id/transcript
GET    /meetings/:id/insights
GET    /meetings/:id/stream    (SSE)

# Google calendar (stub)
GET    /integrations/google/calendar/connect
GET    /integrations/google/calendar/events
POST   /integrations/google/calendar/import      { event_ids: [] }

# Post-meeting
GET    /meetings/:id/summary

# Auth
POST /auth/signup   { email, password, display_name }   → { access, user }
POST /auth/login    { email, password }                  → { access, user }
POST /auth/refresh  (cookie)                             → { access }
POST /auth/logout   (cookie)                             → 204
GET  /auth/me                                            → { user }
```

Auto-classify: `POST /meetings { auto_classify: true }` — boolean on the request body. Invite roles: `'host'|'participant'|'observer'`. Meeting status: `'scheduled'|'live'|'ended'|'cancelled'`.

## Files to create / modify
- `packages/shared/src/index.ts` — barrel export.
- `packages/shared/src/common.ts` — `UlidSchema` (`z.string().length(26)`), `IsoDateSchema`, `LlmProviderSchema` (`z.enum(['openai','anthropic'])`), shared error response type.
- `packages/shared/src/auth.ts` — `SignupReq`, `LoginReq`, `AuthRes` (`{ access: string; user: User }`), `UserSchema` (id, email, display_name, is_superadmin).
- `packages/shared/src/agents.ts` — `AgentSchema`, `CreateAgentReq`, `UpdateAgentReq`.
- `packages/shared/src/meeting-types.ts` — `MeetingTypeSchema`, `CreateMeetingTypeReq` (with `agent_ids: string[]`, `agenda_items: string[]`, `buffer_size?: number`), `UpdateMeetingTypeReq`.
- `packages/shared/src/meetings.ts` — `MeetingSchema`, `MeetingStatusSchema`, `CreateMeetingReq` (with `auto_classify?: boolean`), `UpdateMeetingReq`, `JoinMeetingRes` (`{ livekit_url, livekit_token }`), `ListMeetingsQuery`.
- `packages/shared/src/invites.ts` — `InviteSchema`, `InviteRoleSchema`, `CreateInviteReq`, `UpdateInviteReq`, `AcceptInviteRes`.
- `packages/shared/src/insights.ts` — `TranscriptMessageSchema`, `AgentOutputSchema`, SSE event types (`{ type: 'transcript' | 'insight', data: ... }`).
- `packages/shared/src/admin.ts` — `AdminUserRowSchema`, `UsageCounterSchema`, `UsageLimitsSchema`, `UpdateLimitsReq`.
- `packages/shared/src/summary.ts` — `MeetingSummarySchema`.
- `packages/shared/src/calendar.ts` — `CalendarEventSchema`, `ImportEventsReq`.

## Implementation notes
1. Every schema is a zod object; export both the schema and its inferred type:
   ```ts
   export const CreateAgentReq = z.object({
     name: z.string().min(1).max(255),
     system_prompt: z.string().min(1),
     provider: LlmProviderSchema.optional(),
     model: z.string().max(64).optional(),
     buffer_size: z.number().int().positive().optional(),
   });
   export type CreateAgentReq = z.infer<typeof CreateAgentReq>;
   ```
2. Use `snake_case` field names on the wire (matches DB columns). Do NOT camelCase HTTP bodies.
3. `buffer_size` lives on **meeting_types**, not agents (§4, §13.6). Still accept it on `CreateAgentReq` as optional for forward-compat if you want — but the authoritative location is meeting_types. When in doubt: follow §4, omit from agents.
   **Correction:** plan.md §6 shows `POST /agents { ..., buffer_size? }` but §4 and §13.6 say buffer_size lives on meeting_types. Honor §4 — omit `buffer_size` from the agent schema. If the API must accept it for backward compat, ignore it server-side.
4. `CreateMeetingTypeReq` includes `agent_ids: z.array(UlidSchema)` — the API joins this into `meeting_type_agents` on create.
5. `MeetingStatusSchema = z.enum(['scheduled','live','ended','cancelled'])`.
6. `InviteRoleSchema = z.enum(['host','participant','observer'])`.
7. `ListMeetingsQuery = z.object({ status: z.enum(['scheduled','live','ended']).optional() })`.
8. SSE insight frame shape must match what the API emits in `GET /meetings/:id/stream` and what the worker writes: `{ id, meeting_id, agent_id, content, metadata, created_at }`.
9. Keep schemas framework-agnostic. NO Fastify, NO React imports here.
10. Barrel-export everything from `packages/shared/src/index.ts` so consumers do `import { CreateAgentReq } from '@meeting-app/shared'`.

## Acceptance criteria
- [ ] Every request and response body in §6 has a matching exported zod schema.
- [ ] Every schema exports its inferred TS type under the same name.
- [ ] Field names are `snake_case` matching DB columns.
- [ ] `pnpm --filter @meeting-app/shared typecheck` passes.
- [ ] `apps/api` and `apps/web` can both import from `@meeting-app/shared` (verified by a throwaway import in either app).
- [ ] No runtime dependencies besides `zod`.

## Smoke test
```bash
pnpm --filter @meeting-app/shared build    # if a build step exists; else typecheck
# Add a temporary import in apps/api/src/index.ts:
#   import { CreateAgentReq } from '@meeting-app/shared';
#   console.log(CreateAgentReq.shape);
pnpm --filter api dev
# See schema shape printed, then remove the temp import.
```

## Do NOT
- Do NOT import from `apps/api` or `apps/web` inside `packages/shared`. Shared is leaf.
- Do NOT hand-write TS types separately from zod schemas — always `z.infer`.
- Do NOT camelCase wire field names.
- Do NOT add Fastify-specific types (`FastifySchema`, etc.) here — let the api module adapt.
- Do NOT pre-define org-related endpoint schemas (orgs ship later, §15).

## Hand-off
- Every downstream api route (M10 auth, M12 agents, M13 meeting-types, M14 meetings, later modules) validates with schemas from `@meeting-app/shared`.
- Every downstream web form (M11 auth, M12 agents form, M13/M14 forms) uses these schemas via `react-hook-form` + `@hookform/resolvers/zod`.
- Contract change = edit this package once; both sides update.
