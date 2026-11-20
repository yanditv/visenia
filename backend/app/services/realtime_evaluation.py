"""Pure, in-memory evaluation using the existing five DTW feature definitions."""

import json
from dataclasses import dataclass

import numpy as np

from app.services.dtw_comparator import dtw_distance
from app.services.evaluation_sequence import EvaluationSequence, BASE_DIR
from app.services.handshape_evaluator import calculate_angles
from app.services.orientation_evaluator import calculate_orientation
from app.services.non_manual_evaluator import extract_facial_features
from app.services.motion_location_evaluator import extract_movement
from app.services.scoring_engine import demo_distance_score


@dataclass(frozen=True)
class QualityPolicy:
    min_coverage: float = 0.70  # experimental capture gates
    max_missing_gap_seconds: float = 0.35
    min_valid_frames: int = 4


def quality(mask: np.ndarray, timestamps_ms: np.ndarray) -> dict:
    n = len(mask)
    runs = []
    start = None
    for index, detected in enumerate(mask):
        if not detected and start is None:
            start = index
        if detected and start is not None:
            runs.append((start, index))
            start = None
    if start is not None:
        runs.append((start, n))
    interval = float(np.median(np.diff(timestamps_ms))) if n >= 2 else 0.0
    gap_ms = max((timestamps_ms[min(b, n - 1)] - timestamps_ms[a]
                  if b < n else timestamps_ms[-1] - timestamps_ms[a] + interval
                  for a, b in runs), default=0.0) if n else 0.0
    return {
        "coverage_pct": round(float(mask.mean()) * 100, 2) if n else 0.0,
        "valid_frames": int(mask.sum()),
        "total_frames": n,
        "longest_missing_gap_seconds": round(float(gap_ms) / 1000, 3),
    }


def _features(sequence, region, extractor):
    values = sequence.normalized[region]
    features, valid = extractor(values)
    valid &= getattr(sequence, f"{region}_mask")
    return features, valid


def _compare(reference, candidate, region, extractor, policy):
    ref_features, ref_mask = _features(reference, region, extractor)
    user_features, user_mask = _features(candidate, region, extractor)
    ref_quality = quality(ref_mask, reference.timestamps_ms)
    user_quality = quality(user_mask, candidate.timestamps_ms)
    result = {
        "status": "insufficient_data", "distance": None, "demo_score": None,
        "reference_quality": ref_quality, "candidate_quality": user_quality,
    }
    for item in (ref_quality, user_quality):
        if (item["total_frames"] < policy.min_valid_frames or
            item["valid_frames"] < policy.min_valid_frames or
            item["coverage_pct"] < policy.min_coverage * 100 or
            item["longest_missing_gap_seconds"] > policy.max_missing_gap_seconds):
            return result
    result["status"] = "ok"
    result["distance"] = dtw_distance(ref_features[ref_mask], user_features[user_mask])["distance"]
    return result


def evaluate_handshape(reference: EvaluationSequence, candidate: EvaluationSequence,
                       policy: QualityPolicy) -> dict:
    hands = {hand: _compare(reference, candidate, hand, calculate_angles, policy)
             for hand in ("left_hand", "right_hand")}
    return {"status": "ok" if all(x["status"] == "ok" for x in hands.values())
            else "partial" if any(x["status"] == "ok" for x in hands.values())
            else "insufficient_data", "distance": None, "demo_score": None, "hands": hands}


def evaluate_orientation(reference: EvaluationSequence, candidate: EvaluationSequence,
                         policy: QualityPolicy) -> dict:
    def extract(sequence, hand):
        features, valid = calculate_orientation(getattr(sequence, hand), sequence.width, sequence.height)
        return features, valid & getattr(sequence, f"{hand}_mask")
    hands = {}
    for hand in ("left_hand", "right_hand"):
        def feature_for(sequence, hand=hand):
            return extract(sequence, hand)
        ref_features, ref_mask = feature_for(reference)
        user_features, user_mask = feature_for(candidate)
        ref_q = quality(ref_mask, reference.timestamps_ms)
        user_q = quality(user_mask, candidate.timestamps_ms)
        enough = all(q["total_frames"] >= policy.min_valid_frames and
                     q["valid_frames"] >= policy.min_valid_frames and
                     q["coverage_pct"] >= policy.min_coverage * 100 and
                     q["longest_missing_gap_seconds"] <= policy.max_missing_gap_seconds
                     for q in (ref_q, user_q))
        hands[hand] = {"status": "ok" if enough else "insufficient_data",
                       "distance": dtw_distance(ref_features[ref_mask], user_features[user_mask])["distance"] if enough else None,
                       "demo_score": None, "reference_quality": ref_q, "candidate_quality": user_q}
    return {"status": "ok" if all(x["status"] == "ok" for x in hands.values())
            else "partial" if any(x["status"] == "ok" for x in hands.values())
            else "insufficient_data", "distance": None, "demo_score": None, "hands": hands}


