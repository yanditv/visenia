"""Landmark-only LSEC comparison. Distances are geometric, never probabilities."""

from dataclasses import dataclass
from math import hypot, sqrt

import numpy as np

from app.contracts.lsec import PARAMETERS, Capture, Distance
from app.domain.lsec.dtw_comparator import dtw_distance
from app.domain.lsec.handshape_evaluator import calculate_angles
from app.domain.lsec.orientation_evaluator import calculate_orientation


@dataclass
class Tracks:
    times: np.ndarray
    hands: dict
    face: dict
    body_coverage: float


def prepare(capture: Capture) -> Tracks:
    frames = capture.gesture()
    times = np.asarray([frame.timestamp_ms for frame in frames])
    scale = np.array([capture.ancho, capture.alto, capture.ancho])
    shoulders = np.full((len(frames), 2, 2), np.nan)
    for index, frame in enumerate(frames):
        if frame.pose and min(point.visibility for point in frame.pose[11:13]) >= 0.5:
            shoulders[index] = [(point.x, point.y) for point in frame.pose[11:13]]
    shoulders *= scale[:2]
    centers = shoulders.mean(axis=1)
    widths = np.linalg.norm(shoulders[:, 0] - shoulders[:, 1], axis=1)
    widths[widths < 5] = np.nan
    hands = {}
    for side in ("izquierda", "derecha"):
        raw = np.full((len(frames), 21, 3), np.nan)
        for index, frame in enumerate(frames):
            points = getattr(frame, f"mano_{side}")
            if points and min(point.visibility for point in points) >= 0.5:
                raw[index] = [(point.x, point.y, point.z) for point in points]
        shape, valid_shape = calculate_angles(raw * scale, dimensions=3)
        shape[~valid_shape] = np.nan
        orientation, _ = calculate_orientation(raw, capture.ancho, capture.alto)
        position = (raw[:, 0, :2] * scale[:2] - centers) / widths[:, None]
        hands[side] = (shape, orientation, position)
    coefficients = [frame.blendshapes_rostro or {} for frame in frames]
    face = {
        key: np.array([values.get(key, np.nan) for values in coefficients])
        for key in set().union(*coefficients)
    }
    return Tracks(times, hands, face, float(np.isfinite(widths).mean()))


def _usable(values, times):
    valid = np.isfinite(values).all(axis=1)
    present = times[valid]
    return (
        present.size >= 4
        and valid.mean() >= 0.70
        and present[0] - times[0] <= 350
        and times[-1] - present[-1] <= 350
        and np.diff(present).max() <= 350
    )


def usable_reference(tracks: Tracks, hand: str, face_keys=()):
    sides = ("izquierda", "derecha") if hand == "ambas" else (hand,)
    return all(
        _usable(values, tracks.times) for side in sides for values in tracks.hands[side]
    ) and all(
        key in tracks.face and _usable(tracks.face[key][:, None], tracks.times) for key in face_keys
    )


def _distance(reference, candidate, ref_times, user_times, *, relative=False):
    samples = []
    for values, times in ((reference, ref_times), (candidate, user_times)):
        if not _usable(values, times):
            return None
        valid = np.isfinite(values).all(axis=1)
        track, times = values[valid], times[valid]
        # Bound DTW work and compare samples on a regular time grid.
        grid = np.linspace(times[0], times[-1], min(36, len(times)))
        track = np.column_stack([np.interp(grid, times, channel) for channel in track.T])
        samples.append(track - track[0] if relative else track)
    return round(dtw_distance(*samples)["distance"] / sqrt(reference.shape[1]), 6)


def compare_manual(reference: Tracks, candidate: Tracks, dominant_hand: str, practice_hand=None):
    sides = ("izquierda", "derecha") if dominant_hand == "ambas" else (dominant_hand,)
    results = {}
    for index, parameter in enumerate(PARAMETERS[:4]):
        track = min(index, 2)
        distances = {}
        for side in sides:
            actual = practice_hand if practice_hand and dominant_hand != "ambas" else side
            template = reference.hands[side][track]
            if actual != side and track != 0:
                # Reflect positions and directions in X. The palm normal is an axial vector.
                template = template * ([1, -1, -1, -1, 1, 1] if track == 1 else [-1, 1])
            distances[actual] = _distance(
                template,
                candidate.hands[actual][track],
                reference.times,
                candidate.times,
                relative=index == 3,
            )
        missing = [side for side, distance in distances.items() if distance is None]
        # For two-handed signs, use the greater deviation so one hand cannot hide the other.
        deviation = None if missing else max(distances.values())
        affected = missing or [
            side for side, distance in distances.items() if distance == deviation
        ]
        zone = "dedos_mano" if index == 0 else "mano"
        results[parameter] = Distance(
            estado="datos_insuficientes" if missing else "medido",
            desviacion=deviation,
            zonas_resaltar=[f"{zone}_{side}" for side in affected],
        )
    return results


def compare_face(
    reference: Tracks, candidate: Tracks, required: bool | None, keys: tuple[str, ...]
):
    if required is False:
        return Distance(estado="no_aplica", desviacion=None, zonas_resaltar=[])
    if not keys or any(key not in reference.face or key not in candidate.face for key in keys):
        return Distance(estado="datos_insuficientes", desviacion=None, zonas_resaltar=["rostro"])
    distance = _distance(
        np.column_stack([reference.face[key] for key in keys]),
        np.column_stack([candidate.face[key] for key in keys]),
        reference.times,
        candidate.times,
    )
    return Distance(
        estado="medido" if distance is not None else "datos_insuficientes",
        desviacion=distance,
        zonas_resaltar=["rostro"],
    )


def automatic_segment(frames, width, height):
    def active(frame, side):
        pose, hand = frame.get("pose"), frame.get(f"mano_{side}")
        if not pose or not hand or min(shoulder["visibility"] for shoulder in pose[11:13]) < 0.5:
            return False
        left, right = pose[11:13]
        shoulder_width = hypot((left["x"] - right["x"]) * width / height, left["y"] - right["y"])
        return hand[0]["y"] < (left["y"] + right["y"]) / 2 + 0.95 * shoulder_width

    ranges = []
    for side in ("izquierda", "derecha"):
        present = [index for index, frame in enumerate(frames) if active(frame, side)]
        groups = []
        for index in present:
            if (
                not groups
                or frames[index]["timestamp_ms"] - frames[groups[-1][-1]]["timestamp_ms"] > 250
            ):
                groups.append([])
            groups[-1].append(index)
        ranges.extend(
            (len(group), group[0], group[-1], side) for group in groups if len(group) >= 4
        )
    if not ranges:
        raise ValueError("Sin tramo continuo de manos detectadas en la zona de seña.")
    for _, start, end, side in sorted(ranges, reverse=True):
        segment = frames[start : end + 1]
        if len(segment) > 300 or segment[-1]["timestamp_ms"] - segment[0]["timestamp_ms"] > 20_000:
            continue
        other = "derecha" if side == "izquierda" else "izquierda"
        tracks = prepare(
            Capture.model_validate(
                {
                    "ancho": width,
                    "alto": height,
                    "frames": [dict(frame, frame_idx=i) for i, frame in enumerate(segment)],
                }
            )
        )
        if sum(active(frame, other) for frame in segment) / len(
            segment
        ) >= 0.60 and usable_reference(tracks, "ambas"):
            return start, end, "ambas"
        if usable_reference(tracks, side):
            return start, end, side
    raise ValueError("Ningún tramo supera la cobertura mínima. Revise el intervalo o el video.")
