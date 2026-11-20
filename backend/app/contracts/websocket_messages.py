from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class StrictMessage(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    protocol_version: Literal["1.0"]


class CaptureInfo(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    fps: float = Field(gt=0)
    frame_encoding: Literal["jpeg"]


class SessionStart(StrictMessage):
    type: Literal["session.start"]
    reference_id: UUID
    demo_mode: bool
    capture: CaptureInfo


class ASLSessionStart(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    type: Literal["session.start"]
    protocol_version: Literal["2.0"]
    target_gloss: str = Field(min_length=1, max_length=80)
    practice_hand: Literal["left", "right", "either"] = "either"
    capture: CaptureInfo


class ASLControl(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    type: Literal["evaluation.begin", "evaluation.end", "evaluation.reset",
                  "session.stop", "session.pong"]
    protocol_version: Literal["2.0"]


class Control(StrictMessage):
    type: Literal["evaluation.begin", "evaluation.end", "evaluation.reset",
                  "session.stop", "session.pong"]


def error_message(code: str, message: str, recoverable: bool, session_id=None):
    result = {"type": "error", "protocol_version": "1.0", "code": code,
              "message": message, "recoverable": recoverable}
    if session_id:
        result["session_id"] = session_id
    return result
