
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

FEATURE_GROUPS = {
    "mouth": (0, 2),
    "eyes": (2, 4),
    "eyebrows": (4, 6),
    "head_tilt": (6, 8)
}


def extract_facial_features(face):
    """
    Extrae 8 caracteristicas faciales por frame.
    Entrada: (T, 478, 3)
    Salida: (T, 8), mascara de validez
    """
    points = face[:, :, :2].astype(np.float64)

    def distance(a, b):
        return np.linalg.norm(
            points[:, a] - points[:, b],
            axis=1
        )

    # Referencia de escala: distancia entre ojos
    eye_span = distance(33, 263)

    left_eye_width = distance(33, 133)
    right_eye_width = distance(362, 263)

    with np.errstate(
        divide="ignore",
        invalid="ignore"
    ):
        mouth_open = distance(13, 14) / eye_span
        mouth_width = distance(61, 291) / eye_span

        left_eye_open = (
            distance(159, 145) / left_eye_width
        )

        right_eye_open = (
            distance(386, 374) / right_eye_width
        )

        left_brow = distance(105, 159) / eye_span
        right_brow = distance(334, 386) / eye_span

    # Inclinacion del eje de los ojos
    eye_vector = points[:, 263] - points[:, 33]

    angle = np.arctan2(
        eye_vector[:, 1],
        eye_vector[:, 0]
    )

    features = np.column_stack([
        mouth_open,
        mouth_width,
        left_eye_open,
        right_eye_open,
        left_brow,
        right_brow,
        np.sin(angle),
        np.cos(angle)
    ]).astype(np.float32)

    valid = (
        np.isfinite(features).all(axis=1)
        & (eye_span > 1e-5)
        & (left_eye_width > 1e-5)
        & (right_eye_width > 1e-5)
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

    interval = float(np.median(np.diff(timestamps)))

    return longest * interval


def load_facial_sequence(
    processing_id,
    start=None,
    end=None
):
    uid = UUID(processing_id).hex

    path = DATA_DIR / f"{uid}.npz"

    if not path.is_file():
        raise FileNotFoundError(path)

    with np.load(path) as data:
        face = data["dtw_face"].copy()
        face_mask = data[
            "dtw_face_mask"
        ].astype(bool)

        timestamps = (
            data["timestamps_ms"].astype(np.float64)
            / 1000.0
        )

    selected = np.ones(
        len(timestamps), dtype=bool
    )

    if start is not None:
        selected &= timestamps >= start

    if end is not None:
        selected &= timestamps <= end

    face = face[selected]
    face_mask = face_mask[selected]
    timestamps = timestamps[selected]

    if len(timestamps) < 4:
        raise ValueError(
            "Se necesitan al menos 4 fotogramas."
        )

    if face.shape != (len(timestamps), 478, 3):
        raise ValueError(
            "Dimensiones faciales incompatibles."
        )

    if not np.all(np.diff(timestamps) > 0):
        raise ValueError("Timestamps invalidos.")

    features, feature_mask = (
        extract_facial_features(face)
    )

    valid = face_mask & feature_mask

    coverage = float(np.mean(valid))

    missing_gap = longest_missing_gap(
        valid, timestamps
    )

    # No extrapolar caracteristicas en los extremos.
    boundaries_valid = bool(
        valid[0] and valid[-1]
    )

    sufficient = (
        coverage >= MIN_COVERAGE
        and missing_gap <= MAX_MISSING_GAP_SECONDS
        and valid.sum() >= 4
        and boundaries_valid
    )

    quality = {
        "coverage_pct": round(coverage * 100, 2),
        "valid_frames": int(valid.sum()),
        "total_frames": len(valid),
        "longest_missing_gap_seconds": round(
            missing_gap, 3
        ),
        "boundaries_valid": boundaries_valid
    }

    if not sufficient:
        return {
            "sufficient": False,
            "quality": quality,
            "features": None
        }

    # Interpolar solo ausencias interiores cortas,
    # manteniendo todos los timestamps originales.
    completed = features.copy()

    if not valid.all():
        for column in range(features.shape[1]):
            completed[:, column] = np.interp(
                timestamps,
                timestamps[valid],
                features[valid, column]
            )

    return {
        "sufficient": True,
        "quality": quality,
        "features": completed
    }


def evaluate_non_manual(
    reference_id,
    candidate_id,
    ref_start=None,
    ref_end=None,
    user_start=None,
    user_end=None
):
    reference = load_facial_sequence(
        reference_id,
        ref_start,
        ref_end
    )

    candidate = load_facial_sequence(
        candidate_id,
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
        return {
            "status": "insufficient_data",
            "parameter": "non_manual",
            "algorithm": "DTW",
            **quality,
            "distance": None,
            "score": None,
            "feedback": None
        }

    ref_features = reference["features"]
    user_features = candidate["features"]

    overall = dtw_distance(
        ref_features,
        user_features
    )

    groups = {}

    for name, (start, end) in FEATURE_GROUPS.items():
        result = dtw_distance(
            ref_features[:, start:end],
            user_features[:, start:end]
        )

        groups[name] = {
            "distance": result["distance"],
            "score": None
        }

    return {
        "status": "success",
        "parameter": "non_manual",
        "algorithm": "DTW",
        "features_per_frame": 8,
        **quality,
        "distance": overall["distance"],
        "components": groups,
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

    result = evaluate_non_manual(
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
