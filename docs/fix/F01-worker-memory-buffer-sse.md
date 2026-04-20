# F01 — Worker Memory Leak, Buffer Misfiring, SSE Transcript Lag

**Date:** 2026-04-17
**Severity:** Critical (production)
**Discovered:** Real 4-person meeting test (2026-04-16)

---

## Symptoms

1. **Worker memory climbed from ~400MB to 2.5GB** during a single 1-hour meeting
2. **Agents fired every 2-3 messages** instead of respecting `meeting_types.buffer_size`
3. **Insights page transcript lagged** — messages appeared in clumps of 3-4, while live captions were instant

---

## Root Causes

### Memory Leak: LLM HTTP client accumulation (graph.py)

`init_chat_model()` was called inside both LangGraph nodes (`process` and `update_summary`) on **every invocation**. Each call creates a new LangChain LLM instance wrapping `openai.AsyncOpenAI()`, which internally allocates an `httpx.AsyncClient` with a connection pool (100 max connections, 20 keepalive).

With the silence-based flush firing every ~6-10 seconds, a 1-hour meeting with 2 agents generated:
- ~600 flushes x 2 agents x 2 nodes = **~2400 httpx client pools**

These pools were never explicitly closed and accumulated for the lifetime of the worker process.

### Memory Leak: AudioStream never closed (transcription.py)

`rtc.AudioStream(track)` was created per participant but never `aclose()`d. Only the STT stream was closed. Audio streams hold internal ring buffers for audio frames that accumulated over the meeting duration across 4 participants.

### Buffer Misfiring: Silence flush bypassed buffer_size (main.py / buffer.py)

`buffer_size` was correctly loaded from the DB and passed to `MessageBuffer.max_messages`. However, `maybe_flush_on_silence()` ran every 0.5 seconds and flushed whenever the last message was >6 seconds old, **regardless of how many messages were in the buffer**.

In a 4-person meeting, natural pauses >6 seconds happen constantly. 2-3 messages would accumulate, silence would trigger the flush, and agents would fire prematurely — defeating the purpose of `buffer_size`.

### SSE Lag: Transcript batched with agent invocation (fanout.py / stream.ts)

The `MessageBuffer` served two conflated purposes:
1. Batching messages for DB persistence (transcript)
2. Batching messages for agent invocation

Messages only reached the DB **when the buffer flushed** (on count or silence). The SSE stream polls the DB, so it could only deliver messages after a flush. Meanwhile, live captions published each message to the LiveKit data channel **immediately** from `transcription.py`, which is why captions felt instant but the insights transcript lagged by several seconds and arrived in clumps.

---

## Fixes Applied

### Fix 1: LRU-cache LLM instances (`apps/worker/src/graph.py`)

Added `@lru_cache(maxsize=16)` on a `_get_llm(model, provider)` wrapper around `init_chat_model`. Both graph nodes now call `_get_llm()` instead of `init_chat_model()` directly.

Result: **1 httpx client per unique (model, provider)** instead of ~2400 over a meeting.

```python
@lru_cache(maxsize=16)
def _get_llm(model: str, provider: str):
    return init_chat_model(model, model_provider=provider)
```

Thread safety note: Graph nodes are async functions on a single event loop. Even parallel agent runs via `asyncio.gather` share one thread. `lru_cache` is safe here.

### Fix 2: Close AudioStream (`apps/worker/src/transcription.py`)

Added `await audio.aclose()` in the `finally` block after `stream.aclose()`, wrapped in a try/except so a close failure doesn't mask the original error.

### Fix 3: Decouple transcript persistence from agent buffer

This is the core architectural change addressing both the buffer misfiring and SSE lag.

**Before:**
```
STT -> buffer.add() -> [accumulate] -> flush -> persist_messages() + agent fan-out
```

**After:**
```
STT -> fanout.on_paragraph() -> persist_message() immediately -> buffer.add()
                                                                    |
                                                         [accumulate to max_messages]
                                                                    |
                                                            on_buffer_flush() -> agent fan-out only
```

**Changes:**

| File | What changed |
|---|---|
| `buffer.py` | Added `db_id: int \| None = None` field to `Message` dataclass |
| `db.py` | Added `persist_message()` (singular) for single-row INSERT |
| `fanout.py` | Added `on_paragraph()` implementing `ParagraphSink` — persists immediately then buffers. Rewrote `on_buffer_flush()` to only fan out agents (no persistence). Uses `msg.db_id` for agent_run ID range. Only includes successfully persisted messages in agent processing. |
| `main.py` | Changed `sink=buffer` to `sink=fanout` in `attach_transcription` call. **Removed `silence_watcher` entirely** — no more silence-based flush. |
| `stream.ts` | Reduced `POLL_INTERVAL_MS` from 1000 to 500 |

