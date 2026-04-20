## M20 — LiveKit Join Flow
Wave: 2    Owner: <unassigned>    Branch: feat/m20-livekit-join
Depends on: M14    Blocks: M22, M34    plan.md refs: §6, §8.2

## Goal
Implement the end-to-end "click Join, land in a LiveKit room" flow. The Node API mints a short-lived LiveKit capability token via `livekit-server-sdk` on `POST /meetings/:id/join` and returns `{ livekit_url, livekit_token }`. On the host's first join the API sets `started_at = now()` as the "host has opened the room" signal — but **does not** change `status`. Non-host and guest joins are allowed once `started_at` is set, regardless of the current status. The worker is the only thing that transitions `status: scheduled → live` (on first real participant) and `→ ended` (on room empty); see M22 / M30 for that side. The web app's `/meetings/:id/room` page consumes the token via `@livekit/components-react`'s `LiveKitRoom` + `VideoConference` prebuilt and connects two browser tabs to the same room.

This module is **media-plane only** — no worker, no STT, no captions yet. Worker dispatch is wired in M22; captions overlay lives in M34.

## Context (inlined from plan.md)
- The LiveKit room name is deterministic: `meeting.livekit_room = "meeting-{id}"` (§4).
- LiveKit token minting is **separate from our auth JWT**. It is a short-lived (1 hour) capability token signed with `LIVEKIT_API_SECRET` using `livekit-server-sdk` (Node). It is NOT the same as the auth JWT (§5).
- `POST /meetings/:id/join → { livekit_url, livekit_token }`. On the host's first call this also sets `started_at = now()` (status stays `scheduled`). In M22 it also dispatches the agent worker if `meeting.worker_job_id` is NULL (§6). The `scheduled → live` transition is done by the worker, not by this endpoint.
- `POST /meetings/:id/leave → 204` exists alongside.
- Frontend room page (§8.2): "Use `@livekit/components-react`'s `LiveKitRoom` + `VideoConference` prebuilt for MVP. On mount, call `POST /meetings/:id/join` to get `{ url, token }`. Pass to `<LiveKitRoom serverUrl={url} token={token} connect>`."
- `LIVEKIT_API_SECRET` must never ship to the frontend or be baked into the worker Docker image (§12).

## Files to create / modify
- `apps/api/src/livekit/token.ts` — new. `mintLivekitAccessToken({ roomName, identity, name })` → JWT string. Wraps `AccessToken` from `livekit-server-sdk`; grants `roomJoin: true`, `room: roomName`, `canPublish: true`, `canSubscribe: true`, `canPublishData: true`. TTL 1h.
- `apps/api/src/routes/meetings.ts` — add `POST /meetings/:id/join` and `POST /meetings/:id/leave`. Join handler:
  1. Reject `ended` / `cancelled` with 409.
  2. `assertCanAccess(user, meeting)` — host or accepted invitee.
  3. `assertWithinLimits(user)` (stub ok; see §16).
  4. If `meeting.status === 'scheduled'`:
     - If caller is **not** host **and** `started_at` is NULL → 409 ("Meeting has not started yet. Ask the host to start it.").
     - If caller **is** host **and** `started_at` is NULL → `update({ started_at: now() })`. **Do not** change status — the worker will transition `scheduled → live` when it observes a real participant.
  5. Compute `identity = user.id`, `name = user.display_name`.
  6. `const token = await mintLivekitAccessToken({ roomName: meeting.livekit_room, identity, name })`.
  7. Return `{ livekit_url: process.env.LIVEKIT_URL, livekit_token: token }`.
  `POST /meetings/:id/join-guest` follows the same rule for non-hosts: allowed iff `started_at` is set.
- `apps/api/.env.example` — add `LIVEKIT_URL=`, `LIVEKIT_API_KEY=`, `LIVEKIT_API_SECRET=`.
- `apps/web/src/pages/MeetingRoomPage.tsx` — new. On mount: `useMutation(() => api.post('/meetings/:id/join'))`. While pending, show spinner. On success, render `<LiveKitRoom serverUrl={url} token={token} connect video audio onDisconnected={() => navigate('/dashboard')}><VideoConference /></LiveKitRoom>`.
- `apps/web/src/routes.ts` — register `/meetings/$id/room`.
- `apps/web/package.json` — add `livekit-client`, `@livekit/components-react`, `@livekit/components-styles`.
- `apps/api/package.json` — add `livekit-server-sdk`.
- `packages/shared/src/meetings.ts` — add `JoinMeetingResponseSchema = z.object({ livekit_url: z.string().url(), livekit_token: z.string() })`.

