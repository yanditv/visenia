"""Experimental ASL recognition and measured capture feedback."""

import json
from functools import lru_cache
from threading import BoundedSemaphore

import numpy as np

from app.services.evaluation_sequence import BASE_DIR
from app.services.openhands_adapter import adapt_sequence
from app.services.openhands_runtime import run_inference_sequence
from app.services.openhands_runtime import InferenceError
from app.services.realtime_evaluation import quality


_INFERENCE_SLOT = BoundedSemaphore(1)


@lru_cache(maxsize=1)
def asl_glosses() -> frozenset[str]:
    path = BASE_DIR / "models/openhands/splits/asl2000.json"
    with path.open(encoding="utf-8") as stream:
        return frozenset(item["gloss"] for item in json.load(stream))


def assess_capture(candidate, min_coverage=0.7, max_gap_seconds=0.35):
    if candidate is None or len(candidate.timestamps_ms) < 4:
        return False, ["Realiza la seña durante al menos cuatro fotogramas."]
    pose = quality(candidate.pose_mask, candidate.timestamps_ms)
    feedback = []
    if pose["coverage_pct"] < min_coverage * 100:
        feedback.append(f"Mantén hombros y torso visibles: se detectaron en {pose['coverage_pct']}% de la toma (mínimo {min_coverage:.0%}).")
    elif pose["longest_missing_gap_seconds"] > max_gap_seconds:
        feedback.append(f"Hombros y torso dejaron de detectarse durante {pose['longest_missing_gap_seconds']:.2f} s seguidos (máximo {max_gap_seconds:.2f} s).")
    # OpenHands was trained with zero-filled missing hands. A valid isolated
    # sign may have no hand detection while the signer is at rest. Only gaps
    # *between* detections indicate a broken hand trajectory.
    hand_sufficient = any(
        _hand_observation_ok(mask, candidate.timestamps_ms, max_gap_seconds)
        for mask in (candidate.left_hand_mask, candidate.right_hand_mask)
    )
    if not hand_sufficient:
        feedback.append(
            "No se obtuvo una trayectoria continua de una mano durante al menos 0.25 s. "
            "Mantén la mano visible mientras realizas la seña.")
    return not feedback, feedback


def _hand_observation_ok(mask, timestamps_ms, max_gap_seconds):
    detected = np.flatnonzero(mask)
    if len(detected) < 4:
        return False
    times = np.asarray(timestamps_ms, dtype=float)
    interval = float(np.median(np.diff(times)))
    observed_ms = times[detected[-1]] - times[detected[0]] + interval
    if observed_ms < 250:
        return False
    internal = np.diff(times[detected]) - interval
    return not len(internal) or float(internal.max()) <= max_gap_seconds * 1000


def select_sign_window(candidate):
    """Trim camera idle time using wrist motion, without consulting the target.

    Return the full clip when motion is too weak or fragmented to locate an
    isolated sign reliably. The model still receives the original 27 points.
    """
    times = candidate.timestamps_ms
    if len(times) < 12 or times[-1] - times[0] < 1500:
        return candidate
    wrists = candidate.pose[:, [15, 16], :2]
    shoulders = candidate.pose[:, [11, 12], :2]
    center = shoulders.mean(axis=1)
    scale = np.linalg.norm(shoulders[:, 0] - shoulders[:, 1], axis=1)
    good = np.isfinite(wrists).all(axis=(1, 2)) & np.isfinite(scale) & (scale > 1e-3)
    if good.mean() < 0.7:
        return candidate
    safe_scale = np.where(good, scale, 1.0)
    normalized = (wrists - center[:, None, :]) / safe_scale[:, None, None]
    elapsed = np.diff(times) / 1000
    velocity = np.linalg.norm(np.diff(normalized, axis=0), axis=2) / elapsed[:, None]
    velocity[~(good[:-1] & good[1:])] = 0
    speed = np.max(velocity, axis=1)
    speed[~np.isfinite(speed)] = 0
    # Require sustained movement; one-frame pose jumps are common in MediaPipe.
    moving = np.convolve((speed > 1.8).astype(int), np.ones(3, dtype=int), mode="same") >= 2
    indices = np.flatnonzero(moving)
    if len(indices) < 3:
        return candidate
    start = max(times[0], times[indices[0]] - 250)
    end = min(times[-1], times[indices[-1] + 1] + 250)
    if end - start < 600 or end - start >= times[-1] - times[0] - 100:
        return candidate
    selected = candidate.slice_seconds(start / 1000, end / 1000)
    return selected if len(selected.timestamps_ms) >= 8 else candidate


