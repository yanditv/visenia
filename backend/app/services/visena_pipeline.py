
from pathlib import Path
from uuid import UUID

from app.services.video_processor import (
    process_video,
    PROCESSED_DIR
)

from app.services.sequence_preprocessor import preprocess

from app.services.openhands_adapter import adapt_for_openhands

from app.services.openhands_runtime import run_inference

from app.services.nearest_neighbor import find_nearest

from app.services.evaluation_engine import evaluate_sign

from app.services.scoring_engine import score_evaluation


BASE_DIR = Path(__file__).resolve().parents[2]


def analyze_video(
    video_path: Path,
    reference_id: str | None = None,
    gloss: str | None = None,
    demo_mode: bool = False,
    ref_start: float | None = None,
    ref_end: float | None = None,
    user_start: float = 0.0,
    user_end: float | None = None
):
    # 1. Extraer landmarks con OpenCV y MediaPipe
    video = process_video(video_path)

    processing_id = video["landmark_export"]["id"]

    # 2. Generar representacion normalizada para DTW
    source = PROCESSED_DIR / f"{processing_id}.npz"

    destination = (
        BASE_DIR
        / "data"
        / "preprocessed"
        / f"{processing_id}.npz"
    )

    preprocessing = preprocess(
        source,
        destination
    )

    # 3. Preparar entrada para OpenHands
    adaptation = adapt_for_openhands(
        processing_id
    )

    # 4. Ejecutar inferencia en GPU
    recognition = run_inference(
        processing_id
    )

    # 5. Preparar resultados
    nearest = None
    evaluation = None
    scoring = None

    selected_reference = reference_id
    selection_method = None

    warnings = [
        "Reconocimiento ASL experimental; "
        "no validado para LSEC."
    ]

    # 6. Buscar referencia por vecino mas cercano
    if selected_reference is None and gloss:
        nearest = find_nearest(
            candidate_id=processing_id,
            gloss=gloss,
            user_start=user_start,
            user_end=(
                user_end
                if user_end is not None
                else video["duration_seconds"]
            ),
            k=3,
            demo_mode=demo_mode
        )

        best_match = nearest["best_match"]

        if best_match is not None:
            selected_reference = best_match["reference_id"]
            ref_start = best_match["ref_start"]
            ref_end = best_match["ref_end"]
            selection_method = "nearest_neighbor"
        else:
            warnings.append(
                "No existen referencias comparables "
                "para la glosa indicada."
            )

    elif selected_reference is not None:
        selection_method = "explicit_reference"

    # 7. Evaluar si existe una referencia seleccionada
    if selected_reference is not None:
        selected_reference = UUID(
            selected_reference
        ).hex

        if selected_reference == processing_id:
            raise ValueError(
                "Un video no puede ser su propia referencia."
            )

        evaluation = evaluate_sign(
            reference_id=selected_reference,
            candidate_id=processing_id,
            ref_start=ref_start,
            ref_end=ref_end,
            user_start=user_start,
            user_end=user_end
        )

        # 8. Puntuacion exclusiva de demostracion
        if demo_mode:
            scoring = score_evaluation(
                evaluation
            )
        else:
            warnings.append(
                "Puntuacion no disponible: "
                "se requieren umbrales LSEC calibrados."
            )

    return {
        "status": "success",
        "processing_id": processing_id,
        "recognition_status": "experimental",
        "calibration_status": (
            "demo_only" if scoring is not None
            else "pending"
        ),
        "video": {
            "duration_seconds": video["duration_seconds"],
            "frames_sampled": video["frames_sampled"],
            "landmarks": video["landmarks"]
        },
        "preprocessing": preprocessing,
        "adaptation": adaptation,
        "recognition": recognition,
        "reference_selection": {
            "method": selection_method,
            "reference_id": selected_reference
        },
        "nearest_neighbor": nearest,
        "evaluation": evaluation,
        "scoring": scoring,
        "warnings": warnings
    }
