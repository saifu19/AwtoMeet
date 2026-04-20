## M21 — Python Worker Skeleton
Wave: 2    Owner: <unassigned>    Branch: feat/m21-worker-skeleton
Depends on: M00, M01    Blocks: M22, M30    plan.md refs: §7.1, §3, §10

## Goal
Stand up `apps/worker/` as a **minimum viable livekit-agents 1.x worker**: uv-managed Python project, `src/main.py` entrypoint with explicit `agent_name="meet-transcriber"` dispatch, joins the room when dispatched, parses `meeting_id` from job metadata, subscribes to audio tracks, and logs each participant + track event. No STT, no DB, no fanout yet — those are M30/M31/M32.

This module proves the worker can (a) run locally via `uv run python -m src.main dev`, (b) be dispatched from the API by room name (validated in M22), and (c) observe participants joining. Everything downstream builds on this scaffold.

## Context (inlined from plan.md)
- Repo layout (§2): `apps/worker/` lives inside the monorepo but is **NOT part of pnpm workspaces**. It is managed by `uv` with its own `pyproject.toml`.
- Tech stack (§3): Python 3.12, `uv` package manager, `livekit-agents ~= 1.5` with extras `[openai,silero]`, `sqlalchemy` for DB (used in M31+), `pydantic-settings` for env.
- Deployment (§10): Worker runs on Fly.io on a `python:3.12-slim` Docker image. It holds a persistent WebSocket to LiveKit and spawns subprocesses per job — **do NOT put this on Vercel.**
- Folder layout (§7): `src/main.py`, `src/transcription.py`, `src/buffer.py`, `src/fanout.py`, `src/graph.py`, `src/db.py`, `src/settings.py`, `src/summary.py`, plus `Dockerfile`, `pyproject.toml`, `.env.example`. For M21 only `main.py` + `settings.py` are required; stub the rest as empty files with a module docstring so imports in later modules are cheap to add.
- §7.1 entrypoint reference code (reproduce exactly, minus `attach_transcription` and `fanout` wiring):

```python
from dotenv import load_dotenv
from livekit import agents, rtc
from livekit.agents import JobContext, WorkerOptions, WorkerPermissions, AutoSubscribe, cli
from livekit.plugins import openai, silero

load_dotenv()

async def entrypoint(ctx: JobContext):
    meta = ctx.job.metadata or "{}"
    import json
    meeting_id = json.loads(meta)["meeting_id"]

    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    @ctx.room.on("track_subscribed")
    def on_track(track, pub, participant):
        if track.kind == rtc.TrackKind.KIND_AUDIO:
            print(f"[worker] audio track from {participant.identity} ({participant.name})")

    @ctx.room.on("participant_connected")
    def on_join(participant):
        print(f"[worker] participant joined: {participant.identity}")

    @ctx.room.on("disconnected")
    def on_disconnected(reason):
        print(f"[worker] room disconnected: {reason}")


def prewarm(proc):
    proc.userdata["vad"] = silero.VAD.load()


if __name__ == "__main__":
    cli.run_app(WorkerOptions(
        entrypoint_fnc=entrypoint,
        prewarm_fnc=prewarm,
        agent_name="meet-transcriber",   # explicit dispatch only
        permissions=WorkerPermissions(
            can_subscribe=True,
            can_publish=False,
            can_publish_data=True,
            hidden=True,
        ),
    ))
```

Key invariants from that code:
- `agent_name="meet-transcriber"` is **required** — it disables automatic dispatch, so the worker only joins rooms when the API explicitly dispatches it (M22).
- `permissions.hidden=True` — the worker participant is invisible in the room's participant list for other clients.
- `can_publish=False`, `can_publish_data=True` — no media, but data messages allowed (for captions in M34).
- `AutoSubscribe.AUDIO_ONLY` — never subscribe to video.

