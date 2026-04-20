# M14 — Meetings CRUD (API + Web, DB-only)
Wave: 1    Owner: <unassigned>    Branch: feat/m14-meetings-crud
Depends on: M13    Blocks: Wave 2 (M20 LiveKit join flow and beyond)    plan.md refs: §4, §6, §8.1

## Goal
Implement Meeting CRUD against the `meetings` table — **DB only, no LiveKit yet.** Users can create a meeting (with optional `meeting_type_id` and optional `scheduled_at`), list meetings filtered by status, view a meeting detail page, edit, and delete. The `POST /meetings/:id/join`, `/leave`, `/end` endpoints and LiveKit token minting are explicitly OUT of scope — they live in Wave 2 (§11 step 9).

## Context (inlined from plan.md)
The `meetings` table (§4):
```
meetings
  id              char(26) pk
  user_id         char(26) fk            # creator/owner (host)
  org_id          char(26) null          # §15
  meeting_type_id char(26) fk null
  title           varchar(255)
  description     text
  scheduled_at    datetime null
  google_event_id varchar(255) null
  livekit_room    varchar(255) unique    # = "meeting-{id}"
  status          enum('scheduled','live','ended','cancelled')
  worker_job_id   varchar(255) null      # populated by M22 dispatch / M30 worker; NULL on create
  started_at      datetime null
  ended_at        datetime null
```

Endpoints (§6):
```
GET    /meetings               ?status=scheduled|live|ended
POST   /meetings               { title, description, scheduled_at?, meeting_type_id?, auto_classify? }
GET    /meetings/:id
PATCH  /meetings/:id
DELETE /meetings/:id
```

Auto-classify (§6): if no `meeting_type_id` is given but `auto_classify=true`, the API calls an LLM with the meeting title+description and the user's available `meeting_types[*].{name,description}` and picks one. Runs synchronously inside the create handler. **For M14, you may stub this to "no-op / leave meeting_type_id NULL" and land it in a later module** — or implement it now if the env LLM key is available. Document your choice in the PR.

Web pages (§8.1):
```
/dashboard               list of upcoming + recent meetings, CTA "New meeting"
/meetings/new            form: title, description, scheduled_at, meeting_type or auto-classify
/meetings/:id            meeting detail, "Join now" button (non-functional stub until Wave 2)
```

## Files to create / modify
- `apps/api/src/routes/meetings.ts` — CRUD handlers only (not join/leave/end — those go in Wave 2).
- `apps/api/src/repositories/meetings.ts` — `listByOwner(userId, status?, orgId?)`, `getById(id)`, `create(data)`, `update(id, patch)`, `delete(id)`.
- `apps/api/src/services/auto-classify.ts` — stub or real LLM call behind a feature flag; default stub returns `null`.
- `apps/web/src/routes/_auth/dashboard.tsx` — upgrade from M11 placeholder to list upcoming + recent meetings with a "New meeting" CTA.
- `apps/web/src/routes/_auth/meetings/new.tsx` — create form.
- `apps/web/src/routes/_auth/meetings/$id/index.tsx` — detail page.
- `apps/web/src/features/meetings/MeetingForm.tsx` — title, description, scheduled_at (datetime-local), meeting_type_id select (populated from `GET /meeting-types`), auto_classify checkbox (disabled if meeting_type_id is set).
- `apps/web/src/features/meetings/hooks.ts` — TanStack Query hooks.

## Implementation notes
1. **Create handler:**
   ```ts
   app.post('/meetings', { preHandler: requireAuth, schema: zodToFastify(CreateMeetingReq) }, async (req) => {
     const body = CreateMeetingReq.parse(req.body);
     let meetingTypeId = body.meeting_type_id ?? null;
     if (!meetingTypeId && body.auto_classify) {
       meetingTypeId = await autoClassify(req.user.id, body.title, body.description);
     }
     if (meetingTypeId) {
       const mt = await meetingTypesRepo.getByIdWithAgents(meetingTypeId);
       if (!mt || mt.user_id !== req.user.id) throw httpError(400, 'invalid meeting_type_id');
     }
     const id = ulid();
     await meetingsRepo.create({
       id,
       user_id: req.user.id,
       org_id: null,
       meeting_type_id: meetingTypeId,
       title: body.title,
       description: body.description,
       scheduled_at: body.scheduled_at ?? null,
       livekit_room: `meeting-${id}`,
       status: 'scheduled',
     });
     return meetingsRepo.getById(id);
   });
   ```