def observe_hands_to_mouth(candidate):
    """Report each visible hand approach, not a verdict about the sign."""
    observed = {"left": False, "right": False}
    if candidate is None or len(candidate.timestamps_ms) < 8:
        return observed
    mouth = candidate.face[:, 13, :2]
    shoulders = candidate.pose[:, [11, 12], :2]
    scale = np.linalg.norm(shoulders[:, 0] - shoulders[:, 1], axis=1)
    if not np.isfinite(mouth).all(axis=1).any():
        return observed
    for side in observed:
        wrist = getattr(candidate, f"{side}_hand")[:, 0, :2]
        with np.errstate(divide="ignore", invalid="ignore"):
            distance = np.linalg.norm(wrist - mouth, axis=1) / scale
        valid = np.isfinite(distance) & np.isfinite(scale) & (scale > 0.03)
        if valid.sum() < 8:
            continue
        distances = distance[valid]
        closest_index = int(np.argmin(distances))
        if closest_index < 3 or (distances < 0.75).sum() < 3:
            continue
        approach = float(np.percentile(distances[:closest_index + 1], 90) - distances[closest_index])
        if distances[closest_index] < 0.65 and approach >= 0.27:
            observed[side] = True
    return observed


def observe_hand_to_mouth(candidate):
    """Backwards-compatible aggregate observation."""
    return any(observe_hands_to_mouth(candidate).values())


def drink_hand_observation(candidate, practice_hand="either"):
    """Only checks which hand approached the mouth during a DRINK exercise."""
    hands = observe_hands_to_mouth(candidate)
    if practice_hand == "either":
        status = "observed" if any(hands.values()) else "not_observed"
    elif hands[practice_hand]:
        status = "matching_hand"
    elif hands["left" if practice_hand == "right" else "right"]:
        status = "opposite_hand"
    else:
        status = "not_observed"
    return {
        "observation_type": "hand_to_mouth",
        "hand_to_mouth": any(hands.values()),
        "hands_to_mouth": hands,
        "practice_hand": practice_hand,
        "practice_hand_status": status,
    }


def hello_hand_observation(candidate, practice_hand="either"):
    """Observe which hand rose beside the head; do not judge HELLO itself."""
    hands = {"left": False, "right": False}
    status = "not_observed"
    if candidate is None or len(candidate.timestamps_ms) < 8:
        return {"observation_type": "raised_hand_near_head", "hands_near_head": hands,
                "practice_hand": practice_hand, "practice_hand_status": status,
                "outward_movement": None}
    shoulders = candidate.pose[:, [11, 12], :2]
    center = shoulders.mean(axis=1)
    scale = np.linalg.norm(shoulders[:, 0] - shoulders[:, 1], axis=1)
    activity = {}
    for side, wrist_index in (("left", 15), ("right", 16)):
        wrist = candidate.pose[:, wrist_index, :2]
        with np.errstate(divide="ignore", invalid="ignore"):
            position = (wrist - center) / scale[:, None]
        valid = (np.isfinite(position).all(axis=1) & np.isfinite(scale) &
                 (scale > 0.03))
        hand_mask = getattr(candidate, f"{side}_hand_mask")
        if valid.sum() < 8 or hand_mask.sum() < 4 or hand_mask.mean() < 0.25:
            continue
        points = position[valid]
        high_y = float(np.percentile(points[:, 1], 5))
        typical_x = float(np.median(points[:, 0]))
        # The wrist must be on its own side of the head and at head height.
        if high_y >= 0.45 or (typical_x > -0.6 if side == "right" else typical_x < 0.6):
            continue
        horizontal_motion = float(np.percentile(points[:, 0], 90) -
                                  np.percentile(points[:, 0], 10))
        activity[side] = -high_y + 0.25 * horizontal_motion
    if activity:
        ranked = sorted(activity, key=activity.get, reverse=True)
        if len(ranked) == 1 or activity[ranked[0]] - activity[ranked[1]] >= 0.06:
            hands[ranked[0]] = True
            if practice_hand == "either":
                status = "observed"
            elif ranked[0] == practice_hand:
                status = "matching_hand"
            else:
                status = "opposite_hand"
    active = next((side for side, observed in hands.items() if observed), None)
    outward = _hello_outward_movement(candidate, active) if active else None
    return {"observation_type": "raised_hand_near_head", "hands_near_head": hands,
            "practice_hand": practice_hand, "practice_hand_status": status,
            "outward_movement": outward}


