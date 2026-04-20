## M32 — SSE Live Stream Endpoint
Wave: 3    Owner: <unassigned>    Branch: feat/m32-sse-endpoint
Depends on: M31    Blocks: M33    plan.md refs: §6, §1

## Goal
Implement `GET /meetings/:id/stream` on the Fastify API as a **Server-Sent Events** endpoint. It holds an open HTTP connection per dashboard tab, polls MySQL every ~1 second for new `transcript_messages` and `agent_outputs` rows belonging to that meeting where `id > last_seen_id`, and pushes them as named SSE frames (`event: transcript` or `event: insight`). Also implement the two companion snapshot endpoints `GET /meetings/:id/transcript` and `GET /meetings/:id/insights` that return the full state-so-far — the frontend uses those for initial hydration before subscribing to the stream.

At this milestone `agent_outputs` will always be empty (Wave 4 populates it), but the endpoint MUST already handle and emit `insight` events so the frontend in M33 does not need a follow-up change.

## Context (inlined from plan.md)
From §6: "**SSE stream** (`GET /meetings/:id/stream`): the API holds an open connection per dashboard tab. It polls the DB every 1s for new `transcript_messages` and `agent_outputs` for that meeting where `id > last_seen_id` and pushes them as `event: transcript` / `event: insight` SSE frames. (Polling is fine for MVP scale of 10 users. Later: replace with MySQL CDC or Redis pub/sub.)"

From §6 route list:
```
GET /meetings/:id/transcript   # full so far
GET /meetings/:id/insights     # all agent_outputs so far
GET /meetings/:id/stream (SSE) # live transcript + insights events
```

From §1: the overall data flow is `worker → MySQL → API SSE → dashboard`. The API never talks to the worker directly.

From §13 invite access control: "Access to `/meetings/:id/insights` is gated by `can_view_insights = true` on their invite row (or being the host)." This gate applies to all three endpoints in this module — transcript, insights, and stream.

## Files to create / modify
- `apps/api/src/routes/meetings.ts` — add the three routes.
- `apps/api/src/sse/stream.ts` — new helper. Encapsulates the SSE framing + poll loop so the route handler stays thin. Exports:
  ```ts
  export async function streamMeetingEvents(
    reply: FastifyReply,
    opts: { meetingId: string; lastTranscriptId: number; lastInsightId: number }
  ): Promise<void>
  ```
  It sets headers `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no`. Then loops:
  1. `await sleep(1000)`.
  2. Query new rows: `SELECT * FROM transcript_messages WHERE meeting_id=? AND id>? ORDER BY id LIMIT 500` and same for `agent_outputs`.
  3. For each row, write `event: transcript\ndata: <json>\n\n` (or `event: insight`).
  4. Update `lastTranscriptId` / `lastInsightId`.
  5. Emit a `event: ping\ndata: {}\n\n` heartbeat every ~15s so proxies don't cut the connection.
  6. Exit when `reply.raw.destroyed` or the meeting status becomes `ended`.
- `apps/api/src/db/queries/transcript.ts` — `getTranscript(meetingId)` and `getTranscriptSince(meetingId, lastId)`.
- `apps/api/src/db/queries/insights.ts` — `getInsights(meetingId)` and `getInsightsSince(meetingId, lastId)` joining `agent_outputs` with `agents` for `agent_name`.
- `apps/api/src/auth/meetingAccess.ts` — `assertCanViewInsights(user, meeting)` — true if host OR invite row has `can_view_insights=true`.
- `packages/shared/src/insights.ts` — zod schemas for the wire format of the SSE events:
  ```ts
  export const TranscriptEventSchema = z.object({
    id: z.number(), meeting_id: z.string(), speaker_identity: z.string(),
    speaker_name: z.string(), text: z.string(),
    start_ts_ms: z.number(), end_ts_ms: z.number(), created_at: z.string()
  });
  export const InsightEventSchema = z.object({
    id: z.number(), meeting_id: z.string(), agent_id: z.string(),
    agent_name: z.string(), content: z.string(),
    metadata: z.any().nullable(), created_at: z.string()
  });
  ```

