"""Persist coaching and reserve one provider request per attempt at a time."""

import json

from app.db import connection, execute, initialize


def find(attempt_id):
    initialize()
    with connection() as conn:
        row = execute(
            conn, "SELECT document FROM practice_feedback WHERE attempt_id=%s", (attempt_id,)
        ).fetchone()
        return json.loads(row[0]) if row and row[0] else None


def reserve(attempt_id, now, until):
    initialize()
    with connection() as conn:
        cursor = execute(
            conn,
            """INSERT INTO practice_feedback(attempt_id, retry_after)
            VALUES (%s,%s) ON CONFLICT(attempt_id) DO UPDATE SET retry_after=excluded.retry_after
            WHERE practice_feedback.document IS NULL AND practice_feedback.retry_after <= %s""",
            (attempt_id, until.isoformat(), now.isoformat()),
        )
        return cursor.rowcount == 1


def save(attempt_id, document):
    with connection() as conn:
        execute(
            conn,
            """UPDATE practice_feedback SET document=%s
            WHERE attempt_id=%s AND document IS NULL""",
            (document, attempt_id),
        )
