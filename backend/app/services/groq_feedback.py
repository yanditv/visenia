"""Groq wording for ASL practice feedback, grounded in measured evidence."""

import json
import logging
import os
import re
from html import unescape

import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError


logger = logging.getLogger(__name__)
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
SYSTEM_PROMPT = (
    "Ayudas a una persona a practicar lengua de señas. Escribe en español cotidiano, "
    "hablándole de tú. Cada frase debe ser corta y decir una sola idea. "
    "Usa solo los datos recibidos. No has visto la grabación ni la demostración. "
    "No digas que la seña está bien o mal hecha. No atribuyas errores a los dedos, "
    "la forma, la velocidad ni el movimiento de la persona. "
    "No uses tecnicismos ni nombres de sistemas: evita glosa, clasificador, modelo, "
    "OpenHands, Groq, ASL, MediaPipe, landmarks, fotogramas, cobertura, probabilidad, "
    "confianza, predicción, porcentaje, inferencia y HTTP. No escribas cifras. "
    "Di 'seña', 'grabación', 'cámara' o 'resultado' cuando ayuden a explicar. "
    "Si faltan datos para analizar, explica cómo repetir la grabación. "
    "Si la grabación fue suficiente, no sugieras mejorar luz, encuadre o visibilidad. "
    "Si el sistema sugirió la seña elegida, deja claro que eso no evalúa su ejecución. "
    "Si sugirió otra palabra, explica que el resultado es incierto; no diagnostiques un error. "
    "Si se observó la mano opuesta, puedes recomendar repetir con la mano solicitada. "
    "Para HELLO, si outward_movement es false, puedes recomendar revisar la dirección en la demostración; "
    "si es true, no afirmes que toda la seña sea correcta. "
    "Ofrece una o dos acciones concretas y amables, sin repetir la misma idea. "
    "Devuelve solo JSON: summary es una frase breve y recommendations contiene una o dos frases breves."
)

USER_JARGON = re.compile(
    r"\b(?:asl|openhands|wlasl|mediapipe|groq|http|glosa|clasificador|modelo|"
    r"landmarks?|frames?|fotogramas?|cobertura|probabilidad|confianza|predicci[oó]n|"
    r"porcentaje|m[eé]tricas?|inferencia|secuencia|experimental|"
    r"algoritmo|puntuaci[oó]n|score|top[- ]?k|detecci[oó]n)\b",
    re.IGNORECASE,
)
UNSUPPORTED_CLAIM = re.compile(
    r"\b(?:perfect[ao]?|correct[ao]s?|reconocid[ao]s?|confirmad[ao]s?|"
    r"correctamente|equivocad[ao]?|dedos?|muñeca|velocidad|"
    r"orientaci[oó]n|gram[aá]tica)\b|\b(?:hiciste|haces|realizaste)\s+(?:mal|bien)\b",
    re.IGNORECASE,
)
UNSUPPORTED_CAPTURE_TIP = re.compile(
    r"\b(?:iluminaci[oó]n|luz|encuadre|visible|visibilidad|enfoc[ao]|cuadro)\b"
    r"|\bc[aá]mara\s+(?:la|lo|las|los)\s+vea\b",
    re.IGNORECASE,
)


class GroqAdvice(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    summary: str = Field(min_length=1, max_length=400)
    recommendations: list[str] = Field(min_length=1, max_length=2)


ADVICE_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "recommendations": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["summary", "recommendations"],
    "additionalProperties": False,
}


