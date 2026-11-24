"""Recognition, segmentation and evaluation of LSEC landmark sequences."""

from datetime import UTC, datetime
from statistics import mean
from time import perf_counter
from uuid import uuid4

from app.contracts.lsec import (
    PARAMETERS,
    AppliedCalibration,
    Attempt,
    Candidate,
    DetectedSegment,
    Diagnostics,
    Distance,
    Evaluation,
    EvaluationAttempt,
    Execution,
    Frame,
    Recognition,
    Result,
    ResultParameter,
    ScoredThreshold,
    Segment,
    SimilarityGrade,
    Timing,
)
from app.domain.lsec.lsec_catalog import Catalog
from app.domain.lsec.lsec_matching import automatic_segment, compare_face, compare_manual, prepare
from app.domain.lsec.scoring_engine import distance_score


class ReferenceUnavailable(Exception):
    pass


def segment_capture(attempt: Attempt, *, target_hand=None):
    if attempt.segmentacion is not None:
        raise ValueError("Envíe la captura completa sin un segmento previo.")
    frames = [frame.model_dump(exclude_none=True) for frame in attempt.frames]
    try:
        start, end, hand = automatic_segment(
            frames, attempt.ancho, attempt.alto, target_hand=target_hand
        )
    except ValueError:
        return DetectedSegment(estado="datos_insuficientes", segmentacion=None, mano_observada=None)
    return DetectedSegment(
        estado="detectado",
        mano_observada=hand,
        segmentacion=Segment(frame_inicio_sena=start, frame_fin_sena=end),
    )


# Distance giving 50/100 for one track. These geometric scales are shared
# across the pilot and do not represent specialist-defined passing thresholds.
SIMILARITY_HALF_DISTANCES = dict(zip(PARAMETERS, (0.10, 0.35, 0.25, 0.25, 0.20), strict=True))
ENGINE_VERSION = "lsec-dtw-1"


def practice_similarity(reference, parameters):
    """Equal-weight similarity of measured tracks, with distance in each track's native units."""
    required = PARAMETERS if reference.facial_required else PARAMETERS[:4]
    if any(parameters[name].desviacion is None for name in required):
        return None
    # Angles are fractions of pi, palm directions are unit-vector components,
    # positions and displacements are expressed in shoulder widths, face coefficients in [0, 1].
    parts = {
        name: round(100 * 2 ** (-parameters[name].desviacion / SIMILARITY_HALF_DISTANCES[name]), 2)
        for name in required
    }
    weakest = min(parts, key=parts.get)
    exact = parts[weakest] == 100
    return SimilarityGrade(
        id_referencia=reference.id,
        glosa=reference.gloss,
        puntaje=round(mean(parts.values()), 2),
        por_parametro=parts,
        mensaje_feedback="" if exact else FEEDBACK[PARAMETERS.index(weakest)],
        zonas_resaltar=[] if exact else parameters[weakest].zonas_resaltar,
    )


def recognize(attempt: Attempt, catalog: Catalog, segmentar: bool = False):
    if not catalog.references:
        return Recognition(
            estado="sin_referencias",
            version_catalogo=catalog.version,
            version_motor=ENGINE_VERSION,
            candidatas=[],
        )
    if segmentar:
        detected = segment_capture(attempt)
        if detected.segmentacion is None:
            return Recognition(
                estado="datos_insuficientes",
                version_catalogo=catalog.version,
                version_motor=ENGINE_VERSION,
                candidatas=[],
            )
        attempt = attempt.model_copy(update={"segmentacion": detected.segmentacion})
    tracks = prepare(attempt)
    candidates = []
    candidate_metrics = {}
    for reference in catalog.references.values():
        distances = compare_manual(
            reference.tracks,
            tracks,
            reference.hand,
            attempt.mano_practica if reference.allow_hand_switch else None,
        )
        if reference.facial_required:
            distances[PARAMETERS[-1]] = compare_face(
                reference.tracks, tracks, True, reference.facial_keys
            )
        if all(item.desviacion is not None for item in distances.values()):
            candidate_metrics[reference.id] = distances
            candidates.append(
                Candidate(
                    id_referencia=reference.id,
                    glosa=reference.gloss,
                    distancia=round(
                        mean(
                            metric.desviacion / SIMILARITY_HALF_DISTANCES[name]
                            for name, metric in distances.items()
                        ),
                        6,
                    ),
                )
            )
    candidates.sort(key=lambda item: (item.distancia, item.id_referencia))
    similarity = None
    if candidates:
        best = catalog.references[candidates[0].id_referencia]
        similarity = practice_similarity(best, candidate_metrics[best.id])
    return Recognition(
        estado="experimental" if candidates else "datos_insuficientes",
        version_motor=ENGINE_VERSION,
        version_catalogo=catalog.version,
        candidatas=candidates[:3],
        similitud=similarity,
    )


FEEDBACK = (
    "Revisa la configuración de los dedos.",
    "Revisa hacia dónde apunta la palma.",
    "Compara la altura y posición de la mano.",
    "Compara el recorrido de la mano.",
    "Compara la expresión del rostro.",
)


