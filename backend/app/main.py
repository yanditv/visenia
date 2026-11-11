
import tempfile
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile, File

from app.services.video_processor import process_video

from uuid import UUID
from fastapi.responses import FileResponse
from app.services.video_processor import PROCESSED_DIR

import logging

from app.services.openhands_adapter import adapt_for_openhands
from app.services.openhands_runtime import (
    run_inference,
    InferenceError
)

from app.schemas.evaluation import EvaluationRequest

from app.services.evaluation_engine import evaluate_sign

import os
import json
import logging

from app.schemas.nearest_neighbor import (
    NearestNeighborRequest
)

from app.services.nearest_neighbor import (
    find_nearest
)

from app.schemas.scoring import ScoringDemoRequest

from app.services.scoring_engine import (
    run as run_scoring
)

app = FastAPI(
    title="VISENA API",
    description="Reconocimiento y evaluación de señas LSEC",
    version="0.1.0"
)

ALLOWED_EXTENSIONS = {".mp4", ".avi", ".mov", ".webm"}
MAX_VIDEO_SIZE = 30 * 1024 * 1024 


@app.get("/api/v1/health", tags=["Health"])
def health_check():
    return {
        "status": "ok",
        "service": "visena-backend",
        "version": "0.1.0"
    }


@app.post("/api/v1/videos/process", tags=["Videos"])
def upload_video(file: UploadFile = File(...)):
    extension = Path(file.filename or "").suffix.lower()

    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="Formato de video no permitido."
        )

    temp_path = None

    try:
        with tempfile.NamedTemporaryFile(
            delete=False,
            suffix=extension
        ) as temp:
            temp_path = Path(temp.name)
            total_size = 0

            while chunk := file.file.read(1024 * 1024):
                total_size += len(chunk)

                if total_size > MAX_VIDEO_SIZE:
                    raise HTTPException(
                        status_code=413,
                        detail="El video supera los 30 MB."
                    )

                temp.write(chunk)

        result = process_video(temp_path)

        return {
            "status": "success",
            "filename": Path(file.filename or "").name,
            "video": result
        }

    except ValueError as error:
        raise HTTPException(
            status_code=422,
            detail=str(error)
        ) from error

    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)


@app.get(
    "/api/v1/videos/landmarks/{processing_id}",
    tags=["Videos"]
)
def download_landmarks(processing_id: UUID):
    file_path = (
        PROCESSED_DIR / f"{processing_id.hex}.npz"
    )

    if not file_path.is_file():
        raise HTTPException(
            status_code=404,
            detail="Archivo de landmarks no encontrado."
        )

    return FileResponse(
        path=file_path,
        filename=f"visena-{processing_id.hex}.npz",
        media_type="application/octet-stream"
    )


logger = logging.getLogger(__name__)


