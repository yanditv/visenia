
import tempfile
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile, File

from app.services.video_processor import process_video

from uuid import UUID
from fastapi.responses import FileResponse
from app.services.video_processor import PROCESSED_DIR


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

