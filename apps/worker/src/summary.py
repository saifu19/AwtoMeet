"""Post-meeting summary generation (M50).

One-shot LLM call after meeting ends. NOT a LangGraph run — no checkpointer,
no agent state. Called synchronously from fanout via asyncio.to_thread.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from urllib.parse import urlparse

import pymysql
from langchain.chat_models import init_chat_model
from langchain_core.messages import HumanMessage, SystemMessage

from .settings import settings

logger = logging.getLogger("worker.summary")

_IDEMPOTENCY_WINDOW_SECONDS = 300  # 5 minutes


def _get_connection() -> pymysql.Connection:
    parsed = urlparse(settings.mysql_url)
    return pymysql.connect(
        host=parsed.hostname or "localhost",
        port=parsed.port or 3306,
        user=parsed.username or "root",
        password=parsed.password or "",
        database=parsed.path.lstrip("/"),
        autocommit=True,
        init_command="SET time_zone = '+00:00'",
    )


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _upsert_summary(
    conn: pymysql.Connection,
    meeting_id: str,
    agenda_findings: dict,
    raw_summary: str,
) -> None:
    """UPSERT a meeting_summaries row. Idempotent on meeting_id unique key."""
    now = _utc_now()
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO meeting_summaries "
            "(meeting_id, agenda_findings, raw_summary, generated_at) "
            "VALUES (%s, %s, %s, %s) "
            "ON DUPLICATE KEY UPDATE "
            "agenda_findings = VALUES(agenda_findings), "
            "raw_summary = VALUES(raw_summary), "
            "generated_at = VALUES(generated_at)",
            (
                meeting_id,
                json.dumps(agenda_findings),
                raw_summary,
                now,
            ),
        )


def generate_for(meeting_id: str) -> None:
    """Generate a post-meeting summary for the given meeting.

    Loads the full transcript + meeting type agenda items, calls the default
    LLM once with a structured-output prompt, and writes (upserts) the result
    into meeting_summaries.

    This function is synchronous — call via ``asyncio.to_thread``.
    """
    conn = _get_connection()
    try:
        # ── Idempotency guard ────────────────────────────────────────
        with conn.cursor() as cur:
            cur.execute(
                "SELECT generated_at FROM meeting_summaries WHERE meeting_id = %s",
                (meeting_id,),
            )
            row = cur.fetchone()
            if row and row[0]:
                age = (_utc_now() - row[0]).total_seconds()
                if age < _IDEMPOTENCY_WINDOW_SECONDS:
                    logger.info(
                        "summary for meeting %s already generated %ds ago, skipping",
                        meeting_id, int(age),
                    )
                    return

        # ── Load meeting + meeting_type ──────────────────────────────
        with conn.cursor() as cur:
            cur.execute(
                "SELECT mt.agenda_items "
                "FROM meetings m "
                "LEFT JOIN meeting_types mt ON m.meeting_type_id = mt.id "
                "WHERE m.id = %s",
                (meeting_id,),
            )
            mt_row = cur.fetchone()

        if mt_row is None:
            logger.warning("meeting %s not found, cannot generate summary", meeting_id)
            return

        raw_agenda = mt_row[0]
        if isinstance(raw_agenda, str):
            try:
                agenda_items: list[str] = json.loads(raw_agenda)
            except (json.JSONDecodeError, TypeError):
                agenda_items = []
        elif isinstance(raw_agenda, list):
            agenda_items = raw_agenda
        else:
            agenda_items = []

        # ── Load transcript ──────────────────────────────────────────
        with conn.cursor() as cur:
            cur.execute(
                "SELECT speaker_name, text FROM transcript_messages "
                "WHERE meeting_id = %s ORDER BY id ASC",
                (meeting_id,),
            )
            transcript_rows = cur.fetchall()

        if not transcript_rows:
            logger.info("no transcript for meeting %s, writing stub summary", meeting_id)
            _upsert_summary(conn, meeting_id, {}, "No transcript was recorded for this meeting.")
            return

        formatted = "\n\n".join(
            f"[{r[0]}] {r[1]}" for r in transcript_rows
        )

        # ── Build prompt ─────────────────────────────────────────────
        if agenda_items:
            agenda_list = ", ".join(f'"{item}"' for item in agenda_items)
            system_content = (
                "You are summarizing a meeting. You will receive the full transcript.\n"
                "Produce a JSON object with exactly these keys:\n"
                f'- "agenda_findings": an object with one key per agenda item ({agenda_list}). '
                "The value for each key is a markdown string summarizing what was discussed "
                "for that topic. If nothing was discussed for an item, use an empty string.\n"
                '- "raw_summary": a brief overall markdown summary of the meeting.\n\n'
                "Return ONLY valid JSON, no markdown fences, no extra text."
            )
        else:
            system_content = (
                "You are summarizing a meeting. You will receive the full transcript.\n"
                "Produce a JSON object with exactly these keys:\n"
                '- "agenda_findings": an empty object {}.\n'
                '- "raw_summary": a brief overall markdown summary of the meeting.\n\n'
                "Return ONLY valid JSON, no markdown fences, no extra text."
            )

        messages = [
            SystemMessage(content=system_content),
            HumanMessage(content=f"Full meeting transcript:\n\n{formatted}"),
        ]

        # ── Call LLM ─────────────────────────────────────────────────
        llm = init_chat_model(
            settings.default_llm_model,
            model_provider=settings.default_llm_provider,
        )
        resp = llm.invoke(messages)

        # ── Parse response ───────────────────────────────────────────
        raw_text = resp.content
        try:
            parsed = json.loads(raw_text)
            agenda_findings = parsed.get("agenda_findings", {})
            raw_summary = parsed.get("raw_summary", "")

            # Ensure agenda_findings is a dict of strings
            if not isinstance(agenda_findings, dict):
                agenda_findings = {}
            else:
                agenda_findings = {k: str(v) for k, v in agenda_findings.items()}

            # Ensure all agenda items are present
            for item in agenda_items:
                if item not in agenda_findings:
                    agenda_findings[item] = ""

            if not isinstance(raw_summary, str):
                raw_summary = str(raw_summary)

        except (json.JSONDecodeError, TypeError, AttributeError):
            logger.warning(
                "failed to parse LLM summary response as JSON for meeting %s, "
                "storing as raw_summary",
                meeting_id,
            )
            agenda_findings = {}
            raw_summary = raw_text if isinstance(raw_text, str) else str(raw_text)

        # ── UPSERT into meeting_summaries ────────────────────────────
        _upsert_summary(conn, meeting_id, agenda_findings, raw_summary)
        logger.info("summary generated for meeting %s", meeting_id)

    finally:
        conn.close()
