
from fastapi import FastAPI

app = FastAPI(
    title="VISENIA API",
    description="API de reconocimiento y evaluación de lengua de señas ecuatoriana",
    version="0.1.0"
)


@app.get("/api/v1/health", tags=["Health"])
def health_check():
    return {
        "status": "ok",
        "service": "visenia-backend",
        "version": "0.1.0"
    }
