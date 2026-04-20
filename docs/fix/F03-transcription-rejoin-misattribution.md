# F03 — Transcription Misattribution & Skipped Audio on Participant Rejoin

**Date:** 2026-04-20
**Severity:** High (data integrity)
**Discovered:** Manual testing of leave/rejoin flow

---

## Symptoms

1. **Skipped audio** — a participant's speech is never transcribed at all after they rejoin a meeting
2. **Cross-speaker misattribution** — text said by Muaz appears in the transcript / insights under Saif's name
3. **Duplicated utterances** — the same sentence is recorded twice under two different speakers
4. All three symptoms only appear **after** at least one participant leaves and/or rejoins. Fresh meetings where everyone stays connected behave correctly.

---

## Root Causes

The worker's STT lifecycle had three compounding defects in `apps/worker/src/main.py` and `apps/worker/src/transcription.py`.

### 1. No cleanup on track/participant removal

`main.py` registered `track_subscribed` but had **no `track_unsubscribed` handler and no STT cleanup in `participant_disconnected`**. When a participant left:
- `AudioStream(track)` stopped yielding frames, but the STT task's `async for ev in stream:` loop kept waiting on the OpenAI websocket for trailing final transcripts.
- The task lingered indefinitely. Any late `FINAL_TRANSCRIPT` the OpenAI side flushed was stamped with a fresh wall-clock timestamp (`int(time.time() * 1000)` in `transcription.py`) and pushed into the shared `MessageBuffer` — landing temporally **after** the current speaker's utterances and polluting the downstream agent timeline.

### 2. Race on rejoin: `cancel()` without `await`

```python
task_key = participant.identity
old_task = transcription_tasks.pop(task_key, None)
if old_task and not old_task.done():
    old_task.cancel()          # fire-and-forget
# new task created immediately at same key
```

A rejoining participant keeps their `identity`. The new STT task spawned before the old one's `finally` block (which calls `stream.aclose()` + `audio.aclose()`) had run. Both streams were alive briefly; the old one's trailing final transcript got timestamped *now* but represented pre-disconnect audio, so the paragraph buffer ordered it after newer messages from the new stream, and the flush misattributed.

### 3. `done_callback` blindly evicted the key

```python
task.add_done_callback(
    lambda t, k=task_key: transcription_tasks.pop(k, None)
)
```

When the OLD task finally finished — after the NEW task had already registered itself at the same identity key — this callback unconditionally popped the entry, evicting the NEW task from the tracking dict. On shutdown, `for task in transcription_tasks.values(): task.cancel()` then missed the orphaned task, so its final flush never ran and any audio it had captured since the rejoin was silently dropped. This is the "completely skips someone's audio" symptom.

### Contributing: mutable proxy capture

`transcription.py` read `participant.identity` / `participant.name` at *emission* time off the captured `RemoteParticipant` proxy. LiveKit identity is immutable by contract, so this alone cannot swap speakers, but it widens the blast radius of defects 1 and 2: a stale emission picks up whatever the proxy currently exposes rather than a stable snapshot.

---

## Fixes Applied

### 1. Composite task key `(identity, track.sid)`

`main.py` `on_track` now keys `transcription_tasks` on `(participant.identity, track.sid)`. A new track always has a fresh sid, so a rejoining participant cannot collide with their own stale task. Future support for secondary audio tracks (screenshare-with-audio) comes for free.

### 2. `track_unsubscribed` handler + STT teardown in `participant_disconnected`

```python
@ctx.room.on("track_unsubscribed")
def on_track_unsubscribed(track, pub, participant):
    if track.kind != rtc.TrackKind.KIND_AUDIO:
        return
    task_key = (participant.identity, track.sid)
    t = transcription_tasks.pop(task_key, None)
    if t is not None:
        _schedule_cleanup(t)
```

`on_leave` (`participant_disconnected`) now sweeps every `transcription_tasks` entry whose identity matches the leaving participant and schedules cleanup. LiveKit event handlers are sync, so we cannot `await` inline — cleanup is queued as a tracked background task.

### 3. `cleanup_tasks` set + `_cancel_and_await` helper

