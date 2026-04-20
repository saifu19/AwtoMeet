"""Tests for M34 — Live caption publish helper + transcription integration."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from livekit.agents.stt import SpeechEventType
from livekit.agents.stt.stt import SpeechData, SpeechEvent

from src.buffer import Message
from src.captions import CAPTION_TOPIC, publish_caption
from src.transcription import attach_transcription


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


def _make_room() -> MagicMock:
    """Build a fake rtc.Room with an async publish_data on local_participant."""
    room = MagicMock()
    room.local_participant = MagicMock()
    room.local_participant.publish_data = AsyncMock(return_value=None)
    return room


def _make_msg(text: str = "hello world") -> Message:
    return Message(
        speaker_identity="user_01ARZ3NDEKTSV4RRFFQ69G5FAV",
        speaker_name="Alice",
        text=text,
        start_ts_ms=1_700_000_000_000,
        end_ts_ms=1_700_000_001_500,
    )


class FakeAudioStream:
    def __aiter__(self):
        return self

    async def __anext__(self):
        raise StopAsyncIteration


class FakeRecognizeStream:
    def __init__(self, events):
        self._events = events

    def push_frame(self, frame):
        pass

    def end_input(self):
        pass

    async def aclose(self):
        pass

    def __aiter__(self):
        return self

    async def __anext__(self):
        if not self._events:
            raise StopAsyncIteration
        return self._events.pop(0)


def _speech_event(event_type: SpeechEventType, text: str = "") -> SpeechEvent:
    alts = [SpeechData(language="en", text=text)] if text else []
    return SpeechEvent(type=event_type, alternatives=alts)


def _make_stt(events):
    stt = MagicMock()
    stt.stream.return_value = FakeRecognizeStream(events)
    return stt


def _make_participant(identity: str = "user_01", name: str = "Alice"):
    p = MagicMock()
    p.identity = identity
    p.name = name
    return p


def _make_track():
    t = MagicMock()
    t.sid = "TR_abc"
    t.kind = "audio"
    return t


# ---------------------------------------------------------------------------
# publish_caption unit tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_publish_caption_shape():
    room = _make_room()
    msg = _make_msg()

    await publish_caption(room, msg)

    room.local_participant.publish_data.assert_awaited_once()
    kwargs = room.local_participant.publish_data.await_args.kwargs
    assert kwargs["topic"] == CAPTION_TOPIC == "transcript"
    assert kwargs["reliable"] is True

    payload = json.loads(kwargs["payload"].decode("utf-8"))
    assert payload == {
        "speaker_identity": msg.speaker_identity,
        "speaker_name": msg.speaker_name,
        "text": msg.text,
        "start_ts_ms": msg.start_ts_ms,
        "end_ts_ms": msg.end_ts_ms,
    }


@pytest.mark.asyncio
async def test_publish_caption_swallows_errors(caplog):
    import logging

    room = _make_room()
    room.local_participant.publish_data = AsyncMock(side_effect=RuntimeError("boom"))

    with caplog.at_level(logging.WARNING, logger="captions"):
        # Must not raise
        await publish_caption(room, _make_msg())

    assert any("caption publish failed" in rec.message for rec in caplog.records)


# ---------------------------------------------------------------------------
# attach_transcription integration tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_transcription_publishes_before_sink(monkeypatch):
    """Publish must happen BEFORE sink.on_paragraph so captions feel instant."""
    events = [
        _speech_event(SpeechEventType.START_OF_SPEECH),
        _speech_event(SpeechEventType.END_OF_SPEECH),
        _speech_event(SpeechEventType.FINAL_TRANSCRIPT, text="hi"),
    ]
    stt = _make_stt(events)

    order: list[str] = []

    room = MagicMock()
    room.local_participant = MagicMock()

    async def fake_publish_data(**kwargs):
        order.append("publish")

    room.local_participant.publish_data = AsyncMock(side_effect=fake_publish_data)

    class RecordingSink:
        async def on_paragraph(self, msg: Message) -> None:
            order.append("sink")

    monkeypatch.setattr("src.transcription.rtc.AudioStream", lambda t: FakeAudioStream())

    await attach_transcription(
        participant=_make_participant(),
        track=_make_track(),
        stt=stt,
        sink=RecordingSink(),
        room=room,
    )

    assert order == ["publish", "sink"]


@pytest.mark.asyncio
async def test_transcription_survives_failing_publish(monkeypatch):
    """A publish_data exception must NOT break the M31 sink path."""
    events = [
        _speech_event(SpeechEventType.START_OF_SPEECH),
        _speech_event(SpeechEventType.END_OF_SPEECH),
        _speech_event(SpeechEventType.FINAL_TRANSCRIPT, text="still persists"),
    ]
    stt = _make_stt(events)

    room = MagicMock()
    room.local_participant = MagicMock()
    room.local_participant.publish_data = AsyncMock(side_effect=RuntimeError("network down"))

    class CollectingSink:
        def __init__(self):
            self.msgs: list[Message] = []

        async def on_paragraph(self, msg: Message) -> None:
            self.msgs.append(msg)

    sink = CollectingSink()

    monkeypatch.setattr("src.transcription.rtc.AudioStream", lambda t: FakeAudioStream())

    await attach_transcription(
        participant=_make_participant(),
        track=_make_track(),
        stt=stt,
        sink=sink,
        room=room,
    )

    assert len(sink.msgs) == 1
    assert sink.msgs[0].text == "still persists"


@pytest.mark.asyncio
async def test_transcription_without_room_is_backward_compatible(monkeypatch):
    """Existing callers that don't pass room still work unchanged (M30/M31)."""
    events = [
        _speech_event(SpeechEventType.START_OF_SPEECH),
        _speech_event(SpeechEventType.END_OF_SPEECH),
        _speech_event(SpeechEventType.FINAL_TRANSCRIPT, text="legacy path"),
    ]
    stt = _make_stt(events)

    class CollectingSink:
        def __init__(self):
            self.msgs: list[Message] = []

        async def on_paragraph(self, msg: Message) -> None:
            self.msgs.append(msg)

    sink = CollectingSink()

    monkeypatch.setattr("src.transcription.rtc.AudioStream", lambda t: FakeAudioStream())

    await attach_transcription(
        participant=_make_participant(),
        track=_make_track(),
        stt=stt,
        sink=sink,
    )

    assert len(sink.msgs) == 1
    assert sink.msgs[0].text == "legacy path"
