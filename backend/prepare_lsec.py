"""Turn local LSEC reference videos into an experimental landmarks catalog."""

import argparse
from contextlib import ExitStack
import json
import math
from pathlib import Path
from shutil import which
from subprocess import TimeoutExpired, run
from tempfile import NamedTemporaryFile

import cv2
import mediapipe as mp

from app.services.lsec_catalog import ROOT, inventory, load_reference_record
from app.services.lsec_matching import automatic_segment


MODELS = ROOT / "frontend/app/public/models"


def detectors(stack):
    vision = mp.tasks.vision
    common = {"running_mode": vision.RunningMode.VIDEO}
    pose = stack.enter_context(vision.PoseLandmarker.create_from_options(
        vision.PoseLandmarkerOptions(
            base_options=mp.tasks.BaseOptions(model_asset_path=str(MODELS / "pose_landmarker.task")),
            **common,
        )
    ))
    hands = stack.enter_context(vision.HandLandmarker.create_from_options(
        vision.HandLandmarkerOptions(
            base_options=mp.tasks.BaseOptions(model_asset_path=str(MODELS / "hand_landmarker.task")),
            num_hands=2, **common,
        )
    ))
    face = stack.enter_context(vision.FaceLandmarker.create_from_options(
        vision.FaceLandmarkerOptions(
            base_options=mp.tasks.BaseOptions(model_asset_path=str(MODELS / "face_landmarker.task")),
            output_face_blendshapes=True, **common,
        )
    ))
    return pose, hands, face


def points(landmarks, include_visibility=False):
    result = []
    for point in landmarks:
        values = {axis: round(getattr(point, axis), 5) for axis in ("x", "y", "z")}
        if include_visibility:
            values["visibility"] = round(point.visibility, 4) if point.visibility is not None else 1
        result.append(values)
    return result


def hand_tracks(result, pose, previous, aspect):
    def cost(index, side):
        wrist = result.hand_landmarks[index][0]
        anchor = pose[15 if side == "izquierda" else 16] if pose else None
        if anchor is None or (anchor.visibility is not None and anchor.visibility <= 0.25):
            anchor = previous.get(side)
        if anchor is not None:
            return math.hypot((anchor.x - wrist.x) * aspect, anchor.y - wrist.y)
        label = result.handedness[index][0]
        expected = "Right" if side == "izquierda" else "Left"
        return 1 - label.score if label.category_name == expected else 1 + label.score

    sides = ("izquierda", "derecha")
    count = len(result.hand_landmarks)
    if count == 2:
        direct = cost(0, sides[0]) + cost(1, sides[1])
        crossed = cost(1, sides[0]) + cost(0, sides[1])
        order = (0, 1) if direct <= crossed else (1, 0)
        return {side: result.hand_landmarks[index] for side, index in zip(sides, order)}
    if count == 1:
        side = min(sides, key=lambda item: cost(0, item))
        return {side: result.hand_landmarks[0]}
    return {}


def read_video(path):
    frames = []
    with ExitStack() as stack:
        video = cv2.VideoCapture(str(path))
        stack.callback(video.release)
        fps = video.get(cv2.CAP_PROP_FPS)
        if not video.isOpened() or not math.isfinite(fps) or fps < 10:
            raise ValueError("Video ilegible o FPS insuficientes.")
        pose_detector, hand_detector, face_detector = detectors(stack)
        interval = max(1, round(fps / 24))
        previous = {}
        for index in range(math.ceil(fps * 60)):
            ok, bgr = video.read()
            if not ok:
                break
            if index % interval:
                continue
            ts = round(index * 1000 / fps)
            height, width = bgr.shape[:2]
            image = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
            pose = pose_detector.detect_for_video(image, ts)
            hands = hand_detector.detect_for_video(image, ts)
            face = face_detector.detect_for_video(image, ts)
            frame = {"frame_idx": len(frames), "timestamp_ms": ts}
            if pose.pose_landmarks:
                frame["pose"] = points(pose.pose_landmarks[0], include_visibility=True)
                frame["pose_world"] = points(pose.pose_world_landmarks[0], include_visibility=True)
            detected = hand_tracks(
                hands, pose.pose_landmarks[0] if pose.pose_landmarks else None, previous,
                width / height,
            )
            previous = {side: track[0] for side, track in detected.items()}
            for side, track in detected.items():
                frame[f"mano_{side}"] = points(track)
            if face.face_blendshapes:
                frame["blendshapes_rostro"] = {
                    shape.category_name: round(shape.score, 4) for shape in face.face_blendshapes[0]
                }
            frames.append(frame)
    if len(frames) < 4:
        raise ValueError("Menos de cuatro cuadros decodificables.")
    return frames, width, height, fps / interval


