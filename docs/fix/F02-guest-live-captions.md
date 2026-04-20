# F02 — Guest Live Captions Missing

**Date:** 2026-04-17
**Severity:** Low (UX gap)
**Discovered:** Manual testing of guest join flow

---

## Symptom

Guests joining a meeting via `/join/$id` did not see the live caption overlay at the bottom of the screen, while authenticated users in the same meeting saw captions normally.

---

## Root Cause

The guest room page (`apps/web/src/routes/join.$id.tsx`) rendered only `<VideoConference />` inside `<LiveKitRoom>`. The authenticated room page (`apps/web/src/routes/_auth/meetings/$id/room.tsx`) rendered both `<VideoConference />` and `<LiveCaptions />`.

The `LiveCaptions` component subscribes to `RoomEvent.DataReceived` on the `"transcript"` topic. The worker publishes captions to ALL room participants via the LiveKit data channel with `reliable=True` — no identity filtering. The data was already arriving at the guest's browser; the display component was simply never added to the guest page.

---

## Fix

Added the `LiveCaptions` import and component to the guest room page, matching the authenticated room page pattern.

| File | Change |
|---|---|
| `apps/web/src/routes/join.$id.tsx` | +1 import, +1 `<LiveCaptions />` inside `<LiveKitRoom>` |

No backend changes. No new components. No API changes.

---

## Related: Guest Transcript on Insights Page

Separately reported: guest speech was not appearing on the insights page transcript or post-meeting transcript. Investigation confirmed the entire pipeline (worker transcription, DB persistence, SSE delivery, frontend rendering) handles guest identities (`guest-{ULID}`) correctly with zero filtering. The issue was resolved by the F01 worker fixes (memory leak / buffer decoupling) — the old worker was likely losing messages during instability.

---

## Verification

1. Join as guest, another participant speaks — caption overlay appears at bottom of screen
2. TypeScript compiles clean (`npx tsc --noEmit`)
3. Authenticated room page unaffected
