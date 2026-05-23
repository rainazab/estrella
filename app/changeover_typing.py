"""Derive a transition type string from the Cambios decomposition.

The Cambios file decomposes each OF's changeover into binary flags:

    C. Brand        — different brand
    C. Producto     — different product / recipe
    C. Volum        — different volume (e.g. 33cl → 50cl)
    C. CAP          — different cap
    C. Palet        — different pallet pattern
    C. Primario     — different primary pack
    C. Secundario   — different secondary pack
    C. PRINCIPAL    — coarse human label for the *dominant* change

We combine the flags into a compact, deterministic transition_type string
the diagnostics + recommendation layers can group on. Examples:

    same-sku
    brand
    product
    volume
    brand+product
    primary_pack
    secondary_pack
    palet
    cap
    multi

The mapping is reversible: from a transition_type you can recover the set of
component flags by splitting on '+'.

The legacy `c_principal` label (Volumen Envase / Marca / Contenido / etc.)
is kept side-by-side under `principal_label` so the UI can still group by it.
"""
from __future__ import annotations

import re
from typing import Dict, List, Optional, Tuple

import pandas as pd


# Cambios source column → compact tag emitted in the transition_type string.
# Order matters — emitted tags are sorted by this list so the same combo
# always produces the same string.
_FLAG_TO_TAG: List[Tuple[str, str]] = [
    ("ch_brand", "brand"),       # C. Brand
    ("ch_product", "product"),   # C. Producto
    ("ch_volume", "volume"),     # C. Volum
    ("ch_cap", "cap"),           # C. CAP
    ("ch_primary", "primary_pack"),     # C. Primario
    ("ch_secondary", "secondary_pack"), # C. Secundario
    ("ch_palet", "palet"),       # C. Palet
]


def _truthy_flag(v) -> bool:
    if v is None:
        return False
    try:
        return float(v) >= 1.0
    except (TypeError, ValueError):
        return False


def type_of_row(row: pd.Series) -> Tuple[str, List[str]]:
    """Return (transition_type, [component tags]) for one master row.

    Operates on the row of the *current* OF (the destination of a transition).
    """
    tags: List[str] = []
    for col, tag in _FLAG_TO_TAG:
        if col in row.index and _truthy_flag(row.get(col)):
            tags.append(tag)
    if not tags:
        return "same-sku", []
    if len(tags) >= 4:
        # Avoid hyper-long strings; group very busy changeovers together.
        return "multi", tags
    return "+".join(tags), tags


def principal_label(row: pd.Series) -> Optional[str]:
    """Return the Cambios `C. PRINCIPAL` label if present and meaningful."""
    val = row.get("tipo_cambio") if "tipo_cambio" in row.index else None
    if val is None:
        return None
    s = str(val).strip()
    if not s or s in ("nan", "-2"):
        return None
    return s


def annotate_master(master: pd.DataFrame) -> pd.DataFrame:
    """Add `transition_type` + `transition_components` + `principal_label`
    columns to every row. Cheap, deterministic, idempotent."""
    if master is None or master.empty:
        return master
    df = master.copy()
    types: List[str] = []
    comps: List[str] = []
    principals: List[Optional[str]] = []
    for _, r in df.iterrows():
        t, c = type_of_row(r)
        types.append(t)
        comps.append(",".join(c))
        principals.append(principal_label(r))
    df["transition_type"] = types
    df["transition_components"] = comps
    df["principal_label"] = principals
    return df
