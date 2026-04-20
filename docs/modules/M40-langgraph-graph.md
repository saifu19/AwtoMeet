# M40 — LangGraph graph definition
Wave: 4    Owner: <unassigned>    Branch: feat/m40-langgraph-graph
Depends on: M31, M01    Blocks: M41    plan.md refs: §7.3, §12

## Goal
Create `apps/worker/src/graph.py` — a single, parameterized LangGraph that every AI agent on every meeting will run. The graph has exactly two nodes: `process` (LLM call that produces an insight for the newly-flushed transcript chunk) and `update_summary` (LLM call that merges that chunk + insight into the agent's private rolling summary). Persistence uses `AIOMySQLSaver` (the async MySQL checkpointer from `langgraph-checkpoint-mysql` 3.x). The provider/model are chosen per-invocation via `init_chat_model`, so the same compiled graph supports both OpenAI and Anthropic agents.

## Context (inlined from plan.md)
- Worker layout: `apps/worker/src/graph.py` next to `main.py`, `fanout.py`, `buffer.py`, `db.py`, `settings.py`.
- Stack: `langgraph`, `langchain-core`, `langchain-openai`, `langchain-anthropic`, `langgraph-checkpoint-mysql` 3.x.
- Per-agent isolation happens at the **thread_id** layer (`f"{meeting_id}:{agent_id}"`), NOT inside the graph. The graph itself is oblivious to which agent it is running for — the caller passes `system_prompt`, `provider`, `model` in the initial state, and the checkpointer reloads `rolling_summary` automatically based on thread_id.
- `init_chat_model("gpt-4o-mini", model_provider="openai")` and `init_chat_model("claude-sonnet-4-6", model_provider="anthropic")` are the two shapes of call — same function, different string args. That is the entire "per-agent LLM picker."
- Rolling summary cap: ~1500 tokens; preserve concrete facts, decisions, open questions.

State shape:
```python
class AgentState(TypedDict):
    system_prompt: str
    provider: str
    model: str
    rolling_summary: str   # private to this (meeting, agent) — reloaded by checkpointer
    new_buffer_text: str   # just-flushed chunk, pre-formatted "[speaker] text\n\n..."
    last_output: str       # what process() produced this turn
```

Reference implementation (copy and adapt):
```python
from typing import TypedDict
from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.mysql.aio import AIOMySQLSaver
from langchain.chat_models import init_chat_model
from langchain_core.messages import SystemMessage, HumanMessage

def build_graph(checkpointer):
    g = StateGraph(AgentState)

    async def process(state):
        llm = init_chat_model(state["model"], model_provider=state["provider"])
        prompt = [
            SystemMessage(content=state["system_prompt"]
                + "\n\n[Meeting context so far — your private memory]\n"
                + (state["rolling_summary"] or "(none yet)")),
            HumanMessage(content="New transcript chunk from the meeting:\n\n"
                + state["new_buffer_text"]
                + "\n\nProcess this chunk according to your role. Reply with your insight in markdown."),
        ]
        resp = await llm.ainvoke(prompt)
        return {**state, "last_output": resp.content}

    async def update_summary(state):
        llm = init_chat_model(state["model"], model_provider=state["provider"])
        prompt = [
            SystemMessage(content="You maintain a concise running summary of a meeting from one observer's perspective. Keep under 1500 tokens. Preserve concrete facts, decisions, and open questions."),
            HumanMessage(content=(
                f"Previous summary:\n{state['rolling_summary'] or '(none)'}\n\n"
                f"New transcript chunk:\n{state['new_buffer_text']}\n\n"
                f"Your previous insight on this chunk:\n{state['last_output']}\n\n"
                "Return ONLY the updated summary.")),
        ]
        resp = await llm.ainvoke(prompt)
        return {**state, "rolling_summary": resp.content}

    g.add_node("process", process)
    g.add_node("update_summary", update_summary)
    g.add_edge(START, "process")
    g.add_edge("process", "update_summary")
    g.add_edge("update_summary", END)
    return g.compile(checkpointer=checkpointer)
```

## Files to create / modify
- **Create:** `apps/worker/src/graph.py` — `AgentState` TypedDict + `build_graph(checkpointer)` function.
- **Modify:** `apps/worker/pyproject.toml` — ensure deps `langgraph`, `langchain-core`, `langchain-openai`, `langchain-anthropic`, `langgraph-checkpoint-mysql~=3.0` are pinned. Run `uv sync`.
- **Modify:** `apps/worker/src/settings.py` — add `default_provider` and `default_model` fields (read from `DEFAULT_LLM_PROVIDER`, `DEFAULT_LLM_MODEL`) if not already present.
- **Create:** `apps/worker/tests/test_graph.py` — unit tests with an in-memory checkpointer OR a stub LLM.

## Implementation notes
- `build_graph` takes the checkpointer as an argument; it does NOT create one. Lifecycle of the checkpointer (open connection pool, `.setup()`) belongs to `fanout.py` (M41).
- Do not import `AIOMySQLSaver` at module top-level just to reference it — you only need it for type hints. Import inside a `TYPE_CHECKING` block if you want it annotated.
- The two nodes each instantiate their own LLM. That's fine and cheap; do not try to share a single LLM object across the state transitions (state is serialized).
- `init_chat_model` is from `langchain.chat_models` (the top-level re-export). It handles provider dispatch natively; do not write your own branching.
- Keep the summary prompt fixed. Do not let users override it in MVP.
- `rolling_summary` is seeded empty by the caller; the checkpointer overwrites it on subsequent runs for the same thread_id. If you want to be explicit, you can read prior state via `graph.aget_state(config)` before invoke, but it's not necessary.

## Acceptance criteria
- [ ] `graph.py` exports `AgentState` and `build_graph`.
- [ ] `build_graph` returns a compiled graph with edges `START → process → update_summary → END` and nothing else.
- [ ] Calling the compiled graph twice with the same `thread_id` but different `new_buffer_text` shows the second call's `rolling_summary` includes information from the first chunk (checkpointer works).
- [ ] Calling with `provider="openai"` and `provider="anthropic"` both work without code changes.
- [ ] No tool-calling, no extra nodes, no conditional edges.
- [ ] `uv run pytest apps/worker/tests/test_graph.py` passes.

## Smoke test
```bash
cd apps/worker
uv run python -c "
import asyncio
from langgraph.checkpoint.memory import MemorySaver
from src.graph import build_graph
async def main():
    g = build_graph(MemorySaver())
    cfg = {'configurable': {'thread_id': 'test:agent1'}}
    r = await g.ainvoke({
        'system_prompt': 'You are a sales coach.',
        'provider': 'openai', 'model': 'gpt-4o-mini',
        'rolling_summary': '', 'new_buffer_text': '[Alice] We want pricing.', 'last_output': '',
    }, cfg)
    print('last_output:', r['last_output'][:100])
    print('rolling_summary:', r['rolling_summary'][:100])
asyncio.run(main())
"
```
You should see a non-empty insight and a non-empty rolling summary.

## Do NOT
- Do NOT add tool-calling, retries, conditional routing, or a third node. The graph is `process → update_summary → END`. Period. (plan.md §12)
- Do NOT let the graph know about other agents. It is single-agent by construction.
- Do NOT hard-code a provider/model. They come from state.
- Do NOT create or own the checkpointer here — that belongs to M41.
- Do NOT store `rolling_summary` anywhere outside the checkpointer. It is private to (meeting, agent).
- Do NOT use `whisper-1` or touch STT here. This module is pure LLM.

## Hand-off
M41 (`fanout.py`) imports `build_graph` from this module, constructs an `AIOMySQLSaver`, calls `build_graph(checkpointer)` once per meeting, and invokes the compiled graph per-agent with unique `thread_id`s.
