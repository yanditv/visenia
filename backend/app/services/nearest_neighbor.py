
import argparse
import json
import math
from pathlib import Path
from uuid import UUID

from app.services.evaluation_engine import evaluate_sign


BASE_DIR = Path(__file__).resolve().parents[2]

CATALOG_PATH = (
    BASE_DIR / "data" / "references" / "catalog.json"
)


def find_nearest(
    candidate_id: str,
    gloss: str,
    user_start: float,
    user_end: float,
    k: int = 3,
    demo_mode: bool = False
):
    candidate_id = UUID(candidate_id).hex

    if (
        not math.isfinite(user_start)
        or not math.isfinite(user_end)
        or user_start < 0
        or user_start >= user_end
    ):
        raise ValueError("Intervalo del usuario invalido.")

    if not 1 <= k <= 10:
        raise ValueError("k debe estar entre 1 y 10.")

    with CATALOG_PATH.open(
        "r", encoding="utf-8"
    ) as file:
        catalog = json.load(file)

    references = catalog["references"]

    matches = []
    rejected = []

    for reference in references:
        if reference["gloss"] != gloss:
            continue

        verified = reference.get(
            "verified_lsec"
        ) is True

        if not verified and not demo_mode:
            continue

        reference_id = UUID(
            reference["reference_id"]
        ).hex

        # No comparar un video consigo mismo.
        if reference_id == candidate_id:
            continue

        ref_start = float(reference["start"])
        ref_end = float(reference["end"])

        try:
            result = evaluate_sign(
                reference_id=reference_id,
                candidate_id=candidate_id,
                ref_start=ref_start,
                ref_end=ref_end,
                user_start=user_start,
                user_end=user_end
            )

            movement = result[
                "evaluation"
            ]["movement"]

            distance = movement["distance"]

            if (
                movement["status"] != "ok"
                or distance is None
                or not math.isfinite(distance)
            ):
                raise ValueError(
                    "Movimiento no comparable."
                )

            matches.append({
                "reference_id": reference_id,
                "distance": float(distance),
                "verified_lsec": verified,
                "evaluation_status": result["status"],
                "summary": result["summary"]
            })

        except (ValueError, FileNotFoundError) as error:
            rejected.append({
                "reference_id": reference_id,
                "reason": str(error)
            })

    # Menor distancia DTW = vecino mas cercano.
    matches.sort(
        key=lambda item: item["distance"]
    )

    nearest = matches[:k]

    for rank, match in enumerate(nearest, 1):
        match["rank"] = rank

    return {
        "status": (
            "experimental" if nearest
            else "no_comparable_references"
        ),
        "candidate_id": candidate_id,
        "gloss": gloss,
        "algorithm": "nearest_neighbor_dtw",
        "ranking_parameter": "movement",
        "demo_mode": demo_mode,
        "references_compared": len(matches),
        "best_match": nearest[0] if nearest else None,
        "neighbors": nearest,
        "rejected_references": rejected,
        "score": None,
        "feedback": None
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()

    parser.add_argument("candidate_id")
    parser.add_argument("gloss")

    parser.add_argument(
        "--user-start",
        type=float,
        required=True
    )

    parser.add_argument(
        "--user-end",
        type=float,
        required=True
    )

    parser.add_argument(
        "--k",
        type=int,
        default=3
    )

    parser.add_argument(
        "--demo",
        action="store_true"
    )

    args = parser.parse_args()

    result = find_nearest(
        candidate_id=args.candidate_id,
        gloss=args.gloss,
        user_start=args.user_start,
        user_end=args.user_end,
        k=args.k,
        demo_mode=args.demo
    )

    print(json.dumps(
        result,
        indent=2,
        ensure_ascii=False,
        allow_nan=False
    ))
