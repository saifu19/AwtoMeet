# M52 — Meeting invites + Guest Access
Wave: 2 (moved from Wave 5)    Owner: <unassigned>    Branch: feat/m52-invites
Depends on: M10, M14, M20    plan.md refs: §13.2, §13.9, §4, §6

## Goal
Hosts can invite people to a meeting by email with a toggleable `can_view_insights` flag. Each invite produces an opaque `invite_token` used in a share link. When an invitee clicks the link, after login/signup the invite is bound to their `user_id` by matching email. Access to the meeting room is granted to any accepted invitee; access to the `/meetings/:id/insights` dashboard is gated by `can_view_insights = true` (or being the host).

## Context (inlined from plan.md)
`meeting_invites` schema (already defined in §4):
```
id, meeting_id, invited_email, invited_user_id (nullable),
role enum('host','participant','observer') default 'participant',
can_view_insights boolean default false,
invite_token varchar(64) unique,
accepted_at, created_at
unique (meeting_id, invited_email)
```

Endpoints (§6):
```
GET    /meetings/:id/invites
POST   /meetings/:id/invites              { invited_email, role?, can_view_insights }
PATCH  /meetings/:id/invites/:inviteId    { role?, can_view_insights? }
DELETE /meetings/:id/invites/:inviteId
POST   /invites/:token/accept             # called by invitee after login/signup
```

Resolved product decisions (§13.2):
- If invitee is logged in and email matches, link the invite to their `user_id` and grant access.
- If not registered, they can sign up / Google-login, then the invite auto-binds by email on next login.
- The invitee gets access to the meeting room regardless of `can_view_insights`.
- Insights access gated by `can_view_insights = true` OR being the host.
- Host can edit invites until the meeting ends.

## Files to create / modify
- **Migration:** add `meeting_invites` table (if not already in M01 migration).
- **Create (api):** `apps/api/src/routes/invites.ts` — all five endpoints listed above.
- **Create (api):** `apps/api/src/services/invites.ts` — `createInvite`, `acceptInvite(token, user)`, `canViewInsights(user, meeting_id)`, `canJoinRoom(user, meeting_id)`.
- **Modify (api):** `GET /meetings` — return meetings the user owns OR has an accepted invite to (not just owned). Uses `listAccessible()` repo method.
- **Modify (api):** `GET /meetings/:id` — allow host OR accepted invitee to view meeting details (not just owner).
- **Modify (api):** `POST /meetings/:id/join` — allow any user who is host OR has an accepted invite. Not just the creator. Only host can start a scheduled meeting; invitees joining scheduled get 409.
- **Create (api):** `POST /meetings/:id/join-guest` — NO auth required. Guest provides `display_name`, gets ephemeral LiveKit token. Only works on `live` meetings.
- **Modify (api):** `GET /meetings/:id/stream` (SSE) + `GET /meetings/:id/insights` + `GET /meetings/:id/transcript` + `GET /meetings/:id/summary` — require `canViewInsights(user, meeting_id)`. Return 403 otherwise. (Deferred to M32/M33.)
- **Modify (api):** login/signup handlers — after auth, call `autoBindPendingInvites(user.email)` which sets `invited_user_id` on any matching rows.
- **Create (web):** `apps/web/src/pages/meetings/invites.tsx` — list+add+edit+delete invites on a meeting detail sidebar.
- **Create (web):** `apps/web/src/pages/invites/accept.tsx` — route `/invites/:token/accept` that requires login then calls `POST /invites/:token/accept`, then redirects to `/meetings/:id`.
- **Modify (web):** insights dashboard + meeting detail — handle 403 gracefully.

