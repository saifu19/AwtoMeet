## M31 — Message Buffer + Transcript Persistence
Wave: 3    Owner: <unassigned>    Branch: feat/m31-buffer-persist
Depends on: M30, M01    Blocks: M32, Wave 4    plan.md refs: §7.2, §4, §7.1

## Goal
Implement `apps/worker/src/buffer.py`'s `MessageBuffer` class — a per-meeting, thread-safe accumulator that collects `Message` objects from all speakers and flushes them on any of three conditions: `max_messages` reached, silence timeout exceeded, or meeting ending. On flush, the buffer (a) persists the flushed messages to the MySQL `transcript_messages` table, and (b) calls an `on_flush` callback (which Wave 4 will use for agent fanout — for this module the callback is optional and unused).

**`apps/worker/src/db.py` already exists** as of M30 and owns the worker's meeting-lifecycle DB writes (`register_worker`, `mark_meeting_live`, `deregister_worker`) using **pymysql** with `init_command="SET time_zone = '+00:00'"` to match the API's `timezone: 'Z'` pool. In this module, extend that same `db.py` with a `TranscriptMessage` write path (`persist_messages(meeting_id, msgs)`) and a read helper to resolve `buffer_size` from the meeting's `meeting_type`. Stay on pymysql for consistency — do not introduce a second DB driver. Do not add SQLAlchemy here unless you're prepared to migrate the existing pymysql functions to it in the same PR.

Wire everything together: a single `MessageBuffer` is created in `entrypoint()` once per meeting, `attach_transcription` pushes `Message`s into it via `on_paragraph`, and an asyncio task periodically calls `buffer.maybe_flush_on_silence()` every ~500ms.

## Context (inlined from plan.md)
From §7.2, the canonical `MessageBuffer`:

```python
from dataclasses import dataclass, field
from typing import Callable, Awaitable
import asyncio, time

@dataclass
class Message:
    speaker_identity: str
    speaker_name: str
    text: str
    start_ts_ms: int
    end_ts_ms: int

@dataclass
class MessageBuffer:
    on_flush: Callable[[list[Message]], Awaitable[None]]
    max_messages: int = 10
    silence_ms: int = 1500
    _buf: list[Message] = field(default_factory=list)
    _last_speaker: str | None = None
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    async def add(self, msg: Message):
        async with self._lock:
            self._buf.append(msg)
            if len(self._buf) >= self.max_messages:
                await self._flush_locked()

    async def maybe_flush_on_silence(self):
        # called periodically; flush if buffer non-empty and quiet long enough
        async with self._lock:
            if not self._buf:
                return
            now_ms = int(time.time() * 1000)
            if now_ms - self._buf[-1].end_ts_ms > self.silence_ms * 4:
                await self._flush_locked()

    async def _flush_locked(self):
        if not self._buf:
            return
        msgs, self._buf = self._buf, []
        await self.on_flush(msgs)
```

Key notes from §7.2: "The buffer is **per meeting, not per agent.** A single buffer collects from all speakers; on flush it hands the same list to every agent in the fanout."

From §4, the `transcript_messages` schema:
```
transcript_messages
  id              bigint pk auto_increment
  meeting_id      char(26) fk
  speaker_identity varchar(255)
  speaker_name    varchar(255)
  text            text
  start_ts_ms     bigint
  end_ts_ms       bigint
  created_at      datetime
  index (meeting_id, id)
```

From §4: "The Python worker reads/writes the same tables via `sqlalchemy` (read-only for most tables; write to `transcript_messages`, `agent_runs`, `agent_outputs`)." So we model `TranscriptMessage` in SQLAlchemy matching the Drizzle schema — do not run migrations from Python, Drizzle owns DDL.

From §4, `buffer_size` lives on `meeting_types`, not `agents`: "**buffer_size is per-meeting-type, not per-agent.** ... One shared buffer per meeting." The worker should read `meeting_types.buffer_size` (joined via the meeting row) when instantiating the buffer. If the meeting has no `meeting_type_id`, default to `buffer_size = 10`.

