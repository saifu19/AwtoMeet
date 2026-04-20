"""Tests for worker meeting-lifecycle DB helpers.

Covers:
- register_worker overwrites worker_job_id unconditionally (since the API
  pre-stores a different identifier — the dispatch_id — and the worker's
  ctx.job.id differs). One-worker-per-meeting is enforced upstream at the
  API and LiveKit layers, not here.
- mark_meeting_live / mark_meeting_summarizing / deregister_worker rowcount
  logging on both the transition-applied and no-op branches.
"""

from __future__ import annotations

import pytest

from src import db


# ---------------------------------------------------------------------------
# Fake pymysql connection (mirrors test_db_persist.py but adds rowcount)
# ---------------------------------------------------------------------------


class _FakeCursor:
    def __init__(self, rowcount: int = 1, raises: Exception | None = None) -> None:
        self.executed: list[tuple[str, object]] = []
        self.rowcount = rowcount
        self._raises = raises

    def execute(self, sql, params=None):
        if self._raises:
            raise self._raises
        self.executed.append((sql, params))

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


class _FakeConn:
    def __init__(self, cursor: _FakeCursor) -> None:
        self._cursor = cursor
        self.closed = False

    def cursor(self):
        return self._cursor

    def close(self):
        self.closed = True

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


def _install(monkeypatch, cursor: _FakeCursor) -> _FakeConn:
    conn = _FakeConn(cursor)
    monkeypatch.setattr(db, "_get_connection", lambda: conn)
    return conn


# ---------------------------------------------------------------------------
# register_worker — unconditional overwrite (API pre-stores a different id)
# ---------------------------------------------------------------------------


def test_register_worker_overwrites_regardless_of_existing_value(monkeypatch):
    # rowcount=1 = the UPDATE matched the meeting row (the usual case).
    # The worker must overwrite whatever the API pre-stored (dispatch_id)
    # with its own ctx.job.id. No conditional — the row always has the worker's
    # job_id after this call succeeds.
    cursor = _FakeCursor(rowcount=1)
    _install(monkeypatch, cursor)

    assert db.register_worker("mtg_01", "job_a") is True
    assert len(cursor.executed) == 1
    sql, params = cursor.executed[0]
    assert "UPDATE meetings SET worker_job_id = %s WHERE id = %s" in sql
    # No OR-conditional on worker_job_id — that would block the API's
    # pre-stored dispatch_id from being replaced.
    assert "worker_job_id IS NULL" not in sql
    assert params == ("job_a", "mtg_01")


def test_register_worker_returns_false_when_meeting_row_missing(monkeypatch):
    # rowcount=0 = WHERE didn't match any row. Meeting was deleted between
    # dispatch and worker start. Caller continues anyway; False is just a
    # signal for logging/metrics.
    cursor = _FakeCursor(rowcount=0)
    _install(monkeypatch, cursor)

    assert db.register_worker("mtg_01", "job_a") is False


def test_register_worker_returns_false_on_db_error(monkeypatch):
    cursor = _FakeCursor(raises=RuntimeError("connection lost"))
    _install(monkeypatch, cursor)

    # Must not raise — caller continues into the meeting anyway.
    assert db.register_worker("mtg_01", "job_a") is False


# ---------------------------------------------------------------------------
# Status-transition helpers — Change 2 added no-op branch logging.
# We verify the SQL + that no exception leaks out on either branch.
# ---------------------------------------------------------------------------


def test_mark_meeting_live_executes_transition_sql(monkeypatch):
    cursor = _FakeCursor(rowcount=1)
    _install(monkeypatch, cursor)

    db.mark_meeting_live("mtg_01")

    assert len(cursor.executed) == 1
    sql, _params = cursor.executed[0]
    assert "SET status = 'live'" in sql
    assert "WHERE id = %s AND status = 'scheduled'" in sql


def test_mark_meeting_live_noop_does_not_raise(monkeypatch):
    # rowcount=0 → row wasn't in 'scheduled'. Function logs and returns cleanly.
    cursor = _FakeCursor(rowcount=0)
    _install(monkeypatch, cursor)

    db.mark_meeting_live("mtg_01")  # must not raise


def test_mark_meeting_live_swallows_db_error(monkeypatch):
    cursor = _FakeCursor(raises=RuntimeError("db down"))
    _install(monkeypatch, cursor)

    db.mark_meeting_live("mtg_01")  # must not raise


def test_mark_meeting_summarizing_transition_accepts_live_or_scheduled(monkeypatch):
    cursor = _FakeCursor(rowcount=1)
    _install(monkeypatch, cursor)

    db.mark_meeting_summarizing("mtg_01")

    sql, _params = cursor.executed[0]
    assert "SET status = 'summarizing'" in sql
    # Both live and scheduled must be acceptable pre-states; otherwise a
    # never-joined meeting can't terminate cleanly.
    assert "status IN ('live', 'scheduled')" in sql


def test_deregister_worker_clears_job_id_and_ends(monkeypatch):
    cursor = _FakeCursor(rowcount=1)
    _install(monkeypatch, cursor)

    db.deregister_worker("mtg_01")

    sql, _params = cursor.executed[0]
    assert "worker_job_id = NULL" in sql
    assert "status = 'ended'" in sql
    # Must match summarizing too, otherwise meetings stuck in 'summarizing'
    # after a summary-gen crash would never reach 'ended'.
    assert "status IN ('live', 'scheduled', 'summarizing')" in sql


def test_deregister_worker_noop_does_not_raise(monkeypatch):
    cursor = _FakeCursor(rowcount=0)
    _install(monkeypatch, cursor)

    db.deregister_worker("mtg_01")  # idempotent — meeting already ended


# ---------------------------------------------------------------------------
# Connection close — every function must close the pymysql connection
# ---------------------------------------------------------------------------


def test_register_worker_closes_connection(monkeypatch):
    cursor = _FakeCursor(rowcount=1)
    conn = _install(monkeypatch, cursor)

    db.register_worker("mtg_01", "job_a")

    assert conn.closed


def test_register_worker_closes_connection_on_error(monkeypatch):
    cursor = _FakeCursor(raises=RuntimeError("boom"))
    conn = _install(monkeypatch, cursor)

    db.register_worker("mtg_01", "job_a")

    assert conn.closed


def test_mark_meeting_live_closes_connection(monkeypatch):
    cursor = _FakeCursor(rowcount=1)
    conn = _install(monkeypatch, cursor)

    db.mark_meeting_live("mtg_01")

    assert conn.closed


def test_mark_meeting_live_closes_connection_on_error(monkeypatch):
    cursor = _FakeCursor(raises=RuntimeError("boom"))
    conn = _install(monkeypatch, cursor)

    db.mark_meeting_live("mtg_01")

    assert conn.closed


def test_mark_meeting_summarizing_closes_connection(monkeypatch):
    cursor = _FakeCursor(rowcount=1)
    conn = _install(monkeypatch, cursor)

    db.mark_meeting_summarizing("mtg_01")

    assert conn.closed


def test_deregister_worker_closes_connection(monkeypatch):
    cursor = _FakeCursor(rowcount=1)
    conn = _install(monkeypatch, cursor)

    db.deregister_worker("mtg_01")

    assert conn.closed