A module-local `cleanup_tasks: set[asyncio.Task]` holds every in-flight cancel-and-await. `_schedule_cleanup(task)` wraps `task.cancel()` + `await task` in a background task, adds it to the set, and auto-removes it on completion. The shutdown `finally` block now awaits both `transcription_tasks.values()` AND `cleanup_tasks`, so no teardown can race the final `fanout.flush_all_and_finalize()`.

### 4. Compare-and-delete in `done_callback`

```python
def _on_done(t: asyncio.Task, k=task_key) -> None:
    if transcription_tasks.get(k) is t:
        transcription_tasks.pop(k, None)
```

Only evicts the dict entry if it still points at THIS task. A late-finishing predecessor can no longer remove its successor's registration.

### 5. Immutable speaker snapshot

`transcription.py` now captures `speaker_identity = participant.identity` and `speaker_name = participant.name or participant.identity` once at function entry and uses those locals everywhere (emission, logs, pump task name). The `RemoteParticipant` proxy is never read again after attach.

---

## Files Changed

| File | Change |
|---|---|
| `apps/worker/src/main.py` | Composite task key; `track_unsubscribed` handler; STT teardown in `participant_disconnected`; `_cancel_and_await` + `_schedule_cleanup` + `cleanup_tasks` set; compare-and-delete `done_callback`; shutdown now drains `cleanup_tasks` |
| `apps/worker/src/transcription.py` | Snapshot `speaker_identity` / `speaker_name` locals at entry; all emission/log sites read from locals instead of the participant proxy |
| `apps/worker/tests/test_transcription.py` | +1 test `test_speaker_fields_snapshot_at_attach_time` — mutates the participant proxy mid-stream and asserts emitted `Message` still carries the original identity/name |

No API, DB, or frontend changes.

---

## Impact Assessment

| Scenario | Before | After |
|---|---|---|
| Single meeting, no one leaves | Correct | Correct |
| One participant leaves (no rejoin) | STT task leaks; trailing transcripts pollute buffer | STT task cancelled + awaited on `track_unsubscribed` / `participant_disconnected` |
| One participant rejoins (same identity) | Old + new streams briefly coexist; misattribution + skipped audio via orphaned dict entry | New track's fresh `sid` gives a new key; old task torn down via cleanup set |
| Multiple rejoins (guest churn) | Unbounded stale task accumulation | Bounded — every leave clears the matching keys |
| Worker shutdown mid-speech | Orphaned tasks miss the final-flush cancel loop → dropped paragraphs | Shutdown awaits `cleanup_tasks` too → every in-flight teardown completes before `fanout.flush_all_and_finalize()` |

---

## Test Coverage

- `test_speaker_fields_snapshot_at_attach_time` (new) — mutates the participant proxy mid-stream and asserts the emitted `Message` still carries the pre-mutation values
- Full existing `tests/test_transcription.py` suite (10 tests) still green
- Full worker suite: 77/77 passing

---

## Verification (manual)

1. **Two-tab rejoin:** start a meeting, second tab joins, both speak. Hard-refresh the second tab to force rejoin; speak again. Check `transcript_messages`: all rows for the rejoining speaker carry their correct `speaker_identity` + `speaker_name`; no row has a timestamp older than the rejoin event.
2. **Three-person swap:** A, B, C join. B leaves mid-sentence. C speaks. B rejoins and speaks. A speaks. Every utterance attributes to the correct participant on the insights page.
3. **Guest churn:** auth host + one guest; guest disconnects and reconnects 3× in 60 s (fresh `guest-{ULID}` each time). Each utterance attributes to the right ULID; no orphan rows with empty text.
4. **Shutdown mid-speech:** end the meeting while someone is speaking. The final paragraph is persisted (no "skipped audio"), exercising the `cleanup_tasks` drain in the shutdown path.

---

## Known Trade-offs

- `_schedule_cleanup` spawns a background task per teardown. Memory cost is negligible (set entries auto-discard on completion) and the set is bounded by the number of in-flight disconnects.
- The composite key `(identity, track.sid)` assumes LiveKit sid uniqueness, which is part of the LiveKit Rooms contract. No fallback needed.
