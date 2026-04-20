"""Tests for M30 — STT Stream + Paragraph Detection."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

from livekit.agents.stt import SpeechEventType
from livekit.agents.stt.stt import SpeechData, SpeechEvent

from src.buffer import Message
from src.transcription import PrintSink, attach_transcription


# ---------------------------------------------------------------------------
# Helpers / Fakes
# ---------------------------------------------------------------------------


class FakeRecognizeStream:
    """Minimal fake that replays a scripted list of SpeechEvents."""

    def __init__(self, events: list[SpeechEvent]) -> None:
        self._events = events
        self._input_ended = False
        self._closed = False

    def push_frame(self, frame) -> None:
        pass

    def end_input(self) -> None:
        self._input_ended = True

    async def aclose(self) -> None:
        self._closed = True

    def __aiter__(self):
        return self

    async def __anext__(self) -> SpeechEvent:
        if not self._events:
            raise StopAsyncIteration
        return self._events.pop(0)


class FakeAudioStream:
    """Yields nothing — no audio frames needed for unit tests."""

    def __init__(self):
        self.aclose = AsyncMock()

    def __aiter__(self):
        return self

    async def __anext__(self):
        raise StopAsyncIteration


class FakeSink:
    """Collects paragraphs for assertions."""

    def __init__(self) -> None:
        self.paragraphs: list[Message] = []

    async def on_paragraph(self, msg: Message) -> None:
        self.paragraphs.append(msg)


def _speech_event(
    event_type: SpeechEventType,
    text: str = "",
    language: str = "en",
) -> SpeechEvent:
    """Build a SpeechEvent with minimal boilerplate."""
    alts = []
    if text:
        alts = [SpeechData(language=language, text=text)]
    return SpeechEvent(type=event_type, alternatives=alts)


def _make_participant(identity: str = "user_01", name: str = "Alice"):
    p = MagicMock()
    p.identity = identity
    p.name = name
    return p


def _make_track(sid: str = "TR_abc"):
    t = MagicMock()
    t.sid = sid
    t.kind = "audio"
    return t


def _make_stt(events: list[SpeechEvent]) -> MagicMock:
    """Return a fake STT whose .stream() returns a FakeRecognizeStream."""
    stt = MagicMock()
    stt.stream.return_value = FakeRecognizeStream(events)
    return stt


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_single_paragraph(monkeypatch):
    """START_OF_SPEECH → END_OF_SPEECH → FINAL_TRANSCRIPT produces one Message."""
    events = [
        _speech_event(SpeechEventType.START_OF_SPEECH),
        _speech_event(SpeechEventType.END_OF_SPEECH),
        _speech_event(SpeechEventType.FINAL_TRANSCRIPT, text="hello world"),
    ]
    stt = _make_stt(events)
    sink = FakeSink()
    participant = _make_participant("user_01", "Alice")
    track = _make_track()

    fake_audio = FakeAudioStream()
    monkeypatch.setattr("src.transcription.rtc.AudioStream", lambda t: fake_audio)

    await attach_transcription(
        participant=participant,
        track=track,
        stt=stt,
        sink=sink,
    )

    assert len(sink.paragraphs) == 1
    fake_audio.aclose.assert_awaited_once()
    msg = sink.paragraphs[0]
    assert msg.speaker_identity == "user_01"
    assert msg.speaker_name == "Alice"
    assert msg.text == "hello world"
    assert msg.start_ts_ms > 0
    assert msg.end_ts_ms > 0


@pytest.mark.asyncio
async def test_silence_produces_no_message(monkeypatch):
    """START_OF_SPEECH → END_OF_SPEECH → empty FINAL_TRANSCRIPT → no Message."""
    events = [
        _speech_event(SpeechEventType.START_OF_SPEECH),
        _speech_event(SpeechEventType.END_OF_SPEECH),
        _speech_event(SpeechEventType.FINAL_TRANSCRIPT, text=""),
    ]
    stt = _make_stt(events)
    sink = FakeSink()

    monkeypatch.setattr("src.transcription.rtc.AudioStream", lambda t: FakeAudioStream())

    await attach_transcription(
        participant=_make_participant(),
        track=_make_track(),
        stt=stt,
        sink=sink,
    )

    assert len(sink.paragraphs) == 0


@pytest.mark.asyncio
async def test_whitespace_only_produces_no_message(monkeypatch):
    """Whitespace-only transcript text is skipped."""
    events = [
        _speech_event(SpeechEventType.START_OF_SPEECH),
        _speech_event(SpeechEventType.END_OF_SPEECH),
        _speech_event(SpeechEventType.FINAL_TRANSCRIPT, text="   "),
    ]
    stt = _make_stt(events)
    sink = FakeSink()

    monkeypatch.setattr("src.transcription.rtc.AudioStream", lambda t: FakeAudioStream())

    await attach_transcription(
        participant=_make_participant(),
        track=_make_track(),
        stt=stt,
        sink=sink,
    )

    assert len(sink.paragraphs) == 0


@pytest.mark.asyncio
async def test_multiple_turns(monkeypatch):
    """Two speech turns produce two independent Messages."""
    events = [
        _speech_event(SpeechEventType.START_OF_SPEECH),
        _speech_event(SpeechEventType.END_OF_SPEECH),
        _speech_event(SpeechEventType.FINAL_TRANSCRIPT, text="first turn"),
        _speech_event(SpeechEventType.START_OF_SPEECH),
        _speech_event(SpeechEventType.END_OF_SPEECH),
        _speech_event(SpeechEventType.FINAL_TRANSCRIPT, text="second turn"),
    ]
    stt = _make_stt(events)
    sink = FakeSink()

    monkeypatch.setattr("src.transcription.rtc.AudioStream", lambda t: FakeAudioStream())

    await attach_transcription(
        participant=_make_participant("user_02", "Bob"),
        track=_make_track(),
        stt=stt,
        sink=sink,
    )

    assert len(sink.paragraphs) == 2
    assert sink.paragraphs[0].text == "first turn"
    assert sink.paragraphs[1].text == "second turn"
    assert all(m.speaker_identity == "user_02" for m in sink.paragraphs)
    assert all(m.speaker_name == "Bob" for m in sink.paragraphs)


@pytest.mark.asyncio
async def test_speaker_name_fallback(monkeypatch):
    """When participant.name is empty, speaker_name falls back to identity."""
    events = [
        _speech_event(SpeechEventType.START_OF_SPEECH),
        _speech_event(SpeechEventType.END_OF_SPEECH),
        _speech_event(SpeechEventType.FINAL_TRANSCRIPT, text="no name"),
    ]
    stt = _make_stt(events)
    sink = FakeSink()
    participant = _make_participant("user_03", "")

    monkeypatch.setattr("src.transcription.rtc.AudioStream", lambda t: FakeAudioStream())

    await attach_transcription(
        participant=participant,
        track=_make_track(),
        stt=stt,
        sink=sink,
    )

    assert len(sink.paragraphs) == 1
    assert sink.paragraphs[0].speaker_name == "user_03"


@pytest.mark.asyncio
async def test_final_transcript_without_alternatives(monkeypatch):
    """FINAL_TRANSCRIPT with no alternatives is safely skipped."""
    events = [
        _speech_event(SpeechEventType.START_OF_SPEECH),
        _speech_event(SpeechEventType.END_OF_SPEECH),
        SpeechEvent(type=SpeechEventType.FINAL_TRANSCRIPT, alternatives=[]),
    ]
    stt = _make_stt(events)
    sink = FakeSink()

    monkeypatch.setattr("src.transcription.rtc.AudioStream", lambda t: FakeAudioStream())

    await attach_transcription(
        participant=_make_participant(),
        track=_make_track(),
        stt=stt,
        sink=sink,
    )

    assert len(sink.paragraphs) == 0


@pytest.mark.asyncio
async def test_text_is_stripped(monkeypatch):
    """Leading/trailing whitespace in transcript text is stripped."""
    events = [
        _speech_event(SpeechEventType.START_OF_SPEECH),
        _speech_event(SpeechEventType.END_OF_SPEECH),
        _speech_event(SpeechEventType.FINAL_TRANSCRIPT, text="  hello world  "),
    ]
    stt = _make_stt(events)
    sink = FakeSink()

    monkeypatch.setattr("src.transcription.rtc.AudioStream", lambda t: FakeAudioStream())

    await attach_transcription(
        participant=_make_participant(),
        track=_make_track(),
        stt=stt,
        sink=sink,
    )

    assert sink.paragraphs[0].text == "hello world"


@pytest.mark.asyncio
async def test_print_sink_logs(monkeypatch, caplog):
    """PrintSink logs in the expected format."""
    import logging

    msg = Message(
        speaker_identity="user_01",
        speaker_name="Alice",
        text="hello",
        start_ts_ms=1000,
        end_ts_ms=2000,
    )
    sink = PrintSink()

    with caplog.at_level(logging.INFO, logger="transcription"):
        await sink.on_paragraph(msg)

    assert "[Alice] hello (1000..2000)" in caplog.text


@pytest.mark.asyncio
async def test_speaker_fields_snapshot_at_attach_time(monkeypatch):
    """F03: identity/name are snapshotted at attach time, not read at emit.

    Simulates the LiveKit proxy being mutated (name/identity changed) AFTER
    the stream has started. The emitted Message must still carry the values
    captured when attach_transcription was invoked.
    """
    events = [
        _speech_event(SpeechEventType.START_OF_SPEECH),
        _speech_event(SpeechEventType.END_OF_SPEECH),
        _speech_event(SpeechEventType.FINAL_TRANSCRIPT, text="hello"),
    ]
    stt = _make_stt(events)
    sink = FakeSink()
    participant = _make_participant("muaz_01", "Muaz")

    monkeypatch.setattr("src.transcription.rtc.AudioStream", lambda t: FakeAudioStream())

    # Mutate the proxy mid-flight. Without the F03 snapshot, the emission
    # would pick up these new values and misattribute Muaz's speech to Saif.
    original_stream = stt.stream

    def mutating_stream():
        participant.identity = "saif_02"
        participant.name = "Saif"
        return original_stream.return_value
    stt.stream = mutating_stream

    await attach_transcription(
        participant=participant,
        track=_make_track(),
        stt=stt,
        sink=sink,
    )

    assert len(sink.paragraphs) == 1
    assert sink.paragraphs[0].speaker_identity == "muaz_01"
    assert sink.paragraphs[0].speaker_name == "Muaz"


@pytest.mark.asyncio
async def test_cancellation_cleans_up(monkeypatch):
    """Cancelling the task cleans up pump and stream without errors."""

    class HangingStream:
        """Stream that blocks forever, simulating a live connection."""

        def __init__(self):
            self._closed = False
            self._input_ended = False

        def push_frame(self, frame):
            pass

        def end_input(self):
            self._input_ended = True

        async def aclose(self):
            self._closed = True

        def __aiter__(self):
            return self

        async def __anext__(self):
            await asyncio.sleep(3600)
            raise StopAsyncIteration

    hanging_stream = HangingStream()
    stt = MagicMock()
    stt.stream.return_value = hanging_stream
    sink = FakeSink()

    monkeypatch.setattr("src.transcription.rtc.AudioStream", lambda t: FakeAudioStream())

    task = asyncio.create_task(
        attach_transcription(
            participant=_make_participant(),
            track=_make_track(),
            stt=stt,
            sink=sink,
        )
    )

    await asyncio.sleep(0.05)
    task.cancel()

    # Should complete without raising
    await asyncio.gather(task, return_exceptions=True)

    assert hanging_stream._closed
    assert len(sink.paragraphs) == 0