2. **`livekit_room` is generated as `"meeting-{id}"`** at create time — even though we don't mint tokens yet, the column is UNIQUE and must be populated.
3. **Status filter on GET `/meetings`:** parse `?status=scheduled|live|ended` via zod; default = return all non-cancelled.
4. **Delete:** soft-cancel or hard-delete? For MVP, **hard-delete** is acceptable since there are no transcripts yet at the scheduled stage. A meeting with `status='live'` should be refused (409) — you must leave/end it first (Wave 2). A meeting with `status='ended'` that already has transcripts should probably be refused too (the Python worker will have written rows); for M14's scope, just hard-delete and rely on FK cascade or explicit cleanup. Document the decision.
5. **Auto-classify stub:**
   ```ts
   export async function autoClassify(userId: string, title: string, description: string): Promise<string | null> {
     // TODO(Mxx): call OpenAI with gpt-4o-mini and the user's meeting_types[*].{name,description}
     return null;
   }
   ```
6. **Dashboard:** two sections — "Upcoming" (`status='scheduled'` ordered by `scheduled_at ASC`) and "Recent" (`status='ended'` ordered by `ended_at DESC`, limit 10).
7. **Detail page:** show title, description, scheduled_at, meeting_type name, status badge. Include a disabled "Join now" button with a tooltip "Available in next release" — Wave 2 will enable it.

## Acceptance criteria
- [ ] `POST /meetings` creates a row with `user_id`, `livekit_room='meeting-{id}'`, `status='scheduled'`, `worker_job_id=NULL`, optional meeting_type_id.
- [ ] If both `meeting_type_id` and `auto_classify` are provided, `meeting_type_id` wins.
- [ ] If `meeting_type_id` refers to another user's meeting type, the request is rejected.
- [ ] `GET /meetings?status=scheduled` filters correctly.
- [ ] `GET /meetings/:id` is scoped by owner; other users get 404.
- [ ] `PATCH /meetings/:id` updates title/description/scheduled_at/meeting_type_id; forbidden on live meetings.
- [ ] `DELETE /meetings/:id` removes scheduled meetings; refuses live meetings with 409.
- [ ] `/dashboard` lists upcoming + recent meetings, CTA "New meeting" routes to `/meetings/new`.
- [ ] `/meetings/new` form submits and navigates to `/meetings/:id`.
- [ ] `/meetings/:id` shows details and a disabled Join button.

## Smoke test
```bash
# With M10-M13 working:
# 1. /dashboard → empty sections
# 2. Click "New meeting" → fill title "Acme sync", pick meeting type "Sales call" → Save
# 3. Lands on /meetings/:id with detail rendered
# 4. Back to /dashboard → meeting appears under Upcoming
# 5. DB check: SELECT id, livekit_room, status FROM meetings; → livekit_room = "meeting-<id>", status='scheduled'
# 6. DELETE via detail page → removed
# 7. As another user: verify /meetings/<id> returns 404
```

## Do NOT
- Do NOT mint LiveKit tokens here. No `livekit-server-sdk` import yet.
- Do NOT implement `POST /meetings/:id/join`, `/leave`, `/end`. Wave 2.
- Do NOT dispatch the Python worker from any handler in this module.
- Do NOT hard-delete live meetings. Reject with 409.
- Do NOT skip the `livekit_room` column on insert — it's UNIQUE NOT NULL.
- Do NOT leak other users' meetings via status filters or search.

## Hand-off
- `meetings` rows exist in the DB for Wave 2 to act upon. `livekit_room` is already populated so the token-mint step only has to read it.
- Dashboard skeleton is in place — Wave 2 will add "Join now" handler + live meeting highlight.
- The meeting detail page is the natural place for Wave 2 to drop in the Join button wiring.
- Auto-classify stub hook exists — a later module can flesh it out with a real LLM call without schema changes.
