## M22 — Worker Dispatch Wiring
Wave: 2    Owner: <unassigned>    Branch: feat/m22-worker-dispatch-wiring
Depends on: M20, M21    Blocks: Wave 3 (M30, M31, M32, M33, M34)    plan.md refs: §6, §7.1

## Goal
Wire the Node API to **explicitly dispatch** the Python agent worker into a LiveKit room when a user joins a meeting — at most **one worker per meeting**, even across many join/rejoin calls. Idempotency lives in the database via a new `meetings.worker_job_id` column (§4): before calling the LiveKit API, the join handler checks `meeting.worker_job_id`; if non-NULL, a worker is already registered for this meeting and the handler skips dispatch. Otherwise, call `AgentDispatchClient.createDispatch(meeting.livekit_room, 'meet-transcriber', { metadata: JSON.stringify({ meeting_id }) })`, take the returned `dispatch.id`, and persist it to `meetings.worker_job_id`. The worker itself overwrites `worker_job_id` again on entrypoint (belt-and-suspenders, using its own `ctx.job.id`) and clears it on disconnect — so a crashed worker that rejoins the same meeting transparently re-dispatches on the next join.

This module closes the loop between M20 (token mint + room page) and M21 (worker that waits for dispatch). After it lands, joining a meeting in the browser causes **exactly one** worker process to show up in the room logs with the correct `meeting_id` in its metadata, and subsequent joins reuse it.

## Context (inlined from plan.md)
- From §6 (Meeting lifecycle + Dispatching the worker): idempotency lives in the DB, not in error-swallowing. The join route checks `meeting.worker_job_id`; if set, skips dispatch entirely. Otherwise, calls `AgentDispatchClient.createDispatch(meeting.livekit_room, 'meet-transcriber', { metadata: JSON.stringify({ meeting_id }) })` and writes the returned `dispatch.id` back to `meetings.worker_job_id`.
- Why DB-backed idempotency and not `listDispatch` or "swallow ALREADY_EXISTS": `listDispatch` requires the agent worker to be reachable and returns 503 when the worker process is starting or restarting (observed against local LiveKit server), and `createDispatch`'s ALREADY_EXISTS only fires for pending unfulfilled dispatches — once a dispatch is fulfilled and the worker has joined, a second `createDispatch` call creates a brand-new dispatch and a second worker. A row on `meetings` is the only place we can cheaply assert "there is already a worker registered for this meeting."
- From §7.1: worker is registered with `agent_name="meet-transcriber"` — this name is the contract. Mismatch = silent no-op (worker never joins).
- The worker parses metadata as JSON and reads `meeting_id`:

```python
meta = ctx.job.metadata or "{}"
import json
meeting_id = json.loads(meta)["meeting_id"]
```

- From §3: the API uses `livekit-server-sdk` (Node). `AgentDispatchClient` lives in that package alongside `AccessToken` (used in M20).
- Implementation order (§11 step 10): "Python worker — minimum viable: entrypoint, explicit dispatch, joins the room, logs participants. Verify dispatch from `POST /meetings/:id/join`." That verification is this module.

## Files to create / modify
- `apps/api/src/db/schema.ts` — add `workerJobId: varchar('worker_job_id', { length: 255 })` to the `meetings` table (nullable). Run `db:push`.
- `apps/api/src/repositories/meetings.ts` — expose `worker_job_id` in `toMeetingResponse(...)` and add `workerJobId` to the allowed `update(...)` patch fields.
- `apps/api/src/livekit/dispatch.ts` — new. Exposes `dispatchMeetingWorker({ meetingId, roomName })` that returns the new dispatch id (or `null` if skipped/ALREADY_EXISTS):
  ```ts
  import { AgentDispatchClient } from 'livekit-server-sdk';
  const AGENT_NAME = 'meet-transcriber';

  export async function dispatchMeetingWorker(opts: {
    meetingId: string;
    roomName: string;
  }): Promise<string | null> {
    const client = new AgentDispatchClient(
      process.env.LIVEKIT_URL!,
      process.env.LIVEKIT_API_KEY!,
      process.env.LIVEKIT_API_SECRET!,
    );
    try {
      const dispatch = await client.createDispatch(opts.roomName, AGENT_NAME, {
        metadata: JSON.stringify({ meeting_id: opts.meetingId }),
      });
      return dispatch.id;
    } catch (err: unknown) {
      if (isAlreadyExistsError(err)) return null;
      throw err;
    }
  }
  ```
  `isAlreadyExistsError` is a backstop for in-flight race conditions only; the primary idempotency gate is the `worker_job_id` check in the route. Match defensively on `err.code === 'already_exists'` OR message substring `"already exists"`.
- `apps/api/src/routes/meetings.ts` — inside the join handler, after the `started_at` bookkeeping (see M20) and **before** returning the token:
  ```ts
  if (!meeting.worker_job_id) {
    const dispatchId = await dispatchMeetingWorker({
      meetingId: meeting.id,
      roomName: meeting.livekit_room,
    });
    if (dispatchId) {
      await meetingsRepo.update(meeting.id, { workerJobId: dispatchId });
    }
  }
  ```
  Do this before returning the token so the worker is converging on the room by the time the browser connects.
