"""HTTP integration for the PWA's existing MediaPipe landmark capture."""

from fastapi import APIRouter, Depends, HTTPException

from app.api.dependencies import available_catalog
from app.api.routing import LandmarkRoute
from app.contracts.lsec import (
    Attempt,
    CatalogEntry,
    CatalogIndex,
    DetectedSegment,
    Evaluation,
    EvaluationAttempt,
    Recognition,
    Template,
)
from app.domain.lsec.evaluation import evaluate, recognize, segment_capture
from app.domain.lsec.lsec_catalog import Catalog, inventory

router = APIRouter(prefix="/api/v1/lsec", tags=["LSEC"], route_class=LandmarkRoute)


@router.get("/catalogo", response_model=CatalogIndex)
def catalog_index(catalog: Catalog = Depends(available_catalog)):
    sources = {entry["id_propuesto"]: entry for entry in inventory()}
    rows = []
    for reference_id in dict.fromkeys((*sources, *catalog.references)):
        entry = sources.get(reference_id, {})
        loaded = catalog.references.get(reference_id)
        video_url = entry.get("video_url")
        if loaded is None:
            rows.append(
                CatalogEntry(
                    id=reference_id,
                    glosa=entry["glosa_propuesta"],
                    unidad_tematica=entry["unidad_tematica"],
                    fuente_url=entry["ficha_url"],
                    video_url=video_url,
                    estado="pendiente_referencia",
                    calibrada=False,
                )
            )
            continue
        rows.append(
            CatalogEntry(
                id=reference_id,
                glosa=loaded.gloss,
                unidad_tematica=loaded.unit,
                fuente_url=loaded.source,
                video_url=video_url,
                estado="publicada" if loaded.published else "experimental",
                calibrada=loaded.calibration is not None,
                permite_alternancia_manual=loaded.allow_hand_switch,
            )
        )
    return CatalogIndex(version_catalogo=catalog.version, referencias=rows)


@router.get("/referencias", response_model=list[dict])
def published_references(catalog: Catalog = Depends(available_catalog)):
    return [item.published for item in catalog.references.values() if item.published is not None]


@router.get(
    "/plantillas/{id_referencia}", response_model=Template, response_model_exclude_unset=True
)
def template(id_referencia: str, catalog: Catalog = Depends(available_catalog)):
    reference = catalog.references.get(id_referencia)
    if reference is None:
        raise HTTPException(404, detail={"codigo": "referencia_no_disponible"})
    return Template(
        schema_version="1.1.0",
        version_catalogo=catalog.version,
        id_referencia=reference.id,
        glosa=reference.gloss,
        unidad_tematica=reference.unit,
        fuente_url=reference.source,
        estado="publicada" if reference.published else "experimental",
        mano_dominante=reference.hand,
        captura=reference.capture_data,
        intervalo_video_ms=reference.source_interval,
        permite_alternancia_manual=reference.allow_hand_switch,
        rostro_requerido=reference.facial_required,
        blendshapes_clave=list(reference.facial_keys),
        calibracion=reference.calibration,
    )


@router.post("/segmentaciones", response_model=DetectedSegment, response_model_exclude_unset=True)
def segment_endpoint(attempt: Attempt):
    return segment_capture(attempt)


@router.post("/reconocimientos", response_model=Recognition)
def recognition_endpoint(
    attempt: Attempt, segmentar: bool = False, catalog: Catalog = Depends(available_catalog)
):
    return recognize(attempt, catalog, segmentar)


@router.post("/evaluaciones", response_model=Evaluation, response_model_exclude_unset=True)
def evaluation_endpoint(
    attempt: EvaluationAttempt,
    segmentar: bool = False,
    catalog: Catalog = Depends(available_catalog),
):
    return evaluate(attempt, catalog, segmentar)