def evaluate_motion_location(reference: EvaluationSequence, candidate: EvaluationSequence,
                             policy: QualityPolicy) -> tuple[dict, dict]:
    def trajectory(sequence):
        wrists = sequence.normalized["pose"][:, [15, 16], :2]
        valid = sequence.pose_mask & np.isfinite(wrists).all(axis=(1, 2))
        return wrists.reshape(len(wrists), 4), valid
    ref, ref_mask = trajectory(reference)
    user, user_mask = trajectory(candidate)
    ref_q = quality(ref_mask, reference.timestamps_ms)
    user_q = quality(user_mask, candidate.timestamps_ms)
    base = {"status": "insufficient_data", "distance": None, "demo_score": None,
            "reference_quality": ref_q, "candidate_quality": user_q}
    enough = all(q["total_frames"] >= policy.min_valid_frames and
                 q["valid_frames"] >= policy.min_valid_frames and
                 q["coverage_pct"] >= policy.min_coverage * 100 and
                 q["longest_missing_gap_seconds"] <= policy.max_missing_gap_seconds
                 for q in (ref_q, user_q))
    if not enough:
        return base.copy(), base.copy()
    ref_times = reference.timestamps_ms[ref_mask] / 1000
    user_times = candidate.timestamps_ms[user_mask] / 1000
    location = {**base, "status": "ok", "distance": dtw_distance(ref[ref_mask], user[user_mask])["distance"]}
    ref_velocity = extract_movement(ref[ref_mask], ref_times)
    user_velocity = extract_movement(user[user_mask], user_times)
    movement = {**base, "status": "ok", "distance": dtw_distance(ref_velocity, user_velocity)["distance"]}
    return location, movement


def evaluate_non_manual(reference: EvaluationSequence, candidate: EvaluationSequence,
                        policy: QualityPolicy) -> dict:
    return _compare(reference, candidate, "face", extract_facial_features, policy)


def evaluate_sequences(reference: EvaluationSequence, candidate: EvaluationSequence,
                       demo_mode: bool = False, policy: QualityPolicy = QualityPolicy()):
    handshape = evaluate_handshape(reference, candidate, policy)
    orientation = evaluate_orientation(reference, candidate, policy)
    location, movement = evaluate_motion_location(reference, candidate, policy)
    parameters = {"handshape": handshape, "orientation": orientation,
                  "location": location, "movement": movement,
                  "non_manual": evaluate_non_manual(reference, candidate, policy)}
    overall = {"status": "ok" if all(p["status"] == "ok" for p in parameters.values())
               else "partial" if any(p["status"] in ("ok", "partial") for p in parameters.values())
               else "insufficient_data", "demo_score": None}
    if demo_mode:
        with (BASE_DIR / "data/scoring/demo_thresholds.json").open(encoding="utf-8") as stream:
            scoring = json.load(stream)
        required = scoring["required_hands"]
        weighted = 0.0
        weight_sum = 0.0
        complete = True
        for name, result in parameters.items():
            if name in ("handshape", "orientation"):
                hands = [result["hands"][hand] for hand in required]
                if any(hand["status"] != "ok" for hand in hands):
                    complete = False
                    continue
                distance = float(np.mean([hand["distance"] for hand in hands]))
            else:
                if result["status"] != "ok":
                    complete = False
                    continue
                distance = result["distance"]
            config = scoring["parameters"][name]
            score = demo_distance_score(distance, config["good"], config["bad"])
            result["demo_score"] = score
            result["distance"] = round(distance, 6)
            weighted += score * config["weight"]
            weight_sum += config["weight"]
        if complete and weight_sum > 0:
            overall = {"status": "ok", "demo_score": round(weighted / weight_sum, 2)}
    return parameters, overall