- `apps/api/src/livekit/__tests__/dispatch.test.ts` — unit test with a mocked `AgentDispatchClient`: (a) happy path calls `createDispatch` with exact expected args and returns the dispatch id, (b) already-exists error returns `null`, (c) other errors propagate.
- `apps/api/src/routes/__tests__/meetings-join.routes.test.ts` — integration test: first `/join` on a scheduled meeting calls dispatch once; second `/join` sees `worker_job_id` already set and **does not** call dispatch. A non-host calling `/join` before the host on a scheduled meeting gets 409.

## Implementation notes
- `agentName` is a **string literal `'meet-transcriber'`** and must match `WorkerOptions(agent_name=...)` from M21 byte-for-byte. Extract it to `const AGENT_NAME = 'meet-transcriber'` at the top of `dispatch.ts` so drift is impossible.
- `metadata` is a JSON string, not an object — LiveKit's wire format is opaque bytes. Always stringify.
- **The DB guard is the source of truth.** `LiveKit's createDispatch` is not safely idempotent on its own — once a dispatch is fulfilled (worker has joined), a second call creates a new dispatch and a second worker. Without the `worker_job_id` gate, every `/join` call from every participant spawns another worker and multiplies STT costs by N. The ALREADY_EXISTS catch is only a backstop for races where two join requests land in the same millisecond.
- **Do NOT use `AgentDispatchClient.listDispatch`** as an idempotency check. It requires the agent worker to be reachable (server-to-agent RPC) and returns Twirp 503 "no response from servers" when the worker process is restarting or not yet connected. Observed locally; it breaks the whole join flow.
- Do NOT dispatch on `/meetings/:id/leave` or anywhere else. Only on join.
- Dispatching multiple times across different rooms for the same meeting shouldn't happen (rooms are 1:1 with meetings via `meeting.livekit_room`).
- The worker's prewarm can take ~1s for Silero VAD — the browser will still connect instantly because the worker joins asynchronously as a hidden participant. No need to block the join response on "worker is in the room."
- The worker clears `worker_job_id` on disconnect (M30's `deregister_worker`), so after a clean room empty the next `/join` will correctly re-dispatch.

## Acceptance criteria
- [ ] `meetings.worker_job_id varchar(255) null` is added to the Drizzle schema and pushed to the DB.
- [ ] First `POST /meetings/:id/join` on a meeting where `worker_job_id IS NULL` triggers exactly one `createDispatch` call with positional args `(meeting.livekit_room, 'meet-transcriber', { metadata: '{"meeting_id":"<id>"}' })` and persists the returned `dispatch.id` to `meetings.worker_job_id`.
- [ ] Second `POST /meetings/:id/join` on the same meeting observes the now-populated `worker_job_id` and **does not** call `createDispatch` at all.
- [ ] Worker process (running via `uv run python -m src.main dev`) observes the job, prints `meeting_id=<id>` parsed from metadata, logs participant joins, and overwrites `meetings.worker_job_id` with its own `ctx.job.id`.
- [ ] After the room empties and the worker disconnects, `meetings.worker_job_id` is NULL again (cleared by M30's `deregister_worker`). A fresh `/join` on the same meeting will re-dispatch.
- [ ] Unit tests for `dispatchMeetingWorker` cover happy path (returns dispatch id), already-exists backstop (returns null), and error propagation.
- [ ] Grep confirms `AgentDispatchClient` is imported only in `apps/api/src/livekit/dispatch.ts` — not anywhere in `apps/web/` or `apps/worker/`.

## Smoke test
1. Terminal 1: `pnpm --filter api dev`.
2. Terminal 2: `cd apps/worker && uv run python -m src.main dev`. Wait for "registered worker".
3. Terminal 3: `pnpm --filter web dev`.
4. Browser: log in, create a meeting, click Join on `/meetings/:id`.
5. Expected: worker terminal prints `meeting_id=<ulid>` and `[worker] participant joined: <user_id>` within ~2 seconds.
6. Refresh the room page (triggers a second join). Worker should NOT error; API should not 500. Worker may log a second `track_subscribed` if LiveKit re-fires on reconnect.
7. Chrome test per CLAUDE.md: `--chrome` to the room page, confirm network tab shows `/join` returns 200.

## Do NOT
- Do NOT dispatch from the frontend — the API key/secret must stay server-side.
- Do NOT change the agent name from `'meet-transcriber'` — it is the cross-process contract with M21.
- Do NOT `await` anything that depends on the worker actually having joined the room before returning to the client. Dispatch is fire-and-forget from the API's POV.
- Do NOT add retry/backoff loops around `createDispatch`. The call is cheap; if it fails for a real reason, surface it.
- Do NOT pre-list dispatches to "check if one exists" — race condition. Trust the ALREADY_EXISTS swallow.

## Hand-off
With M22 merged, Wave 3 unblocks: the worker is now actually in the room receiving audio tracks, so M30 (STT stream) can plug into `on_track` directly. M34's data channel will publish from the same worker process into the same room — no additional dispatch wiring needed.