## Files to create / modify
- `apps/worker/src/db.py` — **extend, don't replace.** As of M30, this file already exports `_get_connection()` (pymysql, `SET time_zone = '+00:00'`), `register_worker`, `mark_meeting_live`, `deregister_worker`. Add to it:
  - `get_buffer_size(meeting_id: str) -> int` — `SELECT mt.buffer_size FROM meetings m LEFT JOIN meeting_types mt ON m.meeting_type_id = mt.id WHERE m.id = %s`. Returns `10` if no meeting type or NULL.
  - `persist_messages(meeting_id: str, msgs: list[Message]) -> None` — inserts the whole batch with `executemany` into `transcript_messages`. Pass an explicit `created_at = datetime.now(timezone.utc).replace(tzinfo=None)` per row so timestamps agree with the API's `timezone: 'Z'` pool. Never `NOW()`.
- `apps/worker/src/buffer.py` — **extend** the existing `Message` dataclass (added in M30) with the full `MessageBuffer` class from plan.md §7.2. Do NOT redefine or move `Message`.
- `apps/worker/src/main.py` — in `entrypoint`, after the existing `register_worker(meeting_id, job_id)` call from M30:
  1. Call `buffer_size = get_buffer_size(meeting_id)`.
  2. Create a single `buffer = MessageBuffer(on_flush=make_on_flush(meeting_id), max_messages=buffer_size)`.
  3. `make_on_flush(meeting_id)` returns an async closure that first calls `persist_messages(meeting_id, msgs)` then (placeholder for Wave 4) does nothing else. Wrap the call in `await asyncio.to_thread(persist_messages, ...)` so blocking pymysql doesn't stall the event loop — flushes are hot-path at scale.
  4. **Replace** the M30 `PrintSink` instance with `buffer` in the `attach_transcription(...)` call — the buffer satisfies the same `ParagraphSink` protocol (`async def on_paragraph(self, msg)` which calls `await self.add(msg)`).
  5. Spawn a periodic flusher task:
     ```python
     async def silence_watcher():
         try:
             while True:
                 await asyncio.sleep(0.5)
                 await buffer.maybe_flush_on_silence()
         except asyncio.CancelledError:
             pass
     silence_task = asyncio.create_task(silence_watcher())
     ```
  6. Shutdown uses an `asyncio.Event` sentinel, **not** `ctx.create_task` inside the sync `on_disconnected` handler. The LiveKit event callback is sync and cannot `await`; scheduling cleanup as a background task is racy because the framework may tear down the loop before the flush finishes. Instead:
     - `on_disconnected` only calls `disconnect_event.set()`.
     - `on_leave` (participant_disconnected) must **not** call `deregister_worker` — only `ctx.room.disconnect()`, which fires `on_disconnected` and sets the sentinel. Having both paths call `deregister_worker` would mark the meeting `ended` **before** the final flush, violating the ordering rule below.
     - At the tail of `entrypoint`, `await disconnect_event.wait()` then run cleanup in a `finally` block, awaited inline, in this exact order: **cancel STT tasks → cancel silence_task → `gather(..., return_exceptions=True)` → `await buffer.flush()` → `deregister_worker(meeting_id)`**. This guarantees the tail of the meeting is persisted before the worker job exits. Wrap the `buffer.flush()` call in its own try/except and log-but-continue so `deregister_worker` still runs if the final flush hits a DB error — losing ~10 tail messages is acceptable, leaving the meeting stuck in `live` is not.
- `apps/worker/pyproject.toml` — **no new DB deps.** Keep `pymysql` and `sqlalchemy` as already declared; we only actually use pymysql in `db.py`.

