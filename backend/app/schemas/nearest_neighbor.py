
from uuid import UUID

from pydantic import (
    BaseModel,
    Field,
    model_validator
)


class NearestNeighborRequest(BaseModel):
    candidate_id: UUID

    gloss: str = Field(
        min_length=1,
        max_length=100
    )

    user_start: float = Field(
        ge=0,
        allow_inf_nan=False
    )

    user_end: float = Field(
        gt=0,
        allow_inf_nan=False
    )

    k: int = Field(
        default=3,
        ge=1,
        le=10
    )

    demo_mode: bool = False

    @model_validator(mode="after")
    def validate_interval(self):
        if self.user_start >= self.user_end:
            raise ValueError(
                "user_start debe ser menor que user_end."
            )

        return self