## Implementation notes
- The `identity` passed to the token MUST be `user.id` (ULID), not email — the worker relies on `participant.identity` being stable (§7.5).
- `name` is the human-readable display name used in captions later.
- The join endpoint is **idempotent**: repeated host joins are no-ops on `started_at` (set-once); repeated non-host joins on a `scheduled` meeting with `started_at` set just mint fresh tokens. Never 409 on "already live".
- Do NOT leak `LIVEKIT_API_SECRET` anywhere in a response body, log line, or error message.
- Import CSS once globally: `import '@livekit/components-styles'` in `apps/web/src/main.tsx`.
- `VideoConference` prebuilt handles the whole grid, mic/cam toggles, leave button. Do not build a custom grid in this module — that's premature.
- The `/meetings/:id/leave` endpoint for MVP just returns 204; it's a no-op placeholder so the frontend can call it on unmount without failing. Status is NOT flipped back to `scheduled` on leave (that happens when the room empties, handled by the worker in M22+).
- `assertCanAccess` may not exist yet when you wire this module — if so, stub it as `resource.user_id === user.id` and leave a TODO pointing at §15.

## Acceptance criteria
- [ ] `POST /meetings/:id/join` on a scheduled meeting returns a 200 with a non-empty `livekit_token` and the configured `livekit_url`.
- [ ] The returned token decodes (jwt.io) to a payload with `video.room === meeting.livekit_room`, `video.roomJoin === true`, and `exp` ~1 hour in the future.
- [ ] After the host's first join, the meeting row has `started_at` set and `status` still equals `scheduled` (the worker will flip it to `live` later; at this module we have no worker yet).
- [ ] A non-host calling `/join` on a `scheduled` meeting with `started_at` NULL gets 409. Once the host has joined once and `started_at` is set, the same non-host call returns 200.
- [ ] Calling join a second time on the same meeting returns a fresh token and does not error.
- [ ] `/meetings/:id/room` in two Chrome tabs (two different users, or same user two tabs with different identities) renders two video tiles and audio passes both ways.
- [ ] Grep confirms `LIVEKIT_API_SECRET` appears only in `apps/api/` and `.env.example` — not in `apps/web/` or `apps/worker/`.

## Smoke test
1. `pnpm --filter api dev` and `pnpm --filter web dev`.
2. Log in as user A, create a meeting, click Join on `/meetings/:id`.
3. Grant mic/cam. Confirm you see your own tile in the prebuilt `VideoConference`.
4. Open an incognito window, sign up as user B, accept the invite (or share the meeting ID directly for MVP), click Join.
5. Confirm both tiles visible, audio bidirectional. Use `--chrome` testing per CLAUDE.md.
6. Curl the endpoint with an expired JWT → 401. Curl as a non-invited user → 403.

## Do NOT
- Do NOT mint the LiveKit token in the frontend. Secret stays server-side.
- Do NOT reuse our auth JWT as the LiveKit token.
- Do NOT dispatch the worker from this module — that is M22.
- Do NOT build a custom video grid; use `VideoConference` prebuilt.
- Do NOT set token TTL > 1 hour.
- Do NOT log the minted token.

## Hand-off
M22 will extend `POST /meetings/:id/join` to additionally check `meeting.worker_job_id` and call `AgentDispatchClient.createDispatch(...)` (storing the returned `dispatch.id` back on the meeting row) right after the token is minted. Leave a `// TODO(M22): dispatch worker here` comment at the exact line.
M30 / M31 will wire the worker side: worker sets `status = 'live'` on first non-agent participant and `status = 'ended'` on room empty. No changes to this module's route logic are needed for that.
M34 will add a `<LiveCaptions />` child component inside `<LiveKitRoom>` that listens on `RoomEvent.DataReceived` — keep the room page structured so adding a child is trivial.
