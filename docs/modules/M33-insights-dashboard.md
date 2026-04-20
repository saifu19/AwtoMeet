## M33 — Live Insights Dashboard Page
Wave: 3    Owner: <unassigned>    Branch: feat/m33-insights-dashboard
Depends on: M32, M11    Blocks: M42    plan.md refs: §8.3, §6, §8.1

## Goal
Build the `/meetings/:id/insights` page in `apps/web`. It opens in a separate browser tab (via `window.open(...)` from the room page), hydrates initial transcript + insights from the snapshot endpoints, then subscribes to `GET /meetings/:id/stream` via native `EventSource` and renders a two-column live layout:

- **Left column** — live transcript: chronological list of `transcript_messages`, scrolled to bottom, newest at bottom.
- **Right column** — agent insights: tabs per agent, each tab a chronological feed of that agent's `agent_outputs` rendered as markdown.

For this Wave 3 milestone the insights column will be empty (Wave 4 populates `agent_outputs`) — ship it with **transcript-only as the functional milestone** and a clearly empty "No agent insights yet" state in the right column. The component MUST already handle the `insight` event type so Wave 4 needs zero frontend changes.

## Context (inlined from plan.md)
From §8.1: `/meetings/:id/insights — live dashboard, opens in new tab while meeting is running`.

From §8.3: "Opens in a separate tab via `window.open('/meetings/:id/insights', '_blank')`. Subscribes to `GET /meetings/:id/stream` (SSE) using native `EventSource`. Renders two columns:
- **Live transcript** (left): chronological list of `transcript_messages`.
- **Agent insights** (right): tabs per agent, each tab is a chronological feed of that agent's `agent_outputs`. Markdown rendered."

From §11 step 13: "Insights SSE endpoint + dashboard page: **transcript only, no agents yet.** Open in second tab during a call, see live transcript." — this is the explicit milestone.

From §6, the three endpoints the dashboard consumes:
- `GET /meetings/:id/transcript` — snapshot
- `GET /meetings/:id/insights` — snapshot
- `GET /meetings/:id/stream` — SSE live

Access gate (§13.2): user must be the host OR an invitee with `can_view_insights = true`. The API enforces this; the frontend just needs to handle 403 gracefully.

## Files to create / modify

