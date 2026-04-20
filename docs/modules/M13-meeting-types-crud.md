# M13 — Meeting Types CRUD (API + Web)
Wave: 1    Owner: <unassigned>    Branch: feat/m13-meeting-types-crud
Depends on: M12    Blocks: M14 (optional FK from meetings.meeting_type_id)    plan.md refs: §4, §6, §8.1, §13.6

## Goal
Implement full CRUD for `meeting_types` with an agent multi-select, editable `agenda_items`, and a `buffer_size` field. Backend endpoints at `/meeting-types` write to both `meeting_types` and the `meeting_type_agents` join table atomically. Frontend pages at `/meeting-types`, `/meeting-types/new`, `/meeting-types/:id` provide the create/edit UI with a shadcn multi-select populated from `GET /agents`.

## Context (inlined from plan.md)
Tables (§4):
```
meeting_types
  id              char(26) pk
  user_id         char(26) fk
  org_id          char(26) null          # see §15, always write NULL for MVP
  name            varchar(255)
  description     text
  agenda_items    json                   # ["pricing", "next steps", ...]
  buffer_size     int default 10         # controls fanout cadence for ALL agents on this meeting type
  created_at      datetime

meeting_type_agents                      # many-to-many
  meeting_type_id char(26) fk
  agent_id        char(26) fk
  primary key (meeting_type_id, agent_id)
```

Critical decision from §13.6: **buffer cadence is per-meeting-type, not per-agent.** One shared buffer per meeting; when it flushes, every agent on the meeting type fires in parallel against the same chunk. Default `buffer_size = 10` messages.

Agenda items are a JSON array of strings used later by the post-meeting summarizer (§7.6) to produce structured agenda findings.

Endpoints (§6):
```
GET    /meeting-types
POST   /meeting-types          { name, description, agenda_items, agent_ids }
GET    /meeting-types/:id
PATCH  /meeting-types/:id
DELETE /meeting-types/:id
```

Deletion behavior (§13.4): **soft-detach.** On delete, set `meetings.meeting_type_id = NULL` for any referencing meetings, then delete the meeting type. Do NOT cascade-delete meetings or their transcripts.

Web pages (§8.1):
```
/meeting-types           CRUD list of meeting types
/meeting-types/new       form: name, description, agenda_items[], agent_ids[]
/meeting-types/:id       edit
```
Also expose `buffer_size` on the form (not mentioned in §8.1 wording but required by §13.6).

## Files to create / modify
- `apps/api/src/routes/meeting-types.ts` — five routes, validated via `CreateMeetingTypeReq`/`UpdateMeetingTypeReq` from `@meeting-app/shared`.
- `apps/api/src/repositories/meeting-types.ts` — `listByOwner(userId, orgId?)`, `getByIdWithAgents(id)`, `create(data, agentIds)`, `update(id, patch, agentIds?)`, `deleteWithDetach(id)`.
- `apps/web/src/routes/_auth/meeting-types/index.tsx` — list page.
- `apps/web/src/routes/_auth/meeting-types/new.tsx` — create page.
- `apps/web/src/routes/_auth/meeting-types/$id.tsx` — edit page.
- `apps/web/src/features/meeting-types/MeetingTypeForm.tsx` — form component.
- `apps/web/src/features/meeting-types/AgendaItemsInput.tsx` — repeatable tag input for `agenda_items`.
- `apps/web/src/features/meeting-types/AgentMultiSelect.tsx` — multi-select sourced from `GET /agents`.
- `apps/web/src/features/meeting-types/hooks.ts` — TanStack Query hooks.

## Implementation notes
1. **Create transaction:** insert into `meeting_types`, then bulk-insert into `meeting_type_agents`. Use a Drizzle transaction:
   ```ts
   await db.transaction(async (tx) => {
     await tx.insert(meetingTypes).values({ id, user_id, org_id: null, name, description, agenda_items, buffer_size });
     if (agentIds.length) {
       await tx.insert(meetingTypeAgents).values(agentIds.map((agent_id) => ({ meeting_type_id: id, agent_id })));
     }
   });
   ```
