
from uuid import UUID

from pydantic import (
    BaseModel,
    Field,
    model_validator
)


class ScoringDemoRequest(BaseModel):
    reference_id: UUID
    candidate_id: UUID

    ref_start: float = Field(
        ge=0,
        allow_inf_nan=False
    )

    ref_end: float = Field(
        gt=0,
        allow_inf_nan=False
    )

    user_start: float = Field(
        ge=0,
        allow_inf_nan=False
    )

    user_end: float = Field(
        gt=0,
        allow_inf_nan=False
    )

    @model_validator(mode="after")
    def validate_intervals(self):
        if self.ref_start >= self.ref_end:
            raise ValueError(
                "Intervalo de referencia invalido."
            )

        if self.user_start >= self.user_end:
            raise ValueError(
                "Intervalo del usuario invalido."
            )

        return self
