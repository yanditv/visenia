"""Transactional storage shared by PostgreSQL deployments and local SQLite development."""

import os
import sqlite3
from contextlib import contextmanager
from functools import lru_cache
from pathlib import Path

import psycopg2

DEFAULT_PATH = Path(__file__).resolve().parents[1] / "data" / "visenia.sqlite3"


class StorageUnavailable(Exception):
    pass


@contextmanager
def connection():
    database_url = os.getenv("DATABASE_URL")
    conn = None
    try:
        if database_url:
            conn = psycopg2.connect(
                database_url, connect_timeout=5, options="-c statement_timeout=10000"
            )
        else:
            path = Path(os.getenv("VISENA_SQLITE_PATH", str(DEFAULT_PATH)))
            path.parent.mkdir(parents=True, exist_ok=True)
            conn = sqlite3.connect(path, timeout=10)
            conn.execute("PRAGMA journal_mode=WAL")
        with conn:
            yield conn
    except (psycopg2.Error, sqlite3.Error, OSError) as error:
        raise StorageUnavailable("El almacenamiento no está disponible.") from error
    finally:
        if conn is not None:
            conn.close()


def execute(conn, sql, values=()):
    cursor = conn.cursor()
    cursor.execute(sql if os.getenv("DATABASE_URL") else sql.replace("%s", "?"), values)
    return cursor


@lru_cache(maxsize=16)
def _initialize(database_url, sqlite_path):
    with connection() as conn:
        if database_url:
            execute(conn, "SELECT pg_advisory_xact_lock(%s)", (84693125,))
        execute(
            conn,
            """CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)""",
        )
        execute(
            conn,
            """CREATE TABLE IF NOT EXISTS practices (
            id TEXT PRIMARY KEY, owner_hash TEXT NOT NULL, request_hash TEXT NOT NULL,
            created_at TEXT NOT NULL, reference_id TEXT, gloss TEXT, kind TEXT NOT NULL,
            score DOUBLE PRECISION, document TEXT NOT NULL)""",
        )
        execute(
            conn,
            "CREATE INDEX IF NOT EXISTS practices_owner_created ON practices(owner_hash, created_at, id)",
        )
        execute(
            conn,
            """INSERT INTO schema_migrations(version, applied_at) VALUES (1, CURRENT_TIMESTAMP)
            ON CONFLICT(version) DO NOTHING""",
        )

        execute(
            conn,
            """CREATE TABLE IF NOT EXISTS practice_feedback (
            attempt_id TEXT PRIMARY KEY REFERENCES practices(id) ON DELETE CASCADE,
            retry_after TEXT NOT NULL, document TEXT)""",
        )
        execute(
            conn,
            """INSERT INTO schema_migrations(version, applied_at) VALUES (2, CURRENT_TIMESTAMP)
            ON CONFLICT(version) DO NOTHING""",
        )


def initialize():
    _initialize(os.getenv("DATABASE_URL"), os.getenv("VISENA_SQLITE_PATH", str(DEFAULT_PATH)))
