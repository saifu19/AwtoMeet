# M41 — Agent fanout
Wave: 4    Owner: <unassigned>    Branch: feat/m41-fanout
Depends on: M40, M12, M13    Blocks: M42, M50, M53    plan.md refs: §7.4, §4, §12

## Goal
Create `apps/worker/src/fanout.py` — the `AgentFanout` class that (a) loads an AI-agent roster ONCE at meeting start from MySQL, (b) owns the single shared `AIOMySQLSaver` checkpointer and the compiled LangGraph for the meeting, (c) on every buffer flush from the paragraph buffer, writes `transcript_messages`, then invokes the compiled graph in parallel for each agent with a unique `thread_id = f"{meeting_id}:{agent_id}"`, (d) persists one `agent_runs` row per invocation plus one `agent_outputs` row per successful run.

## Context (inlined from plan.md)
- Buffer is per-meeting, not per-agent. One flush = same `list[Message]` to every agent.
- Agent rows come from joining `agents` through `meeting_type_agents` via the meeting's `meeting_type_id`. Each row carries `id`, `name`, `system_prompt`, nullable `provider`, nullable `model`. NULLs fall back to `settings.default_provider` / `settings.default_model`.
- `buffer_size` lives on `meeting_types`, NOT on `agents`. Fanout does not read it — the buffer does.
- Isolation contract: each agent's `rolling_summary` must be private. Enforced by `thread_id = f"{meeting_id}:{agent_id}"`. Agent A literally cannot read Agent B's state because the checkpointer keys on thread_id.
- `agent_runs` columns: `id`, `meeting_id`, `agent_id`, `buffer_start_msg_id`, `buffer_end_msg_id`, `status ∈ {pending,running,done,error}`, `error`, `prompt_tokens`, `completion_tokens`, `cost_usd`, `started_at`, `finished_at`.
- `agent_outputs` columns: `id`, `agent_run_id`, `meeting_id` (denormalized for SSE), `agent_id`, `content` (markdown), `metadata` (json), `created_at`.

Reference skeleton:
```python
class AgentFanout:
    def __init__(self, meeting_id: str):
        self.meeting_id = meeting_id
        self.agents: list[AgentRow] = []
        self.checkpointer: AIOMySQLSaver | None = None
        self.graph = None
        self.buffer = MessageBuffer(on_flush=self.on_buffer_flush, max_messages=10)

    async def load_agents(self):
        # SELECT a.* FROM agents a
        # JOIN meeting_type_agents mta ON mta.agent_id = a.id
        # JOIN meetings m ON m.meeting_type_id = mta.meeting_type_id
        # WHERE m.id = :meeting_id
        # also fetch buffer_size from meeting_types and set self.buffer.max_messages
        self.checkpointer = await AIOMySQLSaver.from_conn_string(settings.mysql_url).__aenter__()
        await self.checkpointer.setup()
        self.graph = build_graph(self.checkpointer)

    async def on_buffer_flush(self, msgs: list[Message]):
        first_id, last_id = await persist_transcript_messages(self.meeting_id, msgs)
        formatted = "\n\n".join(f"[{m.speaker_name}] {m.text}" for m in msgs)
        await asyncio.gather(*[self._run_agent(a, formatted, first_id, last_id) for a in self.agents])

    async def _run_agent(self, agent, formatted, first_id, last_id):
        run_id = await create_agent_run(self.meeting_id, agent.id, first_id, last_id)
        cfg = {"configurable": {"thread_id": f"{self.meeting_id}:{agent.id}"}}
        state_in = {
            "system_prompt": agent.system_prompt,
            "provider": agent.provider or settings.default_provider,
            "model": agent.model or settings.default_model,
            "new_buffer_text": formatted,
            "rolling_summary": "",  # overwritten by checkpointer on 2nd+ runs
            "last_output": "",
        }
        try:
            result = await self.graph.ainvoke(state_in, cfg)
            await save_agent_output(run_id, self.meeting_id, agent.id, result["last_output"])
            await mark_run_done(run_id)
        except Exception as e:
            await mark_run_error(run_id, str(e))
```

