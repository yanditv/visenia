
import math
from pathlib import Path

import cv2
import mediapipe as mp

from app.services.landmark_extractor import (
    create_landmarker,
    get_wrist_coordinates,
)


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

        effective_fps = fps or 30.0
        frame_interval = max(1, round(effective_fps / 5))

        frames_processed = 0
        frames_sampled = 0

        width = 0
        height = 0

        left_hand_frames = 0
        right_hand_frames = 0
        pose_frames = 0
        face_frames = 0

        wrist_sample = None

        with create_landmarker() as landmarker:
            while True:
                success, frame = capture.read()

                if not success:
                    break

                frames_processed += 1

                if frames_processed == 1:
                    height, width = frame.shape[:2]

                if (frames_processed - 1) % frame_interval != 0:
                    continue

                frames_sampled += 1

                rgb_frame = cv2.cvtColor(
                    frame, cv2.COLOR_BGR2RGB
                )

                mp_image = mp.Image(
                    image_format=mp.ImageFormat.SRGB,
                    data=rgb_frame
                )

                timestamp_ms = round(
                    (frames_processed - 1)
                    * 1000 / effective_fps
                )

                result = landmarker.detect_for_video(
                    mp_image,
                    timestamp_ms
                )

                if result.left_hand_landmarks:
                    left_hand_frames += 1

                if result.right_hand_landmarks:
                    right_hand_frames += 1

                if result.pose_landmarks:
                    pose_frames += 1

                if result.face_landmarks:
                    face_frames += 1

                if wrist_sample is None and (
                    result.left_hand_landmarks
                    or result.right_hand_landmarks
                ):
                    wrist_sample = {
                        "timestamp_ms": timestamp_ms,
                        "left_wrist": get_wrist_coordinates(
                            result.left_hand_landmarks
                        ),
                        "right_wrist": get_wrist_coordinates(
                            result.right_hand_landmarks
                        ),
                    }

        if frames_processed == 0:
            raise ValueError(
                "El video no contiene fotogramas decodificables."
            )

        return {
            "fps": round(fps, 2) if fps else None,
            "duration_seconds": (
                round(frames_processed / fps, 2)
                if fps else None
            ),
            "frames_processed": frames_processed,
            "frames_sampled": frames_sampled,
            "resolution": {
                "width": width,
                "height": height,
            },
            "landmarks": {
                "left_hand_frames": left_hand_frames,
                "right_hand_frames": right_hand_frames,
                "pose_frames": pose_frames,
                "face_frames": face_frames,
                "wrist_sample": wrist_sample,
            }
        }

    finally:
        capture.release()
