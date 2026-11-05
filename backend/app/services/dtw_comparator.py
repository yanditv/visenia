
import argparse
import json
import math
from pathlib import Path
from uuid import UUID

import numpy as np


DATA_DIR = (
    Path(__file__).resolve().parents[2]
    / "data"
    / "preprocessed"
)


def load_wrist_sequence(
    processing_id: str,
    start: float | None = None,
    end: float | None = None
) -> np.ndarray:

    uid = UUID(processing_id).hex
    path = DATA_DIR / f"{uid}.npz"

    if not path.is_file():
        raise FileNotFoundError(
            f"Secuencia no encontrada: {path}"
        )

    with np.load(path) as data:
        pose = data["dtw_pose"]
        mask = data["dtw_pose_mask"].astype(bool)
        timestamps = data["timestamps_ms"] / 1000.0

    # Seleccionar intervalo temporal
    selected = np.ones(
        len(timestamps), dtype=bool
    )

    if start is not None:
        selected &= timestamps >= start

    if end is not None:
        selected &= timestamps <= end

    pose = pose[selected]
    mask = mask[selected]

    if len(pose) < 3:
        raise ValueError(
            "Se necesitan al menos 3 fotogramas."
        )

    if pose.shape[1:] != (33, 3):
        raise ValueError(
            f"Postura incompatible: {pose.shape}"
        )

    # MediaPipe Pose: muñecas 15 y 16
    wrists = pose[:, [15, 16], :2]

    valid = (
        mask
        & np.isfinite(wrists).all(axis=(1, 2))
    )

    if not valid.all():
        raise ValueError(
            "Existen fotogramas sin postura valida. "
            "Revisa la calidad del video."
        )

    # Dos muñecas, coordenadas X e Y
    return wrists.reshape(len(wrists), 4).astype(
        np.float32
    )


def dtw_distance(
    reference: np.ndarray,
    candidate: np.ndarray,
    band_ratio: float = 0.2
) -> dict:

    n = len(reference)
    m = len(candidate)

    if n == 0 or m == 0:
        raise ValueError("Secuencia vacia.")

    if reference.shape[1] != candidate.shape[1]:
        raise ValueError(
            "Las caracteristicas no coinciden."
        )

    band = max(
        abs(n - m),
        math.ceil(max(n, m) * band_ratio)
    )

    costs = np.full(
        (n + 1, m + 1),
        np.inf,
        dtype=np.float64
    )

    lengths = np.zeros(
        (n + 1, m + 1),
        dtype=np.int32
    )

    costs[0, 0] = 0.0

    for i in range(1, n + 1):
        j_min = max(1, i - band)
        j_max = min(m, i + band)

        for j in range(j_min, j_max + 1):
            distance = np.linalg.norm(
                reference[i - 1] - candidate[j - 1]
            )

            neighbors = [
                (i - 1, j),
                (i, j - 1),
                (i - 1, j - 1)
            ]

            best_i, best_j = min(
                neighbors,
                key=lambda pos: costs[pos]
            )

            if not np.isfinite(
                costs[best_i, best_j]
            ):
                continue

            costs[i, j] = (
                distance + costs[best_i, best_j]
            )

            lengths[i, j] = (
                lengths[best_i, best_j] + 1
            )

    if not np.isfinite(costs[n, m]):
        raise ValueError(
            "No existe alineacion DTW valida."
        )

    path_length = int(lengths[n, m])

    return {
        "distance": round(
            float(costs[n, m] / path_length), 6
        ),
        "path_length": path_length,
        "reference_frames": n,
        "candidate_frames": m
    }


def compare(
    reference_id: str,
    candidate_id: str,
    ref_start=None,
    ref_end=None,
    user_start=None,
    user_end=None
):
    reference = load_wrist_sequence(
        reference_id, ref_start, ref_end
    )

    candidate = load_wrist_sequence(
        candidate_id, user_start, user_end
    )

    result = dtw_distance(reference, candidate)

    return {
        "status": "success",
        "parameter": "movement",
        "algorithm": "DTW",
        "reference_id": reference_id,
        "candidate_id": candidate_id,
        "result": result,
        "score": None,
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

    result = compare(
        args.reference_id,
        args.candidate_id,
        args.ref_start,
        args.ref_end,
        args.user_start,
        args.user_end
    )

    print(json.dumps(result, indent=2))
