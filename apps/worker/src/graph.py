"""LangGraph graph definition — two-node insight + summary pipeline.

One graph, parameterized at runtime per (meeting_id, agent_id).
Nodes: process (LLM insight) -> update_summary (rolling summary).
The caller passes system_prompt, provider, model in the initial state;
the checkpointer reloads rolling_summary automatically based on thread_id.
"""

from __future__ import annotations

from functools import lru_cache
from typing import TYPE_CHECKING, TypedDict

from langchain.chat_models import init_chat_model
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph

if TYPE_CHECKING:
    from langgraph.checkpoint.base import BaseCheckpointSaver


@lru_cache(maxsize=16)
def _get_llm(model: str, provider: str):
    """Cache LLM instances by (model, provider) to avoid creating new HTTP clients per invocation."""
    return init_chat_model(model, model_provider=provider)


class AgentState(TypedDict):
    system_prompt: str
    provider: str
    model: str
    rolling_summary: str  # private to this (meeting, agent) — reloaded by checkpointer
    new_buffer_text: str  # just-flushed chunk, pre-formatted "[speaker] text\n\n..."
    last_output: str  # what process() produced this turn
    prompt_tokens: int  # accumulated across nodes per invocation
    completion_tokens: int  # accumulated across nodes per invocation


def build_graph(checkpointer: BaseCheckpointSaver | None = None):
    """Build and compile the two-node agent graph.

    Args:
        checkpointer: LangGraph checkpoint saver (e.g. AIOMySQLSaver).
                      Lifecycle of the checkpointer belongs to the caller (fanout.py).
    """
    g = StateGraph(AgentState)

    async def process(state: AgentState) -> AgentState:
        llm = _get_llm(state["model"], state["provider"])
        prompt = [
            SystemMessage(
                content=(
                    state["system_prompt"]
                    + "\n\n[Meeting context so far — your private memory]\n"
                    + (state["rolling_summary"] or "(none yet)")
                )
            ),
            HumanMessage(
                content=(
                    "New transcript chunk from the meeting:\n\n"
                    + state["new_buffer_text"]
                    + "\n\nProcess this chunk according to your role. "
                    "Reply with your insight in markdown."
                )
            ),
        ]
        resp = await llm.ainvoke(prompt)
        pt = state.get("prompt_tokens", 0)
        ct = state.get("completion_tokens", 0)
        usage = getattr(resp, "usage_metadata", None)
        if usage:
            pt += usage.get("input_tokens", 0)
            ct += usage.get("output_tokens", 0)
        return {**state, "last_output": resp.content, "prompt_tokens": pt, "completion_tokens": ct}

    async def update_summary(state: AgentState) -> AgentState:
        llm = _get_llm(state["model"], state["provider"])
        prompt = [
            SystemMessage(
                content="You maintain a concise running summary of a meeting "
                "from one observer's perspective. Keep under 1500 tokens. "
                "Preserve concrete facts, decisions, and open questions."
            ),
            HumanMessage(
                content=(
                    f"Previous summary:\n{state['rolling_summary'] or '(none)'}\n\n"
                    f"New transcript chunk:\n{state['new_buffer_text']}\n\n"
                    f"Your previous insight on this chunk:\n{state['last_output']}\n\n"
                    "Return ONLY the updated summary."
                )
            ),
        ]
        resp = await llm.ainvoke(prompt)
        pt = state.get("prompt_tokens", 0)
        ct = state.get("completion_tokens", 0)
        usage = getattr(resp, "usage_metadata", None)
        if usage:
            pt += usage.get("input_tokens", 0)
            ct += usage.get("output_tokens", 0)
        return {**state, "rolling_summary": resp.content, "prompt_tokens": pt, "completion_tokens": ct}

    g.add_node("process", process)
    g.add_node("update_summary", update_summary)
    g.add_edge(START, "process")
    g.add_edge("process", "update_summary")
    g.add_edge("update_summary", END)
    return g.compile(checkpointer=checkpointer)
