
import sys
from uuid import UUID

import numpy as np
import torch

from infer_openhands import (
    INPUT_DIR,
    load_model,
    load_labels,
)


def compare(processing_id: str):
    uid = UUID(processing_id).hex

    path = INPUT_DIR / f"{uid}.npz"

    with np.load(path) as data:
        frames = data["frames"].astype(np.float32)

    device = torch.device(
        "cuda" if torch.cuda.is_available() else "cpu"
    )

    model = load_model(device)
    labels = load_labels()

    x = torch.from_numpy(
        frames.copy()
    ).unsqueeze(0).to(device)

    # Mezclar fotogramas conservando el ultimo.
    rng = np.random.default_rng(42)

    order = np.concatenate([
        rng.permutation(frames.shape[1] - 1),
        [frames.shape[1] - 1]
    ])

    indices = torch.tensor(
        order,
        device=device,
        dtype=torch.long
    )

    shuffled = x.index_select(2, indices)

    rnn = model.model.decoder.rnn

    print("\n=== COMPARACION TEMPORAL ===")
    print("Dispositivo:", device)
    print("Entrada:", tuple(x.shape))

    for name, batch_first in [
        ("LEGACY", False),
        ("TEMPORAL", True)
    ]:
        rnn.batch_first = batch_first

        with torch.inference_mode():
            original = torch.softmax(
                model(x), dim=1
            )[0]

            altered = torch.softmax(
                model(shuffled), dim=1
            )[0]

        difference = torch.max(
            torch.abs(original - altered)
        ).item()

        values, indices = torch.topk(
            original, k=3
        )

        print(f"\n=== {name} ===")
        print("batch_first:", batch_first)

        print(
            "Pasos temporales:",
            frames.shape[1] if batch_first else 1
        )

        print("Diferencia al mezclar:", difference)

        print("Top 3:")

        for idx, value in zip(
            indices.cpu().tolist(),
            values.cpu().tolist()
        ):
            print(
                f"  {labels[idx]}: {value:.4%}"
            )


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(
            "Uso: python compare_temporal_modes.py <id>"
        )

    compare(sys.argv[1])