def build_evidence(target_gloss: str, quality: dict, recognition: dict,
                   capture_feedback: list[str], window_frames: int | None = None,
                   observations: dict | None = None) -> dict:
    """Allowlist the facts sent to Groq; never include frames or landmarks."""
    return {
        "target_gloss": target_gloss,
        "recognition_status": recognition["status"],
        "predicted_gloss": (
            recognition["top_k"][0]["gloss"] if recognition["top_k"] else None
        ),
        "target_probability": recognition["target_probability"],
        "left_hand_coverage_pct": quality["left_hand_coverage_pct"],
        "right_hand_coverage_pct": quality["right_hand_coverage_pct"],
        "pose_coverage_pct": quality["pose_coverage_pct"],
        "left_hand_longest_missing_gap_seconds": quality.get("left_hand_longest_missing_gap_seconds"),
        "right_hand_longest_missing_gap_seconds": quality.get("right_hand_longest_missing_gap_seconds"),
        "pose_longest_missing_gap_seconds": quality.get("pose_longest_missing_gap_seconds"),
        "window_frames": window_frames if window_frames is not None else quality["frames_processed"],
        "frames_dropped": quality["frames_dropped"],
        "capture_observations": capture_feedback,
        "practice_hand": observations.get("practice_hand") if observations else None,
        "practice_hand_status": observations.get("practice_hand_status") if observations else None,
        "observation_type": observations.get("observation_type") if observations else None,
        "outward_movement": observations.get("outward_movement") if observations else None,
    }


def _safe_error_detail(response: httpx.Response, key: str) -> str:
    """Expose only a short provider message, never a credential or raw response."""
    try:
        body = response.json()
    except ValueError:
        body = None
    message = None
    if isinstance(body, str):
        message = body
    if isinstance(body, dict):
        error = body.get("error")
        if isinstance(error, dict):
            message = error.get("message") or error.get("code") or error.get("type")
        elif isinstance(error, str):
            message = error
        message = message or body.get("message") or body.get("detail")
    if not isinstance(message, str) or not message.strip():
        if body is None and response.text.strip():
            message = unescape(re.sub(r"<[^>]*>", " ", response.text[:2000]))
        else:
            message = "Respuesta sin mensaje de error."
    message = message.replace(key, "[clave oculta]")
    message = re.sub(r"gsk_[A-Za-z0-9_-]+", "[clave oculta]", message)
    message = re.sub(r"[\x00-\x1f\x7f]", " ", message)
    message = re.sub(r"\s+", " ", message).strip()
    return message[:300] or "Respuesta vacía."


def _plain_language(text: str, *, capture_sufficient: bool) -> bool:
    words = text.split()
    return bool(
        text == text.strip()
        and 3 <= len(words) <= 28
        and len(text) <= 180
        and not re.search(r"[\d%<>\n\r]", text)
        and not USER_JARGON.search(text)
        and not UNSUPPORTED_CLAIM.search(text)
        and not (capture_sufficient and UNSUPPORTED_CAPTURE_TIP.search(text))
    )


def _readable_fallback(evidence: dict, http_status: int | None = None) -> dict:
    if evidence["recognition_status"] == "insufficient_data":
        summary = "La cámara no captó suficiente de la seña para darte un resultado."
        recommendations = ["Vuelve a grabar con el torso y la mano dentro de la imagen."]
    elif evidence.get("practice_hand_status") == "opposite_hand":
        summary = "Se observó la mano opuesta en este ejercicio."
        side = "derecha" if evidence.get("practice_hand") == "right" else "izquierda"
        recommendations = [f"Prueba de nuevo con la mano {side}."]
    elif (evidence.get("observation_type") == "raised_hand_near_head" and
          evidence.get("outward_movement") is False):
        summary = "La mano indicada se elevó, pero no se observó el movimiento hacia afuera."
        recommendations = ["Revisa la dirección del movimiento en la demostración."]
    elif (evidence["recognition_status"] == "experimental" and
          evidence["predicted_gloss"] == evidence["target_gloss"]):
        summary = "El sistema sugirió la seña elegida, pero no puede evaluar cómo la hiciste."
        recommendations = ["Puedes repetirla o pedir a alguien que conozca la lengua de señas que la revise."]
    elif evidence["recognition_status"] == "experimental":
        summary = "El sistema no pudo confirmar la seña elegida en esta toma."
        recommendations = ["Puedes repetir la práctica si quieres."]
    else:
        summary = "No pudimos analizar esta grabación."
        recommendations = ["Intenta grabar de nuevo."]
    return {"status": "error", "source": "rules", "model": None,
            "summary": summary, "recommendations": recommendations,
            "http_status": http_status,
            "diagnostic": "Respuesta de Groq descartada por claridad o por afirmaciones no comprobadas."}


