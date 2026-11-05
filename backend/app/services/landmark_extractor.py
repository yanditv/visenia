
from pathlib import Path

import mediapipe as mp


MODEL_PATH = (
    Path(__file__).resolve().parents[2]
    / "models"
    / "holistic_landmarker.task"
)


def create_landmarker():
    if not MODEL_PATH.is_file():
        raise FileNotFoundError(
            f"No se encuentra el modelo: {MODEL_PATH}"
        )

    options = mp.tasks.vision.HolisticLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(
            model_asset_path=str(MODEL_PATH)
        ),
        running_mode=mp.tasks.vision.RunningMode.VIDEO,
        min_face_detection_confidence=0.5,
        min_pose_detection_confidence=0.5,
        min_hand_landmarks_confidence=0.5
    )

    return mp.tasks.vision.HolisticLandmarker.create_from_options(
        options
    )


def get_wrist_coordinates(landmarks):
    if not landmarks:
        return None

    wrist = landmarks[0]

    return {
        "x": round(wrist.x, 4),
        "y": round(wrist.y, 4),
        "z": round(wrist.z, 4)
    }
