import asyncio
import json
import logging
from time import perf_counter

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from app.contracts.websocket_messages import Control, SessionStart, error_message
from app.services.evaluation_sequence import load_reference
from app.services.realtime_evaluation import QualityPolicy, evaluate_sequences
from app.streaming.config import RealtimeSettings
from app.streaming.frame_decoder import FrameError, parse_frame
from app.streaming.realtime_processor import RealtimeProcessor
from app.streaming.session import StreamingSession


router = APIRouter()
logger = logging.getLogger(__name__)
WARNING = "Scores experimentales de demostración; no calibrados para LSEC."
RECOGNITION = {"status": "experimental", "model": "WLASL", "top_k": [],
               "warning": "Reconocimiento ASL experimental; no validado para LSEC."}


def _result(session, reference, final=False, demo_mode=False):
    start = perf_counter()
    candidate = session.candidate()
    if candidate is None:
        parameters = {name: {"status": "insufficient_data", "distance": None,
                             "demo_score": None}
                      for name in ("handshape", "orientation", "location", "movement", "non_manual")}
        overall = {"status": "insufficient_data", "demo_score": None}
    else:
        parameters, overall = evaluate_sequences(
            reference, candidate, demo_mode,
            QualityPolicy(session.settings.min_coverage, session.settings.max_missing_gap_seconds))
    session.evaluation_latency_ms = (perf_counter() - start) * 1000
    return {"type": "evaluation.final" if final else "evaluation.partial",
            "protocol_version": "1.0", "session_id": session.session_id,
            "reference_id": session.reference_id,
            "frame_sequence": session.last_frame_sequence,
            "timestamp_ms": session.last_processed_timestamp,
            "status": "complete" if final else "partial",
            "quality": session.quality(), "parameters": parameters,
            "overall": overall, "recognition": RECOGNITION,
            "warnings": [WARNING, RECOGNITION["warning"]]}


@router.websocket("/ws/v1/visena/evaluate")
async def evaluate_websocket(websocket: WebSocket):
    await websocket.accept()
    settings = getattr(websocket.app.state, "realtime_settings", None) or RealtimeSettings()
    session = None
    worker = None
    processor = None
    send_lock = asyncio.Lock()
    disconnect_reason = "unknown"

    async def send(message):
        async with send_lock:
            await websocket.send_json(message)

    async def error(code, message, recoverable=True):
        await send(error_message(code, message, recoverable,
                                 session.session_id if session else None))

    async def consume(reference):
        while True:
            generation, timestamp, sequence, jpeg = await session.frame_queue.get()
            try:
                started = perf_counter()
                loop = asyncio.get_running_loop()
                width, height, regions = await loop.run_in_executor(
                    session.executor, processor.process, jpeg, timestamp)
                if generation != session.generation:
                    continue
                session.processing_latency_ms = (perf_counter() - started) * 1000
                session.append(timestamp, sequence, width, height, regions)
                if (session.last_evaluation_timestamp is None or
                    timestamp - session.last_evaluation_timestamp >= settings.evaluation_interval_ms):
                    result = await loop.run_in_executor(session.executor, _result,
                                                         session, reference, False, demo_mode)
                    session.last_evaluation_timestamp = timestamp
                    await send(result)
            except FrameError as exc:
                await error("INVALID_FRAME", str(exc))
            except Exception:
                logger.exception("Processing failed session_id=%s reference_id=%s",
                                 session.session_id, session.reference_id)
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
                raise ValueError("Se requiere session.start en JSON.")
            start = SessionStart.model_validate_json(first["text"])
            if (start.capture.width > settings.max_width or
                start.capture.height > settings.max_height or
                start.capture.fps > settings.max_input_fps or
                (start.demo_mode and not settings.demo_mode)):
                raise ValueError("Captura o modo de demostración fuera de los límites.")
        except (ValidationError, ValueError):
            await error("INVALID_MESSAGE", "session.start inválido o versión incompatible.", False)
            disconnect_reason = "invalid_start"
            return
        reference_id = start.reference_id.hex
        try:
            reference = await asyncio.to_thread(load_reference, reference_id)
        except (FileNotFoundError, KeyError, ValueError):
            await error("REFERENCE_NOT_FOUND", "Referencia no encontrada.", False)
            disconnect_reason = "reference_not_found"
            return
        session = StreamingSession(reference_id, settings)
        loop = asyncio.get_running_loop()
        factory = getattr(websocket.app.state, "realtime_processor_factory", RealtimeProcessor)
        try:
            processor = await loop.run_in_executor(session.executor, factory, settings)
        except Exception:
            logger.exception("Landmarker startup failed reference_id=%s", reference_id)
            await error("INFERENCE_ERROR", "No se pudo iniciar MediaPipe.", False)
            disconnect_reason = "inference_start_failed"
            return
        demo_mode = start.demo_mode
        worker = asyncio.create_task(consume(reference))
        await send({"type": "session.ready", "protocol_version": "1.0",
                    "session_id": session.session_id, "reference_id": reference_id,
                    "status": "ready"})
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
                await send({"type": "session.ping", "protocol_version": "1.0",
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
                control = Control.model_validate_json(incoming.get("text") or "")
            except ValidationError:
                await error("INVALID_MESSAGE", "Mensaje de control inválido.")
                continue
            if control.type == "evaluation.begin":
                session.clear_execution()
                session.active = True
                await send({"type": "evaluation.started", "protocol_version": "1.0",
                            "session_id": session.session_id})
            elif control.type == "evaluation.reset":
                session.clear_execution()
                session.active = False
                await send({"type": "evaluation.reset", "protocol_version": "1.0",
                            "session_id": session.session_id})
            elif control.type == "evaluation.end":
                if not session.active:
                    await error("EVALUATION_NOT_STARTED", "No hay evaluación activa.")
                    continue
                await session.frame_queue.join()
                session.active = False
                result = await loop.run_in_executor(session.executor, _result,
                                                     session, reference, True, demo_mode)
                await send(result)
            elif control.type == "session.stop":
                disconnect_reason = "session_stop"
                await send({"type": "session.stopped", "protocol_version": "1.0",
                            "session_id": session.session_id})
                break
    except WebSocketDisconnect:
        disconnect_reason = "client_disconnect"
    except Exception:
        disconnect_reason = "internal_error"
        logger.exception("WebSocket failed session_id=%s", session.session_id if session else None)
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
                    logger.exception("Landmarker cleanup failed session_id=%s", session.session_id)
            session.executor.shutdown(wait=True)
            session.landmark_buffer.clear()
            logger.info("session_closed %s", json.dumps({
                "session_id": session.session_id, "reference_id": session.reference_id,
                "frames_received": session.frames_received,
                "frames_processed": session.frames_processed,
                "frames_dropped": session.frames_dropped,
                "processing_latency_ms": round(session.processing_latency_ms, 2),
                "evaluation_latency_ms": round(session.evaluation_latency_ms, 2),
                "disconnect_reason": disconnect_reason}))
        try:
            await websocket.close()
        except (RuntimeError, WebSocketDisconnect):
            pass
