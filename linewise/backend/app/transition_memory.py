"""Per-line transition table — the factory's memory of historical changeovers.

For each (previous OF → current OF) pair on the same line we compute:
  - actual changeover (Par.tot − (PNP + Limpieza + IDLE))
  - theoretical changeover (median by line+transition_type, falls back to global)
  - overrun
  - baseline OEE for the (line, current_sku) excluding the row itself
  - oee_cost_points = (actual − baseline) × 100
  - transition_type derived from the real Cambios `c.principal` label when
    available, otherwise from envase/family/SKU comparison
"""
from __future__ import annotations

from typing import Dict, List, Optional

import numpy as np
import pandas as pd


def _derive_transition_type(prev: pd.Series, cur: pd.Series) -> str:
    """Prefer the real label from Cambios; otherwise derive from attributes."""
    tipo = cur.get("tipo_cambio")
    if isinstance(tipo, str) and tipo.strip() and tipo.strip() != "-2":
        return tipo.strip()

    prev_sku = prev.get("sku")
    cur_sku = cur.get("sku")
    prev_envase = prev.get("envase")
    cur_envase = cur.get("envase")
    prev_marca = prev.get("marca")
    cur_marca = cur.get("marca")
    prev_fam = prev.get("familia")
    cur_fam = cur.get("familia")

    if pd.notna(prev_sku) and pd.notna(cur_sku) and prev_sku == cur_sku:
        return "Same SKU"
    if pd.notna(prev_envase) and pd.notna(cur_envase) and prev_envase != cur_envase:
        return "Volumen Envase"
    if pd.notna(prev_marca) and pd.notna(cur_marca) and prev_marca != cur_marca:
        return "Marca"
    if pd.notna(prev_fam) and pd.notna(cur_fam) and prev_fam != cur_fam:
        return "Contenido"
    return "Same envase, different SKU"


def _safe_str(v) -> Optional[str]:
    if v is None or (isinstance(v, float) and np.isnan(v)):
        return None
    s = str(v).strip()
    return s if s else None


_PLACEHOLDER_SKUS = {"LIMPIEZA", "DEFAULTVALUE", "NAN"}


def _is_placeholder(value) -> bool:
    s = _safe_str(value)
    return bool(s and s.upper() in _PLACEHOLDER_SKUS)


def build_transition_table(master: pd.DataFrame) -> pd.DataFrame:
    """Return one row per same-line transition."""
    if master is None or master.empty or "tren" not in master.columns:
        return pd.DataFrame()

    df = master.copy()
    # Drop cleaning/placeholder rows so transitions are real product→product moves
    if "sku" in df.columns:
        df = df[~df["sku"].astype(str).str.upper().isin(_PLACEHOLDER_SKUS)]
    if "familia" in df.columns:
        df = df[~df["familia"].fillna("").astype(str).str.upper().isin(["LIMPIEZA", "DEFAULTVALUE"])]
    if "fecha_fin" in df.columns:
        df = df.sort_values(["tren", "fecha_fin", "of"]).reset_index(drop=True)
    else:
        df = df.sort_values(["tren", "of"]).reset_index(drop=True)

    rows: List[Dict] = []
    for line, g in df.groupby("tren"):
        g = g.reset_index(drop=True)
        for i in range(1, len(g)):
            prev = g.iloc[i - 1]
            cur = g.iloc[i]

            par_tot = float(cur.get("par_tot_min", np.nan))
            pnp = float(cur.get("pnp_min", np.nan)) if pd.notna(cur.get("pnp_min", np.nan)) else 0.0
            limp = float(cur.get("limpieza_min", np.nan)) if pd.notna(cur.get("limpieza_min", np.nan)) else 0.0
            idle = float(cur.get("idle_min", np.nan)) if pd.notna(cur.get("idle_min", np.nan)) else 0.0
            if not np.isnan(par_tot):
                actual_co = max(par_tot - (pnp + limp + idle), 0.0)
                # Squash floating-point near-zero to clean zero
                if actual_co < 1e-6:
                    actual_co = 0.0
            else:
                actual_co = np.nan

            transition_type = _derive_transition_type(prev, cur)

            cur_envase = _safe_str(cur.get("envase"))
            prev_envase = _safe_str(prev.get("envase"))
            format_change = int(bool(prev_envase and cur_envase and prev_envase != cur_envase))

            rows.append({
                "line": int(line),
                "previous_of": str(prev["of"]),
                "current_of": str(cur["of"]),
                "previous_sku": _safe_str(prev.get("sku")),
                "current_sku": _safe_str(cur.get("sku")),
                "previous_product": _safe_str(prev.get("material_precio") or prev.get("mat_precio") or prev.get("cerveza") or prev.get("marca")),
                "current_product": _safe_str(cur.get("material_precio") or cur.get("mat_precio") or cur.get("cerveza") or cur.get("marca")),
                "previous_envase": prev_envase,
                "current_envase": cur_envase,
                "previous_familia": _safe_str(prev.get("familia")),
                "current_familia": _safe_str(cur.get("familia")),
                "previous_marca": _safe_str(prev.get("marca")),
                "current_marca": _safe_str(cur.get("marca")),
                "transition_type": transition_type,
                "change_type": transition_type,
                "format_change": format_change,
                "cleaning_minutes": limp,
                "pnp_minutes": pnp,
                "idle_minutes": idle,
                "actual_changeover_minutes": float(actual_co) if not np.isnan(actual_co) else None,
                "par_tot_minutes": float(par_tot) if not np.isnan(par_tot) else None,
                "stop_minutes": pnp + idle,
                "volume": float(cur.get("hl")) if pd.notna(cur.get("hl", np.nan)) else None,
                "oee": float(cur.get("oee")) if pd.notna(cur.get("oee", np.nan)) else None,
                "maintenance_flag": int(cur.get("maintenance_flag", 0) or 0),
                "date": cur.get("fecha_fin"),
                "month": cur.get("fecha_fin").month if pd.notna(cur.get("fecha_fin", None)) else None,
                "weekday": cur.get("fecha_fin").weekday() if pd.notna(cur.get("fecha_fin", None)) else None,
            })

    tt = pd.DataFrame(rows)
    if tt.empty:
        return tt

    # Theoretical changeover: median actual by (line, transition_type), with
    # global-median fallback. We clamp at >= 0.
    if "actual_changeover_minutes" in tt.columns:
        med_by_type = tt.groupby(["line", "transition_type"])["actual_changeover_minutes"].transform("median")
        global_med = tt["actual_changeover_minutes"].dropna().median()
        tt["theoretical_changeover_minutes"] = med_by_type.fillna(global_med)
        tt["theoretical_changeover_minutes"] = tt["theoretical_changeover_minutes"].clip(lower=0.0)
        tt["changeover_overrun_minutes"] = (
            tt["actual_changeover_minutes"] - tt["theoretical_changeover_minutes"]
        )

    # Baseline OEE: per (line, current_sku) excluding self; falls back to line median
    if "oee" in tt.columns:
        # leave-one-out mean within group
        line_sku_sum = tt.groupby(["line", "current_sku"])["oee"].transform("sum")
        line_sku_cnt = tt.groupby(["line", "current_sku"])["oee"].transform("count")
        baseline = (line_sku_sum - tt["oee"].fillna(0)) / (line_sku_cnt - 1).replace(0, np.nan)
        line_med = tt.groupby("line")["oee"].transform("median")
        global_med_oee = tt["oee"].dropna().median()
        tt["baseline_oee"] = baseline.fillna(line_med).fillna(global_med_oee)
        tt["oee_cost_points"] = (tt["oee"] - tt["baseline_oee"]) * 100.0

    return tt


