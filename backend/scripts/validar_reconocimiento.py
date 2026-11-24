"""Mide el reconocimiento libre con tomas etiquetadas que no forman parte del catálogo."""

import argparse
import json
from collections import Counter
from pathlib import Path

from pydantic import TypeAdapter, ValidationError

from app.contracts.lsec import Attempt, ContractModel, ReferenceId
from app.domain.lsec.evaluation import ENGINE_VERSION, recognize
from app.domain.lsec.lsec_catalog import CatalogError, get_catalog


class Muestra(ContractModel):
    archivo: str
    esperada: ReferenceId | None


def validar(manifiesto: Path, catalogo):
    muestras = TypeAdapter(list[Muestra]).validate_json(manifiesto.read_bytes())
    if not muestras or not catalogo.references:
        raise ValueError("Se requieren muestras y un catálogo de referencias activo.")
    archivos = set()
    por_sena = {}
    confusiones = Counter()
    ajenas = sugerencias_ajenas = 0
    for muestra in muestras:
        archivo = (manifiesto.parent / muestra.archivo).resolve()
        if archivo in archivos:
            raise ValueError(f"La captura aparece más de una vez: {muestra.archivo}")
        archivos.add(archivo)
        esperada = muestra.esperada
        if esperada is not None and esperada not in catalogo.references:
            raise ValueError(f"Referencia esperada ausente del catálogo: {esperada}")
        try:
            toma = Attempt.model_validate_json(archivo.read_bytes())
        except ValidationError as error:
            raise ValueError(
                f"Captura inválida en {muestra.archivo}: {error.error_count()} errores."
            ) from None
        resultado = recognize(toma, catalogo, segmentar=toma.segmentacion is None)
        candidatas = [c.id_referencia for c in resultado.candidatas]
        if esperada is None:
            ajenas += 1
            sugerencias_ajenas += bool(candidatas)
            continue
        fila = por_sena.setdefault(
            esperada, dict(tomas=0, primera=0, entre_tres=0, sin_candidatas=0)
        )
        fila["tomas"] += 1
        fila["primera"] += candidatas[:1] == [esperada]
        fila["entre_tres"] += esperada in candidatas
        fila["sin_candidatas"] += not candidatas
        if candidatas and candidatas[0] != esperada:
            confusiones[(esperada, candidatas[0])] += 1

    conocidas = sum(fila["tomas"] for fila in por_sena.values())

    def tasa(clave):
        return sum(fila[clave] for fila in por_sena.values()) / conocidas if conocidas else None

    return {
        "version_motor": ENGINE_VERSION,
        "version_catalogo": catalogo.version,
        "tomas_conocidas": conocidas,
        "exactitud_top_1": tasa("primera"),
        "exactitud_top_3": tasa("entre_tres"),
        "por_sena": por_sena,
        "confusiones": [
            {"esperada": a, "sugerida": b, "tomas": n} for (a, b), n in confusiones.most_common()
        ],
        "ajenas_al_catalogo": {"tomas": ajenas, "con_sugerencia": sugerencias_ajenas},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifiesto", type=Path)
    args = parser.parse_args()
    try:
        informe = validar(args.manifiesto, get_catalog())
    except (ValueError, OSError, CatalogError) as error:
        parser.exit(1, f"No se pudo validar el lote. {error}\n")
    print(json.dumps(informe, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
