"""Tests for M31 — MessageBuffer."""

from __future__ import annotations

import asyncio
import time

import pytest

from src.buffer import Message, MessageBuffer


def _msg(
    i: int = 0,
    *,
    speaker: str = "user_01",
    end_ts_ms: int | None = None,
) -> Message:
    now_ms = int(time.time() * 1000)
    return Message(
        speaker_identity=speaker,
        speaker_name=speaker,
        text=f"msg {i}",
        start_ts_ms=now_ms,
        end_ts_ms=end_ts_ms if end_ts_ms is not None else now_ms,
    )


class _RecordingFlush:
    """Captures calls to on_flush for assertions."""

    def __init__(self) -> None:
        self.calls: list[list[Message]] = []

    async def __call__(self, msgs: list[Message]) -> None:
        # Store a shallow copy so later mutations don't bleed in.
        self.calls.append(list(msgs))


@pytest.mark.asyncio
async def test_add_flushes_at_max_messages():
    flush = _RecordingFlush()
    buf = MessageBuffer(on_flush=flush, max_messages=10)

    for i in range(10):
        await buf.add(_msg(i))

    assert len(flush.calls) == 1
    assert len(flush.calls[0]) == 10
    assert [m.text for m in flush.calls[0]] == [f"msg {i}" for i in range(10)]
    assert buf._buf == []


@pytest.mark.asyncio
async def test_add_does_not_flush_below_max():
    flush = _RecordingFlush()
    buf = MessageBuffer(on_flush=flush, max_messages=10)

    for i in range(9):
        await buf.add(_msg(i))

    assert flush.calls == []
    assert len(buf._buf) == 9


@pytest.mark.asyncio
async def test_maybe_flush_on_silence_holds_when_recent():
    flush = _RecordingFlush()
    buf = MessageBuffer(on_flush=flush, max_messages=10, silence_ms=1500)

    # end_ts_ms = now → 0ms elapsed, below 6000ms threshold
    await buf.add(_msg(end_ts_ms=int(time.time() * 1000)))
    await buf.maybe_flush_on_silence()

    assert flush.calls == []
    assert len(buf._buf) == 1


@pytest.mark.asyncio
async def test_maybe_flush_on_silence_flushes_after_timeout():
    flush = _RecordingFlush()
    buf = MessageBuffer(on_flush=flush, max_messages=10, silence_ms=1500)

    # end_ts_ms 10s ago → well past the 6s (silence_ms * 4) threshold
    old_end = int(time.time() * 1000) - 10_000
    await buf.add(_msg(end_ts_ms=old_end))
    await buf.maybe_flush_on_silence()

    assert len(flush.calls) == 1
    assert len(flush.calls[0]) == 1
    assert buf._buf == []


@pytest.mark.asyncio
async def test_maybe_flush_on_silence_noop_when_empty():
    flush = _RecordingFlush()
    buf = MessageBuffer(on_flush=flush, max_messages=10)

    await buf.maybe_flush_on_silence()

    assert flush.calls == []


@pytest.mark.asyncio
async def test_public_flush_drains_buffer():
    flush = _RecordingFlush()
    buf = MessageBuffer(on_flush=flush, max_messages=10)

    for i in range(3):
        await buf.add(_msg(i))
    await buf.flush()

    assert len(flush.calls) == 1
    assert len(flush.calls[0]) == 3
    assert buf._buf == []


@pytest.mark.asyncio
async def test_public_flush_noop_when_empty():
    flush = _RecordingFlush()
    buf = MessageBuffer(on_flush=flush, max_messages=10)

    await buf.flush()

    assert flush.calls == []


@pytest.mark.asyncio
async def test_concurrent_add_preserves_order():
    """Two tasks interleaving add() must produce a single flushed batch
    whose ordering reflects the serialized acquisition of the lock."""
    flush = _RecordingFlush()
    buf = MessageBuffer(on_flush=flush, max_messages=10)

    async def push_with_tag(tag: str) -> None:
        for i in range(5):
            await buf.add(
                Message(
                    speaker_identity=tag,
                    speaker_name=tag,
                    text=f"{tag}-{i}",
                    start_ts_ms=0,
                    end_ts_ms=0,
                )
            )

    await asyncio.gather(push_with_tag("A"), push_with_tag("B"))

    assert len(flush.calls) == 1
    batch = flush.calls[0]
    assert len(batch) == 10

    # Each tag's own messages must remain in order (0..4) relative to themselves.
    a_texts = [m.text for m in batch if m.speaker_identity == "A"]
    b_texts = [m.text for m in batch if m.speaker_identity == "B"]
    assert a_texts == [f"A-{i}" for i in range(5)]
    assert b_texts == [f"B-{i}" for i in range(5)]


@pytest.mark.asyncio
async def test_on_flush_exception_propagates():
    """Per brief: log, re-raise, let the coroutine crash."""

    async def boom(msgs: list[Message]) -> None:
        raise RuntimeError("db down")

    buf = MessageBuffer(on_flush=boom, max_messages=2)

    with pytest.raises(RuntimeError, match="db down"):
        await buf.add(_msg(0))
        await buf.add(_msg(1))  # triggers flush → boom
