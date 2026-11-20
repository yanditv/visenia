import json
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator, FormatChecker

from app.contracts.lsec import PARAMETERS
from app.main import app
from app.services import lsec_catalog


@pytest.fixture
def client(tmp_path, monkeypatch):
    path = tmp_path / "catalogo.json"
    monkeypatch.setattr(lsec_catalog, "DEFAULT_CATALOG", path)
    monkeypatch.delenv("VISENA_LSEC_CATALOG", raising=False)
    monkeypatch.delenv("VISENA_LSEC_DRAFTS", raising=False)
    return TestClient(app), path


def frames(offset=0, *, face=True):
    output = []
    for index in range(8):
        pose = [{"x": 0.5, "y": 0.4, "z": 0, "visibility": 1} for _ in range(33)]
        pose[11]["x"], pose[12]["x"] = 0.65, 0.35
        hand = [{"x": 0.4 + offset + index * 0.012 + (point // 4) * 0.008,
                 "y": 0.33 + (point % 4) * 0.016,
                 "z": 0.004 * ((point * point) % 7)} for point in range(21)]
        frame = {"frame_idx": index, "timestamp_ms": index * 40, "pose": pose, "mano_derecha": hand}
        if face:
            frame["blendshapes_rostro"] = {"jawOpen": 0.2}
        output.append(frame)
    return output


def record(reference_id, *, offset=0, required_face=False):
    return {
        "ancho": 640, "alto": 480, "fuente_url": "https://example.org/referencia",
        "revision": {"especialista": "Prueba", "fecha": "2026-11-20T15:00:00Z", "procedencia": "Fixture"},
        "calibracion": {
            "puntaje_minimo": 75,
            "umbrales": {key: {"verde": 0.03, "rojo": 0.15}
                         for key in (PARAMETERS if required_face else PARAMETERS[:4])},
        },
        "referencia": {
            "schema_version": "1.1.0", "id": reference_id, "glosa": reference_id[4:].upper(),
            "unidad_tematica": 1, "mano_dominante": "derecha",
            "metadatos_grabacion": {
                "fps": 25, "total_frames": 8, "duracion_ms": 280, "anotador": "Prueba",
                "fecha_anotacion": "2026-11-20T15:00:00Z",
            },
            "segmentacion": {"frame_inicio_sena": 0, "frame_fin_sena": 7},
            "parametros_fonologicos": {
                "queirema_configuracion": {"codigo_forma": "test", "descripcion": "test", "tolerancia_grados": 20},
                "kinema_orientacion": {"vector_palma": [0, 0, 1], "tolerancia_grados": 25},
                "toponema_ubicacion": {"zona_corporal": "pecho", "tolerancia_radio": 0.15},
                "kinesema_movimiento": {"tipo_movimiento": "rectilineo", "repeticiones": 1},
                "prosoponema_no_manual": {"requerido": required_face, "blendshapes_clave": {"jawOpen": 0.2}},
            },
            "frames": frames(offset),
        },
    }


def pack(path, *records):
    path.write_text(json.dumps({"version": "pruebas-lsec", "referencias": records}), encoding="utf-8")


def attempt(capture_frames=None, **extra):
    return {"schema_version": "1.1.0", "ancho": 640, "alto": 480,
            "frames": frames() if capture_frames is None else capture_frames, **extra}


def test_inventory_without_landmarks_is_documentary(client):
    api, _ = client
    response = api.get("/api/v1/lsec/catalogo")
    assert response.status_code == 200
    catalog = response.json()
    assert len(catalog["referencias"]) == 40
    assert all(row["estado"] == "pendiente_referencia" and row["video_url"] for row in catalog["referencias"])
    assert api.get("/api/v1/lsec/referencias").json() == []
    assert api.post("/api/v1/lsec/reconocimientos", json=attempt()).json()["estado"] == "sin_referencias"
    assert api.post("/api/v1/lsec/evaluaciones", json=attempt(id_referencia="ref-hola")).status_code == 404


def test_drafts_match_but_do_not_publish_or_grade(client, tmp_path, monkeypatch):
    api, _ = client
    path = tmp_path / "borrador.json"
    pack(path, record("ref-hola"), record("ref-adios", offset=0.2))
    monkeypatch.setenv("VISENA_LSEC_DRAFTS", str(path))
    index = api.get("/api/v1/lsec/catalogo").json()
    assert index["referencias"][0]["estado"] == "experimental"
    assert not index["referencias"][0]["calibrada"]
    assert api.get("/api/v1/lsec/referencias").json() == []
    best = api.post("/api/v1/lsec/reconocimientos", json=attempt()).json()
    assert best["estado"] == "experimental"
    assert [candidate["id_referencia"] for candidate in best["candidatas"]] == ["ref-hola", "ref-adios"]
    assert best["candidatas"][0]["distancia"] == 0
    result = api.post("/api/v1/lsec/evaluaciones", json=attempt(id_referencia="ref-hola")).json()
    assert result["estado"] == "sin_calibracion"
    assert result["ejecucion"] is None


def test_calibrated_score_matches_execution_schema_and_localizes_deviation(client):
    api, path = client
    pack(path, record("ref-hola"))
    published = api.get("/api/v1/lsec/referencias").json()
    assert published[0]["id"] == "ref-hola"
    track = frames()
    track[0]["rostro"] = None
    result = api.post("/api/v1/lsec/evaluaciones", json=attempt(track, id_referencia="ref-hola")).json()
    assert result["estado"] == "evaluado"
    execution = result["ejecucion"]
    assert execution["resultado"]["puntaje_global"] == 100
    assert execution["resultado"]["veredicto_aprobado"]
    assert execution["resultado"]["estrellas"] == 3
    assert result["parametros"][PARAMETERS[-1]]["estado"] == "no_aplica"
    execution_schema = Path(lsec_catalog.REFERENCE_SCHEMA).with_name("ejecucion.schema.json")
    Draft202012Validator(json.loads(execution_schema.read_text(encoding="utf-8")),
                         format_checker=FormatChecker()).validate(execution)
    wrong = api.post("/api/v1/lsec/evaluaciones", json=attempt(frames(0.2), id_referencia="ref-hola")).json()
    grade = wrong["ejecucion"]["resultado"]
    assert not grade["veredicto_aprobado"]
    assert grade["parametros_evaluados"][PARAMETERS[2]]["zonas_resaltar"] == ["mano_derecha"]


def test_missing_required_face_and_sparse_tracking_are_not_failed_verdicts(client):
    api, path = client
    pack(path, record("ref-hola", required_face=True))
    result = api.post("/api/v1/lsec/evaluaciones", json=attempt(frames(face=False), id_referencia="ref-hola")).json()
    assert result["estado"] == "datos_insuficientes"
    assert result["parametros"][PARAMETERS[-1]]["zonas_resaltar"] == ["rostro"]
    assert result["ejecucion"] is None
    track = frames()
    for index, frame in enumerate(track):
        frame["timestamp_ms"] = index * 400
    recognition = api.post("/api/v1/lsec/reconocimientos", json=attempt(track)).json()
    assert recognition["estado"] == "datos_insuficientes"


def test_validation_rejects_video_and_time_errors_without_echoing_capture(client):
    api, _ = client
    route = "/api/v1/lsec/reconocimientos"
    assert api.post(route, content=b"video", headers={"content-type": "video/mp4"}).status_code == 415
    response = api.post(route, json=attempt(video="dummy-webcam-data"))
    assert response.status_code == 422
    assert "dummy-webcam-data" not in response.text
    assert api.post(route, json=attempt(segmentacion={"frame_inicio_sena": 0, "frame_fin_sena": 8})).status_code == 422
    track = frames()
    track[2]["timestamp_ms"] = 0
    assert api.post(route, json=attempt(track)).status_code == 422


def test_invalid_published_package_reports_unavailability(client):
    api, path = client
    invalid = record("ref-hola")
    invalid["referencia"]["metadatos_grabacion"]["fecha_anotacion"] = "2026-11-20"
    pack(path, invalid)
    response = api.get("/api/v1/lsec/catalogo")
    assert response.status_code == 503
    assert response.json() == {"detail": {"codigo": "catalogo_no_disponible"}}


def test_templates_preserve_annotation_frames_and_segment_input(client, monkeypatch, tmp_path):
    api, _ = client
    package = tmp_path / "borrador.json"
    draft = record("ref-hola")
    for frame in draft["referencia"]["frames"]:
        frame["image_aspect"] = 640 / 480
    pack(package, draft)
    monkeypatch.setenv("VISENA_LSEC_DRAFTS", str(package))
    template = api.get("/api/v1/lsec/plantillas/ref-hola").json()
    assert template["estado"] == "experimental" and template["calibracion"] is None
    assert template["captura"]["frames"] == draft["referencia"]["frames"]
    assert api.get("/api/v1/lsec/plantillas/ref-desconocida").status_code == 404
    take = attempt(template["captura"]["frames"])
    segment = api.post("/api/v1/lsec/segmentaciones", json=take).json()
    assert segment == {"estado": "detectado", "mano_observada": "derecha",
                       "segmentacion": {"frame_inicio_sena": 0, "frame_fin_sena": 7}}
    rank = api.post("/api/v1/lsec/reconocimientos?segmentar=true", json=take).json()
    assert rank["candidatas"][0]["id_referencia"] == "ref-hola"
    for frame in take["frames"]:
        frame.pop("mano_derecha")
    assert api.post("/api/v1/lsec/segmentaciones", json=take).json()["estado"] == "datos_insuficientes"


def test_typescript_engine_matches_http_verdict_and_distances(client):
    api, path = client
    ref = record("ref-hola", required_face=True)
    ref["permite_alternancia_manual"] = True
    pack(path, ref)
    template = api.get("/api/v1/lsec/plantillas/ref-hola").json()
    takes = [attempt(frames(offset), id_referencia="ref-hola") for offset in (0, 0.035, 0.2)]
    for frame in takes[1]["frames"]:
        frame["blendshapes_rostro"]["jawOpen"] += 0.1
        frame["mano_derecha"][5]["z"] += 0.015
        frame["mano_derecha"][0]["y"] += frame["frame_idx"] * 0.007
    takes.append(attempt(frames(face=False), id_referencia="ref-hola"))
    left = frames()
    for frame in left:
        frame["mano_izquierda"] = [dict(p, x=1 - p["x"]) for p in frame.pop("mano_derecha")]
    takes.append(attempt(left, id_referencia="ref-hola", mano_practica="izquierda"))
    engine = (lsec_catalog.ROOT / "frontend-contract/motor-lsec.ts").as_uri()
    script = (
        "import {readFileSync} from 'node:fs';"
        "const {evaluarLocal}=await import(process.argv[1]);"
        "const [ref,takes]=JSON.parse(readFileSync(0,'utf8'));"
        "console.log(JSON.stringify(takes.map(t=>evaluarLocal(ref,t))));"
    )
    command = subprocess.run(["node", "--input-type=module", "-e", script, engine],
                             input=json.dumps([template, takes]), capture_output=True, text=True, check=True)
    for take, local in zip(takes, json.loads(command.stdout), strict=True):
        server = api.post("/api/v1/lsec/evaluaciones", json=take).json()
        assert local["estado"] == server["estado"]
        for key, metric in server["parametros"].items():
            actual = local["parametros"][key]
            assert actual["estado"] == metric["estado"] and actual["zonas_resaltar"] == metric["zonas_resaltar"]
            assert actual["desviacion"] == pytest.approx(metric["desviacion"], abs=2e-6)
        if server["ejecucion"]:
            for key in ("puntaje_global", "estrellas", "veredicto_aprobado"):
                assert local["ejecucion"]["resultado"][key] == server["ejecucion"]["resultado"][key]
            if take.get("mano_practica") == "izquierda":
                assert local["ejecucion"]["resultado"]["puntaje_global"] == 100
        else:
            assert local["ejecucion"] is None
