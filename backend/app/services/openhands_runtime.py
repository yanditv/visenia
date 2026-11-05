
import json
import logging
import os
import subprocess
from pathlib import Path
from uuid import UUID


logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parents[2]

PYTHON_PATH = (
    BASE_DIR
    / ".venv-openhands"
    / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
)

INFERENCE_SCRIPT = BASE_DIR / "infer_openhands.py"


class InferenceError(Exception):
    pass


def run_inference(processing_id: str) -> dict:
    uid = UUID(processing_id).hex

    if not PYTHON_PATH.is_file():
        raise InferenceError(
            "No se encuentra el entorno de OpenHands."
        )

    if not INFERENCE_SCRIPT.is_file():
        raise InferenceError(
            "No se encuentra infer_openhands.py."
        )

    try:
        result = subprocess.run(
            [
                str(PYTHON_PATH),
                str(INFERENCE_SCRIPT),
                uid
            ],
            cwd=str(BASE_DIR),
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=180,
            check=False
        )

    except subprocess.TimeoutExpired as error:
        raise InferenceError(
            "La inferencia supero el tiempo permitido."
        ) from error

    except OSError as error:
        raise InferenceError(
            "No se pudo iniciar OpenHands."
        ) from error

    if result.returncode != 0:
        logger.error(
            "Error de OpenHands: %s",
            result.stderr
        )

        raise InferenceError(
            "Fallo la ejecucion del modelo."
        )

    try:
        prediction = json.loads(result.stdout)

    except json.JSONDecodeError as error:
        logger.error(
            "Respuesta invalida: %s",
            result.stdout[:1000]
        )

        raise InferenceError(
            "OpenHands devolvio una respuesta invalida."
        ) from error

    if (
        prediction.get("status") != "success"
        or not isinstance(prediction.get("predictions"), list)
    ):
        raise InferenceError(
            "La respuesta del modelo esta incompleta."
        )

    return prediction
