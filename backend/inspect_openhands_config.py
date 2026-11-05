
from pathlib import Path
import json
import yaml

BASE = Path("models/openhands")

CONFIG_PATH = BASE / "wlasl/lstm/lstm.yaml"
CHECKPOINT_PATH = (
    BASE / "wlasl/lstm/epoch=109-step=49059.ckpt"
)

with CONFIG_PATH.open("r", encoding="utf-8") as file:
    config = yaml.safe_load(file)

model = config.get("model", {})
encoder = model.get("encoder", {})
decoder = model.get("decoder", {})

data = config.get("data", {})
validation = data.get("valid_pipeline", {})
dataset = validation.get("dataset", {})

print("\n=== MODELO OPENHANDS ===")
print("Checkpoint:", CHECKPOINT_PATH.exists())
print("Encoder:", encoder.get("type"))
print("Encoder params:", encoder.get("params"))
print("Decoder:", decoder.get("type"))
print("Decoder params:", decoder.get("params"))

print("\n=== PREPROCESAMIENTO ORIGINAL ===")
for transform in dataset.get("transforms", []):
    print(transform)

print("\n=== DATASET ===")
print("Tipo:", dataset.get("_target_"))
print("Split:", dataset.get("split_file"))
print("Modalidad:", dataset.get("modality"))

print("\n=== METADATOS ===")

for name in ("asl100", "asl300", "asl1000", "asl2000"):
    path = BASE / "splits" / f"{name}.json"

    with path.open("r", encoding="utf-8") as file:
        records = json.load(file)

    print(f"\n{name}: {len(records)} registros")

    if isinstance(records, list) and records:
        print("Ejemplo:", records[0].get("gloss"))
