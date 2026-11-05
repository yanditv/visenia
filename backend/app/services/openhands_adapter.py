
import json
import sys
from pathlib import Path
from uuid import UUID

import numpy as np


BASE_DIR = Path(__file__).resolve().parents[2]

INPUT_DIR = BASE_DIR / "data" / "processed"
OUTPUT_DIR = BASE_DIR / "data" / "openhands"

# Indices oficiales de OpenHands:
# mediapipe_holistic_minimal_27
KEYPOINT_INDICES = [
    0, 2, 5, 11, 12, 13, 14,
    33, 37, 38, 41, 42, 45, 46,
    49, 50, 53, 54, 58, 59,
    62, 63, 66, 67, 70, 71, 74
]


def adapt_for_openhands(processing_id: str):
    uid = UUID(processing_id).hex

    source = INPUT_DIR / f"{uid}.npz"
    destination = OUTPUT_DIR / f"{uid}.npz"

    if not source.is_file():
        raise FileNotFoundError(source)

    with np.load(source) as data:
        pose = data["pose"]
        left = data["left_hand"]
        right = data["right_hand"]
        timestamps = data["timestamps_ms"]

    # Orden compatible con los 75 puntos de OpenHands.
    keypoints = np.concatenate(
        [pose, left, right],
        axis=1
    )

    if keypoints.ndim != 3 or keypoints.shape[1:] != (75, 3):
        raise ValueError(
            f"Forma invalida: {keypoints.shape}"
        )

    if keypoints.shape[0] < 2:
        raise ValueError("Secuencia demasiado corta.")

    # El checkpoint utiliza coordenadas 2D.
    xy = keypoints[:, :, :2]

    # Conservar las detecciones validas.
    original_mask = np.isfinite(xy).all(axis=2)

    # Hombros MediaPipe: indices 11 y 12.
    valid_shoulders = (
        original_mask[:, 11]
        & original_mask[:, 12]
    )

    if not valid_shoulders.any():
        raise ValueError(
            "No hay hombros validos para normalizar."
        )

    shoulder_left = xy[valid_shoulders, 11, :]
    shoulder_right = xy[valid_shoulders, 12, :]

    centers = (
        shoulder_left + shoulder_right
    ) / 2.0

    center = centers.mean(axis=0)

    distances = np.linalg.norm(
        shoulder_left - shoulder_right,
        axis=1
    )

    scale = float(distances.mean())

    if not np.isfinite(scale) or scale <= 1e-6:
        raise ValueError("Escala corporal invalida.")

    selected = xy[:, KEYPOINT_INDICES, :]
    selected_mask = original_mask[:, KEYPOINT_INDICES]

    # Reproducir el relleno original de landmarks
    # ausentes antes de normalizar.
    selected = np.nan_to_num(
        selected,
        nan=0.0,
        posinf=0.0,
        neginf=0.0
    )

    normalized = (selected - center) / scale

    # (T, V, C) -> (C, T, V)
    frames = np.transpose(
        normalized, (2, 0, 1)
    ).astype(np.float32)

    if not np.isfinite(frames).all():
        raise ValueError("Coordenadas no finitas.")

    OUTPUT_DIR.mkdir(
        parents=True,
        exist_ok=True
    )

    np.savez_compressed(
        destination,
        frames=frames,
        mask=selected_mask,
        timestamps_ms=timestamps
    )

    return {
        "processing_id": uid,
        "input_shape": list(keypoints.shape),
        "output_shape": list(frames.shape),
        "detected_landmarks_pct": round(
            float(selected_mask.mean() * 100),
            2
        ),
        "output_file": str(destination)
    }


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(
            "Uso: python -m "
            "app.services.openhands_adapter <id>"
        )

    try:
        result = adapt_for_openhands(sys.argv[1])

        print(json.dumps(
            result,
            indent=2,
            ensure_ascii=False
        ))

    except (ValueError, FileNotFoundError) as error:
        raise SystemExit(str(error))
