"""Agent fanout — loads agents once, fans out graph invocations on each buffer flush."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING

from langgraph.checkpoint.mysql.aio import AIOMySQLSaver

from .buffer import Message, MessageBuffer
from .db import (
    create_agent_run,
    deregister_worker,
    load_agents_for_meeting,
    mark_meeting_summarizing,
    mark_run_done,
    mark_run_error,
    mark_run_running,
    persist_message,
    save_agent_output,
)
import httpx

from .summary import generate_for
from .graph import build_graph
from .settings import settings

if TYPE_CHECKING:
    from langgraph.graph.state import CompiledStateGraph

logger = logging.getLogger("worker.fanout")


@dataclass(frozen=True)
class AgentRow:
    """Snapshot of an agent row, loaded once at meeting start."""

    id: str
    name: str
    system_prompt: str
    provider: str  # resolved — never None
    model: str  # resolved — never None


class AgentFanout:
    """Per-meeting agent orchestrator and ParagraphSink.

    Owns the MessageBuffer, the AIOMySQLSaver checkpointer, and the compiled
    LangGraph. Each transcript message is persisted to DB immediately via
    on_paragraph (for real-time SSE delivery), then buffered. When the buffer
    reaches max_messages, on_buffer_flush fans out agent runs.
    """

    def __init__(self, meeting_id: str, buffer_size: int = 10) -> None:
        self.meeting_id = meeting_id
        self.agents: list[AgentRow] = []
        self._checkpointer_cm = None  # async context manager (for cleanup)
        self.checkpointer: AIOMySQLSaver | None = None  # the actual saver
        self.graph: CompiledStateGraph | None = None
        self.buffer = MessageBuffer(
            on_flush=self.on_buffer_flush, max_messages=buffer_size,
        )

    async def load_agents(self) -> int:
        """Load agent roster from MySQL and initialize checkpointer + graph.

        Must be called EXACTLY ONCE per meeting, at room-connect time.
        Returns the number of agents loaded.
        """
        rows = await asyncio.to_thread(load_agents_for_meeting, self.meeting_id)
        self.agents = [
            AgentRow(
                id=r["id"],
                name=r["name"],
                system_prompt=r["system_prompt"],
                provider=r["provider"] or settings.default_llm_provider,
                model=r["model"] or settings.default_llm_model,
            )
            for r in rows
        ]

        if self.agents:
            url = settings.mysql_url.replace("mysql://", "mysql+aiomysql://", 1)
            self._checkpointer_cm = AIOMySQLSaver.from_conn_string(url)
            self.checkpointer = await self._checkpointer_cm.__aenter__()
            await self.checkpointer.setup()
            self.graph = build_graph(self.checkpointer)
            logger.info(
                "loaded %d agents for meeting %s", len(self.agents), self.meeting_id,
            )
        else:
            logger.info(
                "no agents for meeting %s — transcript-only mode", self.meeting_id,
            )

        # FUTURE: hot reload via room data message
        return len(self.agents)

    async def on_paragraph(self, msg: Message) -> None:
        """ParagraphSink: persist message to DB immediately, then buffer for agents.

        Each message is written to transcript_messages as soon as STT emits it
        so the SSE stream can deliver it in near-real-time (matching live
        captions latency). The buffer only controls when agents fire.

        If persistence fails, the message still enters the buffer but with
        db_id=None. on_buffer_flush will exclude it from agent processing
        (agents only see messages whose IDs exist in transcript_messages).
        The message IS still published as a live caption via the data channel
        (upstream in transcription.py), so users see it in real-time
        regardless. This is strictly better than the old batch-persist model
        where a single DB failure lost the entire batch.
        """
        try:
            msg.db_id = await asyncio.to_thread(
                persist_message, self.meeting_id, msg,
            )
        except Exception:
            logger.exception(
                "immediate persist failed for meeting %s", self.meeting_id,
            )
        await self.buffer.add(msg)

    async def on_buffer_flush(self, msgs: list[Message]) -> None:
        """Buffer flush callback: fan out agent runs (transcript already persisted).

        Only messages that were successfully persisted (db_id is set) are
        included in agent processing. Messages that failed immediate persist
        are excluded to keep agent_runs.buffer_start/end_msg_id consistent
        with what actually exists in transcript_messages.
        """
        if not self.agents:
            return

        persisted = [m for m in msgs if m.db_id is not None]
        if not persisted:
            logger.warning(
                "no persisted messages in flush batch for meeting %s",
                self.meeting_id,
            )
            return

        first_id = persisted[0].db_id
        last_id = persisted[-1].db_id

        formatted = "\n\n".join(
            f"[{m.speaker_name}] {m.text}" for m in persisted
        )
        await asyncio.gather(
            *[
                self._run_agent(agent, formatted, first_id, last_id)
                for agent in self.agents
            ],
            return_exceptions=True,
        )

    async def _run_agent(
        self,
        agent: AgentRow,
        formatted: str,
        first_id: int,
        last_id: int,
    ) -> None:
        """Invoke the graph for a single agent. Exceptions are caught per-agent."""
        # Phase 1: create the tracking row. If this fails we have no run_id
        # to mark, so log and bail.
        try:
            run_id = await asyncio.to_thread(
                create_agent_run, self.meeting_id, agent.id, first_id, last_id,
            )
        except Exception:
            logger.exception(
                "failed to create agent_run for agent %s on meeting %s",
                agent.id, self.meeting_id,
            )
            return

        # Phase 2: execute the graph and persist results.
        try:
            await asyncio.to_thread(mark_run_running, run_id)

            config = {
                "configurable": {
                    "thread_id": f"{self.meeting_id}:{agent.id}",
                },
            }
            state_in = {
                "system_prompt": agent.system_prompt,
                "provider": agent.provider,
                "model": agent.model,
                "new_buffer_text": formatted,
                "rolling_summary": "",  # overwritten by checkpointer on 2nd+ runs
                "last_output": "",
                "prompt_tokens": 0,  # reset per invocation
                "completion_tokens": 0,
            }

            result = await self.graph.ainvoke(state_in, config)

            prompt_tokens = result.get("prompt_tokens") or None
            completion_tokens = result.get("completion_tokens") or None

            await asyncio.to_thread(
                save_agent_output,
                run_id, self.meeting_id, agent.id, result["last_output"],
            )
            await asyncio.to_thread(
                mark_run_done, run_id, prompt_tokens, completion_tokens,
            )
            logger.debug(
                "agent %s run %d completed for meeting %s",
                agent.name, run_id, self.meeting_id,
            )
        except Exception as exc:
            logger.exception(
                "agent %s run %d failed for meeting %s",
                agent.name, run_id, self.meeting_id,
            )
            try:
                await asyncio.to_thread(mark_run_error, run_id, str(exc))
            except Exception:
                logger.exception("failed to mark run %d as error", run_id)

    def _notify_summary_ready(self) -> None:
        """Fire-and-forget HTTP call to the API to send summary-ready emails.

        Uses a synchronous httpx client so it works reliably even during
        async shutdown when the event loop may be tearing down.
        """
        if not settings.internal_api_key:
            logger.warning(
                "INTERNAL_API_KEY not set — skipping summary notification for meeting %s",
                self.meeting_id,
            )
            return

        url = f"{settings.api_url}/api/v0/meetings/{self.meeting_id}/notify-summary"
        try:
            with httpx.Client(timeout=10) as client:
                resp = client.post(
                    url,
                    headers={"X-Internal-Key": settings.internal_api_key},
                )
            logger.info(
                "summary notification sent for meeting %s (status=%d)",
                self.meeting_id, resp.status_code,
            )
        except Exception:
            logger.exception(
                "summary notification call failed for meeting %s",
                self.meeting_id,
            )

    async def flush_all_and_finalize(self) -> None:
        """Shutdown: flush pending buffer, close checkpointer, generate summary, end meeting.

        deregister_worker MUST run to transition the meeting from 'summarizing'
        to 'ended'. It lives in a finally block so it executes even when the
        LiveKit framework cancels the entrypoint (CancelledError is a
        BaseException, not Exception, so bare except-Exception blocks miss it).
        """
        try:
            try:
                await self.buffer.flush()
            except Exception:
                logger.exception(
                    "final buffer flush failed for meeting %s", self.meeting_id,
                )

            if self._checkpointer_cm is not None:
                try:
                    await self._checkpointer_cm.__aexit__(None, None, None)
                except Exception:
                    logger.exception(
                        "checkpointer close failed for meeting %s", self.meeting_id,
                    )

            # Transition to 'summarizing' so the frontend knows the meeting ended
            # and summary generation is in progress.
            try:
                await asyncio.to_thread(mark_meeting_summarizing, self.meeting_id)
            except Exception:
                logger.exception(
                    "mark_meeting_summarizing failed for meeting %s", self.meeting_id,
                )

            try:
                await asyncio.to_thread(generate_for, self.meeting_id)
            except Exception:
                logger.exception(
                    "summary generation failed for meeting %s", self.meeting_id,
                )
        except BaseException:
            # Catch CancelledError and any other BaseException so the finally
            # block below is guaranteed to run deregister_worker.
            logger.warning(
                "flush_all_and_finalize interrupted for meeting %s", self.meeting_id,
            )
        finally:
            # ALWAYS runs — sets status to 'ended' regardless of summary
            # success or entrypoint cancellation.
            try:
                await asyncio.to_thread(deregister_worker, self.meeting_id)
            except Exception:
                logger.exception(
                    "deregister_worker failed for meeting %s", self.meeting_id,
                )

            # Notify participants that the summary is ready.
            # Runs in finally so it fires even if the entrypoint was cancelled
            # mid-summary (the thread may have completed in the background).
            self._notify_summary_ready()