async def generate_groq_feedback(evidence: dict, settings, client: httpx.AsyncClient | None = None) -> dict:
    key = (os.getenv("GROQ_API_KEY") or "").strip()
    if not settings.groq_feedback_enabled or not key:
        reason = ("El servicio de consejos está desactivado."
                  if not settings.groq_feedback_enabled else
                  "Groq no está configurado en este servidor.")
        return {"status": "unavailable", "source": "rules", "model": None,
                "summary": reason,
                "recommendations": [], "http_status": None}
    payload = {
        "model": settings.groq_model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": json.dumps(evidence, ensure_ascii=False, allow_nan=False)},
        ],
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "asl_practice_feedback",
                "strict": True,
                "schema": ADVICE_SCHEMA,
            },
        },
        "max_completion_tokens": 2048,
        "reasoning_effort": "low",
        "stream": False,
    }

    async def request(active_client):
        headers = {"Authorization": f"Bearer {key}"}
        response = await active_client.post(GROQ_URL, json=payload, headers=headers)
        if response.status_code in (400, 422):
            # A configured model may reject strict schema mode. JSON mode still
            # receives local Pydantic validation before its text is displayed.
            fallback = {k: v for k, v in payload.items() if k != "reasoning_effort"}
            fallback["response_format"] = {"type": "json_object"}
            response = await active_client.post(GROQ_URL, json=fallback, headers=headers)
        if response.status_code in (400, 422):
            # Some models also reject JSON mode. The response is still parsed
            # as JSON and validated locally before being shown to the user.
            fallback.pop("response_format", None)
            response = await active_client.post(GROQ_URL, json=fallback, headers=headers)
        response.raise_for_status()
        return response

    try:
        if client is None:
            async with httpx.AsyncClient(timeout=settings.groq_timeout_seconds) as owned:
                response = await request(owned)
        else:
            response = await request(client)
        content = response.json()["choices"][0]["message"]["content"]
        advice = GroqAdvice.model_validate_json(content)
        recommendations = [item.strip() for item in advice.recommendations]
        capture_sufficient = evidence["recognition_status"] == "experimental"
        recommendations = [item for item in recommendations
                           if _plain_language(item, capture_sufficient=capture_sufficient)]
        if not recommendations:
            logger.warning("Groq feedback rejected for clarity or unsupported claim")
            return _readable_fallback(evidence, response.status_code)
        # Groq can word an unproven recognition claim without using the
        # prohibited terms above. Keep the factual summary server-owned;
        # Groq contributes only the validated practice recommendations.
        summary = _readable_fallback(evidence)["summary"]
        return {"status": "ok", "source": "groq", "model": settings.groq_model,
                "summary": summary, "recommendations": recommendations,
                "http_status": 200}
    except httpx.HTTPStatusError as exc:
        code = exc.response.status_code
        detail = _safe_error_detail(exc.response, key)
        logger.warning("Groq feedback failed http_status=%s model=%s response_bytes=%s detail=%s",
                       code, settings.groq_model, len(exc.response.content), detail)
        if code == 429:
            summary = "La ayuda automática está ocupada. Intenta de nuevo más tarde."
        elif code in (401, 403, 404):
            summary = "La ayuda automática no está disponible. Pide a quien administra el sistema que revise el acceso."
        else:
            summary = "No pudimos obtener un consejo adicional. Puedes volver a intentar."
        return {"status": "error", "source": "rules", "model": None,
                "summary": summary,
                "recommendations": [], "http_status": code,
                "diagnostic": f"Groq HTTP {code}: {detail}"}
    except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError,
            ValidationError, json.JSONDecodeError) as exc:
        # Never log request headers, the API key, raw response, or camera data.
        logger.warning("Groq feedback failed error_type=%s", type(exc).__name__)
        return {"status": "error", "source": "rules", "model": None,
                "summary": "No pudimos obtener un consejo adicional. Puedes volver a intentar.",
                "recommendations": [], "http_status": None}
