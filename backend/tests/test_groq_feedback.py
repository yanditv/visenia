import asyncio
import json

import httpx
import pytest

from app.services.groq_feedback import build_evidence, generate_groq_feedback
from app.streaming.config import RealtimeSettings


def evidence():
    quality = {"left_hand_coverage_pct": 80.0,
               "right_hand_coverage_pct": 75.0,
               "pose_coverage_pct": 98.0,
               "frames_processed": 35,
               "frames_dropped": 2,
               "frames_received": 37}
    recognition = {"status": "experimental",
                   "target_probability": 0.55,
                   "top_k": [{"gloss": "drink", "score": 0.55}]}
    return build_evidence("drink", quality, recognition, [])


def test_evidence_contains_no_frames_or_landmarks():
    payload = evidence()
    assert payload["target_gloss"] == "drink"
    assert payload["target_probability"] == 0.55
    assert "frames" not in payload
    assert "landmarks" not in payload
    assert "frames_received" not in payload


def test_missing_key_uses_local_feedback(monkeypatch):
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    result = asyncio.run(generate_groq_feedback(evidence(), RealtimeSettings()))
    assert result["source"] == "rules"
    assert result["status"] == "unavailable"
    assert "no está configurado" in result["summary"]


def test_mismatch_groq_advice_keeps_uncertain_summary(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "test-only-key")
    facts = evidence()
    facts["predicted_gloss"] = "feedback"
    facts["target_probability"] = 0.000001

    def respond(request):
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps({
            "summary": "La cámara registró tu intento para esta práctica.",
            "recommendations": ["Puedes repetir la práctica cuando quieras."],
        })}}]})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            return await generate_groq_feedback(facts, RealtimeSettings(), client)

    result = asyncio.run(run())
    assert result["status"] == "ok"
    assert result["source"] == "groq"
    assert result["summary"] == "El sistema no pudo confirmar la seña elegida en esta toma."
    assert result["recommendations"] == ["Puedes repetir la práctica cuando quieras."]


def test_groq_structured_response_and_sanitized_request(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "test-only-key")

    def respond(request):
        assert request.url.path == "/openai/v1/chat/completions"
        assert request.headers["authorization"] == "Bearer test-only-key"
        body = json.loads(request.content)
        assert body["model"] == "openai/gpt-oss-120b"
        assert body["response_format"]["json_schema"]["strict"] is True
        assert "No uses tecnicismos" in body["messages"][0]["content"]
        assert "landmarks" not in body["messages"][1]["content"]
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps({
            "summary": "La cámara registró tu seña para este intento.",
            "recommendations": ["Puedes practicar de nuevo cuando quieras."],
        })}}]})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            return await generate_groq_feedback(evidence(), RealtimeSettings(), client)

    result = asyncio.run(run())
    assert result["status"] == "ok"
    assert result["source"] == "groq"
    assert result["http_status"] == 200
    assert result["recommendations"] == ["Puedes practicar de nuevo cuando quieras."]


def test_groq_cannot_turn_model_suggestion_into_verified_sign(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "test-only-key")

    def respond(request):
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps({
            "summary": "La grabación mostró la seña de drink con la mano derecha.",
            "recommendations": ["Puedes practicar de nuevo cuando quieras."],
        })}}]})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            return await generate_groq_feedback(evidence(), RealtimeSettings(), client)

    result = asyncio.run(run())
    assert result["status"] == "ok"
    assert result["source"] == "groq"
    assert result["summary"] == "El sistema sugirió la seña elegida, pero no puede evaluar cómo la hiciste."


def test_groq_failure_falls_back_without_logging_secret(monkeypatch, caplog):
    monkeypatch.setenv("GROQ_API_KEY", "test-only-key")
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(
                lambda request: httpx.Response(429, json={"error": "rate limited"}))) as client:
            return await generate_groq_feedback(evidence(), RealtimeSettings(), client)

    result = asyncio.run(run())
    assert result["status"] == "error"
    assert result["source"] == "rules"
    assert result["http_status"] == 429
    assert "ocupada" in result["summary"]
    assert "HTTP 429" in result["diagnostic"]
    assert "test-only-key" not in caplog.text


def test_strict_schema_rejection_retries_with_json_mode(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "test-only-key")
    calls = []

    def respond(request):
        body = json.loads(request.content)
        calls.append(body["response_format"]["type"])
        if len(calls) == 1:
            return httpx.Response(400, json={"error": {"type": "invalid_request_error"}})
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps({
            "summary": "La cámara registró tu intento.",
            "recommendations": ["Puedes practicar otra vez."],
        })}}]})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            return await generate_groq_feedback(evidence(), RealtimeSettings(), client)

    result = asyncio.run(run())
    assert calls == ["json_schema", "json_object"]
    assert result["status"] == "ok"


