## M34 — In-Room Live Captions Overlay
Wave: 3    Owner: <unassigned>    Branch: feat/m34-live-captions
Depends on: M20, M30    Blocks: —    plan.md refs: §7, §8.2, §7.1
Status: merged

## Goal
Publish live transcript paragraphs from the Python worker into the LiveKit room as **data channel messages** on topic `"transcript"`, and render them as a caption overlay on the in-room page `/meetings/:id/room` via a `<LiveCaptions />` React component that subscribes to `RoomEvent.DataReceived`.

This is a **low-latency, best-effort** path that bypasses the DB+SSE round-trip — captions should feel instant inside the meeting. The SSE dashboard stream (M32/M33) still remains the authoritative persisted feed. Messages are published to the room AND persisted via M31; captions are a second fire-and-forget publish.

## Context (inlined from plan.md)
From §7.1, the worker's `WorkerPermissions` explicitly enables data publish:
```python
permissions=WorkerPermissions(
    can_subscribe=True,
    can_publish=False,
    can_publish_data=True,   # ← enables room data messages
    hidden=True,
),
```
So the worker CAN publish data messages, even though it cannot publish audio/video.

From §8.2: "Add a custom `<LiveCaptions />` overlay that subscribes to `RoomEvent.DataReceived` filtered by `topic === "transcript"` (the worker publishes captions on this topic)."

From §13.5 (hot-reload hook): "Leave a clearly-marked `# FUTURE: hot reload via room data message` hook in `fanout.py`." — which means the data channel is already reserved for worker→client messages; captions are the first consumer.

The publish API on the Python side (livekit-agents 1.x / livekit-rtc):
```python
await ctx.room.local_participant.publish_data(
    payload=json.dumps({...}).encode("utf-8"),
    topic="transcript",
    reliable=True,
)
```

The subscribe API on the JS side (`livekit-client`):
```ts
room.on(RoomEvent.DataReceived, (payload, participant, kind, topic) => {
  if (topic !== "transcript") return;
  const msg = JSON.parse(new TextDecoder().decode(payload));
  ...
});
```