@app.post("/api/v1/recognitions", tags=["Recognition"])
def recognize_sign(file: UploadFile = File(...)):
    extension = Path(file.filename or "").suffix.lower()

    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="Formato de video no permitido."
        )

    temp_path = None

    try:
        # 1. Guardar temporalmente el video
        with tempfile.NamedTemporaryFile(
            delete=False,
            suffix=extension
        ) as temp:

            temp_path = Path(temp.name)
            total_size = 0

            while chunk := file.file.read(1024 * 1024):
                total_size += len(chunk)

                if total_size > MAX_VIDEO_SIZE:
                    raise HTTPException(
                        status_code=413,
                        detail="El video supera los 30 MB."
                    )

                temp.write(chunk)

        # 2. OpenCV + MediaPipe
        video_result = process_video(temp_path)

        processing_id = video_result[
            "landmark_export"
        ]["id"]

        # 3. Adaptar landmarks a OpenHands
        adaptation = adapt_for_openhands(
            processing_id
        )

        # 4. Ejecutar inferencia en GPU
        recognition = run_inference(
            processing_id
        )

        # 5. Construir respuesta
        return {
            "status": "success",
            "processing_id": processing_id,
            "model": "OpenHands BiLSTM",
            "dataset": "WLASL2000",
            "recognition_status": "experimental",
            "video": {
                "duration_seconds": video_result[
                    "duration_seconds"
                ],
                "frames_sampled": video_result[
                    "frames_sampled"
                ]
            },
            "adaptation": {
                "output_shape": adaptation[
                    "output_shape"
                ],
                "detected_landmarks_pct": adaptation[
                    "detected_landmarks_pct"
                ]
            },
            "recognition": recognition,
            "evaluation": None
        }

    except HTTPException:
        raise

    except ValueError as error:
        raise HTTPException(
            status_code=422,
            detail=str(error)
        ) from error

    except FileNotFoundError as error:
        logger.exception("Archivo requerido no encontrado")

        raise HTTPException(
            status_code=500,
            detail="Falta un archivo de procesamiento."
        ) from error

    except InferenceError as error:
        logger.exception("Error durante la inferencia")

        raise HTTPException(
            status_code=502,
            detail=str(error)
        ) from error

    finally:
        file.file.close()

        if temp_path is not None:
            temp_path.unlink(missing_ok=True)


@app.post(
    "/api/v1/evaluations",
    tags=["Evaluation"]
)
def evaluate_video(request: EvaluationRequest):

    try:
        result = evaluate_sign(
            reference_id=str(request.reference_id),
            candidate_id=str(request.candidate_id),
            ref_start=request.ref_start,
            ref_end=request.ref_end,
            user_start=request.user_start,
            user_end=request.user_end
        )

        return result

    except FileNotFoundError as error:
        raise HTTPException(
            status_code=404,
            detail=(
                "No se encontraron los landmarks "
                "preprocesados de uno de los videos."
            )
        ) from error

    except ValueError as error:
        raise HTTPException(
            status_code=422,
            detail=str(error)
        ) from error


@app.post(
    "/api/v1/evaluations/nearest",
    tags=["Evaluation"]
)
def find_nearest_reference(
    request: NearestNeighborRequest
):
    # El modo demo solo debe habilitarse
    # expresamente en desarrollo local.
    if request.demo_mode and (
        os.getenv("VISENA_ENABLE_DEMO") != "1"
    ):
        raise HTTPException(
            status_code=403,
            detail="Modo demostracion deshabilitado."
        )

    try:
        result = find_nearest(
            candidate_id=str(request.candidate_id),
            gloss=request.gloss,
            user_start=request.user_start,
            user_end=request.user_end,
            k=request.k,
            demo_mode=request.demo_mode
        )

        return result

    except ValueError as error:
        raise HTTPException(
            status_code=422,
            detail=str(error)
        ) from error

    except (
        FileNotFoundError,
        json.JSONDecodeError,
        KeyError
    ) as error:
        logging.exception(
            "Error al leer referencias VISENA"
        )

        raise HTTPException(
            status_code=500,
            detail="No se pudo consultar el catalogo."
        ) from error


@app.post(
    "/api/v1/evaluations/demo-score",
    tags=["Evaluation"]
)
def evaluate_demo_score(
    request: ScoringDemoRequest
):

    # No permitir demostraciones sin habilitacion local.
    if os.getenv("VISENA_ENABLE_DEMO") != "1":
        raise HTTPException(
            status_code=403,
            detail="Modo demostracion deshabilitado."
        )

    try:
        result = run_scoring(
            reference_id=str(request.reference_id),
            candidate_id=str(request.candidate_id),
            ref_start=request.ref_start,
            ref_end=request.ref_end,
            user_start=request.user_start,
            user_end=request.user_end
        )

        return result

    except FileNotFoundError as error:
        raise HTTPException(
            status_code=404,
            detail=(
                "No se encontraron los archivos "
                "necesarios para la evaluacion."
            )
        ) from error

    except ValueError as error:
        raise HTTPException(
            status_code=422,
            detail=str(error)
        ) from error