def test_json_mode_rejection_retries_with_plain_completion(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "test-only-key")
    formats = []

    def respond(request):
        body = json.loads(request.content)
        formats.append(body.get("response_format", {}).get("type"))
        if len(formats) < 3:
            return httpx.Response(400, json={"error": {"message": "Response format unsupported"}})
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps({
            "summary": "La cámara registró tu intento.",
            "recommendations": ["Puedes practicar otra vez."],
        })}}]})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            return await generate_groq_feedback(evidence(), RealtimeSettings(), client)

    result = asyncio.run(run())
    assert formats == ["json_schema", "json_object", None]
    assert result["status"] == "ok"


def test_groq_400_exposes_redacted_reason(monkeypatch, caplog):
    monkeypatch.setenv("GROQ_API_KEY", "test-only-key")
    fake_secret = "gsk_" + "exampleSecret123"

    def respond(request):
        return httpx.Response(400, json={"error": {
            "message": f"Model not supported with test-only-key or {fake_secret}"}})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            return await generate_groq_feedback(evidence(), RealtimeSettings(), client)

    result = asyncio.run(run())
    assert result["http_status"] == 400
    assert "Model not supported" in result["diagnostic"]
    assert "HTTP" not in result["summary"]
    assert "test-only-key" not in result["summary"] + result["diagnostic"] + caplog.text
    assert fake_secret not in result["summary"] + result["diagnostic"] + caplog.text


def test_unauthorized_key_has_actionable_status(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "test-only-key")
    calls = 0

    def respond(request):
        nonlocal calls
        calls += 1
        return httpx.Response(401, json={"error": {"type": "invalid_api_key"}})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            return await generate_groq_feedback(evidence(), RealtimeSettings(), client)

    result = asyncio.run(run())
    assert calls == 1
    assert result["http_status"] == 401
    assert "revise el acceso" in result["summary"]


@pytest.mark.parametrize("response, expected", [
    (lambda: httpx.Response(400, json={"error": "Bad model test-only-key"}), "Bad model"),
    (lambda: httpx.Response(400, json={"detail": "Invalid request test-only-key"}), "Invalid request"),
    (lambda: httpx.Response(400, json="Request denied test-only-key"), "Request denied"),
    (lambda: httpx.Response(400, text="<html><body>Request blocked test-only-key</body></html>"), "Request blocked"),
    (lambda: httpx.Response(400, content=b""), "sin mensaje de error"),
])
def test_nonstandard_groq_error_is_diagnosed_and_redacted(monkeypatch, caplog, response, expected):
    monkeypatch.setenv("GROQ_API_KEY", "test-only-key")

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: response())) as client:
            return await generate_groq_feedback(evidence(), RealtimeSettings(), client)

    result = asyncio.run(run())
    assert expected in result["diagnostic"]
    assert expected in caplog.text
    assert "test-only-key" not in result["summary"] + result["diagnostic"] + caplog.text


def test_invalid_ai_output_falls_back(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "test-only-key")
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(
                lambda request: httpx.Response(200, json={"choices": [{"message": {
                    "content": '{"summary":"ok","recommendations":[]}'}}]}))) as client:
            return await generate_groq_feedback(evidence(), RealtimeSettings(), client)

    result = asyncio.run(run())
    assert result["status"] == "error"


@pytest.mark.parametrize("recommendation", [
    "Mejora la iluminación para ver las manos.",
    "Repite con la mano derecha asegurándote de que la cámara la vea completa.",
    "Hiciste bien la seña.",
])
def test_rejects_unsupported_recommendation(monkeypatch, recommendation):
    monkeypatch.setenv("GROQ_API_KEY", "test-only-key")

    def respond(request):
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps({
            "summary": "La cámara registró tu intento.", "recommendations": [recommendation],
        })}}]})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            return await generate_groq_feedback(evidence(), RealtimeSettings(), client)

    result = asyncio.run(run())
    assert result["status"] == "error"
    assert result["source"] == "rules"
    assert result["http_status"] == 200
    assert "iluminación" not in " ".join(result["recommendations"]).lower()


def test_groq_keeps_safe_recommendation_when_another_is_discarded(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "test-only-key")

    def respond(request):
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps({
            "summary": "La glosa tiene 82% de confianza.",
            "recommendations": [
                "Asegúrate de que la cámara la vea completa.",
                "Compara tu grabación con la demostración para notar diferencias.",
            ],
        })}}]})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            return await generate_groq_feedback(evidence(), RealtimeSettings(), client)

    result = asyncio.run(run())
    assert result["status"] == "ok"
    assert result["source"] == "groq"
    assert result["summary"] == "El sistema sugirió la seña elegida, pero no puede evaluar cómo la hiciste."
    assert result["recommendations"] == ["Compara tu grabación con la demostración para notar diferencias."]
