## M30 — STT Stream + Paragraph Detection
Wave: 3    Owner: <unassigned>    Branch: feat/m30-stt-stream
Depends on: M21    Blocks: M31    plan.md refs: §7.5, §7.1, §12

## Goal
Fill in `apps/worker/src/transcription.py` with `attach_transcription(...)` — the coroutine that opens **one OpenAI `gpt-4o-transcribe` streaming STT per (participant, track)**, consumes `START_OF_SPEECH`, `FINAL_TRANSCRIPT`, and `END_OF_SPEECH` events from the livekit-agents STT stream (wrapped by the `StreamAdapter` with Silero VAD for speech segmentation), and produces per-speaker `Message` objects. At this milestone the messages are forwarded to an in-memory `ParagraphSink` (and optionally printed to stdout via `PrintSink`) — persistence to MySQL lands in M31, fanout to agents lands later.

Also wire `main.py`'s `on_track` handler to spawn `attach_transcription` as a task per audio track, and wrap `openai.STT` in `agents.stt.StreamAdapter` so non-streaming Whisper audio semantics get real VAD boundaries.

## Context (inlined from plan.md §7.5)

Speaker identity comes from `participant.identity` (closure-captured). Every LiveKit participant publishes their own mic, so we get perfect speaker labels for free — **NO diarization library**. Do not "optimize" this by merging audio across participants into one STT stream; that would destroy speaker identity. One stream per (participant, track).

