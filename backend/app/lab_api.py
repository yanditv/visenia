"""
Servidor Backend FastAPI - Viseña (Semana 0)
ERS 3.4 (Tabla 3.3) / RF-34
"""
import os
import psycopg2
from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/api", tags=["Laboratorio"])

@router.get("/health")
def health_check():
    return {
        "status": "healthy",
        "service": "visenia-backend",
        "environment": os.getenv("ENVIRONMENT", "development")
    }


@router.get("/ready")
def readiness_check():
    connected = False
    database_url = os.getenv("DATABASE_URL")
    if database_url:
        connection = None
        try:
            connection = psycopg2.connect(
                database_url, connect_timeout=3, options="-c statement_timeout=3000"
            )
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
                connected = cursor.fetchone() == (1,)
        except psycopg2.Error:
            pass
        finally:
            if connection is not None:
                connection.close()
    return JSONResponse(
        status_code=200 if connected else 503,
        content={"status": "ready" if connected else "unavailable",
                 "database_connected": connected},
    )

@router.get("/version")
def version():
    return {
        "app": "Viseña",
        "version": "0.1.0",
        "sprint": "Semana 0: Arranque y Contratos"
    }
