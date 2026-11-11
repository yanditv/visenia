
import json
import sys
from pathlib import Path
from uuid import UUID

import numpy as np


DATA_DIR = (
    Path(__file__).resolve().parents[2]
    / "data"
    / "preprocessed"
)

REGIONS = (
    "left_hand",
    "right_hand",
    "pose",
    "face"
)


def percentage(mask):
    return round(float(np.mean(mask) * 100), 2)


def longest_missing_run(mask):
    longest = 0
    current = 0

    for detected in mask:
        if detected:
            current = 0
        else:
            current += 1
            longest = max(longest, current)

    return longest


def validate_sequence(processing_id: str):
    uid = UUID(processing_id)

    path = DATA_DIR / f"{uid.hex}.npz"

    if not path.is_file():
        raise FileNotFoundError(path)

    with np.load(path) as data:
        timestamps = data["timestamps_ms"]
        keypoints = data["model_keypoints"]
        model_mask = data["model_mask"]

        masks = {
            name: data[f"dtw_{name}_mask"].astype(bool)
            for name in REGIONS
        }

    source_frames = len(timestamps)

    if source_frames == 0:
        raise ValueError("Secuencia vacia.")

    if any(len(mask) != source_frames for mask in masks.values()):
        raise ValueError("Longitudes inconsistentes.")

    if keypoints.shape != (64, 75, 3):
        raise ValueError(
            f"Forma inesperada: {keypoints.shape}"
        )

    if model_mask.shape != (64, 75):
        raise ValueError("Mascara incompatible.")

    left = masks["left_hand"]
    right = masks["right_hand"]

    report = {
        "source_frames": source_frames,
        "model_shape": list(keypoints.shape),
        "timestamps_valid": bool(
            np.all(np.diff(timestamps) > 0)
        ),
        "model_values_finite": bool(
            np.isfinite(keypoints).all()
        ),
        "missing_values_zero": bool(
            np.all(keypoints[~model_mask] == 0)
        ),
        "detection_percentage": {
            name: percentage(mask)
            for name, mask in masks.items()
        },
        "both_hands_detected_pct": percentage(
            left & right
        ),
        "no_hands_detected_pct": percentage(
            ~(left | right)
        ),
        "longest_missing_run": {
            name: longest_missing_run(mask)
            for name, mask in masks.items()
        }
    }

    return report


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(
            "Uso: python -m "
            "app.services.quality_report <id>"
        )

    try:
        result = validate_sequence(sys.argv[1])
        print(json.dumps(
            result,
            indent=2,
            ensure_ascii=False
        ))

    except (ValueError, FileNotFoundError) as error:
        raise SystemExit(str(error))
