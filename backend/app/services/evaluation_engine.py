
import argparse
import json
import math
from uuid import UUID

from app.services.motion_location_evaluator import (
    evaluate as evaluate_motion_location
)

from app.services.handshape_evaluator import (
    evaluate_handshape
)

from app.services.orientation_evaluator import (
    evaluate_orientation
)

from app.services.non_manual_evaluator import (
    evaluate_non_manual
)


def validate_interval(start, end):
    for value in (start, end):
        if value is not None and not math.isfinite(value):
            raise ValueError("Intervalo no finito.")

    if (
        start is not None
        and end is not None
        and start >= end
    ):
        raise ValueError(
            "El inicio debe ser menor que el fin."
        )


def evaluate_sign(
    reference_id: str,
    candidate_id: str,
    ref_start=None,
    ref_end=None,
    user_start=None,
    user_end=None
):
    reference_id = UUID(reference_id).hex
    candidate_id = UUID(candidate_id).hex

    validate_interval(ref_start, ref_end)
    validate_interval(user_start, user_end)

    args = (
        reference_id,
        candidate_id,
        ref_start,
        ref_end,
        user_start,
        user_end
    )

    # 1. Configuracion manual
    handshape = evaluate_handshape(*args)

    # 2. Orientacion
    orientation = evaluate_orientation(*args)

    # 3 y 4. Ubicacion y movimiento
    motion_location = evaluate_motion_location(*args)

    # 5. Componentes no manuales
    non_manual = evaluate_non_manual(*args)

    location = motion_location["evaluation"]["location"]
    movement = motion_location["evaluation"]["movement"]

    parameters = {
        "handshape": {
            "status": handshape["status"],
            "hands": handshape["evaluation"]
        },
        "orientation": {
            "status": orientation["status"],
            "hands": orientation["evaluation"]
        },
        "location": {
            "status": "ok",
            **location
        },
        "movement": {
            "status": "ok",
            **movement
        },
        "non_manual": non_manual
    }

    complete = [
        name
        for name, result in parameters.items()
        if result["status"] in ("ok", "success")
    ]

    partial = [
        name
        for name, result in parameters.items()
        if result["status"] == "partial"
    ]

    insufficient = [
        name
        for name, result in parameters.items()
        if result["status"] == "insufficient_data"
    ]

    if insufficient or partial:
        overall_status = "partial"
    else:
        overall_status = "success"

    return {
        "status": overall_status,
        "reference_id": reference_id,
        "candidate_id": candidate_id,
        "algorithm": "DTW",
        "evaluation": parameters,
        "summary": {
            "total_parameters": 5,
            "complete": len(complete),
            "partial": len(partial),
            "insufficient": len(insufficient),
            "complete_parameters": complete,
            "partial_parameters": partial,
            "insufficient_parameters": insufficient
        },
        "score": None,
        "feedback": None,
        "calibration_status": "pending"
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

    result = evaluate_sign(
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