## Implementation notes
- Token generation: `crypto.randomBytes(32).toString('base64url')` — 43 chars, opaque, unguessable. Store as-is in `invite_token`.
- `POST /meetings/:id/invites`: host-only. Upsert on `(meeting_id, invited_email)` so re-inviting updates the flag rather than erroring.
- `POST /invites/:token/accept`: requires auth. Match invited_email case-insensitively against `user.email`. If match, set `invited_user_id = user.id`, `accepted_at = now()`. If mismatch, return 403 "this invite is for a different email."
- `canViewInsights(user, meeting_id)`: returns true if `meeting.user_id === user.id` OR `EXISTS (SELECT 1 FROM meeting_invites WHERE meeting_id = ? AND invited_user_id = ? AND can_view_insights = true AND accepted_at IS NOT NULL)`.
- `canJoinRoom(user, meeting_id)`: host OR any accepted invite (regardless of `can_view_insights`).
- Auto-bind on login: single SQL `UPDATE meeting_invites SET invited_user_id = ? WHERE invited_email = ? AND invited_user_id IS NULL`. Does not set `accepted_at` — user still has to click the link or visit the meeting.
- Invite link shape: `${WEB_URL}/invites/${token}/accept`. Send via email (stub the email sender for MVP — log to console is fine) and show "copy link" in the UI.
- Edit window: host can PATCH/DELETE only while `meeting.status IN ('scheduled','live')`. After `ended`, 409.
- Keep all authorization in the `assertCanAccess`-style helpers per §15 — don't sprinkle `WHERE user_id = ?` in route handlers.

## Acceptance criteria
- [ ] Host can create, list, edit, delete invites via the five endpoints.
- [ ] Clicking an invite link while logged out prompts login/signup; after auth, the invite is bound and the user lands on the meeting detail.
- [ ] An invitee with `can_view_insights = false` can join the room but gets 403 on `/insights`, `/stream`, `/transcript`, `/summary`.
- [ ] An invitee with `can_view_insights = true` sees everything.
- [ ] Editing `can_view_insights` on an accepted invite takes effect immediately.
- [ ] Inviting the same email twice updates the existing row (unique constraint respected).
- [ ] After `meeting.status = 'ended'`, PATCH/DELETE invites returns 409.

## Smoke test
1. Host creates a meeting, invites `alice@example.com` with `can_view_insights=false` and `bob@example.com` with `true`.
2. Alice signs up, clicks her link, lands on the meeting detail, joins the room — OK. Visits `/insights` — 403.
3. Bob does the same — `/insights` loads.
4. Host PATCHes Alice's invite to `can_view_insights=true`; Alice refreshes `/insights` — now 200.

## Do NOT
- Do NOT reuse the auth JWT as the invite token.
- Do NOT grant insights access on room-join alone — always check `can_view_insights`.
- Do NOT email-send for real in MVP; console.log the invite URL.
- Do NOT allow invite edits after the meeting has ended.
- Do NOT bypass `assertCanAccess` / repo helpers — all auth flows through them (§15).
- Do NOT leak another user's invite rows via `GET /meetings/:id/invites` — host-only.

## Guest Access (bundled with M52)

Unauthenticated users can join a **live** meeting without signing up. This is in addition to the invite-based auth flow above.

**Endpoint:** `POST /meetings/:id/join-guest { display_name }` — NO auth required.
- Only works on `live` meetings (host must start it first).
- Generates ephemeral LiveKit token with `identity = "guest-{ulid}"`, `name = display_name`.
- Returns `{ livekit_url, livekit_token }` — same shape as authenticated join.
- Guest cannot access insights, transcript, or summary (those require auth + invite).

**Frontend:** Public route at `/join/:meetingId` (not under `_auth/`).
- If user is authenticated → redirect to `/meetings/$id/room` (normal join).
- If not authenticated → show "Enter your name" prompt → call `join-guest` → render LiveKit room inline.
- If meeting not started → show "Waiting for host to start the meeting."

**Host's shareable link:** `${WEB_URL}/join/${meetingId}` — works for both auth'd users and guests.

## Deferred to later modules
- **Insights gating** (`canViewInsights` enforcement on `/insights`, `/stream`, `/transcript`, `/summary`) — helpers created here, wired when M32/M33 land.

## Hand-off
After this ships, the app supports multi-user meetings end-to-end with both invited and guest participants. M53/M54/M55 are infra/nice-to-haves; M60 is deploy.
