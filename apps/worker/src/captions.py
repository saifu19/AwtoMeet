"""Live-caption publish helper for M34.

Publishes transcript paragraphs to the LiveKit room as data-channel messages
on topic ``"transcript"``. Consumed by the web ``<LiveCaptions />`` overlay.

The publish is best-effort: any failure is logged and swallowed so the
M31 DB persist path and M33 SSE feed remain unaffected.
"""

from __future__ import annotations

import json
import logging

from livekit import rtc

from .buffer import Message

logger = logging.getLogger("captions")

# Must match packages/shared/src/captions.ts CAPTION_TOPIC — cross-runtime contract.
CAPTION_TOPIC = "transcript"


async def publish_caption(room: rtc.Room, msg: Message) -> None:
    """Publish one paragraph to the room's data channel.

    Fire-and-forget: errors are swallowed after logging so transcription is
    never blocked by a failed publish.
    """
    payload = json.dumps(
        {
            "speaker_identity": msg.speaker_identity,
            "speaker_name": msg.speaker_name,
            "text": msg.text,
            "start_ts_ms": msg.start_ts_ms,
            "end_ts_ms": msg.end_ts_ms,
        }
    ).encode("utf-8")

    try:
        await room.local_participant.publish_data(
            payload=payload,
            topic=CAPTION_TOPIC,
            reliable=True,
        )
    except Exception:
        logger.warning("caption publish failed for %s", msg.speaker_identity, exc_info=True)
