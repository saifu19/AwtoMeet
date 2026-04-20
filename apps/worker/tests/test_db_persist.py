"""Tests for M31 — db.persist_messages and db.get_buffer_size."""

from __future__ import annotations

from datetime import datetime

import pytest

from src import db
from src.buffer import Message


# ---------------------------------------------------------------------------
# Fake pymysql connection
# ---------------------------------------------------------------------------


class _FakeCursor:
    def __init__(self, fetchone_return=None, raises: Exception | None = None,
                 fetchone_sequence: list | None = None) -> None:
        self.executed: list[tuple[str, object]] = []
        self.executemany_calls: list[tuple[str, list]] = []
        self._fetchone_return = fetchone_return
        self._fetchone_sequence = list(fetchone_sequence) if fetchone_sequence else None
        self._raises = raises

    def execute(self, sql, params=None):
        if self._raises:
            raise self._raises
        self.executed.append((sql, params))

    def executemany(self, sql, rows):
        if self._raises:
            raise self._raises
        self.executemany_calls.append((sql, list(rows)))

    def fetchone(self):
        if self._fetchone_sequence:
            return self._fetchone_sequence.pop(0)
        return self._fetchone_return

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


def _install_fake_conn(monkeypatch, cursor: _FakeCursor) -> _FakeConn:
    conn = _FakeConn(cursor)
    monkeypatch.setattr(db, "_get_connection", lambda: conn)
    return conn


def _msg(speaker: str = "user_01", text: str = "hello") -> Message:
    return Message(
        speaker_identity=speaker,
        speaker_name=speaker,
        text=text,
        start_ts_ms=1000,
        end_ts_ms=2000,
    )


# ---------------------------------------------------------------------------
# persist_messages
# ---------------------------------------------------------------------------


def test_persist_messages_batches_via_executemany(monkeypatch):
    cursor = _FakeCursor(fetchone_sequence=[(42,)])
    _install_fake_conn(monkeypatch, cursor)

    msgs = [_msg(text="one"), _msg(text="two"), _msg(text="three")]
    first_id, last_id = db.persist_messages("mtg_01", msgs)

    assert first_id == 42
    assert last_id == 44  # 42 + 3 - 1
    assert len(cursor.executemany_calls) == 1
    sql, rows = cursor.executemany_calls[0]
    assert "INSERT INTO transcript_messages" in sql
    assert len(rows) == 3
    for row in rows:
        assert len(row) == 7
        assert row[0] == "mtg_01"
        assert isinstance(row[6], datetime)
        # Must be timezone-naive UTC (matches the API's timezone: 'Z' pool).
        assert row[6].tzinfo is None


# ---------------------------------------------------------------------------
# persist_message (singular — real-time persistence)
# ---------------------------------------------------------------------------


def test_persist_message_inserts_single_row(monkeypatch):
    cursor = _FakeCursor(fetchone_sequence=[(77,)])
    conn = _install_fake_conn(monkeypatch, cursor)

    msg = _msg(text="hello single")
    result = db.persist_message("mtg_01", msg)

    assert result == 77
    assert len(cursor.executed) == 2  # INSERT + SELECT LAST_INSERT_ID()
    sql, params = cursor.executed[0]
    assert "INSERT INTO transcript_messages" in sql
    assert params[0] == "mtg_01"
    assert params[3] == "hello single"
    assert conn.closed


def test_persist_message_closes_connection_on_error(monkeypatch):
    cursor = _FakeCursor(raises=RuntimeError("db down"))
    conn = _install_fake_conn(monkeypatch, cursor)

    with pytest.raises(RuntimeError, match="db down"):
        db.persist_message("mtg_01", _msg())

    assert conn.closed


# ---------------------------------------------------------------------------
# persist_messages (batch)
# ---------------------------------------------------------------------------


def test_persist_messages_empty_list_noop(monkeypatch):
    cursor = _FakeCursor()
    _install_fake_conn(monkeypatch, cursor)

    result = db.persist_messages("mtg_01", [])

    assert result == (0, 0)
    assert cursor.executemany_calls == []
    assert cursor.executed == []


def test_persist_messages_uses_frozen_utc_now(monkeypatch):
    cursor = _FakeCursor(fetchone_sequence=[(1,)])
    _install_fake_conn(monkeypatch, cursor)

    frozen = datetime(2026, 4, 11, 12, 0, 0)
    monkeypatch.setattr(db, "_utc_now", lambda: frozen)

    db.persist_messages("mtg_01", [_msg(), _msg()])

    _, rows = cursor.executemany_calls[0]
    assert all(row[6] == frozen for row in rows)


def test_persist_messages_reraises_db_error(monkeypatch):
    cursor = _FakeCursor(raises=RuntimeError("connection lost"))
    _install_fake_conn(monkeypatch, cursor)

    with pytest.raises(RuntimeError, match="connection lost"):
        db.persist_messages("mtg_01", [_msg()])


# ---------------------------------------------------------------------------
# get_buffer_size
# ---------------------------------------------------------------------------


def test_get_buffer_size_returns_row_value(monkeypatch):
    cursor = _FakeCursor(fetchone_return=(25,))
    _install_fake_conn(monkeypatch, cursor)

    assert db.get_buffer_size("mtg_01") == 25
    assert len(cursor.executed) == 1
    sql, params = cursor.executed[0]
    assert "LEFT JOIN meeting_types" in sql
    assert params == ("mtg_01",)


def test_get_buffer_size_defaults_when_null(monkeypatch):
    cursor = _FakeCursor(fetchone_return=(None,))
    _install_fake_conn(monkeypatch, cursor)

    assert db.get_buffer_size("mtg_01") == 10


def test_get_buffer_size_defaults_when_no_row(monkeypatch):
    cursor = _FakeCursor(fetchone_return=None)
    _install_fake_conn(monkeypatch, cursor)

    assert db.get_buffer_size("mtg_01") == 10


def test_get_buffer_size_defaults_on_db_error(monkeypatch, caplog):
    cursor = _FakeCursor(raises=RuntimeError("boom"))
    _install_fake_conn(monkeypatch, cursor)

    import logging

    with caplog.at_level(logging.ERROR, logger="worker.db"):
        result = db.get_buffer_size("mtg_01")

    assert result == 10
    assert "failed to read buffer_size" in caplog.text


# ---------------------------------------------------------------------------
# Connection close — every function must close the pymysql connection
# ---------------------------------------------------------------------------


def test_persist_messages_closes_connection(monkeypatch):
    cursor = _FakeCursor(fetchone_sequence=[(1,)])
    conn = _install_fake_conn(monkeypatch, cursor)

    db.persist_messages("mtg_01", [_msg()])

    assert conn.closed


def test_persist_messages_closes_connection_on_error(monkeypatch):
    cursor = _FakeCursor(raises=RuntimeError("boom"))
    conn = _install_fake_conn(monkeypatch, cursor)

    with pytest.raises(RuntimeError):
        db.persist_messages("mtg_01", [_msg()])

    assert conn.closed


def test_get_buffer_size_closes_connection(monkeypatch):
    cursor = _FakeCursor(fetchone_return=(25,))
    conn = _install_fake_conn(monkeypatch, cursor)

    db.get_buffer_size("mtg_01")

    assert conn.closed


def test_get_buffer_size_closes_connection_on_error(monkeypatch):
    cursor = _FakeCursor(raises=RuntimeError("boom"))
    conn = _install_fake_conn(monkeypatch, cursor)

    db.get_buffer_size("mtg_01")

    assert conn.closed
