"""Model-only ASL prototype with Groq wording for grounded feedback."""

import asyncio
import json
import logging
from time import perf_counter

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from app.contracts.websocket_messages import ASLControl, ASLSessionStart
from app.services.asl_recognition import (asl_glosses, assess_capture,
                                          drink_hand_observation, hello_hand_observation, infer_asl)
from app.services.groq_feedback import build_evidence, generate_groq_feedback
from app.services.openhands_runtime import InferenceError
from app.streaming.config import RealtimeSettings
from app.streaming.frame_decoder import FrameError, parse_frame
from app.streaming.realtime_processor import RealtimeProcessor
from app.streaming.session import StreamingSession


router = APIRouter()
logger = logging.getLogger(__name__)
WARNING = (
    "El modelo ASL no compara la captura con el video demostrativo; "
    "sus probabilidades no miden calidad de ejecución."
)
MODEL_NAME = "OpenHands/BERT-WLASL2000"


def result_message(session, kind, feedback=None, recognition=None, advice=None, observations=None):
    advice = advice or {
        "status": "not_requested", "source": "rules", "model": None,
        "summary": "Observaciones automáticas de captura.",
        "http_status": None,
    }
    return {
        "type": kind, "protocol_version": "2.0",
        "session_id": session.session_id,
        "target_gloss": session.target_gloss,
        "frame_sequence": session.last_frame_sequence,
        "timestamp_ms": session.last_processed_timestamp,
        "status": "complete" if kind == "evaluation.final" else "partial",
        "quality": session.quality(),
        "recognition": recognition or {
            "status": "pending", "model": MODEL_NAME,
            "target_gloss": session.target_gloss,
            "target_probability": None, "top_k": [],
        },
        "execution_score": None,
        "execution_score_status": "awaiting_validation",
        "observations": observations,
        "feedback": feedback or [],
        "feedback_source": advice["source"],
        "feedback_status": advice["status"],
        "feedback_model": advice.get("model"),
        "feedback_summary": advice["summary"],
        "feedback_recommendations": advice.get("recommendations", []),
        "feedback_http_status": advice.get("http_status"),
        "feedback_diagnostic": advice.get("diagnostic"),
        "services": {
            "mediapipe": "used" if session.frames_processed else "not_used",
            "asl_model": ("used" if recognition and recognition["status"] == "experimental"
                          else "error" if recognition and recognition["status"] == "error"
                          else "not_used"),
            "groq": ("used" if advice["source"] == "groq" and advice["status"] == "ok"
                     else "unavailable" if advice["status"] == "unavailable"
                     else "error" if advice["status"] == "error"
                     else "not_used"),
        },
        "warnings": [WARNING],
    }


