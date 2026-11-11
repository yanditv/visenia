"""
Servidor Backend FastAPI - Viseña (Semana 0)
ERS 3.4 (Tabla 3.3) / RF-34
"""
import os
import psycopg2
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

app = FastAPI(
    title="Viseña API - Servidor de Laboratorio",
    description="Servicios de sincronización y almacenamiento de métricas de ejecución (INVENTA)",
    version="0.1.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in os.getenv(
        "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,https://localhost,https://visenia.local"
    ).split(",") if origin.strip()],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/health")
def health_check():
    return {
        "status": "healthy",
        "service": "visenia-backend",
        "environment": os.getenv("ENVIRONMENT", "development")
    }


@app.get("/api/ready")
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

@app.get("/api/version")
def version():
    return {
        "app": "Viseña",
        "version": "0.1.0",
        "sprint": "Semana 0: Arranque y Contratos"
    }