## Files to create / modify
- `apps/worker/src/captions.py` (new) — `publish_caption(room, msg)` helper that JSON-encodes a payload matching the shared schema and calls `room.local_participant.publish_data(payload=..., topic=CAPTION_TOPIC, reliable=True)`. **The try/except lives INSIDE `publish_caption`**, not at the call site, so every caller gets fire-and-forget semantics for free. Also exports `CAPTION_TOPIC = "transcript"` — add a line-comment `# Must match packages/shared/src/captions.ts CAPTION_TOPIC` to prevent cross-runtime drift.
- `apps/worker/src/transcription.py` — add an **optional** `room: rtc.Room | None = None` kwarg to `attach_transcription`. Default MUST be `None` so existing M30 tests (`tests/test_transcription.py`) pass untouched. Inside the `FINAL_TRANSCRIPT` branch, after `msg = Message(...)` and **before** `await sink.on_paragraph(msg)`, do `if room is not None: await publish_caption(room, msg)`. No try/except at this call site — `publish_caption` already swallows.
- `apps/worker/src/main.py` — pass `room=ctx.room` into the `attach_transcription(...)` call inside the `on_track` handler. No other changes; `WorkerPermissions.can_publish_data=True` already ships from M21.
- `apps/web/src/components/room/LiveCaptions.tsx` (new) — React component mounted as a child of `<LiveKitRoom>` in the room route. Uses `useRoomContext()` from `@livekit/components-react` to get the connected `Room`, subscribes to `RoomEvent.DataReceived`, filters by `topic === CAPTION_TOPIC`, parses the payload with `CaptionPayloadSchema.safeParse`, and displays the last ≤3 captions as a fading overlay.
- `apps/web/src/routes/_auth/meetings/$id/room.tsx` (from M20) — add `<LiveCaptions />` inside `<LiveKitRoom>` alongside `<VideoConference />`. Because the LiveKitRoom parent is not `position: relative`, the overlay uses `fixed` positioning (the room page itself is `fixed inset-0`, so this is visually identical to `absolute` and avoids fighting the prebuilt's layout).
- `packages/shared/src/captions.ts` (new) — zod schema + topic constant:
  ```ts
  // Must match apps/worker/src/captions.py CAPTION_TOPIC — cross-runtime contract.
  export const CAPTION_TOPIC = 'transcript' as const;
  export const CaptionPayloadSchema = z.object({
    speaker_identity: z.string(),
    speaker_name: z.string(),
    text: z.string(),
    start_ts_ms: z.number().int(),
    end_ts_ms: z.number().int(),
  });
  export type CaptionPayload = z.infer<typeof CaptionPayloadSchema>;
  ```
  Re-export from `packages/shared/src/index.ts`. Note: no `id` field — captions are fire-and-forget, not DB-backed.

## Implementation notes
- **Topic string is `"transcript"`**, exactly. Exported as `CAPTION_TOPIC` on both sides. Do not change it — it's the cross-runtime contract between §7 and §8.2. Both files carry a `Must match ...` comment pointing at the sibling runtime to prevent silent drift.
- `reliable=True` costs a tiny bit more latency but guarantees in-order delivery — correct for captions, which look terrible when reordered.
- **Publish order is publish → sink**, not sink → publish. The `await publish_caption(room, msg)` call sits immediately BEFORE `await sink.on_paragraph(msg)` so the caption reaches clients before the DB insert starts. There is a pytest in `tests/test_captions.py::test_transcription_publishes_before_sink` that records the actual order using a `FakeRoom` + recording sink — do not refactor this ordering away.
- Caption publish happens INSTEAD OF waiting for buffer flush / DB persist. Each `Message` is published the moment `attach_transcription` builds it in M30. The DB path continues in parallel.
- **Verified Python signature** (`livekit-rtc` ≥ 1.1.5): `async def publish_data(self, payload: Union[bytes, str], *, reliable=True, destination_identities=[], topic="")`. `payload=` keyword passing works (it's not positional-only). Raises `PublishDataError` on failure — caught inside `publish_caption`.
- **Verified JS signature** (`livekit-client` 2.18.x): `room.on(RoomEvent.DataReceived, (payload: Uint8Array, participant?, kind?, topic?, encryptionType?) => void)`. The 4-arg handler form used in `LiveCaptions.tsx` is valid (trailing `encryptionType` is optional).
- **`useRoomContext()` throws** if no Room is in context. Inside a `<LiveKitRoom>` subtree this is guaranteed. In vitest, mock `@livekit/components-react` with `vi.mock(...)` to inject a `FakeRoom`.
- The worker is a hidden participant (§7.1), so its data messages arrive from a well-known identity. Clients should accept any data message on topic `"transcript"` without gating on participant identity — there's only one publisher on that topic.
- Overlay UX: show the last ≤3 captions stacked, each with speaker name, fading out after 8 seconds. Do NOT grow unbounded — it's an ephemeral overlay, not a scrollback. Cap with `slice(-MAX_VISIBLE)` and schedule a per-caption `setTimeout(removeById, 8000)` so each caption expires on its own clock.
- **Ugly-identity handling:** when a participant never set a display name, `participant.name` is empty and the worker falls back to `participant.identity` (§transcription.py). Those identities look like `user_01ARZ3NDEKTSV4RRFFQ69G5FAV` or `guest-01ARZ3NDEKTSV4RRFFQ69G5FAV` — render as `Participant` / `Guest` respectively via a `prettifySpeaker()` helper regex-matching `/^user_[0-9A-HJKMNP-TV-Z]{26}$/i` and `/^guest-[0-9A-HJKMNP-TV-Z]{26}$/i`. Cosmetic but important; the UX looks broken otherwise.
- The overlay must be visually non-intrusive: bottom center, semi-transparent background, readable over video, **`pointer-events-none`** so it never swallows clicks on the VideoConference control bar. Use Tailwind `fixed bottom-24 left-1/2 -translate-x-1/2 max-w-2xl bg-black/60 text-white pointer-events-none z-50` and similar. (`fixed` rather than `absolute` because the `<LiveKitRoom>` parent is not `position: relative` and the room route itself is `fixed inset-0` — pinning to viewport gives the same visual result without fighting the prebuilt's layout.)
- Do NOT persist captions from the browser — the DB is populated by the worker via M31.
- If the user clicks a "hide captions" toggle in the overlay, just unmount the component; next time the page mounts, captions come back.
- The worker's `publish_data` is async — remember to `await` it. If you forget, it silently becomes a dangling coroutine.
- **Backward compat guardrail:** the new `room` kwarg on `attach_transcription` MUST default to `None`. All 8 existing M30 tests in `tests/test_transcription.py` still call the function without `room=` and must continue to pass unchanged.

## Acceptance criteria
- [x] Joining a meeting and speaking produces captions overlaid on the `/room` page within ~500ms of finishing a sentence.
- [x] Captions show the correct speaker display name (with ULID-shaped identities prettified to `Participant` / `Guest`).
- [x] Captions appear on BOTH participants' screens in a two-person meeting (the data channel broadcasts to all).
- [x] Captions fade out after ~8 seconds; the overlay never grows beyond 3 visible lines.
- [x] `transcript_messages` rows are still persisted (M31 path unaffected — verify by querying the DB after the meeting).
- [x] SSE dashboard (M33) still receives the same paragraphs independently.
- [x] Failing the data publish (e.g. by temporarily patching it to raise) does NOT crash transcription or break DB persistence — only captions stop. Covered by `test_transcription_survives_failing_publish`.
- [x] The worker participant does NOT appear as a visible tile in the `VideoConference` grid (it's hidden per §7.1).
- [x] All 8 existing M30 transcription tests still pass with the new optional `room` kwarg (backward compat). Covered by `test_transcription_without_room_is_backward_compatible` plus the unchanged `tests/test_transcription.py` suite.
- [x] Publish happens strictly BEFORE sink call. Covered by `test_transcription_publishes_before_sink`.

## Tests (added in this module)
**Python — `apps/worker/tests/test_captions.py`:**
- `test_publish_caption_shape` — asserts topic=`transcript`, `reliable=True`, and exact JSON payload shape.
- `test_publish_caption_swallows_errors` — raises `RuntimeError` from `publish_data`, asserts `publish_caption` does NOT raise and logs a warning.
- `test_transcription_publishes_before_sink` — order-preservation test (refinement 2).
- `test_transcription_survives_failing_publish` — failing publish still delivers the message to the sink (M31 path unaffected).
- `test_transcription_without_room_is_backward_compatible` — calling `attach_transcription` with no `room` kwarg works unchanged.

**TypeScript — `apps/web/src/components/room/__tests__/LiveCaptions.test.tsx`:** 9 cases covering valid payload render, wrong-topic ignored, malformed JSON ignored, schema-invalid payload dropped, 3-caption cap, 8-second fade, ULID user prettify, ULID guest prettify, DataReceived unsubscribe on unmount.

## Smoke test
1. Start API, worker, web. Join a meeting in two Chrome tabs.
2. Speak in Tab A. Confirm a caption bubble `"[<name>] hello world"` appears at the bottom of BOTH tabs within a second.
3. Open DevTools → Network → WS — verify data messages are arriving on the LiveKit websocket (they'll be binary frames).
4. Speak rapidly with both participants; confirm captions alternate correctly and neither is lost.
5. `SELECT count(*) FROM transcript_messages WHERE meeting_id='<id>';` — count should match the number of spoken paragraphs, proving persistence is independent.
6. Open the dashboard in a third tab (M33) — transcript rows appear there too, from the SSE path.
7. Use `--chrome` per CLAUDE.md for the end-to-end flow.

## Do NOT
- Do NOT persist captions from the frontend. The DB is owned by the worker via M31.
- Do NOT use a different topic string. It's `"transcript"`, same as §8.2.
- Do NOT block transcription on the caption publish — wrap in try/except and swallow errors.
- Do NOT publish captions from the buffer's `on_flush` — that's too late (flush only happens every N messages or on silence). Publish at paragraph-close time in `transcription.py`.
- Do NOT grant the worker `can_publish=True` — data only. §7.1 is explicit.
- Do NOT display the worker as a participant tile — it's `hidden=True` and LiveKit already handles that; do not override.
- Do NOT add a second data topic in this module. Reserve future topics (e.g. "hot_reload") for when §13.5 is implemented.

## Hand-off
After this module, transcription has three parallel sinks for each paragraph:
1. LiveKit data channel → instant in-room captions (M34).
2. `MessageBuffer` → MySQL `transcript_messages` via `persist_messages` (M31).
3. (Wave 4) Agent fanout via `MessageBuffer.on_flush` → `agent_runs` + `agent_outputs`.
All three are driven from the same `Message` object in `transcription.py`. Wave 4 does not touch M34 at all.
