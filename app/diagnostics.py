"""Diagnostic scoring — group the transition memory by transition type and
expose the historical evidence (OEE cost, overrun, line comparison, worst
orders) that the planner needs to trust the simulator.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd


# ---------------------------------------------------------------- helpers


def _fnone(v) -> Optional[float]:
    if v is None:
        return None
    try:
        f = float(v)
        if np.isnan(f):
            return None
        return f
    except (TypeError, ValueError):
        return None


def _risk_pattern(g: pd.DataFrame) -> str:
    avg_overrun = g["changeover_overrun_minutes"].dropna().mean() if "changeover_overrun_minutes" in g else 0.0
    avg_limp = g["cleaning_minutes"].dropna().mean() if "cleaning_minutes" in g else 0.0
    avg_pnp = g["pnp_minutes"].dropna().mean() if "pnp_minutes" in g else 0.0
    maint_rate = g["maintenance_flag"].mean() if "maintenance_flag" in g else 0.0

    if pd.notna(avg_overrun) and avg_overrun > 30:
        return "Changeover overrun"
    if pd.notna(avg_limp) and avg_limp > 90:
        return "Cleaning heavy"
    if pd.notna(avg_pnp) and avg_pnp > 180:
        return "PNP spike"
    if pd.notna(maint_rate) and maint_rate > 0.4:
        return "Maintenance sensitive"
    return "Low OEE recovery"


def _confidence_label(n: int) -> str:
    if n >= 20:
        return "high"
    if n >= 8:
        return "medium-high"
    if n >= 3:
        return "medium"
    return "low"


def _maintenance_risk_from_rate(rate: Optional[float]) -> str:
    if rate is None:
        return "low"
    if rate >= 0.45:
        return "high"
    if rate >= 0.2:
        return "medium"
    return "low"


# ---------------------------------------------------------------- summary


def get_diagnostic_summary(tt: pd.DataFrame, master_size: int, using_fallback: bool) -> Dict[str, Any]:
    if tt is None or tt.empty:
        return {
            "orders_analyzed": master_size,
            "worst_oee_trap": None,
            "total_estimated_oee_cost": None,
            "highest_risk_line": None,
            "using_fallback_data": using_fallback,
        }

    g_type = tt.groupby("transition_type")
    # Worst trap = lowest avg oee_cost_points (most negative) with ≥3 cases
    eligible = g_type.filter(lambda x: len(x) >= 3)
    worst_trap: Optional[str] = None
    total_cost: Optional[float] = None
    if not eligible.empty:
        per_type = (
            eligible.groupby("transition_type")["oee_cost_points"].mean().sort_values()
        )
        if not per_type.empty:
            worst_trap = str(per_type.index[0])
        total_cost = float(eligible["oee_cost_points"].dropna().sum())

    highest_risk_line: Optional[int] = None
    if "line" in tt.columns and tt["oee"].notna().any():
        per_line = tt.groupby("line")["oee"].mean().sort_values()
        if not per_line.empty:
            highest_risk_line = int(per_line.index[0])

    return {
        "orders_analyzed": master_size,
        "worst_oee_trap": worst_trap,
        "total_estimated_oee_cost": _fnone(total_cost),
        "highest_risk_line": highest_risk_line,
        "using_fallback_data": using_fallback,
    }


# ---------------------------------------------------------------- ranking


def rank_transition_types(
    tt: pd.DataFrame,
    line: Optional[int] = None,
    min_cases: int = 3,
) -> List[Dict[str, Any]]:
    if tt is None or tt.empty:
        return []
    df = tt.copy()
    if line is not None:
        df = df[df["line"] == int(line)]
    if df.empty:
        return []

    out: List[Dict[str, Any]] = []
    for ttype, g in df.groupby("transition_type"):
        if len(g) < min_cases:
            continue
        avg_oee = g["oee"].dropna().mean()
        baseline_oee = g["baseline_oee"].dropna().mean() if "baseline_oee" in g else None
        oee_cost = g["oee_cost_points"].dropna().mean() if "oee_cost_points" in g else None
        avg_actual = g["actual_changeover_minutes"].dropna().mean() if "actual_changeover_minutes" in g else None
        avg_theo = g["theoretical_changeover_minutes"].dropna().mean() if "theoretical_changeover_minutes" in g else None
        avg_overrun = g["changeover_overrun_minutes"].dropna().mean() if "changeover_overrun_minutes" in g else None
        maint_rate = g["maintenance_flag"].mean() if "maintenance_flag" in g else None

        # Worst line for this transition type: lowest avg OEE within the group
        worst_line = None
        if "line" in g.columns and g["oee"].notna().any():
            line_oee = g.groupby("line")["oee"].mean().sort_values()
            if not line_oee.empty:
                worst_line = int(line_oee.index[0])

        out.append({
            "transition_type": str(ttype),
            "cases": int(len(g)),
            "avg_oee": _fnone(avg_oee),
            "baseline_oee": _fnone(baseline_oee),
            "oee_cost_points": _fnone(oee_cost),
            "avg_actual_changeover_minutes": _fnone(avg_actual),
            "avg_theoretical_changeover_minutes": _fnone(avg_theo),
            "avg_overrun_minutes": _fnone(avg_overrun),
            "risk_pattern": _risk_pattern(g),
            "worst_line": worst_line,
            "maintenance_risk": _maintenance_risk_from_rate(_fnone(maint_rate)),
        })

    # Rank by most-negative oee_cost first (largest damage), then most cases
    out.sort(key=lambda r: (r["oee_cost_points"] if r["oee_cost_points"] is not None else 0.0, -r["cases"]))
    return out


# ---------------------------------------------------------------- detail


def _why_risky(g: pd.DataFrame, line_comparison: List[Dict[str, Any]]) -> List[str]:
    bullets: List[str] = []
    avg_actual = g["actual_changeover_minutes"].dropna().mean() if "actual_changeover_minutes" in g else None
    avg_theo = g["theoretical_changeover_minutes"].dropna().mean() if "theoretical_changeover_minutes" in g else None
    avg_limp = g["cleaning_minutes"].dropna().mean() if "cleaning_minutes" in g else None
    avg_pnp = g["pnp_minutes"].dropna().mean() if "pnp_minutes" in g else None
    maint_rate = g["maintenance_flag"].mean() if "maintenance_flag" in g else None

    if pd.notna(avg_actual) and pd.notna(avg_theo) and avg_actual > avg_theo:
        bullets.append(
            f"Actual changeovers averaged {avg_actual:.0f} min versus a theoretical {avg_theo:.0f} min."
        )
    if pd.notna(avg_limp) and avg_limp > 90:
        bullets.append(f"Cleaning time was elevated ({avg_limp:.0f} min on average).")
    if pd.notna(avg_pnp) and avg_pnp > 180:
        bullets.append(f"PNP / restart stop minutes averaged {avg_pnp:.0f}, above the typical line range.")
    if pd.notna(maint_rate) and maint_rate > 0.3:
        bullets.append(f"Maintenance was active during {maint_rate*100:.0f}% of these transitions.")
    if len(line_comparison) >= 2:
        best = min(line_comparison, key=lambda r: -(r["avg_oee"] or 0))
        worst = max(line_comparison, key=lambda r: -(r["avg_oee"] or 0))
        if best["line"] != worst["line"] and best["avg_oee"] and worst["avg_oee"]:
            bullets.append(
                f"Line {best['line']} recovered OEE better than Line {worst['line']} on this transition."
            )
    if not bullets:
        bullets.append("Evidence is limited — drill into individual orders for more context.")
    return bullets


def _line_comparison(g: pd.DataFrame) -> List[Dict[str, Any]]:
    if g.empty or "line" not in g.columns:
        return []
    rows: List[Dict[str, Any]] = []
    for line, lg in g.groupby("line"):
        rows.append({
            "line": int(line),
            "cases": int(len(lg)),
            "avg_oee": _fnone(lg["oee"].dropna().mean()),
            "avg_overrun_minutes": _fnone(lg["changeover_overrun_minutes"].dropna().mean()) if "changeover_overrun_minutes" in lg else None,
            "maintenance_risk": _maintenance_risk_from_rate(_fnone(lg["maintenance_flag"].mean()) if "maintenance_flag" in lg else None),
        })
    # Verdict — best avg_oee = safer, worst = avoid
    if rows:
        sorted_rows = sorted(rows, key=lambda r: -(r["avg_oee"] or 0.0))
        for i, r in enumerate(sorted_rows):
            if i == 0 and len(sorted_rows) > 1:
                r["verdict"] = "safer"
            elif i == len(sorted_rows) - 1 and len(sorted_rows) > 1:
                r["verdict"] = "avoid"
            else:
                r["verdict"] = "backup" if len(sorted_rows) > 1 else "safer"
        return sorted_rows
    return rows


def get_transition_detail(tt: pd.DataFrame, transition_type: str, top_orders: int = 8) -> Optional[Dict[str, Any]]:
    if tt is None or tt.empty:
        return None
    g = tt[tt["transition_type"] == transition_type]
    if g.empty:
        return None

    cases = int(len(g))
    avg_oee = _fnone(g["oee"].dropna().mean())
    baseline_oee = _fnone(g["baseline_oee"].dropna().mean()) if "baseline_oee" in g else None
    oee_cost = _fnone(g["oee_cost_points"].dropna().mean()) if "oee_cost_points" in g else None
    avg_actual = _fnone(g["actual_changeover_minutes"].dropna().mean()) if "actual_changeover_minutes" in g else None
    avg_theo = _fnone(g["theoretical_changeover_minutes"].dropna().mean()) if "theoretical_changeover_minutes" in g else None
    avg_overrun = _fnone(g["changeover_overrun_minutes"].dropna().mean()) if "changeover_overrun_minutes" in g else None

    line_cmp = _line_comparison(g)
    why = _why_risky(g, line_cmp)

    # Worst orders: most-negative oee_cost_points
    sorted_g = g.copy()
    if "oee_cost_points" in sorted_g.columns:
        sorted_g = sorted_g.sort_values("oee_cost_points", ascending=True)
    worst_orders = []
    for _, r in sorted_g.head(top_orders).iterrows():
        worst_orders.append({
            "date": r.get("date").isoformat() if pd.notna(r.get("date")) else None,
            "line": int(r.get("line")),
            "previous_of": str(r.get("previous_of")),
            "current_of": str(r.get("current_of")),
            "previous_sku": r.get("previous_sku"),
            "current_sku": r.get("current_sku"),
            "previous_product": r.get("previous_product"),
            "current_product": r.get("current_product"),
            "oee": _fnone(r.get("oee")),
            "actual_changeover_minutes": _fnone(r.get("actual_changeover_minutes")),
            "theoretical_changeover_minutes": _fnone(r.get("theoretical_changeover_minutes")),
            "overrun_minutes": _fnone(r.get("changeover_overrun_minutes")),
            "maintenance_flag": bool(r.get("maintenance_flag")),
        })

    return {
        "transition_type": str(transition_type),
        "summary": {
            "cases": cases,
            "avg_oee": avg_oee,
            "baseline_oee": baseline_oee,
            "oee_cost_points": oee_cost,
            "avg_actual_changeover_minutes": avg_actual,
            "avg_theoretical_changeover_minutes": avg_theo,
            "avg_overrun_minutes": avg_overrun,
            "confidence_label": _confidence_label(cases),
        },
        "why_risky": why,
        "line_comparison": line_cmp,
        "worst_orders": worst_orders,
    }


# ---------------------------------------------------------------- evidence


def get_order_evidence(tt: pd.DataFrame, previous_of: str, current_of: str) -> Optional[Dict[str, Any]]:
    if tt is None or tt.empty:
        return None
    row = tt[(tt["previous_of"] == previous_of) & (tt["current_of"] == current_of)]
    if row.empty:
        return None
    r = row.iloc[0]
    actual = _fnone(r.get("actual_changeover_minutes"))
    theo = _fnone(r.get("theoretical_changeover_minutes"))
    overrun = _fnone(r.get("changeover_overrun_minutes"))
    par_tot = _fnone(r.get("par_tot_minutes"))
    pnp = _fnone(r.get("pnp_minutes"))
    limp = _fnone(r.get("cleaning_minutes"))
    idle = _fnone(r.get("idle_minutes"))
    actual_oee = _fnone(r.get("oee"))
    baseline = _fnone(r.get("baseline_oee"))
    oee_cost = _fnone(r.get("oee_cost_points"))
    transition_type = str(r.get("transition_type"))
    line = int(r.get("line"))
    maint = bool(r.get("maintenance_flag"))

    conclusion_parts: List[str] = []
    if actual and theo and actual > theo:
        conclusion_parts.append(
            f"Actual changeover ({actual:.0f} min) exceeded theoretical ({theo:.0f} min)."
        )
    if actual_oee and baseline and actual_oee < baseline:
        conclusion_parts.append(
            f"OEE was {actual_oee*100:.0f}% versus a baseline of {baseline*100:.0f}% for this SKU on Line {line}."
        )
    if maint:
        conclusion_parts.append("Maintenance was active around this OF.")
    diagnostic_conclusion = (
        " ".join(conclusion_parts)
        if conclusion_parts
        else "No standout deviations in this transition — evidence is limited."
    )

    return {
        "previous_of": str(r.get("previous_of")),
        "current_of": str(r.get("current_of")),
        "line": line,
        "date": r.get("date").isoformat() if pd.notna(r.get("date")) else None,
        "transition_type": transition_type,
        "previous_sku": r.get("previous_sku"),
        "current_sku": r.get("current_sku"),
        "previous_product": r.get("previous_product"),
        "current_product": r.get("current_product"),
        "actual_oee": actual_oee,
        "baseline_oee": baseline,
        "oee_cost_points": oee_cost,
        "theoretical_changeover_minutes": theo,
        "actual_changeover_minutes": actual,
        "overrun_minutes": overrun,
        "par_tot_minutes": par_tot,
        "pnp_minutes": pnp,
        "limpieza_minutes": limp,
        "idle_minutes": idle,
        "maintenance_flag": maint,
        "diagnostic_conclusion": diagnostic_conclusion,
    }


# ---------------------------------------------------------------- helpers exposed to optimizer


def diagnostic_risk_for(
    transition_type: Optional[str],
    line: Optional[int],
    tt: pd.DataFrame,
) -> Dict[str, Any]:
    """Quick lookup used by the optimizer to attach diagnostic context to a candidate."""
    if tt is None or tt.empty or not transition_type:
        return {
            "transition_type": transition_type,
            "risk_pattern": "Low OEE recovery",
            "cases": 0,
            "avg_oee": None,
            "avg_overrun": None,
            "oee_cost_points": None,
            "diagnostic_risk_level": "low",
        }
    g = tt[tt["transition_type"] == transition_type]
    if line is not None:
        line_g = g[g["line"] == int(line)]
        if not line_g.empty:
            g = line_g
    if g.empty:
        return {
            "transition_type": transition_type,
            "risk_pattern": "Low OEE recovery",
            "cases": 0,
            "avg_oee": None,
            "avg_overrun": None,
            "oee_cost_points": None,
            "diagnostic_risk_level": "low",
        }
    avg_oee = _fnone(g["oee"].dropna().mean())
    overrun = _fnone(g["changeover_overrun_minutes"].dropna().mean()) if "changeover_overrun_minutes" in g else None
    oee_cost = _fnone(g["oee_cost_points"].dropna().mean()) if "oee_cost_points" in g else None
    risk_pattern = _risk_pattern(g)
    # Risk level
    level = "low"
    if oee_cost is not None and oee_cost <= -8:
        level = "high"
    elif oee_cost is not None and oee_cost <= -3:
        level = "medium"
    elif overrun is not None and overrun > 30:
        level = "medium"
    return {
        "transition_type": transition_type,
        "risk_pattern": risk_pattern,
        "cases": int(len(g)),
        "avg_oee": avg_oee,
        "avg_overrun": overrun,
        "oee_cost_points": oee_cost,
        "diagnostic_risk_level": level,
    }
