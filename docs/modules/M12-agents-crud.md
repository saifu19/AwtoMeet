# M12 — Agents CRUD (API + Web)
Wave: 1    Owner: <unassigned>    Branch: feat/m12-agents-crud
Depends on: M01, M02, M10, M11    Blocks: M13    plan.md refs: §4, §6, §8.1

## Goal
Implement full CRUD for AI "agent" definitions: Fastify endpoints at `/agents` backed by the `agents` table from M01, plus frontend pages `/agents`, `/agents/new`, `/agents/:id` that let a logged-in user create, list, edit, and delete their agents. Every agent is owned by its creator (`user_id`) and scoped in queries so users only see their own. Uses the schemas from M02 and `requireAuth` from M10.

## Context (inlined from plan.md)
The `agents` table (§4):
```
agents
  id              char(26) pk
  user_id         char(26) fk
  org_id          char(26) null          # see §15
  name            varchar(255)
  system_prompt   text
  provider        varchar(32) null       # "openai" | "anthropic" | null=default
  model           varchar(64) null
  created_at      datetime
```
`buffer_size` does NOT live on agents — it lives on `meeting_types` (§4, §13.6). Per-agent LLM is picked via `provider` + `model`; NULL means fall back to env defaults `DEFAULT_LLM_PROVIDER` + `DEFAULT_LLM_MODEL`.

Endpoints (§6):
```
GET    /agents
POST   /agents                 { name, system_prompt, provider?, model?, buffer_size? }
GET    /agents/:id
PATCH  /agents/:id
DELETE /agents/:id
```
(Note: plan.md §6 lists `buffer_size?` on the POST body. §4/§13.6 override — ignore it server-side. Accept-and-drop is fine for forward compat.)

Web pages (§8.1):
```
/agents                  CRUD list of AI agents
/agents/new              form: name, system_prompt, provider, model, buffer_size
/agents/:id              edit
```
Same note about buffer_size on the web form: don't show it here; show it on the meeting-type form (M13).

Authorization model: every row has a `user_id`. For now, `WHERE user_id = ?` — but go through a helper so M15 can swap it for org-aware logic in one place.

## Files to create / modify
- `apps/api/src/routes/agents.ts` — the five routes, validated with schemas from `@meeting-app/shared` (M02).
- `apps/api/src/repositories/agents.ts` — `listByOwner(userId, orgId?)`, `getById(id)`, `create(data)`, `update(id, patch)`, `delete(id)`. All functions accept an optional `orgId` parameter now (ignored) to satisfy §15 pre-paving.
- `apps/api/src/index.ts` — register agent routes under `requireAuth`.
- `apps/web/src/routes/_auth/agents/index.tsx` — list page with shadcn `<Table>`, create/edit/delete buttons.
- `apps/web/src/routes/_auth/agents/new.tsx` — create form.
- `apps/web/src/routes/_auth/agents/$id.tsx` — edit form (reuse the create form component with initial values).
- `apps/web/src/features/agents/AgentForm.tsx` — shared form component (name, system_prompt textarea, provider select, model input).
- `apps/web/src/features/agents/hooks.ts` — `useAgents()`, `useAgent(id)`, `useCreateAgent()`, `useUpdateAgent()`, `useDeleteAgent()` TanStack Query hooks.

## Implementation notes
1. **API POST `/agents`:**
   ```ts
   app.post('/agents', { preHandler: requireAuth, schema: zodToFastify(CreateAgentReq) }, async (req, reply) => {
     const body = CreateAgentReq.parse(req.body);
     const id = ulid();
     await agentsRepo.create({
       id,
       user_id: req.user.id,
       org_id: null,                // §15: NULL for personal
       name: body.name,
       system_prompt: body.system_prompt,
       provider: body.provider ?? null,
       model: body.model ?? null,
     });
     return reply.code(201).send(await agentsRepo.getById(id));
   });
   ```
2. **Repository functions** accept optional `orgId` parameter even though ignored now:
   ```ts
   export async function listByOwner(userId: string, orgId?: string | null) {
     return db.select().from(agents).where(eq(agents.user_id, userId));
   }
   ```
   When M15/orgs ships, this signature stays the same; only the WHERE clause changes.
3. **GET/PATCH/DELETE `/agents/:id`:** fetch by id, call M15's (or this module's placeholder) `assertCanAccess(req.user, row)` — placeholder for now just checks `row.user_id === req.user.id`. Throw 404 (not 403) on mismatch to avoid leaking existence.
4. **Web list page:** `useAgents()` → render table with columns: Name, Provider, Model, Created, Actions (Edit / Delete). Delete uses a shadcn `<AlertDialog>` confirmation.
5. **Web form:** `AgentForm` uses `react-hook-form` + `zodResolver(CreateAgentReq)`. Provider is a shadcn `<Select>` with options `['openai', 'anthropic']` plus a "(default)" option mapping to `undefined`. Model is a free-text input with placeholder hints (`gpt-4o-mini`, `claude-sonnet-4-6`).
6. **Do NOT show `buffer_size`** on the agent form — it belongs to the meeting-type form in M13.
7. **Empty state:** agents list shows a card "You have no agents yet. [Create your first agent]" when the list is empty.
8. **TanStack Query keys:** `['agents']` for the list, `['agents', id]` for a single agent. Invalidate `['agents']` after every mutation.

## Acceptance criteria
- [ ] `GET /agents` returns only the authenticated user's agents.
- [ ] `POST /agents` creates a new row with `user_id = req.user.id`, `org_id = null`, returns 201 with the row.
- [ ] `GET /agents/:id` returns 404 when the agent belongs to another user.
- [ ] `PATCH /agents/:id` updates only mutable fields; 404 on other users' agents.
- [ ] `DELETE /agents/:id` deletes; 404 on others'.
- [ ] `/agents` page lists current agents with working Create / Edit / Delete.
- [ ] Form validation errors surface inline via zod + react-hook-form.
- [ ] Provider dropdown offers openai / anthropic / default; NULL is persisted when "default" is picked.
- [ ] The buffer_size field is NOT present on the agent form.
- [ ] Repository functions accept an optional `orgId` parameter (even though unused).

## Smoke test
```bash
pnpm --filter api dev
pnpm --filter web dev
# Log in, then:
# 1. Visit /agents → empty state
# 2. Click "New agent" → fill in name "Summarizer", system_prompt "You summarize meetings.", provider openai, model gpt-4o-mini → Save
# 3. Back on /agents list, new row visible
# 4. Edit → change name → Save → list updates
# 5. Delete via dialog → row disappears
# 6. As a second user (log out + sign up), verify /agents is empty and GET /agents/<first user's id> returns 404
```

## Do NOT
- Do NOT expose `buffer_size` on the agent UI or model — it lives on `meeting_types` (§4, §13.6).
- Do NOT write inline `WHERE user_id = ?` clauses in the route handlers. Go through repository functions. M15 depends on this being centralized.
- Do NOT return 403 when an agent belongs to another user; return 404 to avoid existence leaks.
- Do NOT let deletion cascade silently into a meeting type. For MVP, block deletion if the agent is referenced by any `meeting_type_agents` row and ask the user to detach first. (Alternative: soft-delete — pick ONE and document it.)
- Do NOT skip the `org_id: null` write; the column exists for §15.

## Hand-off
- `GET /agents` is the data source M13's meeting-type form needs for its multi-select.
- Repository pattern is established — M13 and M14 follow the same shape.
- `AgentForm` component + TanStack Query hook pattern is the template for M13/M14 frontends.
- The placeholder `assertCanAccess` here is what M15 formalizes and replaces.
