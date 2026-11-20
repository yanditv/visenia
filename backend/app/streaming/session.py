from collections import deque
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from time import monotonic
from uuid import uuid4
import asyncio

from app.services.evaluation_sequence import from_frames
from app.services.realtime_evaluation import quality


@dataclass
class StreamingSession:
    reference_id: str | None
    settings: object
    target_gloss: str | None = None
    practice_hand: str = "either"
    session_id: str = field(default_factory=lambda: str(uuid4()))
    created_at: float = field(default_factory=monotonic)
    last_frame_at: float | None = None
    frame_count: int = 0
    frames_received: int = 0
    frames_processed: int = 0
    frames_dropped: int = 0
    processing_latency_ms: float = 0.0
    evaluation_latency_ms: float = 0.0
    last_received_timestamp: int | None = None
    last_received_sequence: int | None = None
    last_processed_timestamp: int | None = None
    last_evaluation_timestamp: int | None = None
    last_frame_sequence: int | None = None
    width: int = 0
    height: int = 0
    active: bool = False
    generation: int = 0
    landmark_buffer: deque = field(init=False)
    frame_queue: asyncio.Queue = field(init=False)
    executor: ThreadPoolExecutor = field(init=False)

    def __post_init__(self):
        self.landmark_buffer = deque(maxlen=int(self.settings.buffer_seconds * self.settings.max_input_fps) + 1)
        self.frame_queue = asyncio.Queue(maxsize=self.settings.max_frame_queue)
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="visena-session")

    def clear_execution(self):
        self.generation += 1
        self.landmark_buffer.clear()
        while not self.frame_queue.empty():
            self.frame_queue.get_nowait()
            self.frame_queue.task_done()
        self.frame_count = 0
        self.frames_received = 0
        self.frames_processed = 0
        self.frames_dropped = 0
        self.last_evaluation_timestamp = None
        self.last_processed_timestamp = None
        self.last_frame_sequence = None
        self.last_frame_at = None
        self.processing_latency_ms = 0.0
        self.evaluation_latency_ms = 0.0
        self.width = self.height = 0

    def enqueue(self, item):
        if self.frame_queue.full():
            self.frame_queue.get_nowait()
            self.frame_queue.task_done()
            self.frames_dropped += 1
        self.frame_queue.put_nowait(item)

    def append(self, timestamp_ms, sequence, width, height, regions):
        self.width, self.height = width, height
        self.landmark_buffer.append((timestamp_ms, regions))
        while (self.landmark_buffer and
               timestamp_ms - self.landmark_buffer[0][0] > self.settings.buffer_seconds * 1000):
            self.landmark_buffer.popleft()
        self.frame_count += 1
        self.frames_processed += 1
        self.last_frame_at = monotonic()
        self.last_processed_timestamp = timestamp_ms
        self.last_frame_sequence = sequence

    def candidate(self):
        if not self.landmark_buffer:
            return None
        return from_frames(list(self.landmark_buffer), self.width, self.height)

    def quality(self):
        candidate = self.candidate()
        result = {"frames_received": self.frames_received,
                  "frames_processed": self.frames_processed,
                  "frames_dropped": self.frames_dropped,
                  "window_frames": len(candidate.timestamps_ms) if candidate else 0,
                  "processing_latency_ms": round(self.processing_latency_ms, 2),
                  "evaluation_latency_ms": round(self.evaluation_latency_ms, 2)}
        for name in ("left_hand", "right_hand", "pose", "face"):
            mask = getattr(candidate, f"{name}_mask") if candidate else []
            metrics = quality(mask, candidate.timestamps_ms) if candidate else None
            result[f"{name}_coverage_pct"] = metrics["coverage_pct"] if metrics else 0.0
            result[f"{name}_longest_missing_gap_seconds"] = (
                metrics["longest_missing_gap_seconds"] if metrics else 0.0)
        return result
