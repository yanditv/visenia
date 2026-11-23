"""Owner-scoped result history. Camera frames never enter storage."""

import json
from datetime import UTC, datetime, timedelta, timezone

from app.db import connection, execute, initialize


class AttemptConflict(Exception):
    pass


def find(attempt_id, owner, fingerprint=None):
    initialize()
    with connection() as conn:
        row = execute(
            conn,
            "SELECT document, request_hash FROM practices WHERE id=%s AND owner_hash=%s",
            (attempt_id, owner),
        ).fetchone()
        if row and fingerprint is not None and row[1] != fingerprint:
            raise AttemptConflict("El identificador del intento ya fue utilizado.")
        return json.loads(row[0]) if row else None


def save(document, owner, fingerprint):
    initialize()
    grade = document["resultado"].get("similitud") or {}
    execution = document["resultado"].get("ejecucion") or {}
    result = execution.get("resultado") or {}
    score = result.get("puntaje_global", grade.get("puntaje"))
    with connection() as conn:
        execute(
            conn,
            """INSERT INTO practices
            (id, owner_hash, request_hash, created_at, reference_id, gloss, kind, score, document)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(id) DO NOTHING""",
            (
                document["id_intento"],
                owner,
                fingerprint,
                document["timestamp_utc"],
                document["id_referencia"],
                document["glosa"],
                document["tipo"],
                score,
                json.dumps(document, ensure_ascii=False, allow_nan=False),
            ),
        )
        row = execute(
            conn,
            "SELECT owner_hash, request_hash, document FROM practices WHERE id=%s",
            (document["id_intento"],),
        ).fetchone()
        if row[0] != owner or row[1] != fingerprint:
            raise AttemptConflict("El identificador del intento ya fue utilizado.")
        return json.loads(row[2])


def history(owner, limit, offset, reference=None):
    initialize()
    where = "owner_hash=%s"
    values = [owner]
    if reference:
        where += " AND reference_id=%s"
        values.append(reference)
    with connection() as conn:
        total = execute(conn, "SELECT COUNT(*) FROM practices WHERE " + where, values).fetchone()[0]
        rows = execute(
            conn,
            "SELECT document FROM practices WHERE "
            + where
            + " ORDER BY created_at DESC, id DESC LIMIT %s OFFSET %s",
            [*values, limit, offset],
        ).fetchall()
    return {
        "total": total,
        "limite": limit,
        "offset": offset,
        "intentos": [json.loads(r[0]) for r in rows],
    }


def progress(owner):
    initialize()
    with connection() as conn:
        rows = execute(
            conn,
            """SELECT reference_id, gloss, COUNT(*), COUNT(score), AVG(score), MAX(score), MAX(created_at)
            FROM practices WHERE owner_hash=%s GROUP BY reference_id, gloss ORDER BY gloss""",
            (owner,),
        ).fetchall()
    return {
        "senas": [
            {
                "id_referencia": r[0],
                "glosa": r[1],
                "intentos": r[2],
                "calificados": r[3],
                "promedio": round(r[4], 2) if r[4] is not None else None,
                "mejor": r[5],
                "ultimo_intento": r[6],
            }
            for r in rows
        ]
    }


def export_rows(owner):
    initialize()
    with connection() as conn:
        cursor = execute(
            conn,
            "SELECT document FROM practices WHERE owner_hash=%s ORDER BY created_at, id",
            (owner,),
        )
        while rows := cursor.fetchmany(100):
            for row in rows:
                yield json.loads(row[0])


def journey(owner, now=None):
    initialize()
    ecuador = timezone(timedelta(hours=-5))
    today = (now or datetime.now(UTC)).astimezone(ecuador).date()
    with connection() as conn:
        # Group by UTC hour so the same indexed query works in SQLite and PostgreSQL.
        hours = execute(
            conn,
            """SELECT SUBSTR(created_at,1,13), COUNT(*)
            FROM practices WHERE owner_hash=%s AND score IS NOT NULL
            GROUP BY SUBSTR(created_at,1,13)""",
            (owner,),
        ).fetchall()

    days = {}
    for hour, count in hours:
        day = datetime.fromisoformat(hour + ":00+00:00").astimezone(ecuador).date()
        days[day] = days.get(day, 0) + count
    cursor = today if today in days else today - timedelta(days=1)
    streak = 0
    while cursor in days:
        streak += 1
        cursor -= timedelta(days=1)
    total = sum(days.values())
    return {
        "xp": total * 10,
        "hoy": days.get(today, 0),
        "meta_diaria": 3,
        "racha": streak,
        "calificadas": total,
    }
