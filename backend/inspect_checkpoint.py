
import json
from pathlib import Path

import torch


# Clases auxiliares para checkpoints antiguos
class LegacyModelCheckpoint:
    pass


class LegacyEarlyStopping:
    pass


BASE = Path(__file__).resolve().parent

CHECKPOINT = (
    BASE / "models" / "openhands"
    / "wlasl" / "lstm"
    / "epoch=109-step=49059.ckpt"
)

METADATA = (
    BASE / "models" / "openhands"
    / "splits" / "asl2000.json"
)


def inspect_checkpoint():
    print("\n=== CHECKPOINT OPENHANDS ===")

    if not CHECKPOINT.is_file():
        raise FileNotFoundError(CHECKPOINT)

    # 1. Identificar los objetos restringidos
    expected_globals = {
        "pytorch_lightning.callbacks."
        "model_checkpoint.ModelCheckpoint",

        "pytorch_lightning.callbacks."
        "early_stopping.EarlyStopping"
    }

    unsafe_globals = set(
        torch.serialization.get_unsafe_globals_in_checkpoint(
            CHECKPOINT
        )
    )

    print("Objetos restringidos:", unsafe_globals)

    if unsafe_globals != expected_globals:
        raise RuntimeError(
            f"Objetos inesperados: {unsafe_globals}"
        )

    # 2. Cargar el checkpoint con restricciones
    with torch.serialization.safe_globals([
        (
            LegacyModelCheckpoint,
            "pytorch_lightning.callbacks."
            "model_checkpoint.ModelCheckpoint"
        ),
        (
            LegacyEarlyStopping,
            "pytorch_lightning.callbacks."
            "early_stopping.EarlyStopping"
        )
    ]):
        checkpoint = torch.load(
            CHECKPOINT,
            map_location="cpu",
            weights_only=True
        )

    state = checkpoint.get(
        "state_dict", checkpoint
    )

    print("Checkpoint cargado correctamente")
    print("Tensores:", len(state))

    # 3. Inspeccionar arquitectura
    print("\n=== ARQUITECTURA ===")

    rnn_key = next(
        (
            key for key in state
            if key.endswith("rnn.weight_ih_l0")
        ),
        None
    )

    fc_key = next(
        (
            key for key in state
            if key.endswith("fc.weight")
        ),
        None
    )

    if rnn_key is None or fc_key is None:
        print("No se encontraron las capas esperadas")
        print("Primeras claves:")

        for key in list(state)[:30]:
            print(key)

        return

    rnn_shape = tuple(state[rnn_key].shape)
    fc_shape = tuple(state[fc_key].shape)

    print("Capa LSTM:", rnn_key)
    print("LSTM weights:", rnn_shape)
    print("Clasificador:", fc_key)
    print("FC weights:", fc_shape)

    input_features = rnn_shape[1]
    num_classes = fc_shape[0]

    print("Input features:", input_features)
    print("Clases del checkpoint:", num_classes)

    if input_features % 27 == 0:
        print(
            "Canales por punto:",
            input_features // 27
        )

    # 4. Inspeccionar etiquetas WLASL
    print("\n=== ETIQUETAS WLASL ===")

    if not METADATA.is_file():
        raise FileNotFoundError(METADATA)

    with METADATA.open(
        "r", encoding="utf-8"
    ) as file:
        records = json.load(file)

    glosses = sorted(
        entry["gloss"] for entry in records
    )

    print("Etiquetas:", len(glosses))
    print("Clases unicas:", len(set(glosses)))

    for index in [0, 1, 2, len(glosses) - 1]:
        print(index, "->", glosses[index])

    # 5. Validar dimensiones
    print("\n=== VALIDACION ===")

    print(
        "Entrada de 2 x 27:",
        input_features == 54
    )

    print(
        "Clases coinciden:",
        num_classes == len(glosses)
    )


if __name__ == "__main__":
    inspect_checkpoint()
