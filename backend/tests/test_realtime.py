import struct
import threading

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import app
from app.services.evaluation_sequence import REGIONS, from_frames
from app.services.openhands_adapter import adapt_sequence
from app.services.realtime_evaluation import evaluate_sequences
from app.streaming.config import RealtimeSettings
from app.streaming.frame_decoder import HEADER, parse_frame, decode_jpeg, FrameError
from app.streaming.session import StreamingSession


REFERENCE = "df30009dba754c2e876b505bc63aad4b"
ASL_START = {"type": "session.start", "protocol_version": "2.0", "target_gloss": "drink",
             "capture": {"width": 640, "height": 480, "fps": 30,
                         "frame_encoding": "jpeg"}}
START = {"type": "session.start", "protocol_version": "1.0", "reference_id": REFERENCE,
         "demo_mode": False, "capture": {"width": 640, "height": 480, "fps": 30,
                                         "frame_encoding": "jpeg"}}
JPEG = b"\xff\xd8" + b"fake" + b"\xff\xd9"


class FakeProcessor:
    instances = []
    closed_event = threading.Event()

    def __init__(self, settings):
        self.closed = False
        self.__class__.instances.append(self)

    def process(self, jpeg, timestamp):
        if jpeg == b"\xff\xd8bad\xff\xd9":
            from app.streaming.frame_decoder import FrameError
            raise FrameError("JPEG inválido")
        regions = {name: np.full((count, 3), np.nan, dtype=np.float32)
                   for name, count in REGIONS.items()}
        return 640, 480, regions

    def close(self):
        self.closed = True
        self.__class__.closed_event.set()


@pytest.fixture(autouse=True)
def configure(monkeypatch):
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    FakeProcessor.instances.clear()
    FakeProcessor.closed_event.clear()
    app.state.realtime_processor_factory = FakeProcessor
    app.state.realtime_settings = RealtimeSettings(
        max_frame_queue=2, evaluation_interval_ms=100, heartbeat_seconds=0.5)
    yield
    if hasattr(app.state, "realtime_processor_factory"):
        del app.state.realtime_processor_factory
    del app.state.realtime_settings


def control(ws, kind):
    ws.send_json({"type": kind, "protocol_version": "1.0"})


def packet(ts, seq, jpeg=JPEG):
    return HEADER.pack(ts, seq) + jpeg


def until(ws, kind):
    for _ in range(6):
        result = ws.receive_json()
        if result["type"] == kind:
            return result
    raise AssertionError(f"No {kind} message")


def test_full_lifecycle_and_cleanup():
    with TestClient(app).websocket_connect("/ws/v1/visena/evaluate") as ws:
        ws.send_json(START)
        ready = until(ws, "session.ready")
        assert ready["reference_id"] == REFERENCE
        control(ws, "evaluation.begin")
        until(ws, "evaluation.started")
        ws.send_bytes(packet(100, 1))
        partial = until(ws, "evaluation.partial")
        assert partial["parameters"]["handshape"]["status"] == "insufficient_data"
        assert partial["overall"]["demo_score"] is None
        control(ws, "evaluation.end")
        final = until(ws, "evaluation.final")
        assert final["status"] == "complete"
        control(ws, "evaluation.reset")
        until(ws, "evaluation.reset")
        control(ws, "session.stop")
        until(ws, "session.stopped")
    assert FakeProcessor.closed_event.wait(2)
    assert FakeProcessor.instances[-1].closed


@pytest.mark.parametrize("bad_start,code", [
    ({**START, "protocol_version": "2.0"}, "INVALID_MESSAGE"),
    ({**START, "reference_id": "00000000-0000-0000-0000-000000000001"}, "REFERENCE_NOT_FOUND"),
    ({**START, "capture": {**START["capture"], "fps": 120}}, "INVALID_MESSAGE"),
])
def test_invalid_start(bad_start, code):
    with TestClient(app).websocket_connect("/ws/v1/visena/evaluate") as ws:
        ws.send_json(bad_start)
        assert until(ws, "error")["code"] == code


