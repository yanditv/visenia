import json
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from urllib.error import HTTPError
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from test_lsec_api import attempt, frames, pack, record

from app.main import app


@pytest.fixture
def practice_client(tmp_path, monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("VISENA_SQLITE_PATH", str(tmp_path / "practice.sqlite3"))
    published = tmp_path / "published.json"
    pack(published, record("ref-hola"))
    monkeypatch.setenv("VISENA_LSEC_CATALOG", str(published))
    monkeypatch.setenv("VISENA_LSEC_DRAFTS", "")
    with TestClient(app) as client:
        yield client


KEY = {"X-Participant-Key": "a" * 64}
OTHER = {"X-Participant-Key": "b" * 64}


def take(**kwargs):
    return {**attempt(), "id_intento": str(uuid4()), "id_referencia": "ref-hola", **kwargs}


def test_result_is_saved_once_and_survives_reopening(practice_client):
    client = practice_client
    payload = take()
    first = client.post("/api/v1/lsec/practicas", json=payload, headers=KEY)
    assert first.status_code == 200, first.text
    document = first.json()
    assert document["resultado"]["ejecucion"]["resultado"]["puntaje_global"] == 100
    assert document["resultado"]["ejecucion"]["frames_ejecucion"] == []
    assert "pose" not in json.dumps(document)
    retry = client.post("/api/v1/lsec/practicas", json=payload, headers=KEY)
    assert retry.json() == document
    with TestClient(app) as reopened:
        history = reopened.get("/api/v1/lsec/practicas", headers=KEY).json()
        assert history["total"] == 1
        assert history["intentos"] == [document]
    assert client.get("/api/ready").json()["database_connected"]


def test_isolation_conflicts_pagination_progress_and_exports(practice_client):
    client = practice_client
    payload = take()
    client.post("/api/v1/lsec/practicas", json=payload, headers=KEY).raise_for_status()
    assert client.get("/api/v1/lsec/practicas", headers=OTHER).json()["total"] == 0
    path = "/api/v1/lsec/practicas/" + payload["id_intento"]
    assert client.get(path, headers=OTHER).status_code == 404
    assert client.get(path, headers=KEY).status_code == 200
    changed = {**payload, "frames": frames(0.2)}
    assert client.post("/api/v1/lsec/practicas", json=changed, headers=KEY).status_code == 409
    assert client.post("/api/v1/lsec/practicas", json=payload, headers=OTHER).status_code == 409
    free = take(id_referencia=None)
    client.post("/api/v1/lsec/practicas", json=free, headers=KEY).raise_for_status()
    history = client.get("/api/v1/lsec/practicas?limite=1&offset=1", headers=KEY).json()
    assert history["total"] == 2 and len(history["intentos"]) == 1
    progress = client.get("/api/v1/lsec/progreso", headers=KEY).json()["senas"][0]
    assert progress["intentos"] == 2 and progress["mejor"] == 100
    exported = client.get("/api/v1/lsec/exportaciones", headers=KEY)
    assert len(exported.json()["intentos"]) == 2
    csv = client.get("/api/v1/lsec/exportaciones?formato=csv", headers=KEY)
    assert "id_intento" in csv.text and payload["id_intento"] in csv.text
    assert csv.headers["cache-control"] == "no-store"
    assert client.get("/api/v1/lsec/practicas").status_code == 422
    assert client.get("/api/v1/lsec/practicas?limite=1000", headers=KEY).status_code == 422


def test_concurrent_retries_and_insufficient_capture(practice_client):
    client = practice_client
    payload = take()
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(
            pool.map(
                lambda _: client.post("/api/v1/lsec/practicas", json=payload, headers=KEY), range(4)
            )
        )
    assert all(r.status_code == 200 for r in results)
    assert all(r.json() == results[0].json() for r in results)
    missing = frames()
    for frame in missing:
        del frame["mano_derecha"]
    result = client.post("/api/v1/lsec/practicas", json=take(frames=missing), headers=KEY)
    assert result.status_code == 200
    assert result.json()["resultado"]["similitud"] is None
    assert client.get("/api/v1/lsec/practicas", headers=KEY).json()["total"] == 2


def test_unavailable_store_reports_service_error(practice_client, monkeypatch, tmp_path):
    # A directory cannot be opened as a database.
    monkeypatch.setenv("VISENA_SQLITE_PATH", str(tmp_path))
    response = practice_client.post("/api/v1/lsec/practicas", json=take(), headers=KEY)
    assert response.status_code == 503
    assert "captura" not in response.text


def test_retired_video_routes_are_removed(practice_client):
    assert practice_client.post("/api/v1/recognitions").status_code == 404
    assert practice_client.post("/api/v1/videos/process").status_code == 404


def test_coach_is_private_and_uses_sanitized_evidence(practice_client, monkeypatch):
    from app.integrations import groq

    client = practice_client
    payload = take()
    base = "/api/v1/lsec"
    path = f"{base}/feedback/{payload['id_intento']}"
    received = []
    advice = "Compara la mano con la guía y repite el gesto a velocidad normal."

    def reply(request, timeout):
        assert request.get_header("Authorization") == "Bearer gsk_test_only"
        assert request.get_header("User-agent") == "Visenia/1.0"
        assert request.get_header("Accept") == "application/json"
        assert request.get_method() == "POST" and timeout == 10
        assert request.full_url == "https://api.groq.com/openai/v1/chat/completions"
        data = json.loads(request.data)
        assert data["model"] == "openai/gpt-oss-20b"
        assert [message["role"] for message in data["messages"]] == ["system", "user"]
        received.append(json.loads(data["messages"][1]["content"]))
        return BytesIO(
            json.dumps(
                {"choices": [{"finish_reason": "stop", "message": {"content": advice}}]}
            ).encode()
        )

    monkeypatch.setattr(groq, "urlopen", reply)
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    practice = client.post(f"{base}/practicas", json=payload, headers=KEY).raise_for_status().json()
    assert client.get(f"{base}/feedback/estado").json() == {
        "groq_disponible": False,
        "estado": "sin_clave",
    }
    assert client.post(path, json={}, headers=KEY).json()["estado"] == "sin_clave"
    monkeypatch.setenv("GROQ_API_KEY", "gsk_test_only")
    assert client.get(f"{base}/feedback/estado").json() == {
        "groq_disponible": True,
        "estado": "listo",
    }
    assert client.post(path, json={}, headers=OTHER).status_code == 404
    assert received == []
    result = client.post(path, json={}, headers=KEY)
    assert result.json() == {"fuente": "groq", "estado": "listo", "consejo": advice}
    assert client.post(path, json={}, headers=KEY).json() == result.json()
    assert len(received) == 1
    assert set(received[0]) == {"modo", "aspecto_a_practicar", "observacion"}
    assert client.get(f"{base}/practicas/{payload['id_intento']}", headers=KEY).json() == practice


@pytest.mark.parametrize(
    ("status", "state"), [(401, "clave_invalida"), (429, "cuota_agotada"), (503, "no_disponible")]
)
def test_coach_falls_back_if_groq_rejects_request(practice_client, monkeypatch, status, state):
    from app.integrations import groq

    def reject(request, timeout):
        raise HTTPError(request.full_url, status, "Test response", {}, None)

    monkeypatch.setattr(groq, "urlopen", reject)
    payload = take()
    client = practice_client
    path = f"/api/v1/lsec/feedback/{payload['id_intento']}"
    client.post("/api/v1/lsec/practicas", json=payload, headers=KEY).raise_for_status()
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    local = client.post(path, json={}, headers=KEY).raise_for_status().json()
    monkeypatch.setenv("GROQ_API_KEY", "gsk_test_only")
    result = client.post(path, json={}, headers=KEY)
    assert result.status_code == 200
    assert result.json() == {**local, "estado": state}


def test_journey_rewards_only_saved_scored_attempts(practice_client):
    client = practice_client
    payload = take()
    for _ in range(2):
        client.post("/api/v1/lsec/practicas", json=payload, headers=KEY).raise_for_status()
    missing = frames()
    for frame in missing:
        del frame["mano_derecha"]
    client.post("/api/v1/lsec/practicas", json=take(frames=missing), headers=KEY).raise_for_status()
    progress = client.get("/api/v1/lsec/trayectoria", headers=KEY).json()
    assert progress == {"xp": 10, "hoy": 1, "meta_diaria": 3, "racha": 1, "calificadas": 1}
    assert client.get("/api/v1/lsec/trayectoria", headers=OTHER).json()["xp"] == 0
