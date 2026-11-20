from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class RealtimeSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="VISENA_", extra="ignore")

    max_input_fps: float = Field(default=30, gt=0, le=120)
    max_frame_queue: int = Field(default=3, ge=1, le=32)
    evaluation_interval_ms: int = Field(default=250, ge=100, le=5000)
    buffer_seconds: float = Field(default=6, gt=0, le=30)
    max_frame_bytes: int = Field(default=1_000_000, ge=1024, le=20_000_000)
    max_width: int = Field(default=1920, ge=1)
    max_height: int = Field(default=1080, ge=1)
    demo_mode: bool = False
    min_hand_landmarks_confidence: float = Field(default=0.5, ge=0, le=1)
    min_coverage: float = Field(default=0.70, ge=0, le=1)
    max_missing_gap_seconds: float = Field(default=0.35, ge=0)
    heartbeat_seconds: float = Field(default=15, gt=0)
    groq_feedback_enabled: bool = True
    groq_model: str = "openai/gpt-oss-120b"
    groq_timeout_seconds: float = Field(default=12, gt=0, le=60)
    allowed_origins: str = (
        "http://localhost:8000,http://127.0.0.1:8000,"
        "http://localhost:5500,http://127.0.0.1:5500"
    )

