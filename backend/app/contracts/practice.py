from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field

from app.contracts.lsec import Attempt, ContractModel, Evaluation, Number, Recognition, ReferenceId


class PracticeAttempt(Attempt):
    id_intento: UUID = Field(strict=False)
    id_referencia: ReferenceId | None = None
    segmentar: bool = True


class CaptureSummary(ContractModel):
    ancho: int
    alto: int
    total_frames: int
    duracion_ms: Number
    mano_practica: Literal["izquierda", "derecha"] | None
    modo: Literal["practica_libre", "investigacion_pin", "kiosco"]


class PracticeRecord(ContractModel):
    id_intento: UUID = Field(strict=False)
    timestamp_utc: datetime = Field(strict=False)
    tipo: Literal["dirigida", "libre"]
    id_referencia: ReferenceId | None
    glosa: str | None
    resultado: Evaluation | Recognition
    captura: CaptureSummary


class History(ContractModel):
    total: int
    limite: int
    offset: int
    intentos: list[PracticeRecord]


class SignProgress(ContractModel):
    id_referencia: ReferenceId | None
    glosa: str | None
    intentos: int
    calificados: int
    promedio: Number | None
    mejor: Number | None
    ultimo_intento: str


class Progress(ContractModel):
    senas: list[SignProgress]


class GameProgress(ContractModel):
    xp: int
    hoy: int
    meta_diaria: int
    racha: int
    calificadas: int


class Feedback(ContractModel):
    fuente: Literal["reglas", "groq", "grok"]  # "grok" for previously stored advice.
    estado: Literal[
        "listo",
        "sin_clave",
        "no_disponible",
        "sin_mediciones",
        "en_espera",
        "clave_invalida",
        "cuota_agotada",
    ]
    consejo: str = Field(min_length=1, max_length=320)
