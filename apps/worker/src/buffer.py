"""Transcript paragraph types and the per-meeting MessageBuffer."""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Awaitable, Callable


@dataclass
class Message:
    speaker_identity: str  # participant.identity (ULID from JWT)
    speaker_name: str  # participant.name or fallback to identity
    text: str  # transcribed paragraph text
    start_ts_ms: int  # wall-clock ms when speech started
    end_ts_ms: int  # wall-clock ms when speech ended
    db_id: int | None = None  # set after immediate persist to DB


@dataclass
class MessageBuffer:
    """Per-meeting paragraph accumulator. One instance collects from all speakers."""

    on_flush: Callable[[list[Message]], Awaitable[None]]
    max_messages: int = 10
    silence_ms: int = 1500
    _buf: list[Message] = field(default_factory=list)
    _last_speaker: str | None = None
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    async def add(self, msg: Message) -> None:
        async with self._lock:
            self._buf.append(msg)
            if len(self._buf) >= self.max_messages:
                await self._flush_locked()

    async def on_paragraph(self, msg: Message) -> None:
        # ParagraphSink protocol adapter (transcription.py calls this).
        await self.add(msg)

    async def maybe_flush_on_silence(self) -> None:
        async with self._lock:
            if not self._buf:
                return
            now_ms = int(time.time() * 1000)
            # silence_ms * 4: flush only when last message ended >6s ago,
            # i.e. the speaker is clearly done with their turn.
            if now_ms - self._buf[-1].end_ts_ms > self.silence_ms * 4:
                await self._flush_locked()

    async def flush(self) -> None:
        async with self._lock:
            await self._flush_locked()

    async def _flush_locked(self) -> None:
        if not self._buf:
            return
        msgs, self._buf = self._buf, []
        await self.on_flush(msgs)