def test_invalid_frame_timestamp_and_control():
    with TestClient(app).websocket_connect("/ws/v1/visena/evaluate") as ws:
        ws.send_json(START)
        until(ws, "session.ready")
        ws.send_bytes(packet(100, 1))
        assert until(ws, "error")["code"] == "EVALUATION_NOT_STARTED"
        control(ws, "evaluation.begin")
        until(ws, "evaluation.started")
        ws.send_bytes(b"short")
        assert until(ws, "error")["code"] == "INVALID_FRAME"
        ws.send_bytes(packet(100, 1))
        until(ws, "evaluation.partial")
        ws.send_bytes(packet(100, 2))
        assert until(ws, "error")["code"] == "INVALID_TIMESTAMP"
        ws.send_bytes(packet(200, 3, b"\xff\xd8bad\xff\xd9"))
        assert until(ws, "error")["code"] == "INVALID_FRAME"


def test_disconnect_releases_processor():
    with TestClient(app) as client:
        with client.websocket_connect("/ws/v1/visena/evaluate") as ws:
            ws.send_json(START)
            until(ws, "session.ready")
        assert FakeProcessor.closed_event.wait(5)
    assert FakeProcessor.instances[-1].closed


def test_backpressure_is_bounded():
    session = StreamingSession(REFERENCE, RealtimeSettings(max_frame_queue=2))
    for i in range(10):
        session.enqueue((0, i, i, JPEG))
    assert session.frame_queue.qsize() == 2
    assert session.frames_dropped == 8
    session.executor.shutdown()


def test_reset_starts_frame_metrics_for_new_attempt():
    session = StreamingSession(REFERENCE, RealtimeSettings(max_frame_queue=2))
    session.frames_received = 9
    session.frames_processed = 7
    session.frames_dropped = 2
    session.enqueue((0, 1, 1, JPEG))
    session.clear_execution()
    assert (session.frames_received, session.frames_processed, session.frames_dropped) == (0, 0, 0)
    assert session.frame_queue.empty()
    session.executor.shutdown()


def test_sessions_are_isolated():
    settings = RealtimeSettings()
    one, two = StreamingSession(REFERENCE, settings), StreamingSession(REFERENCE, settings)
    one.landmark_buffer.append((0, {}))
    assert len(two.landmark_buffer) == 0
    assert one.session_id != two.session_id
    one.executor.shutdown()
    two.executor.shutdown()


def test_memory_evaluation_insufficient_and_short():
    frames = [(i * 100, {name: np.full((count, 3), np.nan, dtype=np.float32)
                        for name, count in REGIONS.items()}) for i in range(3)]
    sequence = from_frames(frames, 640, 480)
    parameters, overall = evaluate_sequences(sequence, sequence, True)
    assert all(item["status"] == "insufficient_data" for item in parameters.values())
    assert overall["demo_score"] is None


def test_valid_in_memory_evaluation_and_incomplete_mask():
    rng = np.random.default_rng(5)
    frame = {name: rng.uniform(0.2, 0.8, (count, 3)).astype(np.float32)
             for name, count in REGIONS.items()}
    frame["pose"][11, :2] = [0.3, 0.3]
    frame["pose"][12, :2] = [0.7, 0.3]
    frames = [(i * 100, {name: value.copy() for name, value in frame.items()}) for i in range(10)]
    reference = from_frames(frames, 640, 480)
    parameters, overall = evaluate_sequences(reference, reference, True)
    assert all(item["status"] == "ok" for item in parameters.values())
    assert overall == {"status": "ok", "demo_score": 100.0}
    _, unscored = evaluate_sequences(reference, reference, False)
    assert unscored == {"status": "ok", "demo_score": None}
    frames[4][1]["left_hand"][:] = np.nan
    candidate = from_frames(frames, 640, 480)
    parameters, overall = evaluate_sequences(reference, candidate, True)
    assert parameters["handshape"]["hands"]["left_hand"]["candidate_quality"]["coverage_pct"] == 90.0
    assert overall["demo_score"] is not None


