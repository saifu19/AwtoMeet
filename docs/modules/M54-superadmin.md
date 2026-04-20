# M54 — Superadmin dashboard
Wave: 5    Owner: <unassigned>    Branch: feat/m54-superadmin
Depends on: M10, M01    plan.md refs: §16, §6

## Goal
Add `users.is_superadmin boolean default false`, four `/admin/*` endpoints gated by that flag, and a minimal `/admin` frontend page that lists users with current-period usage and inline-editable per-user limits. Skinny, ugly, functional. Set yourself superadmin via SQL UPDATE.

## Context (inlined from plan.md §16, §6)
Endpoints:
```
GET   /admin/users                                    # list all users + current-period usage summary
GET   /admin/users/:id/usage                          # detailed usage for a user, all periods
PATCH /admin/users/:id/limits                         # { max_meeting_minutes_per_month?, max_cost_usd_per_month?, max_agents? }
GET   /admin/usage                                    # system-wide rollup
```
Gating: `users.is_superadmin = true`. Non-superadmins get 403.

Frontend: route `/admin`, visible in nav only if `me.is_superadmin`. Single page listing users with current-period `meeting_minutes`, `prompt_tokens`, `completion_tokens`, `cost_usd`, plus three editable number inputs for the limits. Save per-row.

## Files to create / modify
- **Migration:** `ALTER TABLE users ADD COLUMN is_superadmin boolean NOT NULL DEFAULT false;`
- **Create (api):** `apps/api/src/middleware/requireSuperadmin.ts` — checks `req.user.is_superadmin`, 403 otherwise.
- **Create (api):** `apps/api/src/routes/admin.ts` — the four endpoints. Register with `requireSuperadmin` prefix.
- **Modify (api):** `GET /auth/me` — include `is_superadmin` in the returned user object.
- **Create (web):** `apps/web/src/pages/admin/index.tsx` — table of users with editable limit cells.
- **Modify (web):** main nav — conditionally render `/admin` link when `me.is_superadmin`.
- **Modify (web):** router — add `/admin` route with an admin-only guard HOC (client-side hide only; real gating is server-side).

## Implementation notes
- `GET /admin/users` query: `LEFT JOIN usage_counters ON user_id AND period = CURRENT_PERIOD` plus `LEFT JOIN usage_limits` so one row per user with both sides in the payload. Paginate if >100 users (MVP: just return all).
- `GET /admin/users/:id/usage`: return all `usage_counters` rows for that user, ordered by period desc, plus their `usage_limits` row (if any).
- `PATCH /admin/users/:id/limits`: UPSERT the `usage_limits` row for `(user_id=:id, org_id=NULL)`. Any field omitted = leave unchanged; explicit `null` = set unlimited.
- `GET /admin/usage`: system-wide rollup — SUM over `usage_counters` for current period. Single row response.
- Current period: `YYYY-MM` of `NOW()`.
- Frontend table: one row per user, columns `email`, `meeting_minutes`, `cost_usd`, then three `<Input type="number">` for `max_meeting_minutes_per_month`, `max_cost_usd_per_month`, `max_agents`. "Save" button per row that calls PATCH.
- Empty input = NULL (unlimited). Show a placeholder "∞".
- Do not build a pretty UI. Just `<table>` with shadcn inputs. Ship it.
- Becoming superadmin: ship with no UI path. Human runs `UPDATE users SET is_superadmin=true WHERE email='you@you.com';` manually.

## Acceptance criteria
- [ ] Non-superadmins calling `/admin/*` get 403.
- [ ] Superadmins see a working `/admin` page with all users and current-period usage.
- [ ] Editing a limit and saving updates the `usage_limits` row; enforcement (M53 middleware) picks up the change on the next request.
- [ ] `GET /admin/usage` returns a single system-wide rollup.
- [ ] Non-superadmin user does not see the `/admin` nav link.
- [ ] Setting your own `is_superadmin = true` via SQL and re-logging in grants access without code changes.

## Smoke test
1. `UPDATE users SET is_superadmin = true WHERE email = 'me@me.com';`
2. Log out, log in. Nav shows "Admin."
3. Visit `/admin` — see the user list with usage.
4. Edit a limit, save, verify `usage_limits` row updated in DB.
5. As that user, attempt to create a meeting — 429 if limit exceeded.
6. Log in as a non-superadmin — no "Admin" link; direct visit to `/admin` returns data-less state or redirects; API returns 403.

## Do NOT
- Do NOT rely on client-side gating alone. The server is the source of truth.
- Do NOT build role hierarchies or ACL systems. One boolean.
- Do NOT expose password hashes in `/admin/users`.
- Do NOT allow superadmins to elevate others through the API in MVP — SQL only. (Keeps attack surface tiny.)
- Do NOT prettify. Ship it ugly; iterate later.

## Hand-off
Independent. Works as soon as M53 is in place since enforcement reads the same `usage_limits` rows this page writes.
