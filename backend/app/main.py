"""LSEC application entry point."""

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import health, lsec, practices
from app.db import StorageUnavailable, initialize
from app.domain.lsec.evaluation import ReferenceUnavailable
from app.repositories.practices import AttemptConflict


@asynccontextmanager
async def lifespan(app):
    initialize()
    yield


app = FastAPI(
    title="Viseña LSEC",
    version="1.0.0",
    lifespan=lifespan,
    description="Práctica de Lengua de Señas Ecuatoriana con evaluación e historial.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        value.strip()
        for value in os.getenv(
            "CORS_ORIGINS",
            "http://localhost:5173,http://127.0.0.1:5173,https://localhost,https://visenia.local",
        ).split(",")
        if value.strip()
    ],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-Participant-Key"],
)
app.include_router(health.router)
app.include_router(lsec.router)
app.include_router(practices.router)


@app.exception_handler(StorageUnavailable)
async def storage_error(request: Request, error: StorageUnavailable):
    return JSONResponse(
        status_code=503, content={"detail": {"codigo": "almacenamiento_no_disponible"}}
    )


@app.exception_handler(AttemptConflict)
async def conflict_error(request: Request, error: AttemptConflict):
    return JSONResponse(status_code=409, content={"detail": {"codigo": "id_intento_reutilizado"}})


@app.exception_handler(ReferenceUnavailable)
async def reference_error(request: Request, error: ReferenceUnavailable):
    return JSONResponse(status_code=404, content={"detail": {"codigo": "referencia_no_disponible"}})


@app.exception_handler(ValueError)
async def capture_error(request: Request, error: ValueError):
    return JSONResponse(status_code=422, content={"detail": {"codigo": "captura_invalida"}})


@app.middleware("http")
async def private_results(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith(
        (
            "/api/v1/lsec/practicas",
            "/api/v1/lsec/progreso",
            "/api/v1/lsec/exportaciones",
            "/api/v1/lsec/trayectoria",
            "/api/v1/lsec/feedback",
        )
    ):
        response.headers["Cache-Control"] = "no-store"
    return response
