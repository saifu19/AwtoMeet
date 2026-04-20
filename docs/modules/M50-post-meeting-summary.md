# M50 — Post-meeting summary
Wave: 5    Owner: <unassigned>    Branch: feat/m50-post-meeting-summary
Depends on: M41    plan.md refs: §7.6, §8.1, §4

## Goal
Generate a structured post-meeting summary keyed to the meeting type's fixed agenda items. When a meeting ends (room empties OR `POST /meetings/:id/end` is called), the worker loads the full `transcript_messages` for that meeting plus the meeting type's `agenda_items`, calls one LLM with a structured-output prompt, and writes a single row to `meeting_summaries` (`{ agenda_findings: {...}, raw_summary: "..." }`). The frontend renders `/meetings/:id/summary` as a read-only page.

## Context (inlined from plan.md)
- `meeting_types.agenda_items` is a JSON array of strings, e.g. `["pricing", "next steps", "blockers"]`. Set when the meeting type is created.
- `meeting_summaries` schema: `id`, `meeting_id` (unique), `agenda_findings` (json, shape `{ "pricing": "...", "next steps": "..." }`), `raw_summary` (text), `generated_at`.
- Independent of AI agents. Uses the default LLM (`DEFAULT_LLM_PROVIDER` + `DEFAULT_LLM_MODEL`). It is NOT a LangGraph run and does NOT use checkpointers.
- Trigger: the room `disconnected` handler in `main.py` calls `fanout.flush_all_and_finalize()`, which in turn should call into `summary.generate_for(meeting_id)`. Alternatively, `POST /meetings/:id/end` sets `meetings.status='ended'` and the worker polls; pick one path and stick to it — recommend calling directly from `flush_all_and_finalize()`.
- Frontend page `/meetings/:id/summary` per §8.1: shows the agenda findings (one section per agenda item, markdown) and the full transcript below.

## Files to create / modify
- **Create:** `apps/worker/src/summary.py` — `async def generate_for(meeting_id: str)`. Loads meeting + meeting_type, pulls all `transcript_messages`, constructs prompt, calls LLM, writes `meeting_summaries` row (UPSERT on `meeting_id`).
- **Modify:** `apps/worker/src/fanout.py` — call `await generate_for(self.meeting_id)` at the end of `flush_all_and_finalize()`.
- **Create (API):** `GET /meetings/:id/summary` route — returns the `meeting_summaries` row (404 if not yet generated) plus the meeting title + agenda items.
- **Create (Web):** `apps/web/src/pages/meetings/summary.tsx` — calls the endpoint on mount, renders headings per agenda item with markdown content, transcript below.
- **Modify (Web):** meeting detail page — show a "View summary" link when `meeting.status === 'ended'`.

## Implementation notes
- Prompt skeleton:
  > You are summarizing a meeting. Given the full transcript and an agenda, produce one finding per agenda item, plus a brief overall summary. Return JSON: `{"agenda_findings": {"<item>": "<markdown>", ...}, "raw_summary": "<markdown>"}`. For agenda items with no discussion, return an empty string.
- Use the model's JSON / structured-output mode (`response_format={"type":"json_object"}` for OpenAI, or a pydantic schema via `langchain_core`). Validate with pydantic; on parse failure, log and store `raw_summary` only with `agenda_findings = {}`.
- Transcript may be long. For MVP assume meetings are ≤1 hour and fit within context. If it doesn't fit, chunk by N messages, summarize each chunk, then summarize-of-summaries. Do NOT over-engineer this for MVP — a single prompt is fine up to ~60 min meetings with gpt-4o-mini.
- If the meeting has no `meeting_type_id` (soft-detached or never set), use `agenda_items = []` and just produce `raw_summary`.
- UPSERT: `INSERT ... ON DUPLICATE KEY UPDATE` so re-running is idempotent.
- The worker finalize path runs once, but add an idempotency guard: if `meeting_summaries` row already exists and was generated <5 min ago, skip.

## Acceptance criteria
- [ ] Ending a meeting with a meeting type and agenda items produces one `meeting_summaries` row.
- [ ] `agenda_findings` has a key for every agenda item; missing items have empty string, not omitted.
- [ ] `GET /meetings/:id/summary` returns 404 before generation and 200 after.
- [ ] `/meetings/:id/summary` page renders agenda findings as headed markdown sections plus the full transcript.
- [ ] Re-ending the same meeting does not create duplicate rows.
- [ ] A meeting with no meeting type still gets a `raw_summary` (just no agenda sections).

## Smoke test
1. Create a meeting type with `agenda_items = ["pricing", "next steps"]`.
2. Run a meeting, speak about both topics, end the meeting (close both browser tabs).
3. `GET /meetings/:id/summary` returns JSON with both agenda keys populated.
4. Visit `/meetings/:id/summary` — see both sections rendered.

## Do NOT
- Do NOT use LangGraph or a checkpointer here. This is a one-shot LLM call.
- Do NOT tie this to any specific AI agent or its rolling_summary. This is meeting-level, not agent-level.
- Do NOT generate the summary mid-meeting.
- Do NOT run this in the API process — it is a worker concern.
- Do NOT fail the entire `flush_all_and_finalize` path if summary generation throws. Log and move on.

## Hand-off
After this ships, M51 (auto-classify) and M52 (invites) are the last two user-facing gaps before deploy.