def _hello_outward_movement(candidate, side):
    """Measure a sustained movement away from the head after the hand rises."""
    shoulders = candidate.pose[:, [11, 12], :2]
    center = shoulders.mean(axis=1)
    scale = np.linalg.norm(shoulders[:, 0] - shoulders[:, 1], axis=1)
    wrist = candidate.pose[:, 16 if side == "right" else 15, :2]
    with np.errstate(divide="ignore", invalid="ignore"):
        position = (wrist - center) / scale[:, None]
    outward = -position[:, 0] if side == "right" else position[:, 0]
    near_head = (np.isfinite(position).all(axis=1) & np.isfinite(scale) &
                 (scale > 0.03) & (position[:, 1] < 0.3) &
                 (outward >= 0.6) & (outward <= 1.2))
    starts = np.flatnonzero(near_head)
    if len(starts) < 3:
        return None
    first = starts[0]
    times = candidate.timestamps_ms
    baseline = np.median(outward[near_head & (times >= times[first]) &
                                 (times <= times[first] + 350)])
    follow = (np.isfinite(outward) & (times > times[first] + 250) &
              (times <= times[first] + 1300) & (position[:, 1] < 0.35) &
              (outward >= 0.6))
    pairs = [0.5 * (outward[i] + outward[i + 1])
             for i in range(first, len(times) - 1)
             if follow[i] and follow[i + 1] and times[i + 1] - times[i] <= 300]
    if not pairs:
        return None
    return bool(max(pairs) - baseline >= 0.3)


def select_drink_window(candidate, hand):
    """Keep the full mouth-approach episode, including its entry and release."""
    mouth = candidate.face[:, 13, :2]
    wrist = getattr(candidate, f"{hand}_hand")[:, 0, :2]
    shoulders = candidate.pose[:, [11, 12], :2]
    scale = np.linalg.norm(shoulders[:, 0] - shoulders[:, 1], axis=1)
    with np.errstate(divide="ignore", invalid="ignore"):
        distances = np.linalg.norm(wrist - mouth, axis=1) / scale
    valid = np.isfinite(distances) & np.isfinite(scale) & (scale > 0.03)
    if valid.sum() < 8:
        return candidate
    near = np.flatnonzero(valid & (distances < 0.75))
    if len(near) < 3:
        return candidate
    start = candidate.timestamps_ms[near[0]] / 1000 - 0.8
    end = candidate.timestamps_ms[near[-1]] / 1000 + 0.8
    selected = candidate.slice_seconds(start, end)
    return selected if len(selected.timestamps_ms) >= 8 else candidate


def infer_asl(candidate, target_gloss, practice_hand="either"):
    focused_hand = None
    if (target_gloss == "drink" and practice_hand in ("left", "right") and
            drink_hand_observation(candidate, practice_hand)["practice_hand_status"] == "matching_hand"):
        selected = select_drink_window(candidate, practice_hand)
        focused_hand = practice_hand
    else:
        selected = select_sign_window(candidate)
    frames, mask = adapt_sequence(selected, target_frames=120, active_hand=focused_hand)
    if not _INFERENCE_SLOT.acquire(timeout=30):
        raise InferenceError("OpenHands está ocupado; intenta de nuevo.")
    try:
        result = run_inference_sequence(frames, mask, target_gloss)
        result["input_window"] = {
            "frames": len(selected.timestamps_ms),
            "start_ms": int(selected.timestamps_ms[0] - candidate.timestamps_ms[0]),
            "end_ms": int(selected.timestamps_ms[-1] - candidate.timestamps_ms[0]),
            "trimmed": len(selected.timestamps_ms) < len(candidate.timestamps_ms),
            "focus_hand": focused_hand,
        }
        return result
    finally:
        _INFERENCE_SLOT.release()
