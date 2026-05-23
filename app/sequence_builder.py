"""Reconstruct the executed line sequence and build the production-only
transition table.

This module is the bridge between the master block table and the
diagnostics / analogue layers. It enforces two crucial invariants:

  1. **History is immutable.** Once classified, the executed sequence is read
     only — it represents what *actually happened*. The simulator never
     re-shuffles past blocks.
  2. **Transitions are between PRODUCTION OFs only.** Cleaning / maintenance
     blocks are excluded from the transition table because their `OEE`,
     `actual_changeover_minutes`, etc. would distort statistics. They DO
     appear on the timeline (kind='clean' / 'maint') so the planner can see
     the full line-time picture.

Outputs:

  build_sequence(master) -> {
    "line_blocks":    { "14": [block, …], "17": …, "19": … },
    "transitions":    pd.DataFrame  # one row per (prev_prod_of → cur_prod_of)
  }
"""
from __future__ import annotations

from typing import Any, Dict, List

import numpy as np
import pandas as pd


def _safe_str(v):
    if v is None or (isinstance(v, float) and np.isnan(v)):
        return None
    s = str(v).strip()
    return s if s else None


def _block_dict(r: pd.Series) -> Dict[str, Any]:
    return {
        "of": str(r.get("of")),
        "sku": _safe_str(r.get("sku")),
        "product": _safe_str(r.get("material_precio") or r.get("mat_precio") or r.get("cerveza") or r.get("marca")),
        "envase": _safe_str(r.get("envase")),
        "tipo_envase": _safe_str(r.get("tipo_envase")),
        "familia": _safe_str(r.get("familia")),
        "marca": _safe_str(r.get("marca")),
        "block_type": str(r.get("block_type") or "production"),
        "fecha_fin": r.get("fecha_fin"),
        "oee": float(r["oee"]) if pd.notna(r.get("oee", np.nan)) else None,
        "par_tot_min": float(r["par_tot_min"]) if pd.notna(r.get("par_tot_min", np.nan)) else None,
        "pnp_min": float(r["pnp_min"]) if pd.notna(r.get("pnp_min", np.nan)) else None,
        "limpieza_min": float(r["limpieza_min"]) if pd.notna(r.get("limpieza_min", np.nan)) else None,
        "idle_min": float(r["idle_min"]) if pd.notna(r.get("idle_min", np.nan)) else None,
        "hl": float(r["hl"]) if pd.notna(r.get("hl", np.nan)) else None,
        "transition_type": _safe_str(r.get("transition_type")),
        "principal_label": _safe_str(r.get("principal_label")),
        "transition_components": _safe_str(r.get("transition_components")),
        "maintenance_flag": int(r.get("maintenance_flag") or 0),
    }


def _actual_changeover_minutes(r: pd.Series) -> float:
    par_tot = float(r.get("par_tot_min", 0.0) or 0.0)
    pnp = float(r.get("pnp_min", 0.0) or 0.0)
    limp = float(r.get("limpieza_min", 0.0) or 0.0)
    idle = float(r.get("idle_min", 0.0) or 0.0)
    val = par_tot - (pnp + limp + idle)
    if val < 1e-6:
        return 0.0
    return float(val)


def build_sequence(master: pd.DataFrame) -> Dict[str, Any]:
    """Build per-line block sequences and the production-only transition table."""
    if master is None or master.empty or "tren" not in master.columns:
        return {"line_blocks": {}, "transitions": pd.DataFrame()}

    df = master.copy()
    if "fecha_fin" in df.columns:
        df["fecha_fin"] = pd.to_datetime(df["fecha_fin"], errors="coerce")
        df = df.sort_values(["tren", "fecha_fin", "of"]).reset_index(drop=True)

    line_blocks: Dict[str, List[Dict[str, Any]]] = {}
    transition_rows: List[Dict[str, Any]] = []

    for line, g in df.groupby("tren"):
        line = int(line)
        g = g.reset_index(drop=True)
        line_key = str(line)
        line_blocks[line_key] = [_block_dict(r) for _, r in g.iterrows()]

        # Production-only subset for transitions
        prod = g[g["block_type"] == "production"].reset_index(drop=True)
        for i in range(1, len(prod)):
            prev = prod.iloc[i - 1]
            cur = prod.iloc[i]
            actual_co = _actual_changeover_minutes(cur)
            transition_rows.append({
                "line": line,
                "previous_of": str(prev["of"]),
                "current_of": str(cur["of"]),
                "previous_sku": _safe_str(prev.get("sku")),
                "current_sku": _safe_str(cur.get("sku")),
                "previous_product": _safe_str(prev.get("material_precio") or prev.get("mat_precio") or prev.get("cerveza") or prev.get("marca")),
                "current_product": _safe_str(cur.get("material_precio") or cur.get("mat_precio") or cur.get("cerveza") or cur.get("marca")),
                "previous_envase": _safe_str(prev.get("envase")),
                "current_envase": _safe_str(cur.get("envase")),
                "previous_tipo_envase": _safe_str(prev.get("tipo_envase")),
                "current_tipo_envase": _safe_str(cur.get("tipo_envase")),
                "previous_familia": _safe_str(prev.get("familia")),
                "current_familia": _safe_str(cur.get("familia")),
                "previous_marca": _safe_str(prev.get("marca")),
                "current_marca": _safe_str(cur.get("marca")),
                "transition_type": _safe_str(cur.get("transition_type")) or "same-sku",
                "principal_label": _safe_str(cur.get("principal_label")),
                "transition_components": _safe_str(cur.get("transition_components")),
                "actual_changeover_minutes": actual_co,
                "par_tot_minutes": float(cur.get("par_tot_min") or 0.0),
                "pnp_minutes": float(cur.get("pnp_min") or 0.0),
                "limpieza_minutes": float(cur.get("limpieza_min") or 0.0),
                "idle_minutes": float(cur.get("idle_min") or 0.0),
                "oee": float(cur.get("oee")) if pd.notna(cur.get("oee", np.nan)) else None,
                "hl": float(cur.get("hl")) if pd.notna(cur.get("hl", np.nan)) else None,
                "date": cur.get("fecha_fin"),
                "maintenance_flag": int(cur.get("maintenance_flag") or 0),
            })

    tt = pd.DataFrame(transition_rows)
    return {"line_blocks": line_blocks, "transitions": tt}
