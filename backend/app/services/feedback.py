"""Generate optional coaching from evaluated LSEC metrics."""

import logging
import os
from datetime import UTC, datetime, timedelta
from urllib.error import HTTPError

from app.contracts.practice import Feedback
from app.integrations.groq import generate_advice
from app.repositories import feedback as cache

logger = logging.getLogger(__name__)


def availability():
    configured = bool(os.getenv("GROQ_API_KEY", "").strip())
    return {"groq_disponible": configured, "estado": "listo" if configured else "sin_clave"}


def coaching(document):
    result = document["resultado"]
    grade = result.get("similitud")
    if grade is None:
        return Feedback(
            fuente="reglas",
            estado="sin_mediciones",
            consejo=("Mantén visibles los hombros y la mano activa durante toda la seña."),
        )

    scores = grade["por_parametro"]
    weakest = min(scores, key=scores.get) if scores else None
    observation = (
        grade["mensaje_feedback"] or "Repite la seña a velocidad normal y compárala con la guía."
    )
    if applied := result.get("calibracion_aplicada"):
        weakest = applied["aspecto_a_practicar"]
        if weakest:
            observation = result["ejecucion"]["resultado"]["parametros_evaluados"][weakest][
                "mensaje_feedback"
            ]
        else:
            observation = "Todos los aspectos medidos están dentro del rango de referencia."
    fallback = Feedback(fuente="reglas", estado="sin_clave", consejo=observation)
    attempt_id = document["id_intento"]
    saved = cache.find(attempt_id)
    if saved:
        return Feedback.model_validate(saved)

    key = os.getenv("GROQ_API_KEY", "").strip()
    if not key:
        return fallback

    now = datetime.now(UTC)
    if not cache.reserve(attempt_id, now, now + timedelta(seconds=60)):
        saved = cache.find(attempt_id)
        return (
            Feedback.model_validate(saved)
            if saved
            else fallback.model_copy(update={"estado": "en_espera"})
        )

    evidence = {
        "modo": document["tipo"],
        "aspecto_a_practicar": weakest,
        "observacion": observation,
    }
    try:
        tip = Feedback(fuente="groq", estado="listo", consejo=generate_advice(key, evidence))
    except HTTPError as error:
        logger.warning("Groq rechazó la solicitud de consejo (HTTP %s).", error.code)
        status = {401: "clave_invalida", 429: "cuota_agotada"}.get(error.code, "no_disponible")
        return fallback.model_copy(update={"estado": status})
    except (OSError, ValueError, KeyError, IndexError, TypeError) as error:
        logger.warning("No se pudo obtener el consejo de Groq (%s).", type(error).__name__)
        return fallback.model_copy(update={"estado": "no_disponible"})
    cache.save(attempt_id, tip.model_dump_json())
    return tip