def test_two_websocket_sessions_have_distinct_results():
    with TestClient(app) as client:
        with client.websocket_connect("/ws/v1/visena/evaluate") as left:
            with client.websocket_connect("/ws/v1/visena/evaluate") as right:
                left.send_json(START)
                right.send_json(START)
                left_id = until(left, "session.ready")["session_id"]
                right_id = until(right, "session.ready")["session_id"]
                assert left_id != right_id
                control(left, "evaluation.begin")
                until(left, "evaluation.started")
                left.send_bytes(packet(100, 1))
                result = until(left, "evaluation.partial")
                assert result["quality"]["frames_processed"] == 1
                control(right, "evaluation.begin")
                until(right, "evaluation.started")
                control(right, "evaluation.end")
                result = until(right, "evaluation.final")
                assert result["quality"]["frames_processed"] == 0
                assert result["session_id"] == right_id


def test_real_mediapipe_websocket_cpu():
    del app.state.realtime_processor_factory
    success, encoded = cv2.imencode(".jpg", np.zeros((240, 320, 3), dtype=np.uint8))
    assert success
    with TestClient(app).websocket_connect("/ws/v1/visena/evaluate") as ws:
        ws.send_json(START)
        until(ws, "session.ready")
        control(ws, "evaluation.begin")
        until(ws, "evaluation.started")
        ws.send_bytes(packet(100, 1, encoded.tobytes()))
        result = until(ws, "evaluation.partial")
        assert result["quality"]["frames_processed"] == 1
        assert result["overall"]["demo_score"] is None
        control(ws, "evaluation.end")
        assert until(ws, "evaluation.final")["status"] == "complete"


def asl_control(ws, kind):
    ws.send_json({"type": kind, "protocol_version": "2.0"})


def test_asl_websocket_insufficient_data():
    with TestClient(app).websocket_connect("/ws/v2/visena/recognize") as ws:
        ws.send_json(ASL_START)
        ready = until(ws, "session.ready")
        assert ready["target_gloss"] == "drink"
        assert ready["server_build"] == "asl-camera-20261108-11"
        asl_control(ws, "evaluation.begin")
        until(ws, "evaluation.started")
        ws.send_bytes(packet(100, 1))
        partial = until(ws, "evaluation.partial")
        assert partial["execution_score"] is None
        asl_control(ws, "evaluation.end")
        final = until(ws, "evaluation.final")
        assert final["recognition"]["status"] == "insufficient_data"
        assert final["execution_score"] is None
        assert final["execution_score_status"] == "awaiting_validation"
        assert final["quality"]["window_frames"] == 1
        assert "right_hand_longest_missing_gap_seconds" in final["quality"]
        assert any("cuatro fotogramas" in item for item in final["feedback"])


def test_asl_websocket_rejects_unknown_gloss():
    with TestClient(app).websocket_connect("/ws/v2/visena/recognize") as ws:
        ws.send_json({**ASL_START, "target_gloss": "DEMO_NO_VALIDADA"})
        assert until(ws, "error")["code"] == "TARGET_NOT_SUPPORTED"


