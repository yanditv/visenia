import subprocess

from app.services.openhands_runtime import BASE_DIR, PYTHON_PATH


def test_checkpoint_inference_matches_pinned_upstream_vectors():
    # Execute in the dedicated Torch environment. These logits come from the
    # upstream classes, rather than from our reimplementation.
    code = """
import hashlib
import json
import numpy as np
import torch
from infer_openhands import CHECKPOINT, load_labels, load_model
torch.set_num_threads(1)
meta = json.load(open('tests/fixtures/openhands-upstream.json', encoding='utf-8'))
assert hashlib.sha256(CHECKPOINT.read_bytes()).hexdigest() == meta['checkpoint_sha256']
model = load_model(torch.device('cpu'))
labels = load_labels()
assert len(labels) == len(set(labels)) == 2000
assert labels == sorted(labels) and 'drink' in labels
with np.load('tests/fixtures/openhands-upstream.npz') as fixture:
    for i in range(3):
        with torch.inference_mode():
            logits = model(torch.from_numpy(fixture[f'input_{i}'])).numpy()
        np.testing.assert_allclose(logits, fixture[f'logits_{i}'], rtol=1e-5, atol=1e-5)
"""
    result = subprocess.run([str(PYTHON_PATH), "-c", code], cwd=BASE_DIR,
                            capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stderr[-2500:]


def test_bert_checkpoint_uses_frame_order_and_is_repeatable():
    code = """
import hashlib
import torch
from infer_bert import CHECKPOINT, load_model
assert hashlib.sha256(CHECKPOINT.read_bytes()).hexdigest() == '4c5f0a606b76f32a47b132e50a199bc626dff38f5108b2cb4007be077e85e090'
torch.set_num_threads(1)
model = load_model(torch.device('cpu'))
torch.manual_seed(23)
x = torch.randn(1, 2, 120, 27)
with torch.inference_mode():
    original = model(x)
    repeated = model(x)
    reversed_clip = model(x.flip(2))
torch.testing.assert_close(original, repeated, rtol=0, atol=0)
assert (original - reversed_clip).abs().max().item() > 1e-3
"""
    result = subprocess.run([str(PYTHON_PATH), "-c", code], cwd=BASE_DIR,
                            capture_output=True, text=True, timeout=90)
    assert result.returncode == 0, result.stderr[-2500:]
