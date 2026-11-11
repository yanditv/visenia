
from uuid import UUID

from pydantic import BaseModel, Field


class EvaluationRequest(BaseModel):
    reference_id: UUID
    candidate_id: UUID

    ref_start: float | None = Field(
        default=None,
        ge=0
    )

    ref_end: float | None = Field(
        default=None,
        ge=0
    )

    user_start: float | None = Field(
        default=None,
        ge=0
    )

    user_end: float | None = Field(
        default=None,
        ge=0
    )
