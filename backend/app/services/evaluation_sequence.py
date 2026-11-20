"""In-memory landmark sequences and adapters for existing reference files."""

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from uuid import UUID
import json

import numpy as np


BASE_DIR = Path(__file__).resolve().parents[2]
REGIONS = {"left_hand": 21, "right_hand": 21, "pose": 33, "face": 478}


@dataclass(frozen=True)
class EvaluationSequence:
    timestamps_ms: np.ndarray
    left_hand: np.ndarray
    right_hand: np.ndarray
    pose: np.ndarray
    face: np.ndarray
    left_hand_mask: np.ndarray
    right_hand_mask: np.ndarray
    pose_mask: np.ndarray
    face_mask: np.ndarray
    width: int
    height: int
    # Body-normalized coordinates used by the legacy handshape/location/face metrics.
    normalized: dict[str, np.ndarray]

    def __post_init__(self):
        n = len(self.timestamps_ms)
        if self.width <= 0 or self.height <= 0:
            raise ValueError("Invalid frame dimensions")
        if n and (not np.isfinite(self.timestamps_ms).all() or
                  np.any(np.diff(self.timestamps_ms) <= 0)):
            raise ValueError("Timestamps must be finite and strictly increasing")
        for name, count in REGIONS.items():
            if getattr(self, name).shape != (n, count, 3):
                raise ValueError(f"Invalid {name} shape")
            if self.normalized[name].shape != (n, count, 3):
                raise ValueError(f"Invalid normalized {name} shape")
            if getattr(self, f"{name}_mask").shape != (n,):
                raise ValueError(f"Invalid {name} mask")

    def slice_seconds(self, start=None, end=None):
        selected = np.ones(len(self.timestamps_ms), dtype=bool)
        seconds = self.timestamps_ms / 1000.0
        if start is not None:
            selected &= seconds >= start
        if end is not None:
            selected &= seconds <= end
        return EvaluationSequence(
            self.timestamps_ms[selected],
            *(getattr(self, name)[selected] for name in REGIONS),
            *(getattr(self, f"{name}_mask")[selected] for name in REGIONS),
            self.width, self.height,
            {name: values[selected] for name, values in self.normalized.items()},
        )


def normalize_landmarks(regions: dict[str, np.ndarray], width: int, height: int):
    """Normalize XY to shoulder center/width; missing shoulders use valid median."""
    pose = regions["pose"]
    shoulders = pose[:, [11, 12], :2] * [width, height]
    centers = shoulders.mean(axis=1)
    scales = np.linalg.norm(shoulders[:, 0] - shoulders[:, 1], axis=1)
    usable = np.isfinite(shoulders).all(axis=(1, 2)) & (scales >= 5)
    if usable.any():
        centers[~usable] = np.median(centers[usable], axis=0)
        scales[~usable] = np.median(scales[usable])
    else:
        centers[:] = np.nan
        scales[:] = np.nan
    output = {}
    for name, values in regions.items():
        normalized = values.copy()
        normalized[:, :, 0] = (values[:, :, 0] * width - centers[:, 0, None]) / scales[:, None]
        normalized[:, :, 1] = (values[:, :, 1] * height - centers[:, 1, None]) / scales[:, None]
        output[name] = normalized
    return output


def from_frames(frames: list[tuple[int, dict[str, np.ndarray]]], width: int, height: int):
    times = np.asarray([item[0] for item in frames], dtype=np.float64)
    regions = {
        name: np.stack([item[1][name] for item in frames]).astype(np.float32)
        if frames else np.empty((0, count, 3), dtype=np.float32)
        for name, count in REGIONS.items()
    }
    masks = {name: np.isfinite(values).all(axis=(1, 2)) for name, values in regions.items()}
    return EvaluationSequence(times, *(regions.values()), *(masks.values()),
                              width, height, normalize_landmarks(regions, width, height))


@lru_cache(maxsize=16)
def load_reference(reference_id: str) -> EvaluationSequence:
    uid = UUID(reference_id).hex
    catalog_path = BASE_DIR / "data/references/catalog.json"
    with catalog_path.open(encoding="utf-8") as stream:
        catalog = json.load(stream)
    entry = next((item for item in catalog["references"]
                  if UUID(item["reference_id"]).hex == uid), None)
    if entry is None:
        raise FileNotFoundError(f"Reference {uid} is not in catalog")
    raw_path = BASE_DIR / "data/processed" / f"{uid}.npz"
    pre_path = BASE_DIR / "data/preprocessed" / f"{uid}.npz"
    with np.load(raw_path) as raw, np.load(pre_path) as pre:
        times = raw["timestamps_ms"].astype(np.float64)
        regions = {name: raw[name].astype(np.float32) for name in REGIONS}
        normalized = {name: pre[f"dtw_{name}"].astype(np.float32) for name in REGIONS}
        masks = {name: pre[f"dtw_{name}_mask"].astype(bool) for name in REGIONS}
        result = EvaluationSequence(times, *(regions.values()), *(masks.values()),
                                    int(raw["frame_width"]), int(raw["frame_height"]), normalized)
    return result.slice_seconds(entry.get("start"), entry.get("end"))
