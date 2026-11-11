
import argparse
import json
from pathlib import Path
from uuid import UUID

import numpy as np

from app.services.dtw_comparator import dtw_distance


DATA_DIR = (
    Path(__file__).resolve().parents[2]
    / "data"
    / "preprocessed"
)


def load_trajectory(
    processing_id: str,
    start: float | None = None,
    end: float | None = None
):
    uid = UUID(processing_id).hex
    path = DATA_DIR / f"{uid}.npz"

    if not path.is_file():
        raise FileNotFoundError(path)

    with np.load(path) as data:
        pose = data["dtw_pose"]
        pose_mask = data["dtw_pose_mask"].astype(bool)
        timestamps = (
            data["timestamps_ms"].astype(np.float64)
            / 1000.0
        )

    selected = np.ones(len(timestamps), dtype=bool)

    if start is not None:
        selected &= timestamps >= start

    if end is not None:
        selected &= timestamps <= end

    pose = pose[selected]
    pose_mask = pose_mask[selected]
    timestamps = timestamps[selected]

    if len(timestamps) < 4:
        raise ValueError(
            "Se necesitan al menos 4 fotogramas."
        )

    if not np.all(np.diff(timestamps) > 0):
        raise ValueError(
            "Los timestamps deben ser crecientes."
        )

    # Munecas de MediaPipe Pose: 15 y 16
    wrists = pose[:, [15, 16], :2]

    if not pose_mask.all():
        raise ValueError(
            "Existen fotogramas sin postura valida."
        )

    if not np.isfinite(wrists).all():
        raise ValueError(
            "Las coordenadas contienen valores invalidos."
        )

    # Dos munecas: x1, y1, x2, y2
    trajectory = wrists.reshape(
        len(wrists), 4
    ).astype(np.float64)

    return trajectory, timestamps


def smooth_trajectory(trajectory):
    # Suavizado temporal de tres fotogramas
    padded = np.pad(
        trajectory,
        ((1, 1), (0, 0)),
        mode="edge"
    )

    return (
        padded[:-2]
        + 2 * padded[1:-1]
        + padded[2:]
    ) / 4.0


def extract_movement(trajectory, timestamps):
    smoothed = smooth_trajectory(trajectory)

    # Cambios de posicion por segundo
    velocity = np.gradient(
        smoothed,
        timestamps,
        axis=0
    )

    return velocity


def evaluate(
    reference_id: str,
    candidate_id: str,
    ref_start=None,
    ref_end=None,
    user_start=None,
    user_end=None
):
    reference, ref_times = load_trajectory(
        reference_id,
        ref_start,
        ref_end
    )

    candidate, user_times = load_trajectory(
        candidate_id,
        user_start,
        user_end
    )

    # Parametro 1: ubicacion
    location = dtw_distance(
        reference,
        candidate
    )

    # Parametro 2: movimiento
    ref_movement = extract_movement(
        reference,
        ref_times
    )

    user_movement = extract_movement(
        candidate,
        user_times
    )

    movement = dtw_distance(
        ref_movement,
        user_movement
    )

    return {
        "status": "success",
        "reference_id": reference_id,
        "candidate_id": candidate_id,
        "evaluation": {
            "location": {
                "algorithm": "DTW",
                "distance": location["distance"],
                "score": None
            },
            "movement": {
                "algorithm": "DTW",
                "distance": movement["distance"],
                "score": None
            }
        },
        "feedback": None
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()

    parser.add_argument("reference_id")
    parser.add_argument("candidate_id")

    parser.add_argument("--ref-start", type=float)
    parser.add_argument("--ref-end", type=float)
    parser.add_argument("--user-start", type=float)
    parser.add_argument("--user-end", type=float)

    args = parser.parse_args()

    result = evaluate(
        args.reference_id,
        args.candidate_id,
        args.ref_start,
        args.ref_end,
        args.user_start,
        args.user_end
    )

    print(json.dumps(
        result,
        indent=2,
        ensure_ascii=False
    ))