## Files to create / modify
- **Create:** `apps/worker/src/fanout.py` — `AgentFanout` class plus small DB helpers (or import from `db.py`).
- **Modify:** `apps/worker/src/db.py` — add functions: `load_agents_for_meeting(meeting_id)`, `load_buffer_size(meeting_id)`, `persist_transcript_messages(meeting_id, msgs)`, `create_agent_run(...)`, `save_agent_output(...)`, `mark_run_done(run_id)`, `mark_run_error(run_id, err)`.
- **Modify:** `apps/worker/src/main.py` — instantiate `AgentFanout(meeting_id)`, `await fanout.load_agents()`, pass `fanout` into `attach_transcription`, register `fanout.flush_all_and_finalize()` on room disconnect.
- **Create:** `apps/worker/tests/test_fanout.py` — tests with stubbed graph + in-memory DB.

## Implementation notes
- Open the `AIOMySQLSaver` via `async with AIOMySQLSaver.from_conn_string(...) as cp: await cp.setup()` and keep a reference. Alternatively use `__aenter__` manually as in §7.4 — just remember to call `__aexit__` in `flush_all_and_finalize`.
- `load_agents()` must be called EXACTLY ONCE per meeting, at room-connect time. Do not reload mid-meeting. Leave a `# FUTURE: hot reload via room data message` marker where a reload would go.
- The fanout OWNS the `MessageBuffer`. The buffer's `on_flush` callback is `self.on_buffer_flush`. Override `max_messages` from `meeting_types.buffer_size`.
- `on_buffer_flush` must persist transcript rows BEFORE invoking agents (so SSE can emit transcript immediately and agents can reference stable message IDs).
- Run agents in parallel with `asyncio.gather`. A failure in one agent must NOT cancel the others — handle exceptions per-agent and mark that run's status = 'error'.
- Capture token usage from `AIMessage.usage_metadata` (if present) and write it to `agent_runs.prompt_tokens` / `completion_tokens`. Cost computation is M53 — leave `cost_usd = NULL` here.
- `flush_all_and_finalize()`: flush any pending buffer contents, await outstanding agent runs, close the checkpointer, update `meetings.status = 'ended'` and `ended_at = now()`.

## Acceptance criteria
- [ ] `AgentFanout.load_agents()` populates `self.agents` from MySQL and compiles a graph bound to the shared checkpointer.
- [ ] Each flush produces exactly one row in `transcript_messages` per input `Message`, exactly one row in `agent_runs` per agent, and exactly one row in `agent_outputs` per successful run.
- [ ] Inspect `checkpoints` table — there is one thread per `(meeting_id, agent_id)` pair. Two agents on the same meeting never share a row.
- [ ] Killing one agent's invocation (simulated exception) does NOT affect other agents on the same flush; its `agent_runs.status = 'error'` with the error message recorded.
- [ ] No code path reloads `self.agents` after `load_agents()` returns.

## Smoke test
1. Seed MySQL with 1 meeting, 1 meeting_type with `buffer_size=3` and two agents (one OpenAI, one Anthropic).
2. Dispatch the worker, join the LiveKit room from two browser tabs, speak 3+ sentences.
3. Check MySQL: `transcript_messages` has rows, `agent_runs` has 2 rows per flush, `agent_outputs` has 2 matching content rows, `checkpoints` has exactly 2 distinct `thread_id`s for this meeting.

## Do NOT
- Do NOT let agents see each other's outputs. Enforced by per-agent `thread_id`. (plan.md §12)
- Do NOT reload agents or `buffer_size` mid-meeting. (plan.md §12, §13.5)
- Do NOT merge audio from multiple participants into a single STT stream. Not your concern, but don't "help" transcription here.
- Do NOT swallow exceptions silently. Every failure must land in `agent_runs.error`.
- Do NOT open a new checkpointer per agent — one per meeting, shared.
- Do NOT block the buffer's `on_flush` awaiting all agents serially; use `asyncio.gather`.

## Hand-off
- M42 consumes `agent_outputs` via SSE and renders per-agent tabs.
- M50 reads `transcript_messages` after `flush_all_and_finalize` to produce the post-meeting summary.
- M53 backfills `cost_usd` on `agent_runs` and upserts `usage_counters`.
