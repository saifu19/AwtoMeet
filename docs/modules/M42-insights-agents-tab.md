# M42 — Insights dashboard: per-agent tabs
Wave: 4    Owner: <unassigned>    Branch: feat/m42-insights-agents-tab
Depends on: M41, M33    plan.md refs: §8.3, §6

## Goal
Extend the existing live-insights dashboard page (built in M33 — transcript-only) with a right-hand column that shows each AI agent's outputs in its own tab. Tab content is a chronological feed of that agent's `agent_outputs.content` rendered as markdown. New outputs stream in via the existing SSE connection (`GET /meetings/:id/stream`) — no new endpoint.

## Context (inlined from plan.md)
- Dashboard route: `/meetings/:id/insights`, opened in a separate browser tab via `window.open(..., '_blank')` while the meeting is running.
- SSE endpoint `GET /meetings/:id/stream` already emits `event: transcript` frames (from M33). This module requires it to ALSO emit `event: insight` frames — one per new `agent_outputs` row.
- Dashboard layout per §8.3: two columns. Left = live transcript chronological list. Right = per-agent tabs. Markdown rendered.
- Access gating: host OR invitee with `can_view_insights = true`. Enforced server-side in M52; the frontend just 403s gracefully.
- SSE polling (API side) already polls every 1s for new rows where `id > last_seen_id`. Add an analogous query for `agent_outputs`.

SSE frame shape (emit from API):
```
event: insight
data: {"id":123,"agent_id":"01H...","agent_name":"Sales Coach","content":"...markdown...","created_at":"..."}
```

## Files to create / modify
- **Modify (API):** `apps/api/src/routes/meetings/stream.ts` (or wherever SSE lives) — in the polling loop, also `SELECT ... FROM agent_outputs JOIN agents ... WHERE meeting_id = ? AND id > ?` and emit `event: insight` frames. Track `last_seen_insight_id` alongside `last_seen_transcript_id`.
- **Modify (API):** add `GET /meetings/:id/insights` endpoint (if not already present) — returns `agent_outputs` joined with `agents.name` for initial backfill on dashboard load.
- **Modify (Web):** `apps/web/src/pages/meetings/insights.tsx` — add right column with shadcn `<Tabs>`, one `<TabsTrigger>` per distinct agent, content is a scrollable feed.
- **Modify (Web):** SSE `EventSource` handler — listen for `event: insight`, append to a `Map<agentId, Output[]>` state.
- **Install:** `react-markdown` + `remark-gfm` in `apps/web` if not present.
- **Create (Web):** `apps/web/src/components/insights/AgentFeed.tsx` — renders a single agent's feed.

## Implementation notes
- On dashboard mount: (1) `GET /meetings/:id/transcript` + `GET /meetings/:id/insights` to backfill; (2) open EventSource for live updates.
- Derive the tab list from the union of agents seen in the backfill + any new `agent_id` seen in SSE. Do NOT pre-fetch the meeting's agent roster separately — the dashboard should work even if an agent never produces output.
- Use shadcn `<Tabs>` already in the project (added in M33 siblings). If not present, `pnpm dlx shadcn@latest add tabs scroll-area`.
- Markdown rendering: `<ReactMarkdown remarkPlugins={[remarkGfm]}>`. Allow headings, lists, code, tables, links. Sanitize with `rehype-sanitize` if feeling paranoid.
- Each feed item shows: timestamp (relative, e.g. "2m ago"), agent name in the tab header (not per-item), content. Auto-scroll to bottom when a new item arrives UNLESS the user has scrolled up.
- Tab state: controlled. Default to the first agent in insertion order. Remember selection in `sessionStorage` keyed by `meeting_id` so opening a second dashboard tab doesn't reset.
- Handle the "no agents yet" empty state with a friendly message.

## Acceptance criteria
- [ ] SSE emits `event: insight` frames for new `agent_outputs` rows in near-real-time (≤2s latency at MVP scale).
- [ ] Dashboard shows one tab per agent that has produced output; tabs appear dynamically as new agents are seen.
- [ ] Switching tabs is instant (no refetch).
- [ ] Markdown renders correctly (headings, lists, code blocks).
- [ ] Transcript column continues to work exactly as in M33 — no regression.
- [ ] Opening the dashboard mid-meeting shows prior outputs (backfill works) then continues streaming.
- [ ] If the user lacks `can_view_insights`, the page shows a 403 message, not a crash.

## Smoke test
1. Start a meeting with a meeting type that has ≥2 agents.
2. Join room from one tab; open `/meetings/:id/insights` in a second tab.
3. Speak several sentences. Verify the transcript column updates on the left AND each agent's tab populates on the right with distinct markdown outputs.
4. Switch tabs back and forth — no flicker, no refetch.
5. Refresh the insights tab — backfill repopulates; streaming resumes.

## Do NOT
- Do NOT show another agent's outputs inside a given agent's tab. Each tab is strictly its own agent's feed. (Reflects §12 isolation principle at the UI layer.)
- Do NOT open a separate SSE connection per tab — one EventSource for the whole page.
- Do NOT render raw HTML from markdown without sanitization.
- Do NOT refetch on every new message — append to in-memory state.
- Do NOT hard-code the agent list. Derive from observed outputs.

## Hand-off
Dashboard is now feature-complete for live use. M50 adds the post-meeting summary page (separate route).
