"""Worker DB helpers for meeting lifecycle updates and transcript persistence.

Every function creates a short-lived pymysql connection via _get_connection()
and closes it in a finally block. We do NOT use ``with conn:`` because
pymysql's Connection.__exit__ calls conn.close(), which would double-close
when paired with an explicit finally. autocommit=True is set at connect
time so no explicit commit/rollback is needed.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

import pymysql

from .buffer import Message
from .settings import settings

logger = logging.getLogger("worker.db")


def _get_connection() -> pymysql.Connection:
    """Parse MYSQL_URL and return a pymysql connection.

    Sets the session timezone to UTC so any NOW()/CURRENT_TIMESTAMP values
    and datetime reads are consistent with the API's mysql2 pool (timezone: 'Z').
    """
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


def register_worker(meeting_id: str, job_id: str) -> bool:
    """Record the worker's job_id on the meeting row. Returns True on success.

    The API pre-stores LiveKit's dispatch_id in worker_job_id when it creates
    the dispatch (routes/meetings.ts:364-365). When the worker spins up, its
    ctx.job.id is a DIFFERENT identifier (job_id ≠ dispatch_id), so we simply
    overwrite — the worker is authoritative from here on.

    One-worker-per-meeting is enforced upstream, not here:
      - API's `if (!meeting.worker_job_id)` guard on /join prevents re-dispatch
        while a worker owns the row.
      - LiveKit's createDispatch returns "already_exists" for duplicate
        (room, agent_name) pairs (livekit/dispatch.ts:29-31).
      - deregister_worker only clears worker_job_id at true meeting-end, and
        the worker no longer crashes before that point.
    """
    conn = None
    try:
        conn = _get_connection()
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE meetings SET worker_job_id = %s WHERE id = %s",
                (job_id, meeting_id),
            )
            rc = cur.rowcount
        if rc > 0:
            logger.info("registered worker %s for meeting %s", job_id, meeting_id)
            return True
        logger.warning(
            "register_worker no-op for meeting %s (row not found)", meeting_id,
        )
        return False
    except Exception:
        logger.exception("register_worker failed for meeting %s", meeting_id)
        return False
    finally:
        if conn is not None:
            conn.close()


def mark_meeting_live(meeting_id: str) -> None:
    """Transition a scheduled meeting to live once a human participant joins."""
    conn = None
    try:
        conn = _get_connection()
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE meetings SET status = 'live', started_at = %s "
                "WHERE id = %s AND status = 'scheduled'",
                (_utc_now(), meeting_id),
            )
            rc = cur.rowcount
        if rc > 0:
            logger.info("meeting %s transitioned scheduled→live", meeting_id)
        else:
            logger.info(
                "meeting %s: mark_meeting_live no-op (not in 'scheduled')",
                meeting_id,
            )
    except Exception:
        logger.exception("failed to mark meeting %s live", meeting_id)
    finally:
        if conn is not None:
            conn.close()


def mark_meeting_summarizing(meeting_id: str) -> None:
    """Transition meeting to summarizing — meeting has ended, summary is generating."""
    conn = None
    try:
        conn = _get_connection()
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE meetings SET status = 'summarizing', ended_at = %s "
                "WHERE id = %s AND status IN ('live', 'scheduled')",
                (_utc_now(), meeting_id),
            )
            rc = cur.rowcount
        if rc > 0:
            logger.info("meeting %s transitioned to summarizing", meeting_id)
        else:
            logger.info(
                "meeting %s: mark_meeting_summarizing no-op "
                "(not in 'live'/'scheduled')",
                meeting_id,
            )
    except Exception:
        logger.exception("failed to mark meeting %s as summarizing", meeting_id)
    finally:
        if conn is not None:
            conn.close()


def deregister_worker(meeting_id: str) -> None:
    """Clear worker and end the meeting."""
    conn = None
    try:
        conn = _get_connection()
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE meetings SET worker_job_id = NULL, "
                "status = 'ended', ended_at = %s "
                "WHERE id = %s AND status IN ('live', 'scheduled', 'summarizing')",
                (_utc_now(), meeting_id),
            )
            rc = cur.rowcount
        if rc > 0:
            logger.info("deregistered worker and ended meeting %s", meeting_id)
        else:
            logger.info(
                "meeting %s: deregister_worker no-op (already terminal)",
                meeting_id,
            )
    except Exception:
        logger.exception("failed to deregister worker for meeting %s", meeting_id)
    finally:
        if conn is not None:
            conn.close()


def get_buffer_size(meeting_id: str) -> int:
    """Resolve the meeting's buffer_size from meeting_types; default 10.

    Swallows DB errors and returns the default — a startup blip shouldn't
    block the meeting, and 10 is the schema default anyway.
    """
    conn = None
    try:
        conn = _get_connection()
        with conn.cursor() as cur:
            cur.execute(
                "SELECT mt.buffer_size FROM meetings m "
                "LEFT JOIN meeting_types mt ON m.meeting_type_id = mt.id "
                "WHERE m.id = %s",
                (meeting_id,),
            )
            row = cur.fetchone()
            if row and row[0] is not None:
                return int(row[0])
    except Exception:
        logger.exception("failed to read buffer_size for meeting %s", meeting_id)
    finally:
        if conn is not None:
            conn.close()
    return 10


def persist_message(meeting_id: str, msg: Message) -> int:
    """Insert a single transcript message and return its auto_increment id.

    Used for real-time persistence so the SSE stream picks up messages
    immediately rather than waiting for a buffer flush.
    """
    now = _utc_now()
    conn = _get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO transcript_messages "
                "(meeting_id, speaker_identity, speaker_name, text, "
                "start_ts_ms, end_ts_ms, created_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s)",
                (
                    meeting_id,
                    msg.speaker_identity,
                    msg.speaker_name,
                    msg.text,
                    msg.start_ts_ms,
                    msg.end_ts_ms,
                    now,
                ),
            )
            cur.execute("SELECT LAST_INSERT_ID()")
            return cur.fetchone()[0]
    finally:
        conn.close()


def persist_messages(meeting_id: str, msgs: list[Message]) -> tuple[int, int]:
    """Batch-insert transcript paragraphs. Returns (first_id, last_id).

    Uses an explicit transaction to guarantee contiguous auto_increment IDs
    regardless of innodb_autoinc_lock_mode. Raises on DB error.
    """
    if not msgs:
        return (0, 0)
    now = _utc_now()
    rows = [
        (
            meeting_id,
            m.speaker_identity,
            m.speaker_name,
            m.text,
            m.start_ts_ms,
            m.end_ts_ms,
            now,
        )
        for m in msgs
    ]
    conn = _get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("BEGIN")
            cur.executemany(
                "INSERT INTO transcript_messages "
                "(meeting_id, speaker_identity, speaker_name, text, "
                "start_ts_ms, end_ts_ms, created_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s)",
                rows,
            )
            cur.execute("SELECT LAST_INSERT_ID()")
            first_id = cur.fetchone()[0]
            last_id = first_id + len(msgs) - 1
            cur.execute("COMMIT")
        logger.debug(
            "persisted %d transcript messages for meeting %s (ids %d..%d)",
            len(rows), meeting_id, first_id, last_id,
        )
        return (first_id, last_id)
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# M41 — Agent fanout helpers
# ---------------------------------------------------------------------------


def load_agents_for_meeting(meeting_id: str) -> list[dict[str, Any]]:
    """Load agent roster for a meeting via meeting_type_agents join.

    Returns a list of dicts with keys: id, name, system_prompt, provider, model.
    Returns [] if the meeting has no meeting_type or no agents assigned.
    """
    conn = _get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT a.id, a.name, a.system_prompt, a.provider, a.model "
                "FROM agents a "
                "JOIN meeting_type_agents mta ON mta.agent_id = a.id "
                "JOIN meetings m ON m.meeting_type_id = mta.meeting_type_id "
                "WHERE m.id = %s",
                (meeting_id,),
            )
            rows = cur.fetchall()
        return [
            {
                "id": r[0],
                "name": r[1],
                "system_prompt": r[2],
                "provider": r[3],
                "model": r[4],
            }
            for r in rows
        ]
    finally:
        conn.close()


def create_agent_run(
    meeting_id: str,
    agent_id: str,
    first_msg_id: int,
    last_msg_id: int,
) -> int:
    """Insert a pending agent_run row and return its auto_increment id."""
    now = _utc_now()
    conn = _get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO agent_runs "
                "(meeting_id, agent_id, buffer_start_msg_id, buffer_end_msg_id, "
                "status, started_at) "
                "VALUES (%s, %s, %s, %s, 'pending', %s)",
                (meeting_id, agent_id, first_msg_id, last_msg_id, now),
            )
            cur.execute("SELECT LAST_INSERT_ID()")
            return cur.fetchone()[0]
    finally:
        conn.close()


def mark_run_running(run_id: int) -> None:
    """Transition an agent_run from pending to running."""
    conn = _get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE agent_runs SET status = 'running' WHERE id = %s",
                (run_id,),
            )
    finally:
        conn.close()


def mark_run_done(
    run_id: int,
    prompt_tokens: int | None = None,
    completion_tokens: int | None = None,
) -> None:
    """Mark an agent_run as successfully completed."""
    conn = _get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE agent_runs SET status = 'done', finished_at = %s, "
                "prompt_tokens = %s, completion_tokens = %s "
                "WHERE id = %s",
                (_utc_now(), prompt_tokens, completion_tokens, run_id),
            )
    finally:
        conn.close()


def mark_run_error(run_id: int, error: str) -> None:
    """Mark an agent_run as failed with an error message."""
    conn = _get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE agent_runs SET status = 'error', error = %s, "
                "finished_at = %s WHERE id = %s",
                (error, _utc_now(), run_id),
            )
    finally:
        conn.close()


def save_agent_output(
    run_id: int,
    meeting_id: str,
    agent_id: str,
    content: str,
    metadata: dict | None = None,
) -> int:
    """Insert an agent_output row and return its auto_increment id."""
    conn = _get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO agent_outputs "
                "(agent_run_id, meeting_id, agent_id, content, metadata, created_at) "
                "VALUES (%s, %s, %s, %s, %s, %s)",
                (
                    run_id,
                    meeting_id,
                    agent_id,
                    content,
                    json.dumps(metadata) if metadata else None,
                    _utc_now(),
                ),
            )
            cur.execute("SELECT LAST_INSERT_ID()")
            return cur.fetchone()[0]
    finally:
        conn.close()