**Why silence_watcher was removed:** With immediate per-message persistence, the SSE stream picks up each message within ~500ms. The silence flush was only needed to push transcript to the DB faster — now unnecessary. Agents fire strictly at `max_messages` count or at meeting end (final flush). This is the behavior users expect when they configure `buffer_size`.

### Fix 4: Explicit connection management (`apps/worker/src/db.py`)

Replaced `with conn:` (pymysql's Connection context manager) with explicit `try/finally: conn.close()`.

**Important note:** This was NOT fixing a memory leak. Investigation revealed that pymysql's `Connection.__exit__()` already calls `conn.close()`, so the original code was closing connections correctly. However, `with conn:` on a pymysql Connection is a footgun — it looks like transaction management but actually closes the connection. The explicit pattern is clearer and avoids the double-close crash we hit when we first tried `with conn:` + `finally: conn.close()`.

### Fix 5: httpx client context manager (`apps/worker/src/fanout.py`)

Changed bare `httpx.post()` in `_notify_summary_ready()` to use `with httpx.Client() as client:`. Minor — only runs once per meeting end.

---

## Files Changed

| File | Lines | Summary |
|---|---|---|
| `apps/worker/src/db.py` | Full rewrite | Removed `with conn:`, explicit `finally: conn.close()`, added `persist_message()` |
| `apps/worker/src/graph.py` | +8 | `_get_llm` with `@lru_cache` |
| `apps/worker/src/transcription.py` | +4 | `audio.aclose()` in finally |
| `apps/worker/src/fanout.py` | +40, -10 | `on_paragraph()`, rewrote `on_buffer_flush()`, httpx fix |
| `apps/worker/src/buffer.py` | +1 | `db_id` field on `Message` |
| `apps/worker/src/main.py` | -12, +2 | Removed silence_watcher, `sink=fanout` |
| `apps/api/src/sse/stream.ts` | 1 | `POLL_INTERVAL_MS`: 1000 -> 500 |
| `apps/worker/tests/test_db_persist.py` | +50 | `close()` on FakeConn, `persist_message` tests, conn-close tests |
| `apps/worker/tests/test_db_lifecycle.py` | +40 | `close()` on FakeConn, conn-close tests |
| `apps/worker/tests/test_fanout.py` | Full rewrite | New architecture: `on_paragraph`, `db_id`, mixed-persist tests |
| `apps/worker/tests/test_graph.py` | +20 | Cache-clear, LLM-reuse test |
| `apps/worker/tests/test_transcription.py` | +5 | `audio.aclose()` assertion |

---

## Impact Assessment

| Metric | Before | After |
|---|---|---|
| Worker memory (1hr, 4 users, 2 agents) | ~2.5 GB (climbing) | ~400-500 MB (stable) |
| Agent firing | Every 2-3 messages (silence flush) | Strictly at `buffer_size` count |
| Insights transcript latency | 1.5-7 seconds (batched) | ~500-600ms (per-message) |
| DB writes per message | 0 (batched at flush) | 1 INSERT per message |
| LLM client instances per meeting | ~2400 | 1-3 (one per model/provider) |

---

## Test Coverage

76 tests pass. New tests added:

- `test_persist_message_inserts_single_row` — singular persist works
- `test_persist_message_closes_connection_on_error` — cleanup on failure
- `test_on_paragraph_persists_immediately` — immediate DB write + db_id set
- `test_on_paragraph_still_buffers_on_persist_failure` — graceful degradation
- `test_on_flush_triggers_agents_with_db_ids` — agents use db_id range
- `test_on_flush_no_agents_is_noop` — no agents = no work
- `test_on_flush_skips_when_no_persisted_msgs` — all-failed batch handled
- `test_on_flush_uses_only_persisted_messages` — mixed batch: only persisted sent to agents
- `test_llm_instance_reused_across_invocations` — cache prevents re-creation
- Connection-close assertions on all lifecycle + persist functions

---

## Known Trade-offs

1. **Agents don't fire on silence anymore.** If a meeting has fewer than `buffer_size` messages total and ends normally, agents still fire on the final flush at meeting end. But during a long quiet stretch mid-meeting, agents won't process partial buffers. This is the intended behavior per `buffer_size` configuration.

2. **One DB INSERT per message instead of batched.** At ~1 INSERT/second for a 4-person meeting, this is trivial for MySQL. The trade-off is worth the real-time SSE delivery.

3. **SSE poll at 500ms instead of 1000ms.** Doubles DB query frequency on the API. Safe for MVP scale (10 users). Monitor if scaling significantly.
