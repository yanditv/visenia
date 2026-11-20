from types import SimpleNamespace
from pathlib import Path
import re

import numpy as np

import app.services.asl_recognition as asl_recognition
from app.services.asl_recognition import (assess_capture, select_sign_window,
                                          select_drink_window, observe_hand_to_mouth,
                                          drink_hand_observation, hello_hand_observation)
from app.services.evaluation_sequence import from_frames
from app.services.openhands_adapter import adapt_sequence


def test_capture_rejects_gap_inside_hand_trajectory():
    candidate = SimpleNamespace(
        timestamps_ms=np.arange(20) * 100,
        pose_mask=np.ones(20, dtype=bool),
        left_hand_mask=np.zeros(20, dtype=bool),
        right_hand_mask=np.array([True] * 7 + [False] * 5 + [True] * 8),
    )
    sufficient, feedback = assess_capture(candidate)
    assert not sufficient
    assert any("trayectoria continua" in item for item in feedback)


def test_capture_accepts_hand_visible_only_during_sign():
    # An isolated DRINK demonstration has a visible hand only in the middle.
    candidate = SimpleNamespace(
        timestamps_ms=np.arange(27) * 67,
        pose_mask=np.ones(27, dtype=bool),
        left_hand_mask=np.zeros(27, dtype=bool),
        right_hand_mask=np.array([False] * 9 + [True] * 10 + [False] * 8),
    )
    assert assess_capture(candidate) == (True, [])


def test_sign_window_trims_camera_idle_without_target_label(monkeypatch):
    frames = []
    for index in range(90):
        pose = np.full((33, 3), 0.5, dtype=np.float32)
        pose[11, :2] = [0.3, 0.4]
        pose[12, :2] = [0.7, 0.4]
        pose[15:17, :2] = [0.4, 0.6]
        if 20 <= index <= 55:
            pose[16, 0] += 0.14 * np.sin(2 * np.pi * (index - 20) / 12)
        frames.append((index * 33, {
            "pose": pose,
            "left_hand": np.full((21, 3), 0.5, dtype=np.float32),
            "right_hand": np.full((21, 3), 0.5, dtype=np.float32),
            "face": np.full((478, 3), 0.5, dtype=np.float32),
        }))
    candidate = from_frames(frames, 640, 480)
    selected = select_sign_window(candidate)
    assert 20 < len(selected.timestamps_ms) < 80
    assert selected.timestamps_ms[0] > 0
    assert selected.timestamps_ms[-1] < candidate.timestamps_ms[-1]
    def fake_inference(model_frames, mask, target):
        assert model_frames.shape[1] == 120
        assert mask.shape[0] == 120
        assert target == "drink"
        return {"status": "success", "predictions": [], "target_probability": 0.1}
    monkeypatch.setattr(asl_recognition, "run_inference_sequence", fake_inference)
    result = asl_recognition.infer_asl(candidate, "drink")
    assert result["input_window"]["trimmed"] is True
    assert result["input_window"]["frames"] == len(selected.timestamps_ms)


def test_observes_hand_approach_without_grading_the_sign():
    def sequence(moves):
        frames = []
        for index in range(20):
            pose = np.full((33, 3), 0.5, dtype=np.float32)
            pose[11, :2], pose[12, :2] = [0.3, 0.4], [0.7, 0.4]
            face = np.full((478, 3), 0.5, dtype=np.float32)
            face[13, :2] = [0.5, 0.4]
            hand = np.full((21, 3), 0.5, dtype=np.float32)
            hand[0, :2] = [0.5, 0.85 - 0.25 * index / 19 if moves else 0.85]
            frames.append((index * 67, {
                "pose": pose, "face": face, "left_hand": hand,
                "right_hand": np.full((21, 3), np.nan, dtype=np.float32),
            }))
        return from_frames(frames, 640, 480)

    assert observe_hand_to_mouth(sequence(True)) is True
    assert observe_hand_to_mouth(sequence(False)) is False
    assert drink_hand_observation(sequence(True), "right")["practice_hand_status"] == "opposite_hand"
    assert drink_hand_observation(sequence(True), "left")["practice_hand_status"] == "matching_hand"
    assert drink_hand_observation(sequence(False), "right")["practice_hand_status"] == "not_observed"


def test_drink_focus_uses_observed_hand_and_mouth_interval(monkeypatch):
    frames = []
    for index in range(60):
        pose = np.full((33, 3), 0.5, dtype=np.float32)
        pose[11, :2], pose[12, :2] = [0.3, 0.4], [0.7, 0.4]
        face = np.full((478, 3), 0.5, dtype=np.float32)
        face[13, :2] = [0.5, 0.4]
        right = np.full((21, 3), 0.5, dtype=np.float32)
        wrist_y = np.interp(index, [0, 12, 22, 30, 37, 42, 50, 59],
                            [0.85, 0.85, 0.57, 0.70, 0.56, 0.61, 0.85, 0.85])
        right[0, :2] = [0.5, wrist_y]
        frames.append((index * 100, {
            "pose": pose, "face": face, "right_hand": right,
            "left_hand": np.full((21, 3), 0.5, dtype=np.float32),
        }))
    candidate = from_frames(frames, 640, 480)
    selected = select_drink_window(candidate, "right")
    assert 25 < len(selected.timestamps_ms) < 50
    assert selected.timestamps_ms[0] > 0
    assert selected.timestamps_ms[-1] < candidate.timestamps_ms[-1]
    assert selected.timestamps_ms[0] < 2200
    assert selected.timestamps_ms[-1] > 4200
    adapted, mask = adapt_sequence(selected, target_frames=120, active_hand="right")
    assert adapted.shape == (2, 120, 27)
    assert not mask[:, 7:17].any()  # Left-hand points are suppressed.
    assert mask[:, 17:].all()

    def fake_inference(model_frames, model_mask, target):
        np.testing.assert_array_equal(model_mask, mask)
        assert target == "drink"
        return {"status": "success", "predictions": [{"gloss": "drink"}],
                "target_probability": 0.5}
    monkeypatch.setattr(asl_recognition, "run_inference_sequence", fake_inference)
    result = asl_recognition.infer_asl(candidate, "drink", "right")
    assert result["input_window"]["focus_hand"] == "right"
    assert result["input_window"]["trimmed"] is True


def test_practice_signs_exist_in_the_installed_asl_model():
    page = (Path(__file__).resolve().parents[1] / "manual-test/camera.html").read_text(encoding="utf-8")
    glosses = set(re.findall(r'<option value="([^"]+)">', page))
    assert glosses == {"drink", "hello", "water", "eat", "please", "thank you", "sorry"}
    assert glosses <= asl_recognition.asl_glosses()


def test_hello_observes_hand_and_outward_direction_without_grading_the_sign():
    def sequence(side, outward):
        frames = []
        for index in range(32):
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
            frames.append((index * 100, {
                "pose": pose,
                "face": np.full((478, 3), 0.5, dtype=np.float32),
                "left_hand": np.full((21, 3), 0.5, dtype=np.float32),
                "right_hand": np.full((21, 3), 0.5, dtype=np.float32),
            }))
        return from_frames(frames, 640, 480)

    correct = hello_hand_observation(sequence("right", True), "right")
    assert correct["practice_hand_status"] == "matching_hand"
    assert correct["outward_movement"] is True
    opposite = hello_hand_observation(sequence("left", True), "right")
    assert opposite["practice_hand_status"] == "opposite_hand"
    wrong_direction = hello_hand_observation(sequence("right", False), "right")
    assert wrong_direction["practice_hand_status"] == "matching_hand"
    assert wrong_direction["outward_movement"] is False