## Implementation notes
- The `silence_ms * 4` check in the canonical code is deliberate: it means "flush only if the last message ended more than 6s ago" which matches roughly "the speaker is clearly done with their turn." Preserve this.
- `created_at` is UTC, explicit parameter, `datetime.now(timezone.utc).replace(tzinfo=None)`. Never `NOW()` in SQL — it resolves to the MySQL server's session timezone and will mis-match the API's `timezone: 'Z'` pool. This is the same rule M30 already follows; keep it.
- The buffer is SHARED across all `attach_transcription` coroutines for a meeting. Concurrency safety is handled by `_lock`. Do not create one buffer per participant.
- `persist_messages` should insert the whole batch in ONE `cursor.executemany(...)` — not a loop of single inserts.
- On DB error during flush: log, re-raise, and let the coroutine crash. The worker process will restart via Fly's supervisor. Transcript loss of ~10 messages is acceptable for MVP.
- Add a `public async def flush(self) -> None` wrapping `async with self._lock: await self._flush_locked()` so `main.py` can force-flush on room disconnect without touching the private method.
- `buffer_size` is an `int` column with default 10 in §4. Treat `None` as 10.
- **Order of shutdown in `on_disconnected`**: cancel transcription tasks → `await buffer.flush()` → `deregister_worker(meeting_id)`. The flush must happen **before** `deregister_worker` marks the meeting `ended`, otherwise you're writing transcript messages to an already-ended meeting (which still works — there's no FK check — but it's confusing).

## Acceptance criteria
- [ ] A meeting with 10+ paragraphs produces rows in `transcript_messages` with correct `meeting_id`, `speaker_identity`, `speaker_name`, `text`, `start_ts_ms`, `end_ts_ms`.
- [ ] Filling the buffer to `max_messages` (default 10) triggers an immediate flush — verified by row count jumping by 10.
- [ ] A single paragraph followed by 6+ seconds of silence is flushed by `maybe_flush_on_silence` — verified by a row appearing after the silence, not held indefinitely.
- [ ] Ending the meeting (browser tabs close) persists any remaining buffered messages before the worker job exits.
- [ ] Two concurrent `attach_transcription` tasks pushing into the same buffer do not drop or reorder messages (ordering by `id` matches order of `add` calls).
- [ ] No `MessageBuffer` instance is created per participant — grep for `MessageBuffer(` shows exactly one call site in `main.py`.

## Smoke test
1. Ensure the host's local MySQL is running and apply migrations (`pnpm --filter api db:push`).
2. Start API + worker + web.
3. Join a meeting, speak ~12 short sentences, leave.
4. `SELECT * FROM transcript_messages WHERE meeting_id = '<id>' ORDER BY id;` — expect 12 rows with monotonic `start_ts_ms`.
5. Repeat with two speakers alternating. Verify each row's `speaker_identity` matches the correct user ULID.
6. Trigger silence flush: speak one sentence, then stay silent for 10s — confirm one row appears after the silence.

## Do NOT
- Do NOT run DDL from Python. Drizzle owns schema. Python writes are runtime-only.
- Do NOT create a `MessageBuffer` per agent or per participant — one per meeting (§7.2, §13.6).
- Do NOT add the agent fanout here. The `on_flush` closure's only job in M31 is `persist_messages`. Wave 4 will extend it.
- Do NOT switch MySQL driver to Postgres "because it's easier." Plan §12: use `langgraph-checkpoint-mysql`, stay on MySQL.
- Do NOT make `on_flush` optional-by-None — always pass a real coroutine.
- Do NOT introduce SQLAlchemy/asyncmy/aiomysql alongside the existing pymysql in `db.py`. Pick one. M30 shipped with pymysql; stay there unless you're rewriting the M30 functions in the same PR.
- Do NOT redefine the `Message` dataclass — it already exists from M30.
- Do NOT use `NOW()` / `CURRENT_TIMESTAMP` in SQL for any timestamp the API will later read. Pass explicit UTC datetimes as parameters.

## Hand-off
M32 will read from `transcript_messages` via the Node API and stream new rows to the dashboard over SSE. The Node side uses Drizzle against the same table — no coordination needed beyond the shared schema.
Wave 4 will extend `make_on_flush` in `main.py` to also invoke `AgentFanout.on_buffer_flush(msgs)` after persistence. Keep the closure structured for easy extension.
