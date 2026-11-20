
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


def adapt_sequence(sequence, target_frames=None, active_hand=None):
    """Convert a capture to the checkpoint's input.

    The WLASL BERT checkpoint uniformly samples 120 frames *before*
    shoulder normalization. Match that order, including repeated indices for
    short clips, instead of interpolating landmarks or padding with zeros.
    """
    keypoints = np.concatenate(
        [sequence.pose, sequence.left_hand, sequence.right_hand], axis=1)
    if keypoints.ndim != 3 or keypoints.shape[1:] != (75, 3):
        raise ValueError("Forma de landmarks incompatible con OpenHands.")
    if len(keypoints) < 4:
        raise ValueError("Se requieren al menos 4 fotogramas.")
    if active_hand is not None:
        if active_hand not in ("left", "right"):
            raise ValueError("La mano activa debe ser left o right.")
        # For a one-handed practice target, suppress the other hand before
        # normalization. Missing points follow the checkpoint's zero fill.
        opposite = slice(54, 75) if active_hand == "left" else slice(33, 54)
        keypoints = keypoints.copy()
        keypoints[:, opposite, :] = np.nan
    if target_frames is not None:
        if target_frames < 4:
            raise ValueError("Cantidad de fotogramas objetivo inválida.")
        indices = np.linspace(0, len(keypoints) - 1, target_frames).astype(np.int64)
        keypoints = keypoints[indices]
    xy = keypoints[:, :, :2]
    original_mask = np.isfinite(xy).all(axis=2)
    valid_shoulders = original_mask[:, 11] & original_mask[:, 12]
    if not valid_shoulders.any():
        raise ValueError("No hay hombros válidos para normalizar.")
    shoulders = xy[valid_shoulders]
    center = ((shoulders[:, 11] + shoulders[:, 12]) / 2).mean(axis=0)
    scale = float(np.linalg.norm(
        shoulders[:, 11] - shoulders[:, 12], axis=1).mean())
    if not np.isfinite(scale) or scale <= 1e-6:
        raise ValueError("Escala corporal inválida.")
    selected = np.nan_to_num(xy[:, KEYPOINT_INDICES], nan=0.0,
                             posinf=0.0, neginf=0.0)
    normalized = (selected - center) / scale
    frames = np.transpose(normalized, (2, 0, 1)).astype(np.float32)
    mask = original_mask[:, KEYPOINT_INDICES]
    if not np.isfinite(frames).all():
        raise ValueError("Entrada OpenHands no finita.")
    return frames, mask


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