def draft(path, source, override):
    frames, width, height, fps = read_video(path)
    if override:
        start, end, side = (override[key] for key in ("inicio", "fin", "mano_dominante"))
        if not 0 <= start < end < len(frames):
            raise ValueError("El intervalo indicado está fuera del video.")
    else:
        start, end, side = automatic_segment(frames, width, height)
    offset = frames[start]["timestamp_ms"]
    trimmed = [dict(frame, frame_idx=index, timestamp_ms=frame["timestamp_ms"] - offset)
               for index, frame in enumerate(frames[start:end + 1])]
    record = {
        "ancho": width, "alto": height, "fuente_url": source["video_url"],
        "intervalo_video_ms": [offset, frames[end]["timestamp_ms"]],
        "segmentacion_automatica": not override,
        "referencia": {
            "id": source["id_propuesto"], "glosa": source["glosa_propuesta"],
            "unidad_tematica": source["unidad_tematica"], "mano_dominante": side,
            "segmentacion": {"frame_inicio_sena": 0, "frame_fin_sena": len(trimmed) - 1},
            "metadatos_grabacion": {"fps": round(fps, 4), "total_frames": len(trimmed),
                                     "duracion_ms": trimmed[-1]["timestamp_ms"]},
            "frames": trimmed,
        },
    }
    load_reference_record(record, "draft")
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("videos", type=Path, help="Directorio con archivos <video_id>.mp4 o <ref-id>.mp4")
    parser.add_argument("salida", type=Path, help="Ruta del catálogo experimental JSON")
    parser.add_argument("--version", required=True, help="Versión identificable del paquete experimental")
    parser.add_argument("--intervalos", type=Path, help="Mapa opcional de ref-id a inicio, fin, mano_dominante")
    parser.add_argument("--descargar", action="store_true", help="Obtener los clips faltantes del inventario con yt-dlp")
    args = parser.parse_args()
    downloader = which("yt-dlp") if args.descargar else None
    if args.descargar and downloader is None:
        parser.error("--descargar requiere yt-dlp en PATH.")
    overrides = json.loads(args.intervalos.read_text(encoding="utf-8-sig")) if args.intervalos else {}
    records = []
    for source in inventory():
        reference_id = source["id_propuesto"]
        video = next((path for name in (source["video_id"], reference_id)
                      for extension in ("mp4", "webm", "mov")
                      if (path := args.videos / f"{name}.{extension}").is_file()), None)
        if video is None and downloader is not None:
            args.videos.mkdir(parents=True, exist_ok=True)
            try:
                downloaded = run([
                    downloader, "--ignore-config", "--no-playlist", "--quiet",
                    "--socket-timeout", "10", "--retries", "1",
                    "-f", "bestvideo[ext=mp4][protocol=https][height<=480]/bestvideo[ext=mp4][height<=480]",
                    "--paths", str(args.videos), "-o", "%(id)s.%(ext)s", source["video_url"],
                ], timeout=90, check=False)
            except TimeoutExpired:
                print(f"{reference_id}: tiempo de descarga agotado.", flush=True)
                continue
            expected = args.videos / f"{source['video_id']}.mp4"
            if downloaded.returncode == 0 and expected.is_file():
                video = expected
        if video is None:
            print(f"{reference_id}: falta el archivo local.", flush=True)
            continue
        try:
            record = draft(video, source, overrides.get(reference_id))
        except (ValueError, RuntimeError, KeyError) as error:
            print(f"{reference_id}: {error}", flush=True)
            continue
        records.append(record)
        print(f"{reference_id}: {record['intervalo_video_ms']} {record['referencia']['mano_dominante']}", flush=True)
    if not records:
        parser.exit(1, "Ninguna referencia superó la extracción. No se escribió un catálogo.\n")
    args.salida.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with NamedTemporaryFile(mode="w", encoding="utf-8", dir=args.salida.parent, delete=False) as stream:
            temporary = Path(stream.name)
            json.dump({"version": args.version, "referencias": records},
                      stream, ensure_ascii=False, allow_nan=False)
        temporary.replace(args.salida)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    print(f"{len(records)} referencias experimentales preparadas en {args.salida}.")


if __name__ == "__main__":
    main()