@router.websocket("/ws/v2/visena/recognize")
async def recognize_websocket(websocket: WebSocket):
    settings = getattr(websocket.app.state, "realtime_settings", None) or RealtimeSettings()
    origin = websocket.headers.get("origin")
    allowed = {item.strip() for item in settings.allowed_origins.split(",") if item.strip()}
    if origin and origin not in allowed:
        await websocket.close(code=1008)
        return
    await websocket.accept()
    session = None
    processor = None
    worker = None
    send_lock = asyncio.Lock()
    disconnect_reason = "unknown"

    async def send(message):
        async with send_lock:
            await websocket.send_json(message)

    async def error(code, message, recoverable=True):
        await send({
            "type": "error", "protocol_version": "2.0",
            "session_id": session.session_id if session else None,
            "code": code, "message": message, "recoverable": recoverable,
        })

    async def consume():
        loop = asyncio.get_running_loop()
        while True:
            generation, timestamp, sequence, jpeg = await session.frame_queue.get()
            try:
                started = perf_counter()
                width, height, regions = await loop.run_in_executor(
                    session.executor, processor.process, jpeg, timestamp)
                if generation != session.generation:
                    continue
                session.processing_latency_ms = (perf_counter() - started) * 1000
                session.append(timestamp, sequence, width, height, regions)
                if (session.last_evaluation_timestamp is None or
                    timestamp - session.last_evaluation_timestamp >= settings.evaluation_interval_ms):
                    candidate = session.candidate()
                    _, feedback = assess_capture(
                        candidate, settings.min_coverage,
                        settings.max_missing_gap_seconds)
                    session.last_evaluation_timestamp = timestamp
                    await send(result_message(session, "evaluation.partial", feedback))
            except FrameError as exc:
                await error("INVALID_FRAME", str(exc))
            except Exception:
                logger.exception("ASL frame failed session_id=%s", session.session_id)
                await error("PROCESSING_ERROR", "No se pudo procesar el frame.")
            finally:
                session.frame_queue.task_done()

    try:
        try:
            first = await asyncio.wait_for(websocket.receive(), timeout=settings.heartbeat_seconds * 2)
        except asyncio.TimeoutError:
            await error("SESSION_NOT_READY", "Tiempo de inicio agotado.", False)
            disconnect_reason = "start_timeout"
            return
        if first["type"] == "websocket.disconnect":
            disconnect_reason = "client_disconnect"
            return
        try:
            if first.get("text") is None:
                raise ValueError("Se requiere session.start.")
            start = ASLSessionStart.model_validate_json(first["text"])
            target = start.target_gloss.strip()
            if target not in asl_glosses():
                await error("TARGET_NOT_SUPPORTED", "La glosa no está en WLASL2000.", False)
                disconnect_reason = "unsupported_target"
                return
            if (start.capture.width > settings.max_width or
                start.capture.height > settings.max_height or
                start.capture.fps > settings.max_input_fps):
                raise ValueError("Captura fuera de límites.")
        except (ValidationError, ValueError):
            await error("INVALID_MESSAGE", "session.start inválido o versión incompatible.", False)
            disconnect_reason = "invalid_start"
            return
        session = StreamingSession(None, settings, target_gloss=target,
                                   practice_hand=start.practice_hand)
        loop = asyncio.get_running_loop()
        factory = getattr(websocket.app.state, "realtime_processor_factory", RealtimeProcessor)
        try:
            processor = await loop.run_in_executor(session.executor, factory, settings)
        except Exception:
            logger.exception("ASL MediaPipe startup failed target_gloss=%s", target)
            await error("INFERENCE_ERROR", "No se pudo iniciar MediaPipe.", False)
            disconnect_reason = "inference_start_failed"
            return
        worker = asyncio.create_task(consume())
        await send({"type": "session.ready", "protocol_version": "2.0",
                    "session_id": session.session_id,
                    "target_gloss": target, "status": "ready",
                    "server_build": "asl-camera-20261108-11"})
        idle = 0
        while True:
            try:
                incoming = await asyncio.wait_for(websocket.receive(), timeout=settings.heartbeat_seconds)
                idle = 0
            except asyncio.TimeoutError:
                idle += 1
                if idle >= 2:
                    disconnect_reason = "heartbeat_timeout"
                    break
                await send({"type": "session.ping", "protocol_version": "2.0",
                            "session_id": session.session_id})
                continue
            if incoming["type"] == "websocket.disconnect":
                disconnect_reason = "client_disconnect"
                break
            if incoming.get("bytes") is not None:
                if not session.active:
                    await error("EVALUATION_NOT_STARTED", "Envía evaluation.begin antes de frames.")
                    continue
                if len(incoming["bytes"]) > settings.max_frame_bytes + 12:
                    await error("INVALID_FRAME", "Frame demasiado grande.", False)
                    disconnect_reason = "oversized_frame"
                    break
                try:
                    timestamp, sequence, jpeg = parse_frame(incoming["bytes"], settings.max_frame_bytes)
                except FrameError as exc:
                    await error("INVALID_FRAME", str(exc))
                    continue
                if (timestamp > 2**63 - 1 or
                    (session.last_received_timestamp is not None and
                     (timestamp <= session.last_received_timestamp or
                      sequence <= session.last_received_sequence))):
                    await error("INVALID_TIMESTAMP", "Timestamp y secuencia deben crecer.")
                    continue
                session.last_received_timestamp = timestamp
                session.last_received_sequence = sequence
                session.frames_received += 1
                if (session.last_processed_timestamp is not None and
                    timestamp - session.last_processed_timestamp < 1000 / settings.max_input_fps):
                    session.frames_dropped += 1
                    continue
                session.enqueue((session.generation, timestamp, sequence, jpeg))
                continue
            try:
                control = ASLControl.model_validate_json(incoming.get("text") or "")
            except ValidationError:
                await error("INVALID_MESSAGE", "Mensaje de control inválido.")
                continue
            if control.type == "evaluation.begin":
                session.clear_execution()
                session.active = True
                await send({"type": "evaluation.started", "protocol_version": "2.0",
                            "session_id": session.session_id})
            elif control.type == "evaluation.reset":
                session.clear_execution()
                session.active = False
                await send({"type": "evaluation.reset", "protocol_version": "2.0",
                            "session_id": session.session_id})
            elif control.type == "evaluation.end":
                if not session.active:
                    await error("EVALUATION_NOT_STARTED", "No hay evaluación activa.")
                    continue
                await session.frame_queue.join()
                session.active = False
                candidate = session.candidate()
                sufficient, feedback = assess_capture(
                    candidate, settings.min_coverage,
                    settings.max_missing_gap_seconds)
                observations = None
                if sufficient and target == "drink":
                    observations = drink_hand_observation(candidate, session.practice_hand)
                elif sufficient and target == "hello":
                    observations = hello_hand_observation(candidate, session.practice_hand)
                recognition = {
                    "status": "insufficient_data", "model": MODEL_NAME,
                    "target_gloss": target, "target_probability": None, "top_k": [],
                }
                if sufficient:
                    try:
                        started = perf_counter()
                        inference = getattr(websocket.app.state, "asl_inference", infer_asl)
                        prediction = await loop.run_in_executor(
                            session.executor, inference, candidate, target, session.practice_hand)
                        session.evaluation_latency_ms = (perf_counter() - started) * 1000
                        recognition = {
                            "status": "experimental", "model": prediction.get("model", MODEL_NAME),
                            "target_gloss": target,
                            "target_probability": prediction["target_probability"],
                            "top_k": prediction["predictions"],
                            "input_window": prediction.get("input_window"),
                        }
                        top_gloss = prediction["predictions"][0]["gloss"]
                        opposite_hand = (observations and
                                         observations["practice_hand_status"] == "opposite_hand")
                        if not opposite_hand and top_gloss != target:
                            feedback.append(
                                "La captura es suficiente, pero el modelo no confirmó la glosa seleccionada. "
                                "Este resultado no permite concluir que hiciste mal la seña.")
                        elif not opposite_hand:
                            feedback.append(
                                "El modelo ASL sugirió la glosa seleccionada; su probabilidad no es una nota de ejecución.")
                    except (InferenceError, ValueError, KeyError, IndexError):
                        logger.exception("ASL inference failed session_id=%s", session.session_id)
                        recognition["status"] = "error"
                        feedback.append("No se pudo completar el reconocimiento ASL experimental.")
                        await error("INFERENCE_ERROR", "No se pudo completar el modelo ASL.")
                if observations and observations["practice_hand_status"] == "opposite_hand":
                    side = "derecha" if session.practice_hand == "right" else "izquierda"
                    movement = ("acercarse a la boca" if target == "drink" else
                                "levantarse junto a la cabeza")
                    feedback.insert(0, f"Se observó la mano opuesta {movement}. Para este ejercicio usa la mano {side}.")
                elif (target == "hello" and observations and
                      observations["practice_hand_status"] == "matching_hand"):
                    side = "derecha" if session.practice_hand == "right" else "izquierda"
                    if observations["outward_movement"] is False:
                        feedback.insert(0, f"La mano {side} se elevó junto a la cabeza, pero no se observó un desplazamiento sostenido hacia afuera. Revisa la dirección en la demostración.")
                    elif observations["outward_movement"] is True:
                        feedback.insert(0, f"La mano {side} se elevó junto a la cabeza y se desplazó hacia afuera. Esto no verifica toda la seña HELLO.")
                evidence = build_evidence(
                    target, session.quality(), recognition, feedback,
                    len(candidate.timestamps_ms) if candidate is not None else 0,
                    observations=observations)
                generator = getattr(websocket.app.state, "groq_feedback", generate_groq_feedback)
                advice = await generator(evidence, settings)
                combined = list(dict.fromkeys([*feedback, *advice["recommendations"]]))[:4]
                await send(result_message(
                    session, "evaluation.final", combined, recognition, advice, observations))
            elif control.type == "session.stop":
                disconnect_reason = "session_stop"
                await send({"type": "session.stopped", "protocol_version": "2.0",
                            "session_id": session.session_id})
                break
    except WebSocketDisconnect:
        disconnect_reason = "client_disconnect"
    except Exception:
        disconnect_reason = "internal_error"
        logger.exception("ASL WebSocket failed session_id=%s", session.session_id if session else None)
        try:
            await error("INTERNAL_ERROR", "Error interno de la sesión.", False)
        except Exception:
            pass
    finally:
        if worker:
            worker.cancel()
        if session:
            if processor:
                try:
                    session.executor.submit(processor.close).result(timeout=10)
                except Exception:
                    logger.exception("ASL landmarker cleanup failed session_id=%s", session.session_id)
            session.executor.shutdown(wait=True)
            session.landmark_buffer.clear()
            logger.info("asl_session_closed %s", json.dumps({
                "session_id": session.session_id,
                "target_gloss": session.target_gloss,
                "frames_received": session.frames_received,
                "frames_processed": session.frames_processed,
                "frames_dropped": session.frames_dropped,
                "processing_latency_ms": round(session.processing_latency_ms, 2),
                "evaluation_latency_ms": round(session.evaluation_latency_ms, 2),
                "disconnect_reason": disconnect_reason,
            }))
        try:
            await websocket.close()
        except (RuntimeError, WebSocketDisconnect):
            pass