## Implementation notes
- Fastify's raw response is `reply.raw` (a Node `ServerResponse`). To do SSE cleanly: call `reply.hijack()` before writing headers, then `reply.raw.writeHead(200, { ... })` and `reply.raw.write('event: ...')`. Do NOT return from the handler normally — return a never-resolving promise or explicitly `reply.raw.end()` when the loop exits.
- The `lastTranscriptId` / `lastInsightId` query params allow a reconnecting client to resume without dupes: `GET /meetings/:id/stream?last_transcript_id=42&last_insight_id=7`. Parse as optional ints, default 0.
- Poll interval: `1000ms` per §6. Do not lower it to "be more real-time" — 1s is fine for MVP, and lower just hammers MySQL.
- `LIMIT 500` per poll is a safety cap. If a poll returns exactly 500, immediately re-poll without the sleep to drain.
- The heartbeat comment-line alternative is `:\n\n`. We use a named `ping` event because the frontend will ignore unknown event types.
- Handle the `request.raw.on('close', ...)` event to terminate the loop when the client disconnects — otherwise you leak poll tasks.
- Access control: run `assertCanViewInsights` BEFORE hijacking — if it throws, return a normal 403.

## Acceptance criteria
- [ ] `GET /meetings/:id/transcript` returns `{ messages: [...] }` with all rows so far, ordered by id.
- [ ] `GET /meetings/:id/insights` returns `{ insights: [...] }` (empty array in Wave 3, populated in Wave 4).
- [ ] `GET /meetings/:id/stream` returns `Content-Type: text/event-stream` and does not close immediately.
- [ ] While a meeting is live, new `transcript_messages` rows appear as `event: transcript` frames on the stream within ~2 seconds of insertion.
- [ ] A ping event is emitted at least once per 20 seconds.
- [ ] Closing the browser tab / `curl --max-time 5` terminates the server-side poll loop (verified via logs showing no further queries).
- [ ] A non-invited user gets `403` on all three endpoints.
- [ ] Reconnecting with `?last_transcript_id=N` skips already-seen rows.

## Smoke test
1. Join a meeting in one tab, let the worker write a few `transcript_messages`.
2. In another terminal: `curl -N -H "Authorization: Bearer <token>" http://localhost:3001/meetings/<id>/stream`.
3. Keep speaking in the browser. Confirm `event: transcript` frames appear in the curl output roughly once per second.
4. `curl http://localhost:3001/meetings/<id>/transcript` → snapshot JSON matches what was streamed.
5. Force-insert a fake row into `agent_outputs` via SQL, confirm it appears as `event: insight` on the open curl stream.
6. `Ctrl+C` the curl, confirm server logs show the loop exited without error.

## Do NOT
- Do NOT use WebSockets — plan §3 explicitly picks SSE for simplicity ("Not websockets, simpler.").
- Do NOT push from the worker directly — the worker writes to MySQL, the API polls. Single source of truth.
- Do NOT add Redis pub/sub or MySQL CDC — §6 explicitly defers that optimization.
- Do NOT forget to `reply.hijack()` — without it Fastify will try to auto-send a response and corrupt the stream.
- Do NOT poll faster than 1s.
- Do NOT stream `agent_runs` rows — those are internal bookkeeping, only `agent_outputs` is user-visible.

## Hand-off
M33 builds the `/meetings/:id/insights` dashboard page that opens an `EventSource` against this endpoint, hydrates initial state from `/transcript` + `/insights`, and renders two columns. The wire-format zod schemas in `packages/shared/src/insights.ts` are the contract — M33 imports those verbatim.
Wave 4 will start populating `agent_outputs`; because this endpoint already emits `event: insight`, no changes are needed here.

**Updated during M33 (auth only, no behavior change):** the stream endpoint's preHandler moved from `requireAuth` (bearer header) to `requireStreamAuth` (stream-session cookie). Native `EventSource` cannot set a bearer header, so M33 added a companion `POST /meetings/:id/stream-session` endpoint that the dashboard calls first (with normal bearer auth) to mint a short-lived HttpOnly cookie. The SSE framing, poll loop, heartbeat, drain logic, and cursor params are all unchanged. The `assertCanViewInsights` gate now lives on the stream-session mint endpoint; the stream handler inherits authz from cookie possession (the cookie is minted only after the gate passes). See `apps/api/src/auth/stream-session.ts` and `apps/api/src/plugins/stream-auth.ts` for the new surface.
