
from pathlib import Path
from zipfile import ZipFile, BadZipFile

MODEL_DIR = Path("models/openhands")

FILES = [
    "wlasl_lstm.zip",
    "wlasl_metadata.zip",
]

for filename in FILES:
    path = MODEL_DIR / filename

    print(f"\nArchivo: {filename}")

    if not path.is_file():
        print("ERROR: Archivo no encontrado")
        continue

    try:
        with ZipFile(path) as archive:
            error = archive.testzip()

            if error:
                print(f"ERROR: Entrada dañada: {error}")
                continue

            print("ZIP valido")
            print("Contenido:")

            for item in archive.namelist():
                print(f"  {item}")

    except BadZipFile:
        print("ERROR: El archivo no es un ZIP valido")
