"""Shared dependencies for LSEC routes."""

import logging
from hashlib import sha256
from typing import Annotated

from fastapi import Header, HTTPException

from app.domain.lsec.lsec_catalog import CatalogError, get_catalog

logger = logging.getLogger(__name__)


def available_catalog():
    try:
        return get_catalog()
    except CatalogError as error:
        # The underlying parse exception may include the entire reference document.
        logger.error("No se pudo cargar el catálogo LSEC: %s", str(error).splitlines()[0][:300])
        raise HTTPException(503, detail={"codigo": "catalogo_no_disponible"}) from None


def participant(
    key: Annotated[
        str,
        Header(alias="X-Participant-Key", min_length=64, max_length=64, pattern="^[a-f0-9]{64}$"),
    ],
):
    return sha256(key.encode()).hexdigest()