def test_asl_websocket_reports_opposite_practice_hand_even_when_model_matches():
    class LeftHandProcessor(FakeProcessor):
        def process(self, jpeg, timestamp):
            index = timestamp // 100 - 1
            regions = {name: np.full((count, 3), np.nan, dtype=np.float32)
                       for name, count in REGIONS.items()}
            pose = np.full((33, 3), 0.5, dtype=np.float32)
            pose[11, :2], pose[12, :2] = [0.3, 0.4], [0.7, 0.4]
            face = np.full((478, 3), 0.5, dtype=np.float32)
            face[13, :2] = [0.5, 0.4]
            hand = np.full((21, 3), 0.5, dtype=np.float32)
            hand[0, :2] = [0.5, 0.85 - 0.25 * index / 11]
            regions.update(pose=pose, face=face, left_hand=hand)
            return 640, 480, regions

    app.state.realtime_processor_factory = LeftHandProcessor
    app.state.asl_inference = lambda candidate, target, hand: {
        "target_probability": 0.99,
        "predictions": [{"class_id": 568, "gloss": target, "score": 0.99}],
    }
    async def fake_groq(evidence, settings):
        assert evidence["practice_hand_status"] == "opposite_hand"
        return {"status": "ok", "source": "groq", "model": "test-model",
                "summary": "Se observó la mano opuesta en este ejercicio.",
                "recommendations": ["Puedes repetir el ejercicio."], "http_status": 200}
    app.state.groq_feedback = fake_groq
    try:
        with TestClient(app).websocket_connect("/ws/v2/visena/recognize") as ws:
            ws.send_json({**ASL_START, "practice_hand": "right"})
            until(ws, "session.ready")
            asl_control(ws, "evaluation.begin")
            until(ws, "evaluation.started")
            for index in range(1, 13):
                ws.send_bytes(packet(index * 100, index))
                until(ws, "evaluation.partial")
            asl_control(ws, "evaluation.end")
            final = until(ws, "evaluation.final")
            assert final["recognition"]["top_k"][0]["gloss"] == "drink"
            assert final["observations"]["hands_to_mouth"] == {
                "left": True, "right": False}
            assert final["observations"]["practice_hand_status"] == "opposite_hand"
            assert final["feedback_source"] == "groq"
            assert final["services"]["groq"] == "used"
            assert any("mano derecha" in item for item in final["feedback"])
            assert not any("modelo no confirmó" in item for item in final["feedback"])
    finally:
        del app.state.asl_inference
        del app.state.groq_feedback


@pytest.mark.parametrize("side,outward,expected", [
    ("left", True, "opposite_hand"),
    ("right", False, "matching_hand"),
])
def test_hello_websocket_reports_measured_hand_and_direction(side, outward, expected):
    class HelloProcessor(FakeProcessor):
        def process(self, jpeg, timestamp):
            index = timestamp // 100 - 1
            pose = np.full((33, 3), 0.5, dtype=np.float32)
            pose[11, :2], pose[12, :2] = [0.4, 0.5], [0.6, 0.5]
            for name, wrist_index, base_x in (("right", 16, 0.34), ("left", 15, 0.66)):
                if name == side:
                    pose[wrist_index, 1] = np.interp(index, [0, 8, 22, 31],
                                                      [0.68, 0.46, 0.46, 0.68])
                    direction = -1 if name == "right" else 1
                    excursion = (0.11 if outward else -0.06) * np.interp(
                        index, [0, 8, 18, 31], [0, 0, 1, 0])
                    pose[wrist_index, 0] = base_x + direction * excursion
                else:
                    pose[wrist_index, :2] = [base_x, 0.62]
            regions = {name: np.full((count, 3), 0.5, dtype=np.float32)
                       for name, count in REGIONS.items()}
            regions["pose"] = pose
            return 640, 480, regions

    app.state.realtime_processor_factory = HelloProcessor
    app.state.asl_inference = lambda candidate, target, hand: {
        "target_probability": 0.0001,
        "predictions": [{"class_id": 42, "gloss": "other", "score": 0.8}],
    }
    async def fake_groq(evidence, settings):
        assert evidence["observation_type"] == "raised_hand_near_head"
        assert evidence["practice_hand_status"] == expected
        return {"status": "ok", "source": "groq", "model": "test-model",
                "summary": "Resultado incierto.",
                "recommendations": ["Puedes repetir el ejercicio."], "http_status": 200}
    app.state.groq_feedback = fake_groq
    try:
        with TestClient(app).websocket_connect("/ws/v2/visena/recognize") as ws:
            ws.send_json({**ASL_START, "target_gloss": "hello", "practice_hand": "right"})
            until(ws, "session.ready")
            asl_control(ws, "evaluation.begin")
            until(ws, "evaluation.started")
            for index in range(1, 33):
                ws.send_bytes(packet(index * 100, index))
                until(ws, "evaluation.partial")
            asl_control(ws, "evaluation.end")
            final = until(ws, "evaluation.final")
            assert final["observations"]["practice_hand_status"] == expected
            assert final["services"]["groq"] == "used"
            if side == "right":
                assert final["observations"]["outward_movement"] is False
                assert any("dirección" in item for item in final["feedback"])
            else:
                assert any("cabeza" in item for item in final["feedback"])
                assert not any("boca" in item for item in final["feedback"])
    finally:
        del app.state.asl_inference
        del app.state.groq_feedback


