
import argparse
import json
from pathlib import Path
from uuid import UUID

import numpy as np

from app.services.dtw_comparator import dtw_distance


DATA_DIR = (
    Path(__file__).resolve().parents[2]
    / "data"
    / "processed"
)

MIN_COVERAGE = 0.70
MAX_MISSING_GAP_SECONDS = 0.35


def calculate_orientation(hand, width, height):
    """
    Calcula dos vectores unitarios por fotograma:
    - Normal aproximada de la palma
    - Direccion longitudinal de la mano

    Salida: (frames, 6)
    """

    points = hand[:, [0, 5, 17], :].astype(
        np.float64
    ).copy()

    # MediaPipe normaliza X por ancho e Y por alto.
    # Z tiene aproximadamente la escala de X.
    points *= np.array(
        [width, height, width],
        dtype=np.float64
    )

    wrist = points[:, 0]
    index_base = points[:, 1]
    pinky_base = points[:, 2]

    v1 = index_base - wrist
    v2 = pinky_base - wrist

    normal = np.cross(v1, v2)

    direction = (
        (index_base + pinky_base) / 2.0
        - wrist
    )

    normal_length = np.linalg.norm(
        normal, axis=1
    )

    direction_length = np.linalg.norm(
        direction, axis=1
    )

    v1_length = np.linalg.norm(v1, axis=1)
    v2_length = np.linalg.norm(v2, axis=1)

    with np.errstate(divide="ignore", invalid="ignore"):
        separation = (
            normal_length / (v1_length * v2_length)
        )

    valid = (
        np.isfinite(points).all(axis=(1, 2))
        & np.isfinite(separation)
        & (separation > 0.05)
        & (normal_length > 1e-5)
        & (direction_length > 1e-5)
    )

    features = np.full(
        (len(hand), 6),
        np.nan,
        dtype=np.float32
    )

    features[valid, :3] = (
        normal[valid]
        / normal_length[valid, None]
    )

    features[valid, 3:] = (
        direction[valid]
        / direction_length[valid, None]
    )

    return features, valid


def longest_missing_gap(mask, timestamps):
    longest = 0
    current = 0

    for detected in mask:
        if detected:
            current = 0
        else:
            current += 1
            longest = max(longest, current)

    interval = float(
        np.median(np.diff(timestamps))
    )

    return longest * interval


def load_orientation(
    processing_id,
    hand_name,
    start=None,
    end=None
):
    uid = UUID(processing_id).hex
    path = DATA_DIR / f"{uid}.npz"

    if not path.is_file():
        raise FileNotFoundError(path)

    with np.load(path) as data:
        hand = data[hand_name].copy()

        width = int(data["frame_width"])
        height = int(data["frame_height"])

        timestamps = (
            data["timestamps_ms"].astype(np.float64)
            / 1000.0
        )

    selected = np.ones(
        len(timestamps),
        dtype=bool
    )

    if start is not None:
        selected &= timestamps >= start

    if end is not None:
        selected &= timestamps <= end

    hand = hand[selected]
    timestamps = timestamps[selected]

    if len(timestamps) < 4:
        raise ValueError(
            "Se necesitan al menos 4 fotogramas."
        )

    if not np.all(np.diff(timestamps) > 0):
        raise ValueError("Timestamps invalidos.")

    if hand.shape != (len(timestamps), 21, 3):
        raise ValueError("Dimensiones invalidas.")

    if width <= 0 or height <= 0:
        raise ValueError("Resolucion invalida.")

    features, valid = calculate_orientation(
        hand, width, height
    )

    coverage = float(np.mean(valid))

    missing_gap = longest_missing_gap(
        valid, timestamps
    )

    sufficient = (
        coverage >= MIN_COVERAGE
        and missing_gap <= MAX_MISSING_GAP_SECONDS
        and int(valid.sum()) >= 4
    )

    return {
        "sufficient": sufficient,
        "features": (
            features[valid] if sufficient else None
        ),
        "quality": {
            "coverage_pct": round(
                coverage * 100, 2
            ),
            "valid_frames": int(valid.sum()),
            "total_frames": len(valid),
            "longest_missing_gap_seconds": round(
                missing_gap, 3
            )
        }
    }


def evaluate_orientation(
    reference_id,
    candidate_id,
    ref_start=None,
    ref_end=None,
    user_start=None,
    user_end=None
):
    results = {}

    for hand_name in ("left_hand", "right_hand"):
        reference = load_orientation(
            reference_id,
            hand_name,
            ref_start,
            ref_end
        )

        candidate = load_orientation(
            candidate_id,
            hand_name,
            user_start,
            user_end
        )

        quality = {
            "reference_quality": reference["quality"],
            "candidate_quality": candidate["quality"]
        }

        if not (
            reference["sufficient"]
            and candidate["sufficient"]
        ):
            results[hand_name] = {
                "status": "insufficient_data",
                **quality,
                "distance": None,
                "score": None
            }
            continue

        comparison = dtw_distance(
            reference["features"],
            candidate["features"]
        )

        results[hand_name] = {
            "status": "ok",
            **quality,
            "distance": comparison["distance"],
            "score": None
        }

    valid_hands = sum(
        result["status"] == "ok"
        for result in results.values()
    )

    status = (
        "success" if valid_hands == 2
        else "partial" if valid_hands == 1
        else "insufficient_data"
    )

    return {
        "status": status,
        "parameter": "orientation",
        "algorithm": "DTW",
        "features_per_frame": 6,
        "evaluation": results,
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

    result = evaluate_orientation(
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
