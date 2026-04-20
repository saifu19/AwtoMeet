# M15 — Authorization Helper (assertCanAccess + repository orgId pre-paving)
Wave: 1    Owner: <unassigned>    Branch: feat/m15-authz-helper
Depends on: M10, M11, M12, M13, M14    Blocks: Wave 2 hardening (any protected read/write added later)    plan.md refs: §15

## Goal
Centralize every authorization check in the API behind a single helper `assertCanAccess(user, resource)` and retrofit M12/M13/M14 repositories so they ALL accept an optional `orgId` filter parameter. Today the helper just checks `resource.user_id === user.id`; when orgs ship later, a one-line change makes it org-aware. This module is the insurance policy that §15's "litmus test" holds: shipping orgs later should be **schema additions + one helper rewrite**, not a grep-through-200-files refactor.

## Context (inlined from plan.md, §15)
We are NOT building orgs in MVP, but we ARE pre-paving the road. Concrete rules:

- Every user-owned table (`agents`, `meeting_types`, `meetings`) has a **nullable `org_id char(26)`** column from day one. NULL means "personal." (M01 handles this.)
- All authorization checks in the API go through a single helper `assertCanAccess(user, resource)` rather than inline `WHERE user_id = ?` clauses. The helper currently checks `resource.user_id === user.id`. When orgs ship, this becomes `user_id === user.id || (resource.org_id && user.org_ids.includes(resource.org_id))`. **One function to change**, not 50.
- Resource queries go through repository functions that already accept an optional `orgId` filter parameter (ignore it for now, but the signature exists).
- The frontend's resource lists are written against `GET /agents` etc. which already returns rows scoped by the helper above — when orgs ship, the same endpoint just starts returning org-shared rows too.
- Future tables to expect: `orgs`, `org_members(org_id, user_id, role)`, `org_invites`. Don't create them now. Just don't paint yourself into a corner.

**Litmus test:** when the human says "ok, ship orgs," the dev should be doing schema additions and one helper function rewrite, not chasing `user_id` references through 200 files.

## Files to create / modify
- `apps/api/src/authz/assertCanAccess.ts` — the helper. Exports `assertCanAccess(user, resource)` and `canAccess(user, resource)` (non-throwing variant).
- `apps/api/src/authz/types.ts` — `OwnedResource` interface (`{ user_id: string; org_id: string | null }`), `AuthUser` type (`{ id: string; email: string; org_ids?: string[] }` — `org_ids` is `undefined` for now but present in the type).
- `apps/api/src/repositories/agents.ts` — ensure every list/get function accepts an optional `orgId` parameter (unused today) and all writes preserve `org_id` from the input.
- `apps/api/src/repositories/meeting-types.ts` — same.
- `apps/api/src/repositories/meetings.ts` — same.
- `apps/api/src/routes/agents.ts`, `meeting-types.ts`, `meetings.ts` — replace any inline `row.user_id !== req.user.id` checks with `assertCanAccess(req.user, row)`.
- `apps/api/src/plugins/auth.ts` — update `request.user` type to `AuthUser` (add `org_ids?: string[]`, leave undefined for now).
- `apps/api/test/authz.test.ts` — unit tests covering the helper and a couple of route integration tests.

## Implementation notes
1. **Helper:**
   ```ts
   import type { AuthUser, OwnedResource } from './types';

   export class ForbiddenError extends Error {
     statusCode = 404;    // return 404, not 403, to avoid existence leaks
     constructor() { super('not_found'); }
   }

   export function canAccess(user: AuthUser, resource: OwnedResource): boolean {
     if (resource.user_id === user.id) return true;
     // FUTURE: org membership check
     // if (resource.org_id && user.org_ids?.includes(resource.org_id)) return true;
     return false;
   }

   export function assertCanAccess(user: AuthUser, resource: OwnedResource | null | undefined): asserts resource is OwnedResource {
     if (!resource || !canAccess(user, resource)) throw new ForbiddenError();
   }
   ```
