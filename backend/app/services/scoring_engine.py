
import argparse
import json
import math
from pathlib import Path

from app.services.evaluation_engine import evaluate_sign


BASE_DIR = Path(__file__).resolve().parents[2]

POLICY_PATH = (
    BASE_DIR / "data/scoring/demo_thresholds.json"
)

PARAMETERS = (
    "handshape",
    "orientation",
    "location",
    "movement",
    "non_manual"
)


def demo_distance_score(distance, good, bad):
    if not (
        all(math.isfinite(v) for v in (distance, good, bad))
        and 0 <= good < bad
        and distance >= 0
    ):
        raise ValueError("Distancia o umbrales invalidos.")

    if distance <= good:
        return 100.0

    if distance >= bad:
        return 0.0

    return round(
        100 * (bad - distance) / (bad - good),
        2
    )


def get_distance(parameter_name, result, required_hands):
    if parameter_name in ("handshape", "orientation"):
        hands = result["hands"]
        distances = []
        problems = []

        for hand_name in required_hands:
            hand = hands[hand_name]

            if (
                hand["status"] == "ok"
                and hand["distance"] is not None
            ):
                distances.append(float(hand["distance"]))
            else:
                reference_coverage = hand[
                    "reference_quality"
                ]["coverage_pct"]

                candidate_coverage = hand[
                    "candidate_quality"
                ]["coverage_pct"]

                problems.append(
                    f"{hand_name}: deteccion insuficiente "
                    f"(referencia {reference_coverage}%, "
                    f"usuario {candidate_coverage}%)."
                )

        if problems:
            return None, problems

        if not distances:
            return None, ["No hay manos evaluables."]

        return sum(distances) / len(distances), []

    if result["status"] not in ("ok", "success"):
        return None, ["Parametro no evaluable."]

    distance = result.get("distance")

    if distance is None:
        return None, ["No existe distancia DTW."]

    return float(distance), []


def score_evaluation(evaluation):
    with POLICY_PATH.open("r", encoding="utf-8") as file:
        policy = json.load(file)

    if policy.get("calibration_status") != "demo_only":
        raise ValueError("Politica de demostracion invalida.")

    required_hands = policy["required_hands"]

    if (
        not required_hands
        or len(set(required_hands)) != len(required_hands)
        or any(
            hand not in ("left_hand", "right_hand")
            for hand in required_hands
        )
    ):
        raise ValueError("Configuracion de manos invalida.")

    results = {}
    feedback = []
    weighted_sum = 0.0
    total_weight = 0.0
    complete = True

    for name in PARAMETERS:
        config = policy["parameters"][name]
        parameter = evaluation["evaluation"][name]

        good = float(config["good"])
        bad = float(config["bad"])
        weight = float(config["weight"])

        if not (
            math.isfinite(weight)
            and weight > 0
        ):
            raise ValueError("Ponderacion invalida.")

        distance, problems = get_distance(
            name,
            parameter,
            required_hands
        )

        if problems:
            complete = False

            results[name] = {
                "status": "insufficient_data",
                "distance": None,
                "demo_score": None
            }

            for problem in problems:
                feedback.append({
                    "parameter": name,
                    "type": "capture_quality",
                    "message": problem
                })

            continue

        score = demo_distance_score(
            distance, good, bad
        )

        results[name] = {
            "status": "experimental",
            "distance": round(distance, 6),
            "demo_score": score,
            "thresholds": {
                "good": good,
                "bad": bad
            }
        }

        weighted_sum += score * weight
        total_weight += weight

        if distance > good:
            feedback.append({
                "parameter": name,
                "type": "experimental_difference",
                "message": (
                    f"La distancia de {name} supera "
                    "el umbral bajo de demostracion. "
                    "Esto no demuestra un error LSEC."
                )
            })

    # No producir una puntuacion global parcial.
    demo_overall = None

    if complete and total_weight > 0:
        demo_overall = round(
            weighted_sum / total_weight,
            2
        )

    return {
        "status": (
            "experimental" if complete else "partial"
        ),
        "calibration_status": "demo_only",
        "parameters": results,
        "demo_overall_score": demo_overall,
        "score": None,
        "feedback": feedback,
        "message": (
            "Resultados matematicos de demostracion. "
            "No constituyen una evaluacion validada de LSEC."
        )
    }


def run(
    reference_id,
    candidate_id,
    ref_start,
    ref_end,
    user_start,
    user_end
):
    evaluation = evaluate_sign(
        reference_id,
        candidate_id,
        ref_start,
        ref_end,
        user_start,
        user_end
    )

    result = score_evaluation(evaluation)

    return {
        "reference_id": reference_id,
        "candidate_id": candidate_id,
        "evaluation_status": evaluation["status"],
        **result
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

    result = run(
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
        ensure_ascii=False,
        allow_nan=False
    ))