def find_similar_cases(
    candidate: Dict,
    tt: pd.DataFrame,
    top_k: int = 5,
) -> Dict:
    """Score historical transitions vs. a candidate slot."""
    if tt is None or tt.empty:
        return {
            "similar": [],
            "historical_avg_oee": None,
            "historical_avg_actual_changeover": None,
            "historical_avg_overrun": None,
            "historical_stop_risk": None,
            "maintenance_nearby_rate": None,
            "n_similar": 0,
        }

    df = tt.copy()
    line = candidate.get("line")
    prev_sku = str(candidate.get("previous_sku"))
    cur_sku = str(candidate.get("current_sku"))
    cur_envase = candidate.get("current_envase")
    cur_familia = candidate.get("current_familia")
    transition_type = candidate.get("transition_type") or candidate.get("change_type")
    theo = candidate.get("theoretical_changeover_minutes")
    volume = candidate.get("volume")

    def row_score(r):
        s = 0.0
        if r["line"] == line:
            s += 3.0
        if r.get("previous_sku") == prev_sku:
            s += 2.0
        if r.get("current_sku") == cur_sku:
            s += 2.5
        if cur_familia and r.get("current_familia") == cur_familia:
            s += 1.5
        if cur_envase and r.get("current_envase") == cur_envase:
            s += 1.5
        if transition_type and r.get("transition_type") == transition_type:
            s += 1.5
        if theo and pd.notna(r.get("theoretical_changeover_minutes")):
            diff = abs(float(r["theoretical_changeover_minutes"]) - float(theo))
            s += max(0.0, 1.0 - diff / 120.0)
        if volume and pd.notna(r.get("volume")):
            ratio = min(volume, r["volume"]) / max(volume, r["volume"], 1.0)
            s += ratio * 0.5
        return s

    df["_score"] = df.apply(row_score, axis=1)
    df = df.sort_values("_score", ascending=False)
    top = df.head(top_k)

    avg_oee = top["oee"].dropna().mean() if "oee" in top.columns else None
    avg_actual = top["actual_changeover_minutes"].dropna().mean() if "actual_changeover_minutes" in top.columns else None
    avg_overrun = top["changeover_overrun_minutes"].dropna().mean() if "changeover_overrun_minutes" in top.columns else None
    stop_risk = top["stop_minutes"].dropna().mean() if "stop_minutes" in top.columns else None
    maint_rate = top["maintenance_flag"].mean() if "maintenance_flag" in top.columns else None

    similar = []
    for _, r in top.iterrows():
        similar.append({
            "previous_of": str(r.get("previous_of")),
            "current_of": str(r.get("current_of")),
            "line": int(r.get("line")),
            "oee": float(r.get("oee")) if pd.notna(r.get("oee")) else 0.0,
            "actual_changeover_minutes": float(r.get("actual_changeover_minutes") or 0.0),
            "theoretical_changeover_minutes": float(r.get("theoretical_changeover_minutes") or 0.0),
            "overrun_minutes": float(r.get("changeover_overrun_minutes") or 0.0),
        })

    return {
        "similar": similar,
        "historical_avg_oee": float(avg_oee) if pd.notna(avg_oee) else None,
        "historical_avg_actual_changeover": float(avg_actual) if pd.notna(avg_actual) else None,
        "historical_avg_overrun": float(avg_overrun) if pd.notna(avg_overrun) else None,
        "historical_stop_risk": float(stop_risk) if pd.notna(stop_risk) else None,
        "maintenance_nearby_rate": float(maint_rate) if pd.notna(maint_rate) else None,
        "n_similar": int(len(top)),
    }
