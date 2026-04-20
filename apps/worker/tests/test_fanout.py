"""Tests for M41 — AgentFanout."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.buffer import Message
from src.fanout import AgentFanout, AgentRow


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

MEETING_ID = "01JTEST000000000000000001"
AGENT_A_ID = "01JTEST000000000000AGENTA"
AGENT_B_ID = "01JTEST000000000000AGENTB"


def _agent_row(
    agent_id: str = AGENT_A_ID,
    name: str = "Test Agent",
    system_prompt: str = "You are a test agent.",
    provider: str = "openai",
    model: str = "gpt-4o-mini",
) -> dict:
    return {
        "id": agent_id,
        "name": name,
        "system_prompt": system_prompt,
        "provider": provider,
        "model": model,
    }


def _msg(speaker: str = "user_01", text: str = "hello", db_id: int | None = None) -> Message:
    return Message(
        speaker_identity=speaker,
        speaker_name=speaker,
        text=text,
        start_ts_ms=1000,
        end_ts_ms=2000,
        db_id=db_id,
    )


class _FakeSaver:
    """Mimics the actual AIOMySQLSaver (returned by __aenter__)."""

    def __init__(self):
        self.setup_called = False

    async def setup(self):
        self.setup_called = True


class _FakeCheckpointerCM:
    """Mimics the async context manager returned by AIOMySQLSaver.from_conn_string."""

    def __init__(self):
        self.saver = _FakeSaver()
        self.closed = False

    async def __aenter__(self):
        return self.saver

    async def __aexit__(self, *args):
        self.closed = True


class _FakeGraph:
    """Fake compiled graph that returns canned results."""

    def __init__(self, output: str = "test insight", raises: Exception | None = None):
        self._output = output
        self._raises = raises
        self.invocations: list[dict] = []

    async def ainvoke(self, state_in, config):
        self.invocations.append({"state": state_in, "config": config})
        if self._raises:
            raise self._raises
        return {
            **state_in,
            "last_output": self._output,
            "rolling_summary": "updated summary",
            "prompt_tokens": 10,
            "completion_tokens": 20,
        }


def _patch_db(monkeypatch, agents: list[dict] | None = None):
    """Monkeypatch all db functions used by fanout."""
    agents = agents if agents is not None else []
    monkeypatch.setattr(
        "src.fanout.load_agents_for_meeting", lambda mid: agents,
    )

    persist_counter = {"n": 0}

    def _persist_message(mid, msg):
        persist_counter["n"] += 1
        return 100 + persist_counter["n"] - 1
    monkeypatch.setattr("src.fanout.persist_message", _persist_message)

    run_counter = {"n": 0}

    def _create_run(*args, **kwargs):
        run_counter["n"] += 1
        return run_counter["n"]

    monkeypatch.setattr("src.fanout.create_agent_run", _create_run)
    monkeypatch.setattr("src.fanout.mark_run_running", lambda rid: None)

    done_calls = []
    monkeypatch.setattr(
        "src.fanout.mark_run_done",
        lambda rid, pt=None, ct=None: done_calls.append((rid, pt, ct)),
    )

    error_calls = []
    monkeypatch.setattr(
        "src.fanout.mark_run_error",
        lambda rid, err: error_calls.append((rid, err)),
    )

    output_calls = []

    def _save_output(rid, mid, aid, content, metadata=None):
        output_calls.append((rid, mid, aid, content))
        return 1

    monkeypatch.setattr("src.fanout.save_agent_output", _save_output)
    monkeypatch.setattr("src.fanout.deregister_worker", lambda mid: None)

    return {
        "persist_counter": persist_counter,
        "run_counter": run_counter,
        "done_calls": done_calls,
        "error_calls": error_calls,
        "output_calls": output_calls,
    }


def _install_fake_checkpointer(monkeypatch):
    """Replace AIOMySQLSaver.from_conn_string with a fake context manager."""
    fake_cm = _FakeCheckpointerCM()

    def fake_from_conn_string(url):
        return fake_cm

    monkeypatch.setattr(
        "src.fanout.AIOMySQLSaver.from_conn_string", fake_from_conn_string,
    )
    return fake_cm


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


async def test_load_agents_populates_roster(monkeypatch):
    """Two agents loaded, null provider/model resolved to defaults."""
    agents = [
        _agent_row(AGENT_A_ID, provider=None, model=None),
        _agent_row(AGENT_B_ID, name="Agent B", provider="anthropic", model="claude-sonnet-4-6"),
    ]
    _patch_db(monkeypatch, agents)
    fake_cm = _install_fake_checkpointer(monkeypatch)
    monkeypatch.setattr("src.fanout.build_graph", lambda cp: _FakeGraph())

    fanout = AgentFanout(MEETING_ID)
    count = await fanout.load_agents()

    assert count == 2
    assert len(fanout.agents) == 2
    # Agent A: null provider/model → defaults
    assert fanout.agents[0].provider == "openai"
    assert fanout.agents[0].model == "gpt-4o-mini"
    # Agent B: explicit values preserved
    assert fanout.agents[1].provider == "anthropic"
    assert fanout.agents[1].model == "claude-sonnet-4-6"
    assert fake_cm.saver.setup_called
    assert fanout.graph is not None


async def test_load_agents_empty_roster(monkeypatch):
    """No agents → checkpointer and graph stay None."""
    _patch_db(monkeypatch, agents=[])

    fanout = AgentFanout(MEETING_ID)
    count = await fanout.load_agents()

    assert count == 0
    assert fanout.agents == []
    assert fanout.checkpointer is None
    assert fanout.graph is None


async def test_on_paragraph_persists_immediately(monkeypatch):
    """on_paragraph calls persist_message and sets msg.db_id."""
    _patch_db(monkeypatch, agents=[])

    fanout = AgentFanout(MEETING_ID)
    await fanout.load_agents()

    msg = _msg(text="hello world")
    assert msg.db_id is None

    await fanout.on_paragraph(msg)

    assert msg.db_id is not None
    assert msg.db_id == 100


async def test_on_paragraph_still_buffers_on_persist_failure(monkeypatch):
    """If persist_message raises, the message still enters the buffer."""
    _patch_db(monkeypatch, agents=[])
    monkeypatch.setattr(
        "src.fanout.persist_message",
        lambda mid, msg: (_ for _ in ()).throw(RuntimeError("db down")),
    )

    fanout = AgentFanout(MEETING_ID)
    await fanout.load_agents()

    msg = _msg(text="still buffered")
    await fanout.on_paragraph(msg)

    assert msg.db_id is None
    # Message is in the buffer despite persist failure
    assert len(fanout.buffer._buf) == 1


async def test_on_flush_triggers_agents_with_db_ids(monkeypatch):
    """Buffer flush triggers agent runs using db_id from pre-persisted messages."""
    agents = [_agent_row(AGENT_A_ID)]
    tracker = _patch_db(monkeypatch, agents)
    _install_fake_checkpointer(monkeypatch)
    fake_graph = _FakeGraph()
    monkeypatch.setattr("src.fanout.build_graph", lambda cp: fake_graph)

    fanout = AgentFanout(MEETING_ID)
    await fanout.load_agents()

    # Simulate messages that were already persisted (db_id set)
    msgs = [_msg(text="one", db_id=100), _msg(text="two", db_id=101)]
    await fanout.on_buffer_flush(msgs)

    assert len(fake_graph.invocations) == 1
    assert tracker["run_counter"]["n"] == 1


async def test_on_flush_no_agents_is_noop(monkeypatch):
    """With no agents, flush is a no-op (transcript already persisted via on_paragraph)."""
    tracker = _patch_db(monkeypatch, agents=[])

    fanout = AgentFanout(MEETING_ID)
    await fanout.load_agents()

    msgs = [_msg(text="one", db_id=100)]
    await fanout.on_buffer_flush(msgs)

    assert tracker["run_counter"]["n"] == 0


async def test_on_flush_skips_when_no_persisted_msgs(monkeypatch):
    """If all messages failed persistence (db_id=None), flush skips agent runs."""
    agents = [_agent_row(AGENT_A_ID)]
    tracker = _patch_db(monkeypatch, agents)
    _install_fake_checkpointer(monkeypatch)
    fake_graph = _FakeGraph()
    monkeypatch.setattr("src.fanout.build_graph", lambda cp: fake_graph)

    fanout = AgentFanout(MEETING_ID)
    await fanout.load_agents()

    msgs = [_msg(text="no db_id")]  # db_id is None
    await fanout.on_buffer_flush(msgs)

    assert len(fake_graph.invocations) == 0
    assert tracker["run_counter"]["n"] == 0


async def test_on_flush_uses_only_persisted_messages(monkeypatch):
    """Mixed batch: only persisted messages (db_id set) are sent to agents."""
    agents = [_agent_row(AGENT_A_ID)]
    tracker = _patch_db(monkeypatch, agents)
    _install_fake_checkpointer(monkeypatch)
    fake_graph = _FakeGraph()
    monkeypatch.setattr("src.fanout.build_graph", lambda cp: fake_graph)

    fanout = AgentFanout(MEETING_ID)
    await fanout.load_agents()

    # Mix of persisted and unpersisted messages
    msgs = [
        _msg(text="failed persist"),          # db_id=None — should be excluded
        _msg(text="ok one", db_id=100),       # persisted
        _msg(text="also failed"),             # db_id=None — should be excluded
        _msg(text="ok two", db_id=101),       # persisted
    ]
    await fanout.on_buffer_flush(msgs)

    assert len(fake_graph.invocations) == 1
    state = fake_graph.invocations[0]["state"]
    # Agent sees ONLY the two persisted messages
    assert "[user_01] ok one" in state["new_buffer_text"]
    assert "[user_01] ok two" in state["new_buffer_text"]
    assert "failed persist" not in state["new_buffer_text"]
    assert "also failed" not in state["new_buffer_text"]


async def test_agent_error_does_not_cancel_others(monkeypatch):
    """Agent A raises, Agent B succeeds. Both tracked correctly."""
    agents = [
        _agent_row(AGENT_A_ID, name="Failing Agent"),
        _agent_row(AGENT_B_ID, name="Good Agent"),
    ]
    tracker = _patch_db(monkeypatch, agents)
    _install_fake_checkpointer(monkeypatch)

    invocation_count = {"n": 0}

    async def _fake_ainvoke(state_in, config):
        invocation_count["n"] += 1
        thread_id = config["configurable"]["thread_id"]
        if AGENT_A_ID in thread_id:
            raise ValueError("LLM exploded")
        return {
            **state_in,
            "last_output": "good output",
            "rolling_summary": "summary",
            "prompt_tokens": 5,
            "completion_tokens": 10,
        }

    fake_graph = MagicMock()
    fake_graph.ainvoke = _fake_ainvoke
    monkeypatch.setattr("src.fanout.build_graph", lambda cp: fake_graph)

    fanout = AgentFanout(MEETING_ID)
    await fanout.load_agents()
    await fanout.on_buffer_flush([_msg(db_id=100)])

    # Both agents attempted
    assert invocation_count["n"] == 2
    # One error, one success
    assert len(tracker["error_calls"]) == 1
    assert "LLM exploded" in tracker["error_calls"][0][1]
    assert len(tracker["done_calls"]) == 1
    assert len(tracker["output_calls"]) == 1


async def test_error_message_recorded(monkeypatch):
    """Exception string lands in mark_run_error."""
    agents = [_agent_row(AGENT_A_ID)]
    tracker = _patch_db(monkeypatch, agents)
    _install_fake_checkpointer(monkeypatch)

    async def _exploding_invoke(state_in, config):
        raise RuntimeError("rate limit exceeded")

    fake_graph = MagicMock()
    fake_graph.ainvoke = _exploding_invoke
    monkeypatch.setattr("src.fanout.build_graph", lambda cp: fake_graph)

    fanout = AgentFanout(MEETING_ID)
    await fanout.load_agents()
    await fanout.on_buffer_flush([_msg(db_id=100)])

    assert len(tracker["error_calls"]) == 1
    assert "rate limit exceeded" in tracker["error_calls"][0][1]


async def test_thread_id_isolation(monkeypatch):
    """Each agent gets thread_id = f'{meeting_id}:{agent_id}'."""
    agents = [
        _agent_row(AGENT_A_ID),
        _agent_row(AGENT_B_ID, name="Agent B"),
    ]
    _patch_db(monkeypatch, agents)
    _install_fake_checkpointer(monkeypatch)
    fake_graph = _FakeGraph()
    monkeypatch.setattr("src.fanout.build_graph", lambda cp: fake_graph)

    fanout = AgentFanout(MEETING_ID)
    await fanout.load_agents()
    await fanout.on_buffer_flush([_msg(db_id=100)])

    thread_ids = {
        inv["config"]["configurable"]["thread_id"]
        for inv in fake_graph.invocations
    }
    assert thread_ids == {
        f"{MEETING_ID}:{AGENT_A_ID}",
        f"{MEETING_ID}:{AGENT_B_ID}",
    }


async def test_finalize_closes_checkpointer(monkeypatch):
    """flush_all_and_finalize closes checkpointer and calls deregister_worker."""
    agents = [_agent_row(AGENT_A_ID)]
    _patch_db(monkeypatch, agents)
    fake_cm = _install_fake_checkpointer(monkeypatch)
    monkeypatch.setattr("src.fanout.build_graph", lambda cp: _FakeGraph())

    deregister_called = []
    monkeypatch.setattr(
        "src.fanout.deregister_worker",
        lambda mid: deregister_called.append(mid),
    )

    fanout = AgentFanout(MEETING_ID)
    await fanout.load_agents()
    await fanout.flush_all_and_finalize()

    assert fake_cm.closed
    assert deregister_called == [MEETING_ID]


async def test_finalize_flushes_before_close(monkeypatch):
    """Pending buffer messages are flushed and agents run before checkpointer close."""
    agents = [_agent_row(AGENT_A_ID)]
    tracker = _patch_db(monkeypatch, agents)
    fake_cm = _install_fake_checkpointer(monkeypatch)
    fake_graph = _FakeGraph()
    monkeypatch.setattr("src.fanout.build_graph", lambda cp: fake_graph)

    fanout = AgentFanout(MEETING_ID)
    await fanout.load_agents()

    # Add a message with db_id set (simulating pre-persisted via on_paragraph)
    msg = _msg(text="pending msg", db_id=100)
    await fanout.buffer.add(msg)

    # Now finalize — should flush the pending message first
    await fanout.flush_all_and_finalize()

    # Verify: agent ran (meaning flush happened before close)
    assert len(fake_graph.invocations) == 1
    assert tracker["run_counter"]["n"] == 1
    assert len(tracker["done_calls"]) == 1
    # Checkpointer closed AFTER agent completed
    assert fake_cm.closed


async def test_token_usage_captured(monkeypatch):
    """When graph returns token counts, they flow to mark_run_done."""
    agents = [_agent_row(AGENT_A_ID)]
    tracker = _patch_db(monkeypatch, agents)
    _install_fake_checkpointer(monkeypatch)

    fake_graph = _FakeGraph()  # returns prompt_tokens=10, completion_tokens=20
    monkeypatch.setattr("src.fanout.build_graph", lambda cp: fake_graph)

    fanout = AgentFanout(MEETING_ID)
    await fanout.load_agents()
    await fanout.on_buffer_flush([_msg(db_id=100)])

    assert len(tracker["done_calls"]) == 1
    run_id, pt, ct = tracker["done_calls"][0]
    assert pt == 10
    assert ct == 20
