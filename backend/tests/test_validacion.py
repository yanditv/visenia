import json

import pytest
from test_lsec_api import attempt, frames, pack, record

from app.domain.lsec.lsec_catalog import get_catalog
from scripts.validar_reconocimiento import validar


def test_report_counts_misses_missing_tracks_and_out_of_catalog_samples(tmp_path, monkeypatch):
    path = tmp_path / "catalogo.json"
    pack(path, record("ref-a"), record("ref-b", offset=0.2))
    monkeypatch.setenv("VISENA_LSEC_CATALOG", str(path))
    monkeypatch.setenv("VISENA_LSEC_DRAFTS", "")
    muestras = []
    for i, (esperada, offset) in enumerate(
        [("ref-a", 0.01), ("ref-b", 0.02), ("ref-b", None), (None, 0.3)]
    ):
        track = frames(offset or 0)
        if offset is None:
            for frame in track:
                del frame["mano_derecha"]
        archivo = f"toma-{i}.json"
        (tmp_path / archivo).write_text(json.dumps(attempt(track)))
        muestras.append({"archivo": archivo, "esperada": esperada})
    manifiesto = tmp_path / "lote.json"
    manifiesto.write_text(json.dumps(muestras))
    catalogo = get_catalog()
    informe = validar(manifiesto, catalogo)
    assert informe["exactitud_top_1"] == pytest.approx(1 / 3)
    assert informe["exactitud_top_3"] == pytest.approx(2 / 3)
    assert informe["por_sena"]["ref-b"]["sin_candidatas"] == 1
    assert informe["confusiones"] == [{"esperada": "ref-b", "sugerida": "ref-a", "tomas": 1}]
    assert informe["ajenas_al_catalogo"] == {"tomas": 1, "con_sugerencia": 1}
    manifiesto.write_text(json.dumps(muestras + muestras))
    with pytest.raises(ValueError, match="más de una vez"):
        validar(manifiesto, catalogo)