def test_asl_websocket_rejects_untrusted_browser_origin():
    with TestClient(app) as client:
        with pytest.raises(WebSocketDisconnect) as caught:
            with client.websocket_connect(
                "/ws/v2/visena/recognize",
                headers={"origin": "https://untrusted.example"}):
                pass
        assert caught.value.code == 1008


def test_asl_websocket_frame_controls_and_timestamps():
    with TestClient(app) as client:
        with client.websocket_connect("/ws/v2/visena/recognize") as ws:
            ws.send_json(ASL_START)
            until(ws, "session.ready")
            ws.send_bytes(packet(100, 1))
            assert until(ws, "error")["code"] == "EVALUATION_NOT_STARTED"
            asl_control(ws, "evaluation.begin")
            until(ws, "evaluation.started")
            ws.send_bytes(b"bad")
            assert until(ws, "error")["code"] == "INVALID_FRAME"
            ws.send_bytes(packet(100, 1))
            until(ws, "evaluation.partial")
            ws.send_bytes(packet(100, 2))
            assert until(ws, "error")["code"] == "INVALID_TIMESTAMP"
            asl_control(ws, "evaluation.reset")
            until(ws, "evaluation.reset")
            asl_control(ws, "session.stop")
            until(ws, "session.stopped")
        assert FakeProcessor.closed_event.wait(5)


def test_asl_real_mediapipe_cpu_insufficient():
    del app.state.realtime_processor_factory
    success, encoded = cv2.imencode(".jpg", np.zeros((240, 320, 3), dtype=np.uint8))
    assert success
    with TestClient(app).websocket_connect("/ws/v2/visena/recognize") as ws:
        ws.send_json(ASL_START)
        until(ws, "session.ready")
        asl_control(ws, "evaluation.begin")
        until(ws, "evaluation.started")
        ws.send_bytes(packet(100, 1, encoded.tobytes()))
        until(ws, "evaluation.partial")
        asl_control(ws, "evaluation.end")
        final = until(ws, "evaluation.final")
        assert final["recognition"]["status"] == "insufficient_data"
        assert final["execution_score"] is None


def test_asl_websocket_model_result_without_lsec_score():
    rng = np.random.default_rng(7)
    frame = {name: rng.uniform(0.2, 0.8, (count, 3)).astype(np.float32)
             for name, count in REGIONS.items()}
    frame["pose"][11, :2] = [0.3, 0.3]
    frame["pose"][12, :2] = [0.7, 0.3]

    class ValidProcessor(FakeProcessor):
        def process(self, jpeg, timestamp):
            return 640, 480, {name: values.copy() for name, values in frame.items()}

    app.state.realtime_processor_factory = ValidProcessor
    app.state.asl_inference = lambda candidate, target, hand: {
        "target_probability": 0.8,
        "predictions": [{"class_id": 42, "gloss": target, "score": 0.8}],
        "input_window": {"frames": 5, "start_ms": 0, "end_ms": 400, "trimmed": False},
    }
    async def fake_groq(evidence, settings):
        assert evidence["target_gloss"] == "drink"
        return {"status": "ok", "source": "groq", "model": "test-model",
                "summary": "Captura observada.",
                "recommendations": ["Puedes practicar otra vez."]}
    app.state.groq_feedback = fake_groq
    try:
        with TestClient(app).websocket_connect("/ws/v2/visena/recognize") as ws:
            ws.send_json(ASL_START)
            until(ws, "session.ready")
            asl_control(ws, "evaluation.begin")
            until(ws, "evaluation.started")
            for index in range(1, 6):
                ws.send_bytes(packet(index * 100, index))
                until(ws, "evaluation.partial")
            asl_control(ws, "evaluation.end")
            final = until(ws, "evaluation.final")
            assert final["recognition"]["status"] == "experimental"
            assert final["recognition"]["target_probability"] == 0.8
            assert isinstance(final["observations"]["hand_to_mouth"], bool)
            assert final["recognition"]["input_window"]["frames"] == 5
            assert final["execution_score"] is None
            assert final["feedback_source"] == "groq"
            assert final["feedback_recommendations"] == ["Puedes practicar otra vez."]
            assert "Puedes practicar otra vez." in final["feedback"]
    finally:
        del app.state.asl_inference
        del app.state.groq_feedback


