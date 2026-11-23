import os

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.db import StorageUnavailable, connection, execute, initialize

router = APIRouter(tags=["Sistema"])


@router.get("/api/health")
@router.get("/api/v1/health", include_in_schema=False)
@router.get("/health", include_in_schema=False)
def health():
    return {"status": "healthy", "service": "visenia-backend", "lengua": "LSEC"}


@router.get("/api/ready")
def ready():
    try:
        initialize()
        with connection() as conn:
            execute(conn, "SELECT 1 FROM practices LIMIT 1")
        return {
            "status": "ready",
            "database_connected": True,
            "database": "postgresql" if os.getenv("DATABASE_URL") else "sqlite",
        }
    except StorageUnavailable:
        return JSONResponse(
            status_code=503, content={"status": "unavailable", "database_connected": False}
        )


@router.get("/api/version")
def version():
    return {"app": "Viseña", "version": "1.0.0", "lengua": "LSEC"}
