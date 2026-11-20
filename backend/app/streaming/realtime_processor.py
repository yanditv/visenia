import cv2
import mediapipe as mp

from app.services.evaluation_sequence import REGIONS
from app.services.landmark_extractor import create_landmarker, landmarks_to_numpy
from app.streaming.frame_decoder import decode_jpeg


class RealtimeProcessor:
    """A private VIDEO-mode landmarker, called serially on one session executor."""

    def __init__(self, settings):
        self.settings = settings
        self.landmarker = create_landmarker(settings.min_hand_landmarks_confidence)

    def process(self, jpeg: bytes, timestamp_ms: int):
        bgr = decode_jpeg(jpeg, self.settings.max_width, self.settings.max_height)
        height, width = bgr.shape[:2]
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        result = self.landmarker.detect_for_video(
            mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), timestamp_ms)
        regions = {name: landmarks_to_numpy(getattr(result, f"{name}_landmarks"), count)
                   for name, count in REGIONS.items()}
        return width, height, regions

    def close(self):
        self.landmarker.close()
