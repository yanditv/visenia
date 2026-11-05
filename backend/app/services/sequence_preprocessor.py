
from pathlib import Path
import sys

import numpy as np


COUNTS = {
    "left_hand": 21,
    "right_hand": 21,
    "pose": 33,
    "face": 478,
}


def resample_with_mask(
    sequence,
    timestamps,
    targets,
    max_gap_ms=300
):
    output = np.full(
        (len(targets), *sequence.shape[1:]),
        np.nan,
        dtype=np.float32
    )

    mask = np.zeros(len(targets), dtype=bool)

    observed = np.isfinite(sequence).all(axis=(1, 2))

    valid_times = timestamps[observed]
    valid_values = sequence[observed]

    for i, time in enumerate(targets):
        j = np.searchsorted(valid_times, time)

        if (
            j < len(valid_times)
            and np.isclose(
                valid_times[j], time, atol=0.01
            )
        ):
            output[i] = valid_values[j]
            mask[i] = True

        elif 0 < j < len(valid_times):
            first = valid_times[j - 1]
            last = valid_times[j]

            if 0 < last - first <= max_gap_ms:
                weight = (time - first) / (last - first)

                output[i] = (
                    (1 - weight) * valid_values[j - 1]
                    + weight * valid_values[j]
                )
                mask[i] = True

    return output, mask


def preprocess(
    source: Path,
    destination: Path,
    target_frames: int = 64
):
    with np.load(source) as raw:
        timestamps = np.asarray(
            raw["timestamps_ms"],
            dtype=np.float64
        )

        width = int(raw["frame_width"])
        height = int(raw["frame_height"])

        data = {
            name: np.asarray(raw[name], dtype=np.float32)
            for name in COUNTS
        }

    if (
        width <= 0
        or height <= 0
        or len(timestamps) < 2
        or np.any(np.diff(timestamps) <= 0)
    ):
        raise ValueError(
            "Dimensiones o timestamps invalidos."
        )

    for name, count in COUNTS.items():
        expected = (len(timestamps), count, 3)

        if data[name].shape != expected:
            raise ValueError(
                f"Dimensiones incorrectas en {name}."
            )

    # Hombros: indices 11 y 12 de MediaPipe Pose.
    shoulders = (
        data["pose"][:, [11, 12], :2]
        * np.array([width, height])
    )

    valid_shoulders = np.isfinite(
        shoulders
    ).all(axis=(1, 2))

    centers = shoulders.mean(axis=1)

    scales = np.linalg.norm(
        shoulders[:, 0] - shoulders[:, 1],
        axis=1
    )

    usable = (
        valid_shoulders
        & np.isfinite(scales)
        & (scales >= 5.0)
    )

    if not usable.any():
        raise ValueError(
            "No hay hombros suficientes para normalizar."
        )

    # Referencia alternativa para frames sin hombros.
    fallback_center = np.median(
        centers[usable], axis=0
    )
    fallback_scale = float(
        np.median(scales[usable])
    )

    centers[~usable] = fallback_center
    scales[~usable] = fallback_scale

    targets = np.linspace(
        timestamps[0],
        timestamps[-1],
        target_frames
    )

    normalized = {}
    sampled = {}
    masks = {}
    original_masks = {}

    for name, sequence in data.items():
        norm = sequence.copy()

        # Normalizar X e Y respecto al cuerpo.
        norm[:, :, 0] = (
            sequence[:, :, 0] * width
            - centers[:, 0, None]
        ) / scales[:, None]

        norm[:, :, 1] = (
            sequence[:, :, 1] * height
            - centers[:, 1, None]
        ) / scales[:, None]

        # Z permanece sin transformar en esta etapa.
        normalized[name] = norm

        original_masks[name] = np.isfinite(
            sequence
        ).all(axis=(1, 2))

        sampled[name], masks[name] = (
            resample_with_mask(
                norm,
                timestamps,
                targets
            )
        )

    # Formato provisional: 33 + 21 + 21 = 75 puntos.
    model_keypoints = np.concatenate(
        [
            sampled["pose"],
            sampled["left_hand"],
            sampled["right_hand"]
        ],
        axis=1
    )

    model_mask = np.concatenate(
        [
            np.repeat(
                masks[name][:, None],
                COUNTS[name],
                axis=1
            )
            for name in (
                "pose",
                "left_hand",
                "right_hand"
            )
        ],
        axis=1
    )

    destination.parent.mkdir(
        parents=True,
        exist_ok=True
    )

    np.savez_compressed(
        destination,
        timestamps_ms=timestamps.astype(np.int64),
        standardized_timestamps_ms=targets,
        model_keypoints=np.nan_to_num(
            model_keypoints, nan=0.0
        ),
        model_mask=model_mask,
        **{
            f"dtw_{name}": normalized[name]
            for name in COUNTS
        },
        **{
            f"dtw_{name}_mask": original_masks[name]
            for name in COUNTS
        },
        **{
            f"model_{name}": np.nan_to_num(
                sampled[name], nan=0.0
            )
            for name in COUNTS
        },
        **{
            f"model_{name}_mask": masks[name]
            for name in COUNTS
        }
    )

    return {
        "source_frames": len(timestamps),
        "model_frames": target_frames,
        "model_keypoints_shape": model_keypoints.shape,
        "detection_pct": {
            name: round(
                100 * np.mean(original_masks[name]), 1
            )
            for name in COUNTS
        }
    }


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(
            "Uso: python -m "
            "app.services.sequence_preprocessor "
            "<processing_id>"
        )

    processing_id = sys.argv[1]

    if not (
        len(processing_id) == 32
        and all(
            c in "0123456789abcdef"
            for c in processing_id
        )
    ):
        raise SystemExit("ID invalido.")

    source = (
        Path("data/processed")
        / f"{processing_id}.npz"
    )

    destination = (
        Path("data/preprocessed")
        / f"{processing_id}.npz"
    )

    if not source.exists():
        raise SystemExit(
            "Archivo no encontrado. "
            "Vuelve a procesar el video."
        )

    result = preprocess(source, destination)

    print(result)
    print(f"Guardado: {destination}")
