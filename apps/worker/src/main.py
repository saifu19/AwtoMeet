import asyncio
import json
import logging
import re

from dotenv import load_dotenv
from livekit import agents, rtc
from livekit.agents import AutoSubscribe, JobContext, WorkerOptions, WorkerPermissions, cli
from livekit.plugins import openai, silero

from .db import (
    deregister_worker,
    get_buffer_size,
    mark_meeting_live,
    register_worker,
)
from .fanout import AgentFanout
from .transcription import attach_transcription

load_dotenv()

logger = logging.getLogger("worker")

# Crockford's Base32 alphabet (RFC-like), 26 chars — same as the ULIDs
# produced by the `ulid` npm package used on the API side.
_ULID_RE = re.compile(r"^[0-9A-HJKMNP-TV-Z]{26}$")


def _is_human(participant: rtc.Participant) -> bool:
    return participant.kind == rtc.ParticipantKind.PARTICIPANT_KIND_STANDARD


def _parse_meeting_id(raw_metadata: str) -> str:
    """Parse the dispatch metadata and return a validated meeting_id ULID.

    Raises ValueError if the metadata is missing meeting_id or the id is not a
    well-formed ULID. Fails fast so a malformed dispatch does not create
    orphaned DB rows or burn STT minutes against an invalid target.
    """
    try:
        payload = json.loads(raw_metadata or "{}")
    except json.JSONDecodeError as exc:
        raise ValueError(f"dispatch metadata is not valid JSON: {exc}") from exc
    meeting_id = payload.get("meeting_id")
    if not isinstance(meeting_id, str) or not _ULID_RE.match(meeting_id):
        raise ValueError(f"dispatch metadata meeting_id is not a ULID: {meeting_id!r}")
    return meeting_id


async def entrypoint(ctx: JobContext):
    meeting_id = _parse_meeting_id(ctx.job.metadata or "{}")
    job_id = ctx.job.id

    # Record ourselves as the active worker on this meeting row. One-worker-
    # per-meeting is enforced at the API + LiveKit layers, not here (see
    # docstring on register_worker). If the write fails (DB unreachable, row
    # missing) we log and continue — better to transcribe without registration
    # than to silently bail on a user-visible meeting.
    register_worker(meeting_id, job_id)

    # Outer try/except guarantees deregister_worker runs on ANY crash — including
    # failures during connect, load_agents, or setup. Without this, a crash
    # leaves worker_job_id set and the API never dispatches a new worker.
    fanout: AgentFanout | None = None
    try:
        buffer_size = get_buffer_size(meeting_id)
        fanout = AgentFanout(meeting_id, buffer_size=buffer_size)
        transcription_tasks: dict[str, asyncio.Task] = {}
        disconnect_event = asyncio.Event()

        # participant/track handlers are REGISTERED BEFORE ctx.connect() so the
        # room-state sync that fires during connect doesn't race ahead of us.
        # LiveKit does not re-emit participant_connected for participants
        # already in the room when the worker joins — we sweep them manually
        # right after connect (see below).
        #
        # track_subscribed needs `stt` which needs `vad` from ctx.proc.userdata;
        # we build that first, then attach the handler — still before connect.

        @ctx.room.on("participant_connected")
        def on_join(participant):
            logger.info(
                "participant joined: %s (kind=%s)",
                participant.identity, participant.kind,
            )
            if _is_human(participant):
                mark_meeting_live(meeting_id)

        @ctx.room.on("participant_disconnected")
        def on_leave(participant):
            logger.info("participant left: %s", participant.identity)
            humans = [
                p for p in ctx.room.remote_participants.values() if _is_human(p)
            ]
            if not humans:
                logger.info("no humans remain, ending meeting %s", meeting_id)
                asyncio.create_task(ctx.room.disconnect())

        @ctx.room.on("disconnected")
        def on_disconnected(reason):
            logger.info("room disconnected: %s", reason)
            disconnect_event.set()

        vad = ctx.proc.userdata["vad"]
        base_stt = openai.STT(model="gpt-4o-transcribe", language="en")
        stt = agents.stt.StreamAdapter(stt=base_stt, vad=vad)

        @ctx.room.on("track_subscribed")
        def on_track(track, pub, participant):
            if track.kind == rtc.TrackKind.KIND_AUDIO:
                task_key = participant.identity
                old_task = transcription_tasks.pop(task_key, None)
                if old_task and not old_task.done():
                    old_task.cancel()

                task = asyncio.create_task(
                    attach_transcription(
                        participant=participant,
                        track=track,
                        stt=stt,
                        sink=fanout,
                        room=ctx.room,
                    ),
                    name=f"stt-{task_key}",
                )
                transcription_tasks[task_key] = task
                task.add_done_callback(
                    lambda t, k=task_key: transcription_tasks.pop(k, None)
                )

        await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

        # Post-connect sweep: catch participants who were ALREADY in the room
        # when the worker joined. LiveKit populates ctx.room.remote_participants
        # synchronously after connect but does NOT emit participant_connected
        # for them, so the handler above would never fire and the meeting would
        # stay 'scheduled' forever if the host joined before the worker.
        for p in ctx.room.remote_participants.values():
            logger.info(
                "pre-existing participant at connect: %s (kind=%s)",
                p.identity, p.kind,
            )
            if _is_human(p):
                mark_meeting_live(meeting_id)
                break  # mark_meeting_live is idempotent, one call is enough

        # Now safe to do async agent setup — the buffer is ready (created in
        # AgentFanout.__init__) and any pre-load_agents flush will persist
        # transcript but skip agents (self.agents is still empty).
        await fanout.load_agents()

        try:
            await disconnect_event.wait()
        finally:
            # Order: cancel STT → flush buffer + agents → close checkpointer → end meeting.
            for task in transcription_tasks.values():
                task.cancel()
            await asyncio.gather(
                *transcription_tasks.values(),
                return_exceptions=True,
            )
            await fanout.flush_all_and_finalize()

    except Exception:
        logger.exception("worker crashed for meeting %s", meeting_id)
        deregister_worker(meeting_id)


def prewarm(proc):
    proc.userdata["vad"] = silero.VAD.load()


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
            agent_name="meet-transcriber",
            permissions=WorkerPermissions(
                can_subscribe=True,
                can_publish=False,
                can_publish_data=True,
                hidden=True,
            ),
        )
    )
