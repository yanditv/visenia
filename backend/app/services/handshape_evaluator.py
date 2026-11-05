
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

MIN_COVERAGE = 0.70
MAX_MISSING_GAP_SECONDS = 0.35

# Tres angulos por dedo
JOINTS = np.array([
    # Pulgar
    [0, 1, 2], [1, 2, 3], [2, 3, 4],

    # Indice
    [0, 5, 6], [5, 6, 7], [6, 7, 8],

    # Medio
    [0, 9, 10], [9, 10, 11], [10, 11, 12],

    # Anular
    [0, 13, 14], [13, 14, 15], [14, 15, 16],

    # Menique
    [0, 17, 18], [17, 18, 19], [18, 19, 20]
])


def calculate_angles(hand):
    points = hand[:, :, :2]

    a = points[:, JOINTS[:, 0], :]
    b = points[:, JOINTS[:, 1], :]
    c = points[:, JOINTS[:, 2], :]

    u = a - b
    v = c - b

    norm_u = np.linalg.norm(u, axis=2)
    norm_v = np.linalg.norm(v, axis=2)

    denominator = norm_u * norm_v

    with np.errstate(divide="ignore", invalid="ignore"):
        cosine = np.sum(u * v, axis=2) / denominator
        angles = np.arccos(
            np.clip(cosine, -1.0, 1.0)
        ) / np.pi

    valid = (
        np.isfinite(angles).all(axis=1)
        & (norm_u > 1e-5).all(axis=1)
        & (norm_v > 1e-5).all(axis=1)
    )

    return angles.astype(np.float32), valid


def longest_missing_gap(mask, timestamps):
    longest = 0
    current = 0

    for detected in mask:
        if detected:
            current = 0
        else:
            current += 1
            longest = max(longest, current)

    interval = float(np.median(np.diff(timestamps)))

    return longest * interval


def load_hand_features(
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
        hand = data[f"dtw_{hand_name}"]
        mask = data[
            f"dtw_{hand_name}_mask"
        ].astype(bool)

        timestamps = (
            data["timestamps_ms"].astype(float)
            / 1000.0
        )

    selected = np.ones(len(timestamps), dtype=bool)

    if start is not None:
        selected &= timestamps >= start

    if end is not None:
        selected &= timestamps <= end

    hand = hand[selected]
    mask = mask[selected]
    timestamps = timestamps[selected]

    if len(timestamps) < 4:
        raise ValueError(
            "Se necesitan al menos 4 fotogramas."
        )

    if hand.shape != (len(timestamps), 21, 3):
        raise ValueError("Dimensiones de mano invalidas.")

    if not np.all(np.diff(timestamps) > 0):
        raise ValueError("Timestamps invalidos.")

    angles, valid_angles = calculate_angles(hand)

    valid = mask & valid_angles

    coverage = float(np.mean(valid))
    missing_gap = longest_missing_gap(
        valid, timestamps
    )

    quality = {
        "coverage_pct": round(coverage * 100, 2),
        "valid_frames": int(valid.sum()),
        "total_frames": len(valid),
        "longest_missing_gap_seconds": round(
            missing_gap, 3
        )
    }

    sufficient = (
        coverage >= MIN_COVERAGE
        and missing_gap <= MAX_MISSING_GAP_SECONDS
        and int(valid.sum()) >= 4
    )

    return {
        "sufficient": sufficient,
        "quality": quality,
        "features": angles[valid] if sufficient else None
    }


def evaluate_handshape(
    reference_id,
    candidate_id,
    ref_start=None,
    ref_end=None,
    user_start=None,
    user_end=None
):
    results = {}

    for hand_name in ("left_hand", "right_hand"):
        reference = load_hand_features(
            reference_id,
            hand_name,
            ref_start,
            ref_end
        )

        candidate = load_hand_features(
            candidate_id,
            hand_name,
            user_start,
            user_end
        )

        if not (
            reference["sufficient"]
            and candidate["sufficient"]
        ):
            results[hand_name] = {
                "status": "insufficient_data",
                "reference_quality": reference["quality"],
                "candidate_quality": candidate["quality"],
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
            "reference_quality": reference["quality"],
            "candidate_quality": candidate["quality"],
            "distance": comparison["distance"],
            "score": None
        }

    valid_hands = sum(
        result["status"] == "ok"
        for result in results.values()
    )

    if valid_hands == 2:
        status = "success"
    elif valid_hands == 1:
        status = "partial"
    else:
        status = "insufficient_data"

    return {
        "status": status,
        "parameter": "handshape",
        "algorithm": "DTW",
        "features_per_hand": len(JOINTS),
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

    result = evaluate_handshape(
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
