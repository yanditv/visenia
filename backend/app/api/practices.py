"""Persistent practice, history, progress and portable result exports."""

import csv
import io
import json
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from app.api.dependencies import available_catalog, participant
from app.api.routing import LandmarkRoute
from app.contracts.lsec import ReferenceId
from app.contracts.practice import (
    Feedback,
    GameProgress,
    History,
    PracticeAttempt,
    PracticeRecord,
    Progress,
)
from app.repositories import practices
from app.services.feedback import availability, coaching
from app.services.practice import complete

router = APIRouter(prefix="/api/v1/lsec", tags=["Historial"], route_class=LandmarkRoute)


@router.post("/practicas", response_model=PracticeRecord)
def practice(attempt: PracticeAttempt, owner: str = Depends(participant)):
    return complete(attempt, owner, available_catalog)


@router.get("/practicas", response_model=History)
def history(
    owner: str = Depends(participant),
    limite: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    id_referencia: ReferenceId | None = None,
):
    return practices.history(owner, limite, offset, id_referencia)


@router.get("/practicas/{id_intento}", response_model=PracticeRecord)
def detail(id_intento: UUID, owner: str = Depends(participant)):
    result = practices.find(str(id_intento), owner)
    if result is None:
        raise HTTPException(404, detail={"codigo": "intento_no_disponible"})
    return result


@router.get("/progreso", response_model=Progress)
def progress(owner: str = Depends(participant)):
    return practices.progress(owner)


@router.get("/trayectoria", response_model=GameProgress)
def journey(owner: str = Depends(participant)):
    return practices.journey(owner)


@router.get("/feedback/estado")
def feedback_status():
    return availability()


@router.post("/feedback/{id_intento}", response_model=Feedback)
def practice_feedback(id_intento: UUID, owner: str = Depends(participant)):
    return coaching(detail(id_intento, owner))


@router.get("/exportaciones")
def export(owner: str = Depends(participant), formato: Literal["json", "csv"] = "json"):
    # Open the store before response headers so unavailability yields HTTP 503.
    practices.history(owner, 1, 0)

    def records():
        rows = practices.export_rows(owner)
        if formato == "json":
            yield '{"version":"1.0","intentos":['
            separator = ""
            for document in rows:
                yield separator + json.dumps(document, ensure_ascii=False, allow_nan=False)
                separator = ","
            yield "]}"
        else:
            output = io.StringIO()
            writer = csv.writer(output)
            yield "﻿"
            writer.writerow(
                [
                    "id_intento",
                    "timestamp_utc",
                    "tipo",
                    "id_referencia",
                    "glosa",
                    "puntaje",
                    "estado",
                ]
            )
            yield output.getvalue()
            for document in rows:
                result = document["resultado"]
                grade = result.get("similitud") or {}
                execution = (result.get("ejecucion") or {}).get("resultado") or {}
                output.seek(0)
                output.truncate()
                # Quotes alone do not prevent spreadsheet formula execution.
                gloss = document["glosa"] or ""
                if gloss.startswith(("=", "+", "-", "@")):
                    gloss = "'" + gloss
                writer.writerow(
                    [
                        document["id_intento"],
                        document["timestamp_utc"],
                        document["tipo"],
                        document["id_referencia"],
                        gloss,
                        execution.get("puntaje_global", grade.get("puntaje")),
                        result["estado"],
                    ]
                )
                yield output.getvalue()

    return StreamingResponse(
        records(),
        media_type="application/json" if formato == "json" else "text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="visenia-resultados.{formato}"',
            "Cache-Control": "no-store",
        },
    )
