
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