### Backend (API) — stream-session cookie auth
- `apps/api/src/auth/stream-session.ts` — new. `signStreamSession(sub, meetingId)` and `verifyStreamSession(token)` using `jose` with 60s TTL, `kind:'stream'` claim, and `meeting_id` claim.
- `apps/api/src/plugins/stream-auth.ts` — new. `requireStreamAuth` preHandler reading the `stream_session` cookie, verifying the JWT, and asserting the payload's `meeting_id` matches the route `:id` param. Used ONLY on `GET /meetings/:id/stream`; every other route keeps `requireAuth`.
- `apps/api/src/routes/meetings.ts` — add `POST /meetings/:id/stream-session` (bearer-gated, asserts `can_view_insights`, mints the cookie with `httpOnly`, `sameSite:'lax'`, `secure` in prod, `maxAge: 60`, `path` scoped to `/<prefix>/:id/stream`) AND `GET /meetings/:id/agents` (insights-gated, returns the meeting type's attached agents so invited viewers can populate the right-column tabs without needing host-only access to `/meeting-types/:id` or `/agents/:id`). Switch `GET /meetings/:id/stream`'s preHandler from `requireAuth` to `requireStreamAuth`.
- `apps/api/src/repositories/meetings.ts` — add `getAgentsForMeeting(meetingId)` joining `meeting_type_agents` → `agents`.

### Frontend (Web)
- `apps/web/src/routes/_auth/meetings/$id/insights.tsx` — new. File-based route registered automatically by TanStack Router under the `_auth` layout guard.
- `apps/web/src/hooks/useMeetingStream.ts` — custom hook:
  ```ts
  export function useMeetingStream(meetingId: string) {
    const [transcript, setTranscript] = useState<TranscriptMessageSchema[]>([]);
    const [insights, setInsights] = useState<AgentOutputSchema[]>([]);
    const [status, setStatus] = useState<
      'connecting'|'live'|'reconnecting'|'error'|'closed'
    >('connecting');
    // 1. Fetch snapshots in parallel from /transcript and /insights.
    // 2. POST /meetings/:id/stream-session (bearer auth) to mint the 60s cookie.
    // 3. Open EventSource at /meetings/:id/stream?last_transcript_id=<maxId>
    //    &last_insight_id=<maxId> with { withCredentials: true }.
    // 4. Listen for 'transcript', 'insight', 'ping' events; append to state.
    // 5. On error: es.close() immediately (disable native auto-reconnect —
    //    it would retry with the dead cookie forever), attempt ONE manual
    //    reconnect after 2s by minting a fresh cookie. After second failure,
    //    setStatus('closed').
    // 6. Cleanup: es.close() on unmount.
    return { transcript, insights, status, error };
  }
  ```
- `apps/web/src/features/meetings/insights-hooks.ts` — `useMeetingAgents(meetingId)` React Query hook hitting `GET /meetings/:id/agents`.
- `apps/web/src/components/insights/TranscriptColumn.tsx` — renders the list with sticky speaker labels, auto-scrolls to bottom on new messages (via `useEffect` + a `ref.current?.scrollIntoView({ block: 'end' })`).
- `apps/web/src/components/insights/InsightsColumn.tsx` — tabs per agent using shadcn `<Tabs>`. For each tab, a scrollable feed of `<AgentOutputCard>` items. Empty state: "No agent insights yet — speak for a few seconds to get started." Uses `react-markdown` for `content` rendering.
- `apps/web/src/components/insights/AgentOutputCard.tsx` — timestamped card with markdown body.
- No `router.tsx` edit needed — TanStack Router uses file-based routing; the new route file is picked up automatically and `routeTree.gen.ts` regenerates on dev-server start.
- `apps/web/src/routes/_auth/meetings/$id/index.tsx` — add an "Open Insights" button next to "Join Meeting" that calls `window.open('/meetings/' + id + '/insights', '_blank', 'noopener')`.
- `apps/web/src/routes/_auth/meetings/$id/room.tsx` — add the same "Open Insights" button in the minimal header next to "Leave" (primary entry point during a live call).
- `apps/web/package.json` — add `react-markdown` and shadcn `tabs` component (`pnpm dlx shadcn@latest add tabs`).

## Implementation notes
- `EventSource` is browser-native, no library needed. It **cannot** set an `Authorization` header — it only carries cookies. The dashboard therefore first calls `POST /meetings/:id/stream-session` with the normal bearer token; the API asserts `can_view_insights` and mints a 60-second, HttpOnly, path-scoped `stream_session` cookie (meeting-scoped JWT). Then the dashboard opens `new EventSource(url, { withCredentials: true })` — the browser attaches the cookie and the API's `requireStreamAuth` preHandler validates it once at handshake. The 60-second TTL is deliberate: the cookie's only job is authorizing the handshake, so decoupling its TTL from the 30-minute stream lifetime shrinks the leak window without shortening legitimate sessions. `Access-Control-Allow-Credentials: true` is already set by the API CORS config. **Do not** pass the bearer token as a URL query parameter — tokens in URLs leak into server logs, browser history, and `Referer` headers.
- Hydrate snapshots BEFORE opening the stream, using the max `id` from each snapshot as the `last_*_id` cursor. This avoids duplicates.
- Append new events to state via functional updates: `setTranscript(prev => [...prev, ev])`. For very long meetings (>1000 rows) this is still fine for MVP — no virtualization needed yet.
- Auto-scroll should only fire if the user is already at (or within ~100px of) the bottom — do not yank the view if they scrolled up to read something.
- The insights column tabs should list **all agents attached to the meeting type**, not just the ones that have output so far — fetch via `GET /meetings/:id/agents` (added in this milestone). Do NOT use `/meeting-types/:id` or `/agents/:id`, which are host-ownership gated and would 404 for invited viewers. The new endpoint reuses `assertCanViewInsights`, so host + invitee-with-flag both work. For meetings with no `meeting_type_id` (or a meeting type with zero attached agents), show a single "No agent insights — this meeting has no agents attached" empty-state card.
- The page is intentionally second-tab: `window.open` from the room page. Do not attempt to reuse the same tab — participants need the room to stay visible for video.
- Show a small connection indicator in the header: "Connecting / Live / Reconnecting / Closed" using the `status` from the hook.

## Acceptance criteria
- [ ] From the room page, clicking "Open insights" opens a new tab at `/meetings/:id/insights`.
- [ ] The dashboard shows existing transcript rows immediately (snapshot hydration) and appends new rows live as the speaker talks.
- [ ] Speaker labels are visible on every transcript row with the display name from `speaker_name`.
- [ ] The insights column renders an empty state in Wave 3.
- [ ] Connection status indicator transitions `connecting → live` after the first event or heartbeat.
- [ ] Closing the tab terminates the `EventSource` (verified by the server no longer logging polls for that meeting).
- [ ] A user without `can_view_insights` on their invite lands on an "Access denied" state (the API masks `ForbiddenError` as 404 `not_found` for enumeration safety — see `apps/api/src/plugins/error-handler.ts`), not a stuck "connecting" state.
- [ ] Markdown rendering works for `content` with headings, lists, bold, and code fences.

## Smoke test
1. Start API + worker + web. Create a meeting, join it in Tab A, grant mic.
2. From Tab A, click "Open insights" — Tab B opens the dashboard.
3. Speak in Tab A. Within ~2 seconds, transcript rows appear in Tab B's left column with correct speaker name.
4. Open Tab C as a second participant, speak. Both speakers appear in the transcript with distinct labels.
5. Force-insert an `agent_outputs` row via SQL, tagged with an agent_id attached to this meeting's type. Verify it shows up in the right column under the correct tab with markdown rendered.
6. Close Tab B; confirm API logs show the SSE loop ended.
7. Use `--chrome` per CLAUDE.md for the full flow.

## Do NOT
- Do NOT poll the snapshot endpoints repeatedly — snapshots are for hydration only, the SSE stream is the live source after that.
- Do NOT use a websocket library here — native `EventSource`, per §3 and §8.3.
- Do NOT render the dashboard inside the room page — it opens in a new tab (§8.3).
- Do NOT gate the transcript column behind `can_view_insights` at the frontend level — the API is the source of truth; the frontend just handles the 403.
- Do NOT add virtualization or infinite scroll optimization in this module — transcript lists up to ~2000 items render fine.
- Do NOT ship without the empty-state for agent insights — it has to exist so Wave 4 is purely additive.
- Do NOT `dangerouslySetInnerHTML` raw markdown — use `react-markdown` so Wave 4's agent-authored content is sanitized.

## Hand-off
When Wave 4 begins populating `agent_outputs`, the right column will start filling automatically — no frontend change. M42 (post-meeting summary) will add a "View summary" link to this page once the meeting ends. The `useMeetingStream` hook's `status === 'closed'` on `meeting.status = ended` is the signal to show that link.