## Files to create / modify
- `apps/worker/pyproject.toml` — new. `[project]` with `name = "meet-worker"`, `requires-python = ">=3.12"`, dependencies: `livekit-agents[openai,silero]~=1.5`, `python-dotenv`, `pydantic-settings`, `sqlalchemy`, `pymysql` (needed in M31). Build backend: `hatchling`.
- `apps/worker/.env.example` — `LIVEKIT_URL=`, `LIVEKIT_API_KEY=`, `LIVEKIT_API_SECRET=`, `OPENAI_API_KEY=`, `MYSQL_URL=`, `DEFAULT_LLM_PROVIDER=openai`, `DEFAULT_LLM_MODEL=gpt-4o-mini`.
- `apps/worker/src/__init__.py` — empty.
- `apps/worker/src/main.py` — entrypoint above.
- `apps/worker/src/settings.py` — `pydantic-settings` class reading env vars listed above.
- `apps/worker/src/transcription.py` — stub: `"""Filled in M30."""`.
- `apps/worker/src/buffer.py` — stub: `"""Filled in M31."""`.
- `apps/worker/src/fanout.py` — stub: `"""Filled in Wave 4."""`.
- `apps/worker/src/graph.py` — stub: `"""Filled in Wave 4."""`.
- `apps/worker/src/db.py` — stub: `"""Filled in M31."""`.
- `apps/worker/src/summary.py` — stub: `"""Filled in Wave 4."""`.
- `apps/worker/Dockerfile` — `FROM python:3.12-slim`, install `uv`, copy `pyproject.toml` + `src/`, `uv sync --frozen`, `CMD ["uv", "run", "python", "-m", "src.main", "start"]`.
- `apps/worker/README.md` — 10 lines: how to run `uv sync`, `uv run python -m src.main dev`.
- `.gitignore` — add `apps/worker/.venv/`, `apps/worker/.env`.

## Implementation notes
- `cli.run_app` gives you two modes: `dev` (reloads on change, connects to LiveKit Cloud, idle until dispatched) and `start` (production). Use `dev` locally.
- Do **not** call `session_scope` / DB / `AgentFanout` yet. Keep imports minimal so M21 runs with zero DB configured.
- `prewarm_fnc=prewarm` loads Silero VAD in the prewarm subprocess. Safe to keep even though M21 doesn't use it — M30 will.
- All prints go through `print(...)` for now; upgrade to `logging` in a later cleanup pass.
- Parse `meeting_id` from metadata at the top of `entrypoint` so M22 can verify the dispatch path end-to-end with a real UUID.

## Acceptance criteria
- [ ] `cd apps/worker && uv sync` installs cleanly on a fresh checkout.
- [ ] `uv run python -m src.main dev` starts and prints "registered worker" log from livekit-agents, then waits idle.
- [ ] Manually dispatching via the `lk` CLI (`lk dispatch create --agent-name meet-transcriber --room test-room --metadata '{"meeting_id":"test"}'`) causes the worker process to log `[worker] audio track from ...` when a browser joins that room.
- [ ] Stubbed modules (`transcription.py` etc.) exist as files so `from .transcription import ...` will work in later PRs without touching this module.
- [ ] `Dockerfile` builds: `docker build apps/worker -t meet-worker`.

## Smoke test
1. Start the worker: `cd apps/worker && uv run python -m src.main dev`.
2. In another terminal: `lk dispatch create --agent-name meet-transcriber --room smoke-test-room --metadata '{"meeting_id":"01HXXXX"}'` (requires `lk` CLI configured with the same LiveKit project).
3. Open https://meet.livekit.io, connect to `smoke-test-room` with the same project credentials.
4. Worker should print `[worker] participant joined: ...` and `[worker] audio track from ...`.
5. Disconnect the browser → worker prints `[worker] room disconnected`.

## Do NOT
- Do NOT run this worker on Vercel or any serverless platform (§12) — it holds a persistent WebSocket.
- Do NOT omit `agent_name="meet-transcriber"` — without it the worker would auto-dispatch to every room and blow up quotas.
- Do NOT add STT, paragraph buffering, DB writes, or fanout here. Those are M30/M31.
- Do NOT bake `LIVEKIT_API_SECRET` or `OPENAI_API_KEY` into the Dockerfile — pass at runtime.
- Do NOT set `hidden=False` — the worker must be invisible to other participants.
- Do NOT enable `can_publish=True` — worker never publishes media tracks.

## Hand-off
M22 will add the Node-side `AgentDispatchClient.createDispatch(meeting.livekit_room, 'meet-transcriber', { metadata: JSON.stringify({ meeting_id }) })` call inside `POST /meetings/:id/join` (positional args: roomName, agentName, options). The worker contract (agent name, metadata shape) is frozen here.
M30 will replace the `on_track` print with `ctx.create_task(attach_transcription(...))`.
