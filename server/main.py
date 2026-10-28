"""
Servidor Backend FastAPI - Viseña (Semana 0)
ERS 3.4 (Tabla 3.3) / RF-34
"""
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="Viseña API - Servidor de Laboratorio",
    description="Servicios de sincronización y almacenamiento de métricas de ejecución (INVENTA)",
    version="0.1.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/health")
def health_check():
    return {
        "status": "healthy",
        "service": "visenia-backend",
        "database_connected": bool(os.getenv("DATABASE_URL")),
        "environment": os.getenv("ENVIRONMENT", "development")
    }

@app.get("/api/version")
def version():
    return {
        "app": "Viseña",
        "version": "0.1.0",
        "sprint": "Semana 0: Arranque y Contratos"
    }