2. **Repository signature pattern:**
   ```ts
   // BEFORE
   export async function listByOwner(userId: string) { ... }
   // AFTER
   export async function listByOwner(userId: string, orgId?: string | null) {
     // TODO(orgs): include rows where org_id = orgId when orgId is provided
     return db.select().from(agents).where(eq(agents.user_id, userId));
   }
   ```
   Do this for `agents`, `meetingTypes`, `meetings`. Write functions (`create`, `update`) simply persist whatever `org_id` is supplied (currently always `null`).
3. **Route retrofit:**
   ```ts
   // BEFORE
   const row = await agentsRepo.getById(id);
   if (!row || row.user_id !== req.user.id) return reply.code(404).send();
   // AFTER
   const row = await agentsRepo.getById(id);
   assertCanAccess(req.user, row);
   ```
4. **Error mapping:** register a Fastify error handler that translates `ForbiddenError` to a `404 { error: 'not_found' }` response. This preserves the "don't leak existence" behavior from M12/M13/M14.
5. **Tests:**
   - Unit: `canAccess` returns true when user_id matches, false otherwise, false when resource is null.
   - Unit: assert the `FUTURE: org membership check` comment exists (or a simple regression test asserting `canAccess` returns false when `user_id` doesn't match even if `org_id` is set — until orgs ship).
   - Integration: GET/PATCH/DELETE agents/meeting-types/meetings by another user → 404.
6. **Do a grep audit** at the end: `grep -rn "user_id !==" apps/api/src` should return **zero** matches outside of `authz/assertCanAccess.ts`. Same for `WHERE user_id = ?` patterns in route files (they should be in repositories only).
7. **`request.user` type:** make sure `AuthUser.org_ids` is `string[] | undefined` (not omitted). This means downstream code that checks `user.org_ids?.includes(...)` compiles today and works tomorrow.

## Acceptance criteria
- [ ] `assertCanAccess` and `canAccess` exist and are exported from `apps/api/src/authz/assertCanAccess.ts`.
- [ ] Every route in M12/M13/M14 that authorizes a resource goes through `assertCanAccess`. No inline `user_id` comparisons in route files.
- [ ] Every repository list/get function in `agents`, `meeting-types`, `meetings` accepts an optional `orgId` parameter (even if unused).
- [ ] `request.user.org_ids` is typed as `string[] | undefined`.
- [ ] `ForbiddenError` is mapped to a 404 response by the global error handler.
- [ ] Unit tests for `canAccess` pass.
- [ ] Integration tests confirm cross-user access to any agent/meeting-type/meeting returns 404.
- [ ] Grep audit: no `user_id !==` outside the authz module; no raw ownership filters in route files.

## Smoke test
```bash
pnpm --filter api test
# Manual:
# 1. Sign up user A, create an agent → note its id.
# 2. Sign up user B in a separate browser profile → GET /agents/<A's agent id> → expect 404.
# 3. Attempt PATCH and DELETE on A's agent as B → 404.
# 4. Repeat for meeting-types and meetings.
# 5. Simulate the future org path in a throwaway branch: set `request.user.org_ids = ['abc']` and a resource.org_id='abc', confirm `canAccess` CAN be extended with two lines — leave as a note in the PR description.
```

## Do NOT
- Do NOT create `orgs`, `org_members`, or `org_invites` tables. Pre-paving only.
- Do NOT return 403. Return 404 to avoid leaking resource existence.
- Do NOT inline ownership checks in route handlers anymore. Repositories + `assertCanAccess` only.
- Do NOT add org-membership logic to `canAccess` now — leave it as a commented `FUTURE:` line. §15 is explicit: the helper currently just checks `user_id`.
- Do NOT refactor the worker or the Python codebase here — the worker doesn't authorize HTTP traffic; it trusts the meeting_id it receives via dispatch metadata.

## Hand-off
- Every future protected route (Wave 2+: join/leave/end, insights, invites, admin, calendar, summary) MUST use `assertCanAccess` from day one.
- When orgs ship (post-MVP), the dev changes:
  1. `canAccess` to add the org-membership clause.
  2. Repository `listByOwner` functions to OR-in `org_id IN (user.org_ids)`.
  3. `requireAuth` to populate `request.user.org_ids` from `org_members`.
  Nothing else touches. That is the §15 litmus test and the reason this module exists.
- Grep audit established as a standing invariant — future PRs that reintroduce inline `user_id !==` should be rejected in review.
