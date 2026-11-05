
import math
from pathlib import Path

import cv2


def process_video(video_path: Path) -> dict:
    capture = cv2.VideoCapture(str(video_path))

    if not capture.isOpened():
        raise ValueError("No se pudo abrir el video.")

    try:
        raw_fps = capture.get(cv2.CAP_PROP_FPS)
        fps = (
            raw_fps
            if math.isfinite(raw_fps) and raw_fps > 0
            else None
        )

        frames_processed = 0
        frames_sampled = 0
        width = 0
        height = 0

        # Muestreo aproximado a 5 FPS
        frame_interval = (
            max(1, round(fps / 5))
            if fps is not None
            else 1
        )

        while True:
            success, frame = capture.read()

            if not success:
                break

            frames_processed += 1

            if frames_processed == 1:
                height, width = frame.shape[:2]

            if (frames_processed - 1) % frame_interval == 0:
                frames_sampled += 1
                # Aquí integraremos MediaPipe después.

        if frames_processed == 0:
            raise ValueError(
                "El video no contiene fotogramas decodificables."
            )

        duration = (
            round(frames_processed / fps, 2)
            if fps is not None
            else None
        )

        return {
            "fps": round(fps, 2) if fps else None,
            "duration_seconds": duration,
            "frames_processed": frames_processed,
            "frames_sampled": frames_sampled,
            "resolution": {
                "width": width,
                "height": height
            }
        }

    finally:
        capture.release()
