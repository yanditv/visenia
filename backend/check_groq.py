"""Check Groq with the same settings and request used by the ASL backend."""

import asyncio
import os

import httpx

from app.services.groq_feedback import GROQ_URL, generate_groq_feedback
from app.streaming.config import RealtimeSettings


async def main():
    settings = RealtimeSettings()
    key = os.getenv("GROQ_API_KEY", "").strip()
    if not key:
        print("Groq: falta GROQ_API_KEY. Inicia con start_with_groq.ps1.")
        return
    print(f"Comprobando Groq con {settings.groq_model}...")
    try:
        async with httpx.AsyncClient(timeout=settings.groq_timeout_seconds) as client:
            response = await client.get(
                GROQ_URL.replace("/chat/completions", "/models"),
                headers={"Authorization": f"Bearer {key}"})
        print(f"Acceso a modelos de Groq: HTTP {response.status_code}.")
        if response.status_code == 401:
            print("Groq rechazó la clave API. Comprueba que pegaste una clave vigente.")
            return
        if response.status_code == 200:
            models = {item["id"] for item in response.json()["data"]}
            if settings.groq_model not in models:
                print(f"El modelo {settings.groq_model} no está disponible con esta clave.")
                return
            print("El modelo configurado está disponible.")
    except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
        print(f"No se pudo comprobar la lista de modelos ({type(exc).__name__}).")
    result = await generate_groq_feedback({
        "target_gloss": "drink",
        "recognition_status": "insufficient_data",
        "predicted_gloss": None,
        "target_probability": None,
        "window_frames": 0,
        "capture_observations": ["Prueba de conexión: aún no se capturó una seña."],
    }, settings)
    if result["status"] == "ok":
        print("Groq: conexión y feedback JSON correctos.")
    else:
        print(f"Groq: {result['summary']}")
        print("El servidor iniciará con feedback local hasta resolver este problema.")


if __name__ == "__main__":
    asyncio.run(main())