2. **Ownership check on agent_ids:** before inserting into `meeting_type_agents`, verify every `agent_id` belongs to `req.user.id` (via the M12 repository). Reject with 400 if any does not.
3. **Update:** if `agent_ids` is present in the PATCH body, delete existing join rows and re-insert. Simple and correct; optimize later if needed.
4. **Delete (soft-detach):**
   ```ts
   await db.transaction(async (tx) => {
     await tx.update(meetings).set({ meeting_type_id: null }).where(eq(meetings.meeting_type_id, id));
     await tx.delete(meetingTypeAgents).where(eq(meetingTypeAgents.meeting_type_id, id));
     await tx.delete(meetingTypes).where(eq(meetingTypes.id, id));
   });
   ```
5. **GET `/meeting-types`:** return each meeting type with its attached `agent_ids` (array) or full agent objects — pick one and stay consistent with M02 schemas. Recommend IDs on list, full expansion on single-resource GET.
6. **buffer_size:** number input on the form, min 1, max 100, default 10. Store as `int`.
7. **agenda_items input:** a tag-style input where the user types and presses Enter to add. Stored as `string[]` in JSON.
8. **AgentMultiSelect:** shadcn `<Command>` + `<Popover>` pattern, or just a grid of checkboxes if simpler. Load agents via `useAgents()` from M12.
9. **Empty state:** "You have no meeting types yet. Meeting types bundle an agenda and a set of AI agents that will run during every meeting of this type."

## Acceptance criteria
- [ ] `GET /meeting-types` lists only the authenticated user's meeting types with their `agent_ids`.
- [ ] `POST /meeting-types` atomically inserts the meeting type and its join rows, rejects if any agent_id isn't owned by the user.
- [ ] `GET /meeting-types/:id` returns the meeting type with full agent objects (or IDs — be consistent).
- [ ] `PATCH /meeting-types/:id` updates fields and (if provided) replaces the agent list.
- [ ] `DELETE /meeting-types/:id` sets `meetings.meeting_type_id = NULL` on referencing meetings and deletes join rows + the meeting type — meetings survive.
- [ ] Frontend form validates with zod, creates/edits successfully, shows inline errors.
- [ ] buffer_size defaults to 10 and can be edited on the form.
- [ ] Agent multi-select loads from `GET /agents` and returns the selected IDs in the submit payload.
- [ ] List page shows name, agent count, agenda item count, and edit/delete actions.

## Smoke test
```bash
# With M12 already working and at least 2 agents created:
# 1. Visit /meeting-types → empty state
# 2. New → name "Sales call", description "...", agenda_items ["pricing","next steps"], buffer_size 10, pick 2 agents → Save
# 3. List shows the row
# 4. Edit → change agent selection → Save → persisted
# 5. Delete → dialog → confirm → row gone
# 6. To verify soft-detach: create a meeting type, create a meeting referencing it (via M14 or direct SQL), delete the meeting type, verify the meeting still exists with NULL meeting_type_id.
# 7. Verify the API rejects agent_ids that belong to another user (use a second user's agent id manually — expect 400).
```

## Do NOT
- Do NOT put `buffer_size` on agents. It lives on meeting_types (§4, §13.6).
- Do NOT cascade-delete meetings when a meeting type is deleted. Soft-detach only (§13.4).
- Do NOT allow picking agents owned by another user. Validate ownership server-side.
- Do NOT support per-agent buffer overrides "as a small nice-to-have." One shared buffer, one cadence.
- Do NOT forget to wrap the insert-and-join in a transaction. Partial creates are unacceptable.

## Hand-off
- `/meeting-types` API ready for M14's meeting create form (which offers an optional `meeting_type_id`).
- `meetingTypeAgents` join rows are the source of truth the Python worker later reads to know which agents to fan out to (via §7.4 `AgentFanout.load_agents()`).
- `buffer_size` value on the meeting type is what the worker will pass into the shared `MessageBuffer` (§7.2) at runtime.
- The agent multi-select UX pattern here is reusable for any future "pick N of my things" form.