def score(parameters, calibration):
    scores = {}
    results = {}
    for name, feedback in zip(PARAMETERS, FEEDBACK):
        metric = parameters[name]
        if metric.estado == "no_aplica":
            results[name] = ResultParameter(
                estado="verde",
                desviacion=0,
                zonas_resaltar=[],
                mensaje_feedback="Sin requisito facial.",
            )
            continue
        threshold = calibration.umbrales[name]
        distance = metric.desviacion
        scores[name] = ScoredThreshold(
            verde=threshold.verde,
            rojo=threshold.rojo,
            puntaje=distance_score(distance, threshold.verde, threshold.rojo),
        )
        color = (
            "verde"
            if distance <= threshold.verde
            else "rojo"
            if distance >= threshold.rojo
            else "amarillo"
        )
        results[name] = ResultParameter(
            estado=color,
            desviacion=distance,
            zonas_resaltar=[] if color == "verde" else metric.zonas_resaltar,
            mensaje_feedback="Dentro del rango de referencia." if color == "verde" else feedback,
        )
    total = round(mean(item.puntaje for item in scores.values()), 2)
    passed = total >= calibration.puntaje_minimo and all(
        item.estado != "rojo" for item in results.values()
    )
    result = Result(
        puntaje_global=total,
        estrellas=(3 if total >= 95 else 2 if total >= 85 else 1) if passed else 0,
        veredicto_aprobado=passed,
        parametros_evaluados=results,
    )
    weakest = min(
        (name for name in scores if results[name].estado != "verde"),
        key=lambda name: (results[name].estado != "rojo", scores[name].puntaje),
        default=None,
    )
    return result, AppliedCalibration(
        puntaje_minimo=calibration.puntaje_minimo, por_parametro=scores, aspecto_a_practicar=weakest
    )


def evaluate(attempt: EvaluationAttempt, catalog: Catalog, segmentar: bool = False):
    reference = catalog.references.get(attempt.id_referencia)
    if reference is None:
        raise ReferenceUnavailable("referencia_no_disponible")
    start = perf_counter()
    practice_hand = attempt.mano_practica if reference.allow_hand_switch else None
    if segmentar:
        target_hand = "ambas" if reference.hand == "ambas" else practice_hand or reference.hand
        detected = segment_capture(attempt, target_hand=target_hand)
        if detected.segmentacion is None:
            return Evaluation(
                estado="datos_insuficientes",
                version_motor=ENGINE_VERSION,
                version_catalogo=catalog.version,
                id_referencia=reference.id,
                parametros={
                    name: Distance(
                        estado="no_aplica"
                        if name == PARAMETERS[-1] and reference.facial_required is False
                        else "datos_insuficientes"
                    )
                    for name in PARAMETERS
                },
                ejecucion=None,
                similitud=None,
                latencia_ms=round((perf_counter() - start) * 1000, 3),
            )
        attempt = attempt.model_copy(update={"segmentacion": detected.segmentacion})
    tracks = prepare(attempt)
    parameters = compare_manual(
        reference.tracks,
        tracks,
        reference.hand,
        practice_hand,
    )
    facial = compare_face(
        reference.tracks, tracks, reference.facial_required, reference.facial_keys
    )
    has_data = all(value.estado == "medido" for value in parameters.values())
    has_data &= reference.facial_required is not True or facial.estado == "medido"
    parameters[PARAMETERS[-1]] = facial
    state = "datos_insuficientes" if not has_data else "sin_calibracion"
    result = applied = None
    if has_data and reference.calibration is not None:
        result, applied = score(parameters, reference.calibration)
    latency_ms = round((perf_counter() - start) * 1000, 3)
    execution = None
    if result is not None:
        frames = attempt.gesture()
        first_valid_pose = next(
            frame
            for frame in frames
            if frame.pose and min(point.visibility for point in frame.pose[11:13]) >= 0.5
        )
        begin, end = frames[0].timestamp_ms, frames[-1].timestamp_ms
        execution = Execution(
            schema_version="1.1.0",
            id_ejecucion=uuid4(),
            id_referencia=reference.id,
            timestamp_utc=datetime.now(UTC),
            modo=attempt.modo,
            diagnostico_tecnico=Diagnostics(
                fps_promedio=round((len(frames) - 1) * 1000 / (end - begin), 2),
                latencia_veredicto_ms=latency_ms,
                calidad_encuadre=round(tracks.body_coverage, 4),
            ),
            senales_segmentacion=Timing(
                timestamp_encuadre_valido=first_valid_pose.timestamp_ms,
                timestamp_inicio_sena=begin,
                timestamp_fin_sena=end,
            ),
            resultado=result,
            frames_ejecucion=[
                Frame.model_validate(frame.model_dump(exclude_none=True, exclude_unset=True))
                for frame in attempt.frames
            ],
        )
        state = "evaluado"
    return Evaluation(
        estado=state,
        version_motor=ENGINE_VERSION,
        calibracion_aplicada=applied,
        version_catalogo=catalog.version,
        id_referencia=attempt.id_referencia,
        parametros=parameters,
        ejecucion=execution,
        latencia_ms=latency_ms,
        similitud=practice_similarity(reference, parameters) if has_data else None,
    )
