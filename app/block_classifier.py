"""Classify every master-block row as production / clean / maint / other.

Each row of the master table is a line-time block keyed by OF. Most rows are
production runs but a meaningful minority are cleaning blocks (LIMPIEZA), and
some are maintenance windows. The downstream pipeline (OEE baselines,
analogues, transition statistics) must run on PRODUCTION ROWS ONLY — but the
non-production blocks still need to appear on timelines so the planner sees
the full line-time picture.

Rules used:

* `clean`     — SKU or Familia contains "LIMPIEZA".
* `maint`     — no production volume and no OEE and not a clean block.
                (Catches the small set of OFs that exist as maintenance windows
                 without a SKU/family match.)
* `production`— OEE is present (post-cap) OR HL > 0.
* `other`     — anything that escapes the above (always small).

Returns the input frame with two new columns appended:

    block_type        Literal['production','clean','maint','other']
    oee_capped        bool   — True if OEE was clipped at 1.0.

The originally-observed OEE is preserved in `oee_raw` and the working column
`oee` is the capped, non-negative value the rest of the pipeline uses.
"""
from __future__ import annotations

from typing import Tuple

import numpy as np
import pandas as pd

_LIMPIEZA = "LIMPIEZA"


def _is_limpieza_like(s) -> bool:
    if s is None or (isinstance(s, float) and np.isnan(s)):
        return False
    return _LIMPIEZA in str(s).upper()


def classify_blocks(master: pd.DataFrame) -> Tuple[pd.DataFrame, dict]:
    """Return (master_with_block_type, summary_counts)."""
    if master is None or master.empty:
        return master, {"production": 0, "clean": 0, "maint": 0, "other": 0, "oee_capped": 0}

    df = master.copy()

    # OEE column normalization. Preserve raw + capped.
    if "oee" in df.columns:
        df["oee_raw"] = df["oee"].copy()
        df["oee_capped"] = (df["oee"] > 1.0)
        df["oee"] = df["oee"].clip(lower=0.0, upper=1.0)
    else:
        df["oee_raw"] = None
        df["oee_capped"] = False

    # Pull the two strings used to detect LIMPIEZA cleanly
    sku_str = df.get("sku", pd.Series(dtype=str)).astype(str).str.upper()
    fam_str = df.get("familia", pd.Series(dtype=str)).astype(str).str.upper()

    is_clean = sku_str.str.contains(_LIMPIEZA, na=False) | fam_str.str.contains(_LIMPIEZA, na=False)

    has_oee = df["oee"].notna() if "oee" in df.columns else pd.Series(False, index=df.index)
    has_hl = (df.get("hl", pd.Series(0, index=df.index)).fillna(0) > 0)
    has_production_signal = has_oee | has_hl

    # Maintenance — no production signal and not a clean block.
    # This catches the ~few extra rows that aren't LIMPIEZA-flagged but also
    # have no OEE / no volume.
    is_maint = (~is_clean) & (~has_production_signal)

    # Default to production when there IS a production signal
    is_production = (~is_clean) & (~is_maint) & has_production_signal

    block_type = np.where(
        is_clean, "clean",
        np.where(is_maint, "maint",
                 np.where(is_production, "production", "other"))
    )
    df["block_type"] = block_type

    summary = {
        "rows_total": int(len(df)),
        "production": int((df["block_type"] == "production").sum()),
        "clean": int((df["block_type"] == "clean").sum()),
        "maint": int((df["block_type"] == "maint").sum()),
        "other": int((df["block_type"] == "other").sum()),
        "oee_capped": int(df["oee_capped"].sum()) if "oee_capped" in df.columns else 0,
    }
    return df, summary


def verify_of_woid_join(oee_df: pd.DataFrame, tiempo_df: pd.DataFrame) -> dict:
    """Print + return diagnostics for the OF↔WOID join (Step 1)."""
    if oee_df is None or tiempo_df is None:
        return {"ok": False, "reason": "missing input"}

    oee_set = set(oee_df["OF"].dropna().astype(str)) if "OF" in oee_df.columns else set()
    woid_col = "WOID" if "WOID" in tiempo_df.columns else ("OF" if "OF" in tiempo_df.columns else None)
    if not woid_col:
        return {"ok": False, "reason": "Tiempo has no WOID/OF column"}
    tiempo_set = set(tiempo_df[woid_col].dropna().astype(str))

    inter = oee_set & tiempo_set
    only_oee = oee_set - tiempo_set
    only_tiempo = tiempo_set - oee_set
    coverage = len(inter) / max(len(oee_set), 1)
    return {
        "ok": True,
        "oee_rows": int(len(oee_df)),
        "tiempo_rows": int(len(tiempo_df)),
        "intersection_ofs": int(len(inter)),
        "only_in_oee": int(len(only_oee)),
        "only_in_tiempo": int(len(only_tiempo)),
        "coverage_share": round(coverage, 4),
        "should_rename_woid_to_of": coverage >= 0.99,
    }