The paragraph boundary is whatever the STT stream reports as a `FINAL_TRANSCRIPT` event after VAD segmentation. We do NOT manually re-glue fragments at the M30 layer — the buffer layer (M31's `MessageBuffer`) handles downstream aggregation (silence windows, max-message flushes).

## Timestamp strategy

`gpt-4o-transcribe` does **not** expose reliable `alt.start_time` / `alt.end_time` values in all event types, and the values it does expose are stream-relative (seconds since stream open), which makes reconciliation across multiple parallel STT streams in the same meeting painful. Rather than fight the upstream SDK, we stamp each `Message` with **wall-clock epoch milliseconds** captured in the worker on `START_OF_SPEECH` / `END_OF_SPEECH` / `FINAL_TRANSCRIPT` events. Concretely:

- On `START_OF_SPEECH`: remember `para_start_ms = int(time.time() * 1000)`.
- On `END_OF_SPEECH`: remember `para_end_ms = int(time.time() * 1000)`.
- On `FINAL_TRANSCRIPT`: emit a `Message` with `start_ts_ms = para_start_ms or now_ms` and `end_ts_ms = para_end_ms or now_ms`, then reset both. This handles the race where a `FINAL_TRANSCRIPT` arrives without a matching `START_OF_SPEECH` (e.g., at stream open).

Wall-clock timestamps are monotonic within a single worker process (there is no NTP skew inside one Python runtime), correct for ordering across multiple STT streams in the same meeting, and trivially convertible to human-readable times in the insights dashboard — no per-stream offset bookkeeping needed. The only thing we trade away is alignment with the original audio waveform for replay, which we do not ship in MVP (Egress/recording is out of scope per §12).

## Emission semantics

`attach_transcription` emits **one `Message` per `FINAL_TRANSCRIPT` event**, not one `Message` per `END_OF_SPEECH`. Rationale: the `StreamAdapter` + VAD pipeline already segments speech into natural utterance boundaries before handing them to Whisper, so each `FINAL_TRANSCRIPT` is a complete sentence-sized unit. Accumulating multiple `FINAL_TRANSCRIPT`s across a single `END_OF_SPEECH` is not required — the buffer layer (M31) performs the downstream aggregation based on speaker change and silence windows, which is the correct level of abstraction for that concern.

Empty / whitespace-only `FINAL_TRANSCRIPT` events are dropped without emission.

## Files to create / modify
- `apps/worker/src/transcription.py` — implementation of `attach_transcription` and a simple `PrintSink`. Import `Message` from `buffer.py`.
- `apps/worker/src/buffer.py` — the `Message` dataclass (M31 adds `MessageBuffer` on top).
- `apps/worker/src/main.py` — inside `entrypoint`:
  1. `base_stt = openai.STT(model="gpt-4o-transcribe", language="en")`
  2. `stt = agents.stt.StreamAdapter(stt=base_stt, vad=ctx.proc.userdata["vad"])`
  3. Replace the M21 print-only `on_track` handler with `asyncio.create_task(attach_transcription(participant=..., track=..., stt=stt, sink=...))`.

## Implementation notes

- **One STT stream per (participant, track).** Do not share a stream. How we get perfect speaker labels without diarization.
- `participant.identity` is the ULID user id passed into the LiveKit token in M20 — stable and authoritative. Canonical speaker key.
- `participant.name` is the display name for humans (fall back to `identity` if null).
- The inner `pump()` task that forwards audio frames into `stream.push_frame(...)` must be cancelled on task exit. Use a `try/finally` around the `async for ev in stream:` loop to cancel it; otherwise dangling pumps leak across rooms.
- Wrap the event loop in `try/except` that handles `asyncio.CancelledError` quietly (expected on room disconnect) and logs any other exception.
- Prewarm Silero VAD in `prewarm(proc)` via `proc.userdata["vad"] = silero.VAD.load()` so worker cold-start doesn't eat the first paragraph.
- `language="en"` is hardcoded for MVP. Do not add language detection.

## Acceptance criteria
- [ ] Two participants speaking alternately produce two independent streams of `Message` objects, each tagged with the correct `speaker_identity`.
- [ ] Silence produces no `Message` emissions (empty `FINAL_TRANSCRIPT`s are dropped).
- [ ] Worker logs show paragraphs formatted as `[speaker_name] text (start_ms..end_ms)`.
- [ ] `start_ts_ms` and `end_ts_ms` are wall-clock epoch ms, monotonic within a single stream, and populated on every emitted `Message` (never `None`).
- [ ] No diarization library (pyannote, whisperx, NeMo) appears in `pyproject.toml`.
- [ ] `openai.STT(model="gpt-4o-transcribe", ...)` is the only STT instantiation — grep confirms no `whisper-1` anywhere.
- [ ] `StreamAdapter` wraps `openai.STT` with Silero VAD in `main.py`.

## Smoke test
1. Start worker (`uv run python -m src.main dev`) and API.
2. Join a meeting in two browser tabs as two different users. Unmute both.
3. Speak sequentially: tab A says "hello world", pause 2s, tab B says "testing one two three".
4. Worker stdout shows two `Message` objects with distinct `speaker_identity` values and wall-clock timestamps roughly matching the speech.
5. Speak over each other briefly — each speaker's paragraph still only contains their own words (because streams are independent).
6. Leave the room — `attach_transcription` tasks cancel cleanly (no traceback).

## Do NOT
- Do NOT use `whisper-1` (non-streaming). Plan §12: "Do not use `whisper-1` (non-streaming). Use `gpt-4o-transcribe`."
- Do NOT merge audio from multiple participants into a single STT stream. Plan §12.
- Do NOT add a diarization library.
- Do NOT persist to `transcript_messages` from this module — that's M31.
- Do NOT implement `MessageBuffer` here — that's M31.
- Do NOT attempt manual speaker-change detection. Speaker identity comes from the participant closure, not from audio analysis.
- Do NOT call the LLM from here.
- Do NOT try to reconstruct STT-relative timestamps from `alt.start_time` / `alt.end_time` — those values are unreliable across the event types we actually handle. Use wall-clock time.

## Hand-off
M31 swaps the `PrintSink` for a `MessageBuffer` instance shared across all `attach_transcription` calls for the meeting. The `on_paragraph(msg)` contract is the handoff point. M31 adds the "silence > 1.5s" and "max_messages reached" flush conditions at the buffer layer (not here).
