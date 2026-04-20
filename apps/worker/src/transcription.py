"""STT stream per (participant, track) with paragraph detection via StreamAdapter."""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Protocol

from livekit import agents, rtc
from livekit.agents.stt import SpeechEventType

from .buffer import Message
from .captions import publish_caption

logger = logging.getLogger("transcription")


class ParagraphSink(Protocol):
    async def on_paragraph(self, msg: Message) -> None: ...


class PrintSink:
    """Logs paragraphs to stdout. Replaced by MessageBuffer in M31."""

    async def on_paragraph(self, msg: Message) -> None:
        logger.info(
            "[%s] %s (%d..%d)",
            msg.speaker_name,
            msg.text,
            msg.start_ts_ms,
            msg.end_ts_ms,
        )


async def attach_transcription(
    *,
    participant: rtc.RemoteParticipant,
    track: rtc.Track,
    stt: agents.stt.STT,
    sink: ParagraphSink,
    room: rtc.Room | None = None,
) -> None:
    """One STT stream per (participant, track). Emits paragraphs to sink."""
    audio = rtc.AudioStream(track)
    stream = stt.stream()

    async def pump() -> None:
        """Forward audio frames to the STT stream."""
        try:
            async for ev in audio:
                stream.push_frame(ev.frame)
        except asyncio.CancelledError:
            pass
        finally:
            stream.end_input()

    pump_task = asyncio.create_task(pump(), name=f"stt-pump-{participant.identity}")

    para_start_ms: int | None = None
    para_end_ms: int | None = None

    try:
        async for ev in stream:
            if ev.type == SpeechEventType.START_OF_SPEECH:
                para_start_ms = int(time.time() * 1000)

            elif ev.type == SpeechEventType.END_OF_SPEECH:
                para_end_ms = int(time.time() * 1000)

            elif ev.type == SpeechEventType.FINAL_TRANSCRIPT:
                alt = ev.alternatives[0] if ev.alternatives else None
                if alt is None or not alt.text.strip():
                    para_start_ms, para_end_ms = None, None
                    continue

                now_ms = int(time.time() * 1000)
                msg = Message(
                    speaker_identity=participant.identity,
                    speaker_name=participant.name or participant.identity,
                    text=alt.text.strip(),
                    start_ts_ms=para_start_ms or now_ms,
                    end_ts_ms=para_end_ms or now_ms,
                )
                # M34: publish to room data channel BEFORE DB persist so captions
                # feel instant. publish_caption swallows its own errors — never
                # blocks the sink call that feeds M31/M33.
                if room is not None:
                    await publish_caption(room, msg)
                await sink.on_paragraph(msg)
                para_start_ms, para_end_ms = None, None

    except asyncio.CancelledError:
        logger.debug("attach_transcription cancelled for %s", participant.identity)
    except Exception:
        logger.exception("STT stream error for %s", participant.identity)
    finally:
        pump_task.cancel()
        await asyncio.gather(pump_task, return_exceptions=True)
        await stream.aclose()
        try:
            await audio.aclose()
        except Exception:
            logger.debug("audio stream close failed for %s", participant.identity)
        logger.debug("attach_transcription ended for %s", participant.identity)
