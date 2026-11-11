
import sys
from uuid import UUID

import numpy as np
import torch

from infer_openhands import INPUT_DIR, load_model


def diagnose(processing_id):
    uid = UUID(processing_id).hex

    path = INPUT_DIR / f"{uid}.npz"

    with np.load(path) as data:
        frames = data["frames"].astype(np.float32)

    device = torch.device(
        "cuda" if torch.cuda.is_available() else "cpu"
    )

    model = load_model(device)

    x = torch.from_numpy(
        frames.copy()
    ).unsqueeze(0).to(device)

    # Entrada al LSTM después del PoseFlattener
    flattened = x.permute(0, 2, 1, 3).flatten(2)

    rnn = model.model.decoder.rnn

    print("\n=== DIAGNOSTICO LSTM ===")
    print("Dispositivo:", device)
    print("Entrada:", tuple(flattened.shape))
    print("batch_first:", rnn.batch_first)

    temporal_steps = (
        flattened.shape[1]
        if rnn.batch_first
        else flattened.shape[0]
    )

    print("Pasos temporales interpretados:", temporal_steps)

    # Alterar el orden conservando el último frame
    torch.manual_seed(42)

    frame_count = x.shape[2]

    indices = torch.cat([
        torch.randperm(
            frame_count - 1,
            device=device
        ),
        torch.tensor(
            [frame_count - 1],
            device=device
        )
    ])

    shuffled = x.index_select(2, indices)

    with torch.inference_mode():
        original = torch.softmax(model(x), dim=1)
        altered = torch.softmax(model(shuffled), dim=1)

    difference = (
        original - altered
    ).abs().max().item()

    similar = torch.allclose(
        original,
        altered,
        rtol=1e-5,
        atol=1e-6
    )

    print("\n=== PRUEBA DE ORDEN TEMPORAL ===")
    print("Diferencia maxima:", difference)
    print("Predicciones casi identicas:", bool(similar))

    print("\n=== RESULTADO ===")

    if temporal_steps == 1:
        print(
            "ADVERTENCIA: el LSTM no esta procesando "
            "los fotogramas como una secuencia temporal."
        )
    else:
        print(
            "El LSTM recibe multiples pasos temporales."
        )


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(
            "Uso: python diagnose_temporal.py <id>"
        )

    diagnose(sys.argv[1])
