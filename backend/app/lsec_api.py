"""HTTP integration for the PWA's existing MediaPipe landmark capture."""

from datetime import UTC, datetime
import logging
from statistics import mean
from time import perf_counter
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from fastapi.responses import JSONResponse

from app.contracts.lsec import (
    Attempt, Candidate, CatalogEntry, CatalogIndex, Diagnostics, Evaluation, EvaluationAttempt,
    DetectedSegment, Execution, Frame, PARAMETERS, Recognition, Result, ResultParameter, Segment, Template, Timing,
)
from app.services.lsec_catalog import Catalog, CatalogError, get_catalog, inventory
from app.services.lsec_matching import automatic_segment, compare_face, compare_manual, prepare
from app.services.scoring_engine import demo_distance_score


logger = logging.getLogger(__name__)
MAX_BODY_BYTES = 10 * 1024 * 1024


class LandmarkRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def bounded(request: Request):
            if request.method == "POST":
                if request.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/json":
                    raise HTTPException(415, detail="Solo se aceptan landmarks en application/json.")
                body = bytearray()
                async for chunk in request.stream():
                    if len(body) + len(chunk) > MAX_BODY_BYTES:
                        raise HTTPException(413, detail="La captura supera 10 MiB.")
                    body.extend(chunk)

                original = request
                buffered = bytes(body)
                delivered = False

                async def receive():
                    nonlocal delivered
                    if delivered:
                        return await original.receive()
                    delivered = True
                    return {"type": "http.request", "body": buffered, "more_body": False}

                request = Request(request.scope, receive=receive)
            try:
                return await handler(request)
            except RequestValidationError as error:
                return JSONResponse(status_code=422, content={
                    "detail": [{key: item[key] for key in ("loc", "msg", "type")}
                               for item in error.errors()],
                })

        return bounded


router = APIRouter(prefix="/api/v1/lsec", tags=["LSEC"], route_class=LandmarkRoute)


def available_catalog():
    try:
        return get_catalog()
    except CatalogError as error:
        # The underlying parse exception may include the entire reference document.
        logger.error("No se pudo cargar el catálogo LSEC: %s", str(error).splitlines()[0][:300])
        raise HTTPException(503, detail={"codigo": "catalogo_no_disponible"}) from None


@router.get("/catalogo", response_model=CatalogIndex)
def catalog_index(catalog: Catalog = Depends(available_catalog)):
    sources = {entry["id_propuesto"]: entry for entry in inventory()}
    rows = []
    for reference_id in dict.fromkeys((*sources, *catalog.references)):
        entry = sources.get(reference_id, {})
        loaded = catalog.references.get(reference_id)
        video_url = entry.get("video_url")
        if loaded is None:
            rows.append(CatalogEntry(
                id=reference_id, glosa=entry["glosa_propuesta"], unidad_tematica=entry["unidad_tematica"],
                fuente_url=entry["ficha_url"], video_url=video_url,
                estado="pendiente_referencia", calibrada=False,
            ))
            continue
        rows.append(CatalogEntry(
            id=reference_id, glosa=loaded.gloss, unidad_tematica=loaded.unit, fuente_url=loaded.source,
            video_url=video_url, estado="publicada" if loaded.published else "experimental",
            calibrada=loaded.calibration is not None,
        ))
    return CatalogIndex(version_catalogo=catalog.version, referencias=rows)


@router.get("/referencias", response_model=list[dict])
def published_references(catalog: Catalog = Depends(available_catalog)):
    return [item.published for item in catalog.references.values() if item.published is not None]


@router.get("/plantillas/{id_referencia}", response_model=Template, response_model_exclude_unset=True)
def template(id_referencia: str, catalog: Catalog = Depends(available_catalog)):
    reference = catalog.references.get(id_referencia)
    if reference is None:
        raise HTTPException(404, detail={"codigo": "referencia_no_disponible"})
    return Template(
        schema_version="1.1.0", version_catalogo=catalog.version, id_referencia=reference.id,
        glosa=reference.gloss, unidad_tematica=reference.unit, fuente_url=reference.source,
        estado="publicada" if reference.published else "experimental", mano_dominante=reference.hand,
        captura=reference.capture_data, intervalo_video_ms=reference.source_interval,
        permite_alternancia_manual=reference.allow_hand_switch,
        rostro_requerido=reference.facial_required, blendshapes_clave=list(reference.facial_keys),
        calibracion=reference.calibration,
    )


@router.post("/segmentaciones", response_model=DetectedSegment, response_model_exclude_unset=True)
def segment_capture(attempt: Attempt):
    if attempt.segmentacion is not None:
        raise HTTPException(422, detail="Envíe la captura completa sin un segmento previo.")
    frames = [frame.model_dump(exclude_none=True) for frame in attempt.frames]
    try:
        start, end, hand = automatic_segment(frames, attempt.ancho, attempt.alto)
    except ValueError:
        return DetectedSegment(estado="datos_insuficientes", segmentacion=None, mano_observada=None)
    return DetectedSegment(estado="detectado", mano_observada=hand,
                           segmentacion=Segment(frame_inicio_sena=start, frame_fin_sena=end))