def test_asl_mismatch_uses_groq_without_grading_the_sign():
    frame = {name: np.full((count, 3), 0.5, dtype=np.float32)
             for name, count in REGIONS.items()}
    frame["pose"][11, :2] = [0.3, 0.3]
    frame["pose"][12, :2] = [0.7, 0.3]

    class ValidProcessor(FakeProcessor):
        def process(self, jpeg, timestamp):
            return 640, 480, {name: values.copy() for name, values in frame.items()}

    async def fake_groq(evidence, settings):
        assert evidence["predicted_gloss"] == "match"
        assert evidence["target_gloss"] == "drink"
        return {"status": "ok", "source": "groq", "model": "test-model",
                "summary": "El resultado de esta toma es incierto.",
                "recommendations": ["Puedes repetir la práctica."], "http_status": 200}

    app.state.realtime_processor_factory = ValidProcessor
    app.state.asl_inference = lambda candidate, target, hand: {
        "target_probability": 0.0001,
        "predictions": [{"class_id": 1, "gloss": "match", "score": 0.49}],
    }
    app.state.groq_feedback = fake_groq
    try:
        with TestClient(app).websocket_connect("/ws/v2/visena/recognize") as ws:
            ws.send_json(ASL_START)
            until(ws, "session.ready")
            asl_control(ws, "evaluation.begin")
            until(ws, "evaluation.started")
            for index in range(1, 6):
                ws.send_bytes(packet(index * 100, index))
                until(ws, "evaluation.partial")
            asl_control(ws, "evaluation.end")
            final = until(ws, "evaluation.final")
            assert final["recognition"]["top_k"][0]["gloss"] == "match"
            assert final["feedback_source"] == "groq"
            assert final["feedback_status"] == "ok"
            assert final["services"] == {"mediapipe": "used", "asl_model": "used", "groq": "used"}
            assert final["feedback_model"] == "test-model"
            assert any("no permite concluir" in text for text in final["feedback"])
    finally:
        del app.state.asl_inference
        del app.state.groq_feedback


def test_in_memory_openhands_adapter_matches_existing_export():
    uid = REFERENCE
    with np.load(f"data/processed/{uid}.npz") as raw:
        frames = [(int(raw["timestamps_ms"][i]),
                   {name: raw[name][i].copy() for name in REGIONS})
                  for i in range(len(raw["timestamps_ms"]))]
        sequence = from_frames(frames, int(raw["frame_width"]), int(raw["frame_height"]))
    actual_frames, actual_mask = adapt_sequence(sequence)
    with np.load(f"data/openhands/{uid}.npz") as existing:
        np.testing.assert_allclose(actual_frames, existing["frames"], rtol=1e-5, atol=1e-5)
        np.testing.assert_array_equal(actual_mask, existing["mask"])


def test_frame_header():
    assert parse_frame(packet(42, 7), 100)[:2] == (42, 7)
    with pytest.raises(FrameError):
        parse_frame(struct.pack("<QI", 1, 1) + b"not jpeg", 100)


def test_health_without_inference():
    with TestClient(app) as client:
        assert client.get("/health").json()["status"] == "ok"
    assert FakeProcessor.instances == []


def test_jpeg_resolution_guard():
    success, encoded = cv2.imencode(".jpg", np.zeros((20, 30, 3), dtype=np.uint8))
    assert success
    assert decode_jpeg(encoded.tobytes(), 30, 20).shape == (20, 30, 3)
    with pytest.raises(FrameError):
        decode_jpeg(encoded.tobytes(), 29, 20)
