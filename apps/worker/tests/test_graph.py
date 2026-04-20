"""Tests for M40 — LangGraph graph definition."""

from __future__ import annotations

import pytest

from src.graph import AgentState, _get_llm, build_graph


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


class _FakeAIMessage:
    """Mimics an LLM response with a .content attribute."""

    def __init__(self, content: str) -> None:
        self.content = content


class _CapturingFakeLLM:
    """Fake LLM that returns canned responses and captures call args."""

    def __init__(self, responses: list[str]) -> None:
        self._responses = responses
        self._idx = 0
        self.calls: list[dict] = []  # records (model, model_provider) per init

    async def ainvoke(self, messages):
        resp = _FakeAIMessage(self._responses[self._idx])
        self._idx += 1
        return resp


def _make_fake_init(responses: list[str]):
    """Return a patched init_chat_model + the shared fake LLM for assertions."""
    fake_llm = _CapturingFakeLLM(responses)

    def fake_init(model, *, model_provider=None, **kwargs):
        fake_llm.calls.append({"model": model, "model_provider": model_provider})
        return fake_llm

    return fake_init, fake_llm


def _input_state(
    *,
    system_prompt: str = "You are a test agent.",
    provider: str = "openai",
    model: str = "gpt-4o-mini",
    rolling_summary: str = "",
    new_buffer_text: str = "[Alice] Hello world.",
    last_output: str = "",
) -> AgentState:
    return AgentState(
        system_prompt=system_prompt,
        provider=provider,
        model=model,
        rolling_summary=rolling_summary,
        new_buffer_text=new_buffer_text,
        last_output=last_output,
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_exports():
    """AgentState and build_graph are importable."""
    assert AgentState is not None
    assert callable(build_graph)


def test_graph_edges():
    """Compiled graph has exactly process and update_summary nodes, 3 edges."""
    from langgraph.checkpoint.memory import MemorySaver

    graph = build_graph(MemorySaver())
    drawable = graph.get_graph()

    node_ids = {n.id for n in drawable.nodes.values()}
    assert "process" in node_ids
    assert "update_summary" in node_ids

    # Exactly 3 edges: __start__->process, process->update_summary, update_summary->__end__
    assert len(drawable.edges) == 3


def test_no_conditional_edges():
    """Graph has no conditional edges — all edges are fixed."""
    from langgraph.checkpoint.memory import MemorySaver

    graph = build_graph(MemorySaver())
    drawable = graph.get_graph()

    for edge in drawable.edges:
        # Conditional edges in LangGraph drawables have a 'conditional' attribute
        assert not getattr(edge, "conditional", False), (
            f"Unexpected conditional edge: {edge}"
        )


def test_build_graph_no_checkpointer():
    """build_graph(None) compiles without error."""
    graph = build_graph(checkpointer=None)
    assert graph is not None


async def test_process_populates_last_output(monkeypatch):
    """After invocation, last_output matches the process node's LLM response."""
    from langgraph.checkpoint.memory import MemorySaver

    _get_llm.cache_clear()
    fake_init, _ = _make_fake_init(["insight from LLM", "updated summary"])
    monkeypatch.setattr("src.graph.init_chat_model", fake_init)

    graph = build_graph(MemorySaver())
    cfg = {"configurable": {"thread_id": "test:agent1"}}
    result = await graph.ainvoke(_input_state(), cfg)

    assert result["last_output"] == "insight from LLM"


async def test_update_summary_updates_rolling_summary(monkeypatch):
    """After invocation, rolling_summary matches update_summary node's LLM response."""
    from langgraph.checkpoint.memory import MemorySaver

    _get_llm.cache_clear()
    fake_init, _ = _make_fake_init(["insight text", "new rolling summary"])
    monkeypatch.setattr("src.graph.init_chat_model", fake_init)

    graph = build_graph(MemorySaver())
    cfg = {"configurable": {"thread_id": "test:agent2"}}
    result = await graph.ainvoke(_input_state(), cfg)

    assert result["rolling_summary"] == "new rolling summary"


async def test_rolling_summary_carries_over(monkeypatch):
    """Two invocations with the same thread_id — second sees first's summary."""
    from langgraph.checkpoint.memory import MemorySaver

    _get_llm.cache_clear()
    all_responses = [
        "insight 1",
        "summary after round 1",
        "insight 2",
        "summary after round 2",
    ]
    fake_init, _ = _make_fake_init(all_responses)
    monkeypatch.setattr("src.graph.init_chat_model", fake_init)

    saver = MemorySaver()
    graph = build_graph(saver)
    cfg = {"configurable": {"thread_id": "test:agent3"}}

    # Round 1
    r1 = await graph.ainvoke(
        _input_state(new_buffer_text="[Alice] First chunk"), cfg
    )
    assert r1["rolling_summary"] == "summary after round 1"

    # Round 2 — same thread_id, fresh buffer text
    r2 = await graph.ainvoke(
        _input_state(new_buffer_text="[Bob] Second chunk"), cfg
    )
    assert r2["rolling_summary"] == "summary after round 2"


async def test_anthropic_provider_works(monkeypatch):
    """Provider='anthropic' works without code changes."""
    from langgraph.checkpoint.memory import MemorySaver

    _get_llm.cache_clear()
    fake_init, _ = _make_fake_init(["anthropic insight", "anthropic summary"])
    monkeypatch.setattr("src.graph.init_chat_model", fake_init)

    graph = build_graph(MemorySaver())
    cfg = {"configurable": {"thread_id": "test:anthropic1"}}
    result = await graph.ainvoke(
        _input_state(provider="anthropic", model="claude-sonnet-4-6"), cfg
    )

    assert result["last_output"] == "anthropic insight"
    assert result["rolling_summary"] == "anthropic summary"


async def test_init_chat_model_receives_correct_args(monkeypatch):
    """init_chat_model is called with the correct model and model_provider from state."""
    from langgraph.checkpoint.memory import MemorySaver

    _get_llm.cache_clear()
    fake_init, fake_llm = _make_fake_init(["insight", "summary"])
    monkeypatch.setattr("src.graph.init_chat_model", fake_init)

    graph = build_graph(MemorySaver())
    cfg = {"configurable": {"thread_id": "test:args1"}}
    await graph.ainvoke(
        _input_state(provider="anthropic", model="claude-sonnet-4-6"), cfg
    )

    # With caching, init_chat_model is called once for the unique (model, provider) pair
    assert len(fake_llm.calls) == 1
    assert fake_llm.calls[0]["model"] == "claude-sonnet-4-6"
    assert fake_llm.calls[0]["model_provider"] == "anthropic"


async def test_llm_instance_reused_across_invocations(monkeypatch):
    """LLM instances are cached — same (model, provider) should call init_chat_model only once."""
    from langgraph.checkpoint.memory import MemorySaver

    _get_llm.cache_clear()

    call_count = 0
    fake_llm = _CapturingFakeLLM([
        "insight 1", "summary 1",
        "insight 2", "summary 2",
    ])

    def counting_init(model, *, model_provider=None, **kwargs):
        nonlocal call_count
        call_count += 1
        return fake_llm

    monkeypatch.setattr("src.graph.init_chat_model", counting_init)

    saver = MemorySaver()
    graph = build_graph(saver)
    cfg = {"configurable": {"thread_id": "test:reuse1"}}

    # Invocation 1
    await graph.ainvoke(
        _input_state(new_buffer_text="[Alice] First chunk"), cfg
    )
    # Invocation 2 — same model/provider
    await graph.ainvoke(
        _input_state(new_buffer_text="[Bob] Second chunk"), cfg
    )

    # 2 invocations x 2 nodes = 4 calls without caching; with caching only 1
    assert call_count == 1, (
        f"Expected init_chat_model to be called once (cached), got {call_count}"
    )

    _get_llm.cache_clear()
