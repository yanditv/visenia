"""Inference for the official OpenHands WLASL2000 temporal BERT checkpoint.

The original OpenHands BiLSTM checkpoint treats the batch dimension as time;
this checkpoint has positional embeddings and attends over all 120 frames.
"""

import json
import sys

import numpy as np
import torch
from torch import nn
from transformers import BertConfig
from transformers.models.bert.modeling_bert import BertLayer

from infer_openhands import (
    BASE, LegacyEarlyStopping, LegacyModelCheckpoint, load_labels,
)


CHECKPOINT = BASE / "models/openhands/wlasl/bert/epoch=392-step=175670.ckpt"
MODEL_NAME = "OpenHands/BERT-WLASL2000"


class PositionEmbedding(nn.Module):
    def __init__(self):
        super().__init__()
        self.position_embeddings = nn.Embedding(121, 96)
        self.LayerNorm = nn.LayerNorm(96, eps=1e-12)
        self.dropout = nn.Dropout(0.1)
        self.register_buffer("position_ids", torch.arange(121).expand((1, -1)))

    def forward(self, x):
        positions = self.position_embeddings(self.position_ids[:, :x.shape[1]])
        return self.dropout(self.LayerNorm(x + positions))


class BERTClassifier(nn.Module):
    def __init__(self):
        super().__init__()
        self.cls_param = nn.Parameter(torch.empty(96))
        self.l1 = nn.Linear(54, 96)
        self.embedding = PositionEmbedding()
        config = BertConfig(hidden_size=96, num_attention_heads=6, num_hidden_layers=3)
        config._attn_implementation = "eager"
        self.layers = nn.ModuleList(BertLayer(config) for _ in range(3))
        self.l2 = nn.Linear(96, 2000)

    def forward(self, x):
        x = self.l1(x)
        x = torch.cat((self.cls_param[None, None].expand(x.shape[0], -1, -1), x), dim=1)
        x = self.embedding(x)
        for layer in self.layers:
            x = layer(x)[0]
        # OpenHands calls F.dropout without a training argument here, which
        # also drops features in eval mode. Inference must be repeatable.
        x = nn.functional.dropout(x[:, 0], p=0.2, training=self.training)
        return self.l2(x)


class OpenHandsBERT(nn.Module):
    def __init__(self):
        super().__init__()
        self.model = nn.Module()
        self.model.decoder = BERTClassifier()

    def forward(self, frames):
        x = frames.permute(0, 2, 1, 3).flatten(start_dim=2)
        return self.model.decoder(x)


def load_model(device):
    if not CHECKPOINT.is_file():
        raise FileNotFoundError(
            f"Falta {CHECKPOINT}. Ejecuta install_bert.ps1 antes de iniciar el servidor.")
    expected_globals = {
        "pytorch_lightning.callbacks.model_checkpoint.ModelCheckpoint",
        "pytorch_lightning.callbacks.early_stopping.EarlyStopping",
    }
    if set(torch.serialization.get_unsafe_globals_in_checkpoint(CHECKPOINT)) != expected_globals:
        raise RuntimeError("El checkpoint contiene objetos no esperados.")
    with torch.serialization.safe_globals([
        (LegacyModelCheckpoint, "pytorch_lightning.callbacks.model_checkpoint.ModelCheckpoint"),
        (LegacyEarlyStopping, "pytorch_lightning.callbacks.early_stopping.EarlyStopping"),
    ]):
        checkpoint = torch.load(CHECKPOINT, map_location="cpu", weights_only=True)
    model = OpenHandsBERT()
    model.load_state_dict(checkpoint["state_dict"], strict=True)
    model.to(device).eval()
    return model


def predict_arrays(frames, mask, target_gloss):
    frames = np.asarray(frames, dtype=np.float32)
    mask = np.asarray(mask, dtype=bool)
    if frames.shape != (2, 120, 27) or mask.shape != (120, 27):
        raise ValueError("La entrada BERT debe tener 120 fotogramas y 27 puntos.")
    if not np.isfinite(frames).all():
        raise ValueError("Entrada no finita.")
    labels = load_labels()
    if len(labels) != 2000 or target_gloss not in labels:
        raise ValueError("Glosa ASL no reconocida por WLASL2000.")
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = load_model(device)
    x = torch.from_numpy(frames.copy()).unsqueeze(0).to(device)
    with torch.inference_mode():
        probabilities = model(x).softmax(dim=1)[0]
        values, indices = torch.topk(probabilities, 5)
    return {
        "status": "success",
        "model": MODEL_NAME,
        "device": str(device),
        "input_shape": list(x.shape),
        "classes": len(labels),
        "target_gloss": target_gloss,
        "target_probability": float(probabilities[labels.index(target_gloss)].item()),
        "predictions": [
            {"class_id": i, "gloss": labels[i], "score": round(float(v), 6)}
            for i, v in zip(indices.cpu().tolist(), values.cpu().tolist())
        ],
    }


if __name__ == "__main__":
    if sys.argv[1:] == ["--check"]:
        load_model(torch.device("cpu"))
        print("BERT checkpoint loaded")
        raise SystemExit(0)
    if sys.argv[1:] != ["--stdin"]:
        raise SystemExit("Uso: python infer_bert.py --check | --stdin")
    payload = json.load(sys.stdin)
    print(json.dumps(predict_arrays(
        payload["frames"], payload["mask"], payload["target_gloss"]),
        ensure_ascii=False))
