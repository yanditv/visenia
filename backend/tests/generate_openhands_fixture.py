"""Generate offline regression vectors from pinned upstream OpenHands classes.

Run manually with .venv-openhands, never as part of normal tests. Only synthetic
coordinates are stored. No camera capture or reference video is used.
"""

import ast
import hashlib
import json
from pathlib import Path
import sys
import urllib.request

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from infer_openhands import CHECKPOINT, load_model


COMMIT = "975b08807c40579708093a03918b4679a91a07e6"
SOURCES = {
    "openhands/models/decoder/utils.py": "3b609ec51ecb89974324b30edbe70d8f1bd73a8e23c289ffc4418ef2abbe3e53",
    "openhands/models/decoder/rnn.py": "ffe11359da5d74ea58feb50809b1c5261e9ef5b8e9567aeafa7dda9997092cb3",
    "openhands/models/encoder/graph/pose_flattener.py": "0af8a5a5f05113a33348916eef03ef84a33b31b6f186ceafbb884c289509fff9",
}


def main():
    torch.set_num_threads(1)
    namespace = {"torch": torch, "nn": nn, "F": F, "__name__": "upstream_reference"}
    for filename, expected_hash in SOURCES.items():
        url = f"https://raw.githubusercontent.com/AI4Bharat/OpenHands/{COMMIT}/{filename}"
        with urllib.request.urlopen(url, timeout=20) as stream:
            source = stream.read()
        if hashlib.sha256(source).hexdigest() != expected_hash:
            raise RuntimeError("Upstream source hash mismatch")
        tree = ast.parse(source)
        classes = ast.Module(body=[node for node in tree.body if isinstance(node, ast.ClassDef)], type_ignores=[])
        exec(compile(classes, filename, "exec"), namespace)
    actual = load_model(torch.device("cpu"))
    reference = nn.Sequential(
        namespace["PoseFlattener"](in_channels=2, num_points=27),
        namespace["RNNClassifier"](54, 2000, rnn_type="LSTM", hidden_size=128,
                                   num_layers=2, bidirectional=True, use_attention=True),
    ).eval()
    reference[1].load_state_dict(actual.model.decoder.state_dict(), strict=True)
    rng = np.random.default_rng(1729)
    arrays = {}
    for index, shape in enumerate(((1, 2, 7, 27), (2, 2, 11, 27), (1, 2, 90, 27))):
        frames = rng.normal(size=shape).astype(np.float32)
        with torch.inference_mode():
            logits = reference(torch.from_numpy(frames)).numpy()
        arrays[f"input_{index}"] = frames
        arrays[f"logits_{index}"] = logits
    folder = Path(__file__).parent / "fixtures"
    folder.mkdir(exist_ok=True)
    np.savez_compressed(folder / "openhands-upstream.npz", **arrays)
    (folder / "openhands-upstream.json").write_text(json.dumps({
        "upstream_commit": COMMIT,
        "source_sha256": SOURCES,
        "checkpoint_sha256": hashlib.sha256(CHECKPOINT.read_bytes()).hexdigest(),
        "description": "Synthetic inputs and full logits produced by the unmodified upstream classes on CPU.",
    }, indent=2), encoding="utf-8")
    print("Generated 3 upstream compatibility vectors.")


if __name__ == "__main__":
    main()
