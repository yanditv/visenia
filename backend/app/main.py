
import tempfile
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile, File

from app.services.video_processor import process_video


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
