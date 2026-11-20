from typing import Annotated, Literal
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator


ReferenceId = Annotated[str, StringConstraints(pattern=r"^ref-[a-z0-9-]+$", max_length=80)]
Number = Annotated[float, Field(allow_inf_nan=False)]
Coordinate = Annotated[Number, Field(ge=-10, le=10)]
Coefficient = Annotated[Number, Field(ge=0, le=1)]
Side = Literal["izquierda", "derecha", "ambas"]
Parameter = Literal[
    "queirema_configuracion", "kinema_orientacion", "toponema_ubicacion",
    "kinesema_movimiento", "prosoponema_no_manual",
]
PARAMETERS = (
    "queirema_configuracion", "kinema_orientacion", "toponema_ubicacion",
    "kinesema_movimiento", "prosoponema_no_manual",
)


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Point(ContractModel):
    x: Coordinate
    y: Coordinate
    z: Coordinate
    visibility: Coefficient = 1


class Frame(ContractModel):
    frame_idx: int = Field(ge=0)
    timestamp_ms: Number = Field(ge=0)
    image_aspect: Number | None = Field(default=None, gt=0)
    pose: list[Point] | None = Field(default=None, max_length=33)
    pose_world: list[Point] | None = Field(default=None, max_length=33)
    mano_izquierda: list[Point] | None = Field(default=None, max_length=21)
    mano_derecha: list[Point] | None = Field(default=None, max_length=21)
    rostro: list[Point] | None = Field(default=None, max_length=478)
    blendshapes_rostro: dict[str, Coefficient] | None = Field(default=None, max_length=64)
    vrm_pose_override: dict[str, Annotated[list[Number], Field(min_length=4, max_length=4)]] | None = Field(
        default=None, max_length=64
    )

    @model_validator(mode="after")
    def check_tracks(self):
        for name, count in (
            ("pose", 33), ("pose_world", 33), ("mano_izquierda", 21), ("mano_derecha", 21),
        ):
            points = getattr(self, name)
            if points and len(points) != count:
                raise ValueError(f"{name} requiere {count} puntos o una pista vacía.")
        return self


class Segment(ContractModel):
    frame_inicio_preparacion: int | None = Field(default=None, ge=0)
    frame_inicio_sena: int = Field(ge=0)
    frame_fin_sena: int = Field(ge=0)
    frame_retorno: int | None = Field(default=None, ge=0)


class Capture(ContractModel):
    ancho: int = Field(ge=64, le=4096)
    alto: int = Field(ge=64, le=4096)
    segmentacion: Segment | None = None
    frames: list[Frame] = Field(min_length=4, max_length=300)

    @model_validator(mode="after")
    def check_sequence(self):
        indexes = [frame.frame_idx for frame in self.frames]
        times = [frame.timestamp_ms for frame in self.frames]
        if indexes != list(range(len(indexes))) or any(a >= b for a, b in zip(times, times[1:])):
            raise ValueError("Los índices deben empezar en 0 y los tiempos deben crecer.")
        if times[-1] - times[0] > 20_000:
            raise ValueError("La captura puede durar hasta 20 segundos.")
        if self.segmentacion:
            segment = self.segmentacion
            start, end = segment.frame_inicio_sena, segment.frame_fin_sena
            preparation = start if segment.frame_inicio_preparacion is None else segment.frame_inicio_preparacion
            return_frame = end if segment.frame_retorno is None else segment.frame_retorno
            if not 0 <= preparation <= start <= end <= return_frame < len(self.frames) or end - start < 3:
                raise ValueError("La segmentación debe contener al menos cuatro cuadros consecutivos válidos.")
        return self

    def gesture(self):
        if self.segmentacion is None:
            return self.frames
        return self.frames[self.segmentacion.frame_inicio_sena:self.segmentacion.frame_fin_sena + 1]


class Attempt(Capture):
    schema_version: Literal["1.1.0"]
    modo: Literal["practica_libre", "investigacion_pin", "kiosco"] = "practica_libre"
    mano_practica: Literal["izquierda", "derecha"] | None = None


class EvaluationAttempt(Attempt):
    id_referencia: ReferenceId


class DetectedSegment(ContractModel):
    estado: Literal["detectado", "datos_insuficientes"]
    segmentacion: Segment | None
    mano_observada: Side | None


class Threshold(ContractModel):
    verde: Number = Field(ge=0)
    rojo: Number = Field(gt=0)

    @model_validator(mode="after")
    def check_bounds(self):
        if self.verde >= self.rojo:
            raise ValueError("El umbral verde debe ser menor que el rojo.")
        return self


class Calibration(ContractModel):
    puntaje_minimo: Number = Field(ge=0, le=100)
    umbrales: dict[Parameter, Threshold]


class Template(ContractModel):
    schema_version: Literal["1.1.0"]
    version_catalogo: str
    id_referencia: ReferenceId
    glosa: str
    unidad_tematica: int
    fuente_url: str
    estado: Literal["experimental", "publicada"]
    mano_dominante: Side
    permite_alternancia_manual: bool
    intervalo_video_ms: tuple[Number, Number] | None
    captura: Capture
    rostro_requerido: bool | None
    blendshapes_clave: list[str]
    calibracion: Calibration | None


class Distance(ContractModel):
    estado: Literal["medido", "datos_insuficientes", "no_aplica"]
    desviacion: float | None = None
    zonas_resaltar: list[str] = Field(default_factory=list)


class Candidate(ContractModel):
    id_referencia: ReferenceId
    glosa: str
    distancia: float


class Recognition(ContractModel):
    estado: Literal["experimental", "datos_insuficientes", "sin_referencias"]
    version_catalogo: str | None
    candidatas: list[Candidate]


class ResultParameter(ContractModel):
    estado: Literal["verde", "amarillo", "rojo"]
    desviacion: float
    zonas_resaltar: list[str]
    mensaje_feedback: str


class Result(ContractModel):
    puntaje_global: float
    estrellas: int
    veredicto_aprobado: bool
    parametros_evaluados: dict[Parameter, ResultParameter]


class Diagnostics(ContractModel):
    fps_promedio: float
    latencia_veredicto_ms: float
    calidad_encuadre: float


class Timing(ContractModel):
    timestamp_encuadre_valido: float
    timestamp_inicio_sena: float
    timestamp_fin_sena: float


class Execution(ContractModel):
    schema_version: Literal["1.1.0"] = "1.1.0"
    id_ejecucion: UUID
    id_referencia: ReferenceId
    timestamp_utc: datetime
    modo: Literal["practica_libre", "investigacion_pin", "kiosco"]
    diagnostico_tecnico: Diagnostics
    senales_segmentacion: Timing
    resultado: Result
    frames_ejecucion: list[Frame]


class Evaluation(ContractModel):
    estado: Literal["evaluado", "sin_calibracion", "datos_insuficientes"]
    version_catalogo: str
    id_referencia: ReferenceId
    parametros: dict[Parameter, Distance]
    ejecucion: Execution | None
    latencia_ms: float


class CatalogEntry(ContractModel):
    id: ReferenceId
    glosa: str
    unidad_tematica: int
    fuente_url: str
    video_url: str | None
    estado: Literal["pendiente_referencia", "experimental", "publicada"]
    calibrada: bool


class CatalogIndex(ContractModel):
    lengua: Literal["LSEC"] = "LSEC"
    version_catalogo: str | None
    referencias: list[CatalogEntry]