@router.post("/reconocimientos", response_model=Recognition)
def recognize(attempt: Attempt, segmentar: bool = False, catalog: Catalog = Depends(available_catalog)):
    if not catalog.references:
        return Recognition(estado="sin_referencias", version_catalogo=catalog.version, candidatas=[])
    if segmentar:
        detected = segment_capture(attempt)
        if detected.segmentacion is None:
            return Recognition(estado="datos_insuficientes", version_catalogo=catalog.version, candidatas=[])
        attempt = attempt.model_copy(update={"segmentacion": detected.segmentacion})
    tracks = prepare(attempt)
    candidates = []
    for reference in catalog.references.values():
        distances = compare_manual(reference.tracks, tracks, reference.hand,
                                   attempt.mano_practica if reference.allow_hand_switch else None)
        if all(item.desviacion is not None for item in distances.values()):
            candidates.append(Candidate(
                id_referencia=reference.id, glosa=reference.gloss,
                distancia=round(mean(item.desviacion for item in distances.values()), 6),
            ))
    candidates.sort(key=lambda item: (item.distancia, item.id_referencia))
    return Recognition(
        estado="experimental" if candidates else "datos_insuficientes",
        version_catalogo=catalog.version, candidatas=candidates[:3],
    )


FEEDBACK = (
    "Revisa la configuración de los dedos.",
    "Revisa hacia dónde apunta la palma.",
    "Compara la altura y posición de la mano.",
    "Compara el recorrido de la mano.",
    "Compara la expresión del rostro.",
)


def score(parameters, calibration):
    scores = []
    results = {}
    for name, feedback in zip(PARAMETERS, FEEDBACK):
        metric = parameters[name]
        if metric.estado == "no_aplica":
            results[name] = ResultParameter(
                estado="verde", desviacion=0, zonas_resaltar=[], mensaje_feedback="Sin requisito facial.",
            )
            continue
        threshold = calibration.umbrales[name]
        distance = metric.desviacion
        scores.append(demo_distance_score(distance, threshold.verde, threshold.rojo))
        color = "verde" if distance <= threshold.verde else "rojo" if distance >= threshold.rojo else "amarillo"
        results[name] = ResultParameter(
            estado=color, desviacion=distance, zonas_resaltar=[] if color == "verde" else metric.zonas_resaltar,
            mensaje_feedback="Dentro del rango de referencia." if color == "verde" else feedback,
        )
    total = round(mean(scores), 2)
    passed = total >= calibration.puntaje_minimo and all(item.estado != "rojo" for item in results.values())
    return Result(
        puntaje_global=total,
        estrellas=(3 if total >= 95 else 2 if total >= 85 else 1) if passed else 0,
        veredicto_aprobado=passed, parametros_evaluados=results,
    )


@router.post("/evaluaciones", response_model=Evaluation, response_model_exclude_unset=True)
def evaluate(attempt: EvaluationAttempt, catalog: Catalog = Depends(available_catalog)):
    reference = catalog.references.get(attempt.id_referencia)
    if reference is None:
        raise HTTPException(404, detail={"codigo": "referencia_no_disponible"})
    start = perf_counter()
    tracks = prepare(attempt)
    parameters = compare_manual(reference.tracks, tracks, reference.hand,
                                attempt.mano_practica if reference.allow_hand_switch else None)
    facial = compare_face(reference.tracks, tracks, reference.facial_required, reference.facial_keys)
    has_data = all(value.estado == "medido" for value in parameters.values())
    has_data &= reference.facial_required is not True or facial.estado == "medido"
    parameters[PARAMETERS[-1]] = facial
    state = "datos_insuficientes" if not has_data else "sin_calibracion"
    result = score(parameters, reference.calibration) if has_data and reference.calibration is not None else None
    latency_ms = round((perf_counter() - start) * 1000, 3)
    execution = None
    if result is not None:
        frames = attempt.gesture()
        first_valid_pose = next(frame for frame in frames if frame.pose and
                                min(point.visibility for point in frame.pose[11:13]) >= 0.5)
        begin, end = frames[0].timestamp_ms, frames[-1].timestamp_ms
        execution = Execution(
            schema_version="1.1.0", id_ejecucion=uuid4(), id_referencia=reference.id,
            timestamp_utc=datetime.now(UTC), modo=attempt.modo,
            diagnostico_tecnico=Diagnostics(
                fps_promedio=round((len(frames) - 1) * 1000 / (end - begin), 2),
                latencia_veredicto_ms=latency_ms, calidad_encuadre=round(tracks.body_coverage, 4),
            ),
            senales_segmentacion=Timing(
                timestamp_encuadre_valido=first_valid_pose.timestamp_ms,
                timestamp_inicio_sena=begin, timestamp_fin_sena=end,
            ),
            resultado=result,
            frames_ejecucion=[Frame.model_validate(frame.model_dump(exclude_none=True, exclude_unset=True))
                              for frame in attempt.frames],
        )
        state = "evaluado"
    return Evaluation(
        estado=state, version_catalogo=catalog.version, id_referencia=attempt.id_referencia,
        parametros=parameters, ejecucion=execution, latencia_ms=latency_ms,
    )
