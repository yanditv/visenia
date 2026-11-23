"""Load laboratory drafts and separately reviewed LSEC references."""

import json
import os
from dataclasses import dataclass
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Literal

from jsonschema import Draft202012Validator, FormatChecker
from jsonschema import ValidationError as SchemaError
from pydantic import HttpUrl, TypeAdapter, ValidationError

from app.contracts.lsec import PARAMETERS, Calibration, Capture, ReferenceId, Side
from app.domain.lsec.lsec_matching import Tracks, prepare, usable_reference

ROOT = Path(__file__).resolve().parents[4]
INVENTORY = ROOT / "backend/resources/inventario-lsec.json"
REFERENCE_SCHEMA = ROOT / "contracts/schemas/referencia.schema.json"
DEFAULT_CATALOG = ROOT / "backend/data/lsec/catalogo.json"


class CatalogError(Exception):
    pass


@dataclass(frozen=True)
class Reference:
    id: str
    gloss: str
    unit: int
    source: str
    hand: Side
    tracks: Tracks
    published: dict | None
    facial_required: bool | None
    facial_keys: tuple[str, ...]
    calibration: Calibration | None
    capture_data: dict
    source_interval: tuple[float, float] | None
    allow_hand_switch: bool


@dataclass(frozen=True)
class Catalog:
    version: str | None
    references: dict[str, Reference]


@lru_cache(maxsize=1)
def inventory():
    return json.loads(INVENTORY.read_text(encoding="utf-8"))["referencias"]


@lru_cache(maxsize=1)
def reference_validator():
    schema = json.loads(REFERENCE_SCHEMA.read_text(encoding="utf-8"))
    return Draft202012Validator(schema, format_checker=FormatChecker())


def _review(record):
    review = record["revision"]
    if not review["especialista"].strip() or not review["procedencia"].strip():
        raise ValueError("La revisión requiere especialista y procedencia.")
    if not datetime.fromisoformat(review["fecha"]).tzinfo:
        raise ValueError("La fecha de revisión requiere zona horaria.")


def load_reference_record(record, kind: Literal["published", "draft"]):
    data = record["referencia"]
    reference_id = TypeAdapter(ReferenceId).validate_python(data["id"], strict=True)
    hand = TypeAdapter(Side).validate_python(data["mano_dominante"], strict=True)
    gloss, unit = data["glosa"], data["unidad_tematica"]
    if (
        not isinstance(gloss, str)
        or not gloss.strip()
        or type(unit) is not int
        or not 1 <= unit <= 12
    ):
        raise ValueError("Glosa o unidad temática incorrecta.")
    source = str(TypeAdapter(HttpUrl).validate_python(record["fuente_url"]))
    capture_data = {
        "frames": data["frames"],
        "segmentacion": data["segmentacion"],
        "ancho": record["ancho"],
        "alto": record["alto"],
    }
    capture = Capture.model_validate(capture_data)
    interval = record.get("intervalo_video_ms")
    if interval is not None:
        interval = TypeAdapter(tuple[float, float]).validate_python(interval)
        if not (0 <= interval[0] < interval[1] < float("inf")):
            raise ValueError("Intervalo de video inválido.")
    required, keys, calibration = None, (), None
    if kind == "published":
        _review(record)
        reference_validator().validate(data)
        metadata = data["metadatos_grabacion"]
        if metadata["total_frames"] != len(capture.frames):
            raise ValueError("total_frames debe coincidir con frames.")
        duration = capture.frames[-1].timestamp_ms - capture.frames[0].timestamp_ms
        fps = metadata["fps"]
        if abs(metadata["duracion_ms"] - duration) > 1 or abs(
            (len(capture.frames) - 1) * 1000 / duration - fps
        ) > max(0.1, fps * 0.05):
            raise ValueError("duracion_ms y fps deben coincidir con los timestamps.")
        if not any(data["parametros_fonologicos"]["kinema_orientacion"]["vector_palma"]):
            raise ValueError("El vector de la palma no puede ser nulo.")
        for frame in capture.frames:
            if any(not any(q) for q in (frame.vrm_pose_override or {}).values()):
                raise ValueError("El cuaternión del avatar no puede ser nulo.")
            if any(
                getattr(frame, key) == []
                for key in ("pose", "pose_world", "mano_derecha", "mano_izquierda")
            ):
                raise ValueError("Omita las pistas ausentes en una referencia para el reproductor.")
        facial = data["parametros_fonologicos"]["prosoponema_no_manual"]
        required = facial["requerido"]
        if not all(0 <= value <= 1 for value in facial.get("blendshapes_clave", {}).values()):
            raise ValueError("Los objetivos faciales deben estar entre 0 y 1.")
        keys = tuple(sorted(facial.get("blendshapes_clave", {}))) if required else ()
        if required and not keys:
            raise ValueError("El prosoponema requerido debe indicar los blendshapes.")
        if record.get("calibracion") is not None:
            calibration = Calibration.model_validate(record["calibracion"])
            expected = set(PARAMETERS if required else PARAMETERS[:4])
            if set(calibration.umbrales) != expected:
                raise ValueError("Deben calibrarse exactamente los parámetros aplicables.")
    tracks = prepare(capture)
    if not usable_reference(tracks, hand, keys):
        raise ValueError("Cobertura insuficiente en las pistas requeridas de la referencia.")
    return Reference(
        reference_id,
        gloss,
        unit,
        source,
        hand,
        tracks,
        data if kind == "published" else None,
        required,
        keys,
        calibration,
        capture_data,
        interval,
        TypeAdapter(bool).validate_python(
            record.get("permite_alternancia_manual", False), strict=True
        ),
    )


@lru_cache(maxsize=8)
def _load_package(path, kind, _modified, _size):
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    version, records = data["version"], data["referencias"]
    if not isinstance(version, str) or not version.strip() or not isinstance(records, list):
        raise ValueError("El paquete requiere version y una lista referencias.")
    references = {}
    for record in records:
        reference = load_reference_record(record, kind)
        if reference.id in references:
            raise ValueError(f"ID duplicado: {reference.id}.")
        references[reference.id] = reference
    return Catalog(version, references)


def get_catalog():
    draft = os.getenv("VISENA_LSEC_DRAFTS")
    if draft is None:
        local = DEFAULT_CATALOG.with_name("borrador-conadis-lote1.json")
        draft = (
            str(local)
            if local.is_file()
            else str(ROOT / "backend/resources/lsec-experimental.json")
        )
    sources = (
        (Path(os.environ.get("VISENA_LSEC_CATALOG", DEFAULT_CATALOG)), "published"),
        (Path(draft), "draft") if draft else None,
    )
    version = []
    references = {}
    for source in sources:
        if source is None:
            continue
        path, kind = source
        try:
            stat = path.stat()
            package = _load_package(path, kind, stat.st_mtime_ns, stat.st_size)
        except FileNotFoundError:
            if path == DEFAULT_CATALOG and kind == "published":
                continue
            raise CatalogError(f"Falta el paquete LSEC: {path}") from None
        except (OSError, ValidationError, SchemaError, ValueError, KeyError, TypeError) as error:
            raise CatalogError(f"El paquete LSEC {path} es inválido: {error}") from error
        version.append(package.version)
        for reference_id, reference in package.references.items():
            references.setdefault(reference_id, reference)
    return Catalog("+".join(version) if version else None, references)
