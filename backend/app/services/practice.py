"""Compute and atomically persist idempotent practice results."""

import json
from datetime import UTC, datetime
from hashlib import sha256

from app.contracts.lsec import Attempt, EvaluationAttempt
from app.domain.lsec.evaluation import evaluate, recognize
from app.repositories import practices


def complete(attempt, catalog, owner):
    payload = attempt.model_dump(mode="json")
    fingerprint = sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    previous = practices.find(str(attempt.id_intento), owner, fingerprint)
    if previous is not None:
        return previous
    # save() arbitrates concurrent retries, including retries from another worker.
    capture = attempt.model_dump(exclude={"id_intento", "id_referencia", "segmentar"})
    if attempt.id_referencia:
        result = evaluate(
            EvaluationAttempt(**capture, id_referencia=attempt.id_referencia),
            catalog,
            attempt.segmentar,
        )
    else:
        result = recognize(Attempt(**capture), catalog, attempt.segmentar)
    output = result.model_dump(mode="json")
    if output.get("ejecucion"):
        output["ejecucion"]["frames_ejecucion"] = []
    grade = output.get("similitud") or {}
    first_candidate = next(iter(output.get("candidatas", [])), {})
    reference_id = (
        attempt.id_referencia or grade.get("id_referencia") or first_candidate.get("id_referencia")
    )
    reference = catalog.references.get(reference_id)
    document = {
        "id_intento": str(attempt.id_intento),
        "timestamp_utc": datetime.now(UTC).isoformat(),
        "tipo": "dirigida" if attempt.id_referencia else "libre",
        "id_referencia": reference_id,
        "glosa": reference.gloss if reference else None,
        "resultado": output,
        "captura": {
            "ancho": attempt.ancho,
            "alto": attempt.alto,
            "total_frames": len(attempt.frames),
            "duracion_ms": attempt.frames[-1].timestamp_ms - attempt.frames[0].timestamp_ms,
            "mano_practica": attempt.mano_practica,
            "modo": attempt.modo,
        },
    }
    return practices.save(document, owner, fingerprint)
