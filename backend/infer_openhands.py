
import json
import sys
from pathlib import Path
from uuid import UUID

import numpy as np
import torch
import torch.nn as nn


BASE = Path(__file__).resolve().parent

CHECKPOINT = (
    BASE / "models/openhands/wlasl/lstm"
    / "epoch=109-step=49059.ckpt"
)

METADATA = (
    BASE / "models/openhands/splits/asl2000.json"
)

INPUT_DIR = BASE / "data/openhands"


# Objetos históricos del checkpoint
class LegacyModelCheckpoint:
    pass


class LegacyEarlyStopping:
    pass


# Atención original de OpenHands
class AttentionBlock(nn.Module):
    def __init__(self, hidden_size):
        super().__init__()

        self.fc1 = nn.Linear(
            hidden_size, hidden_size, bias=False
        )

        self.fc2 = nn.Linear(
            hidden_size * 2, hidden_size, bias=False
        )

    def forward(self, hidden_states):
        scores = self.fc1(hidden_states)

        last_hidden = hidden_states[:, -1, :]

        weights = torch.softmax(
            torch.bmm(
                scores,
                last_hidden.unsqueeze(2)
            ).squeeze(2),
            dim=1
        )

        context = torch.bmm(
            hidden_states.permute(0, 2, 1),
            weights.unsqueeze(2)
        ).squeeze(2)

        combined = torch.cat(
            (context, last_hidden),
            dim=1
        )

        return torch.tanh(self.fc2(combined))


# BiLSTM compatible con el checkpoint
class RNNClassifier(nn.Module):
    def __init__(self):
        super().__init__()

        self.rnn = nn.LSTM(
            input_size=54,
            hidden_size=128,
            num_layers=2,
            bidirectional=True
        )

        self.attn_block = AttentionBlock(256)

        self.fc = nn.Linear(256, 2000)

    def forward(self, x):
        self.rnn.flatten_parameters()

        output, _ = self.rnn(x)

        attended = self.attn_block(output)

        return self.fc(attended)


class OpenHandsModel(nn.Module):
    def __init__(self):
        super().__init__()

        # Mantener los nombres originales de los pesos
        self.model = nn.Module()
        self.model.decoder = RNNClassifier()

    def forward(self, x):
        # (B, C, T, V) -> (B, T, C * V)
        x = x.permute(0, 2, 1, 3)
        x = x.flatten(start_dim=2)

        return self.model.decoder(x)


def load_model(device):
    expected_globals = {
        "pytorch_lightning.callbacks."
        "model_checkpoint.ModelCheckpoint",
        "pytorch_lightning.callbacks."
        "early_stopping.EarlyStopping"
    }

    actual_globals = set(
        torch.serialization.get_unsafe_globals_in_checkpoint(
            CHECKPOINT
        )
    )

    if actual_globals != expected_globals:
        raise RuntimeError(
            f"Objetos no esperados: {actual_globals}"
        )

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

    model = OpenHandsModel()

    # Falla si algún peso falta o no coincide.
    model.load_state_dict(
        checkpoint["state_dict"],
        strict=True
    )

    model.to(device)
    model.eval()

    return model


def load_labels():
    with METADATA.open("r", encoding="utf-8") as file:
        records = json.load(file)

    # Es el orden usado por WLASLDataset.
    return sorted(
        entry["gloss"] for entry in records
    )


def predict(processing_id):
    uid = UUID(processing_id).hex

    input_file = INPUT_DIR / f"{uid}.npz"

    if not input_file.is_file():
        raise FileNotFoundError(input_file)

    with np.load(input_file) as data:
        frames = data["frames"].astype(np.float32)
        mask = data["mask"].astype(bool)

    if frames.ndim != 3 or frames.shape[0] != 2:
        raise ValueError("Canales invalidos.")

    if frames.shape[2] != 27:
        raise ValueError("Se esperaban 27 landmarks.")

    if mask.shape != (frames.shape[1], 27):
        raise ValueError("Mascara incompatible.")

    if not np.isfinite(frames).all():
        raise ValueError("Entrada no finita.")

    device = torch.device(
        "cuda" if torch.cuda.is_available() else "cpu"
    )

    print("Dispositivo:", device, file=sys.stderr)

    model = load_model(device)
    labels = load_labels()

    if len(labels) != 2000:
        raise ValueError("Etiquetas incompatibles.")

    # Agregar dimensión del batch.
    x = torch.from_numpy(
        frames.copy()
    ).unsqueeze(0).to(device)

    with torch.inference_mode():
        logits = model(x)
        probabilities = torch.softmax(logits, dim=1)

        values, indices = torch.topk(
            probabilities[0],
            k=5
        )

    predictions = []

    for index, probability in zip(
        indices.cpu().tolist(),
        values.cpu().tolist()
    ):
        predictions.append({
            "class_id": index,
            "gloss": labels[index],
            "score": round(
                float(probability), 6
            )
        })

    return {
        "status": "success",
        "processing_id": uid,
        "device": str(device),
        "input_shape": list(x.shape),
        "classes": len(labels),
        "predictions": predictions
    }


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(
            "Uso: python infer_openhands.py <id>"
        )

    result = predict(sys.argv[1])

    print(json.dumps(
        result,
        indent=2,
        ensure_ascii=False
    ))
