"""Generate candidate insertion slots, score them with diagnostic + business
context, and rank them.

The recommendation is no longer "best predicted OEE". It is a business-aware
score that combines:

  * hard line-format feasibility (line_rules.py)
  * theoretical changeover from the CF matrix (cf_matrix.py) versus
    historical actuals — the *execution gap*
  * historical OEE benchmark for this line + transition type
  * predicted OEE from the local sklearn model
  * cleaning impact (CIP + Limpieza + PNP)
  * Sequence Pain Score (kept transparent)
  * financial / capacity impact (business_impact.py)
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

from .business_impact import compute_business_impact
from .cf_matrix import CFMatrix
from .config import LINES
from .diagnostics import diagnostic_risk_for
from .line_rules import (
    LINE_FORMAT_CAPABILITIES,
    infeasibility_reason,
    is_feasible,
    normalize_format,
)
from .model import OEEModel, confidence_from_similar
from .transition_memory import find_similar_cases


# ---------------------------------------------------- helpers


def derive_transition_type(
    prev_envase: Optional[str],
    prev_fam: Optional[str],
    prev_marca: Optional[str],
    cur_envase: Optional[str],
    cur_fam: Optional[str],
    cur_marca: Optional[str],
    prev_format_key: Optional[str] = None,
    cur_format_key: Optional[str] = None,
) -> str:
    if prev_format_key and cur_format_key and prev_format_key != cur_format_key:
        return "Volumen Envase"
    if prev_envase and cur_envase and prev_envase != cur_envase:
        return "Volumen Envase"
    if prev_marca and cur_marca and prev_marca != cur_marca:
        return "Marca"
    if prev_fam and cur_fam and prev_fam != cur_fam:
        return "Contenido"
    return "Pack. Secundario"


def median_cleaning_minutes(tt: pd.DataFrame, line: int) -> float:
    if tt is None or tt.empty or "cleaning_minutes" not in tt.columns:
        return 45.0
    sub = tt[tt["line"] == line]
    v = sub["cleaning_minutes"].dropna().median() if not sub.empty else tt["cleaning_minutes"].dropna().median()
    return float(v) if pd.notna(v) else 45.0


def _maintenance_risk(rate: Optional[float]) -> str:
    if rate is None:
        return "low"
    if rate >= 0.45:
        return "high"
    if rate >= 0.2:
        return "medium"
    return "low"


def _evidence_strength_label(n: int) -> str:
    if n >= 20:
        return "very strong"
    if n >= 8:
        return "strong"
    if n >= 3:
        return "fair"
    return "limited"


def _diagnostic_risk_penalty(level: str) -> float:
    return {"high": 15.0, "medium": 7.0, "low": 0.0}.get(level, 0.0)


def _cleaning_risk_label(cf_minutes: Optional[float], actual_minutes: Optional[float]) -> str:
    if cf_minutes is None or actual_minutes is None:
        return "unknown"
    gap = actual_minutes - cf_minutes
    if gap >= 60:
        return "high"
    if gap >= 20:
        return "medium"
    return "low"


def _estimate_recovery_hours(
    transition_type: str,
    actual_co_minutes: float,
    cleaning_minutes: float,
    diag_level: str,
) -> float:
    """Hours to return to baseline OEE after the insertion.

    Heuristic: actual changeover + cleaning + a tail proportional to diagnostic
    risk. Tail is shorter for low-risk transitions and longer for known
    OEE-recovery offenders.
    """
    base_hours = (actual_co_minutes + cleaning_minutes) / 60.0
    tail = {"high": 24.0, "medium": 12.0, "low": 4.0}.get(diag_level, 8.0)
    if transition_type in ("Marca", "Contenido"):
        tail += 6.0
    if transition_type == "Volumen Envase":
        tail += 12.0
    return round(base_hours + tail, 1)


def _of_duration_hours(anchor_order: Dict[str, Any]) -> float:
    """Derive duration in hours from an order's start/end ISO strings."""
    try:
        from datetime import datetime as _dt
        s = _dt.fromisoformat(anchor_order["start"])
        e = _dt.fromisoformat(anchor_order["end"])
        return max((e - s).total_seconds() / 3600.0, 1.0)
    except Exception:
        return 4.0


def _build_proposed_plan_and_moves(
    current_plan: Dict[str, Any],
    insertion_line: int,
    anchor_of: str,
    urgent_label: str,
    urgent_oee: float,
    urgent_volume_hl: float,
    line_hl_per_hour: float,
) -> Dict[str, Any]:
    """Produce a per-line timeline of the plan with the urgent OF inserted.

    Returns:
      {
        'plan': { '14': [{of, start, w, oee, kind}], '17': [...], '19': [...] },
        'ghosts': { '17': [{of, start, w}] },     # original positions of shifted orders
        'moves': [{of, line, shift, why}],
        'orders_moved': N,
      }
    """
    # Insertion duration in days, using the urgent volume and a baseline throughput
    insertion_hours = max(1.0, urgent_volume_hl / max(line_hl_per_hour, 1.0))
    insertion_days = insertion_hours / 24.0

    plan: Dict[str, List[Dict[str, Any]]] = {}
    ghosts: Dict[str, List[Dict[str, Any]]] = {}
    moves: List[Dict[str, Any]] = []
    orders_moved = 0

    for plan_line in current_plan.get("lines", []):
        line = int(plan_line["line"])
        orders = plan_line.get("orders", [])
        segs: List[Dict[str, Any]] = []

        # Build day-relative coords by accumulating durations starting at 0
        cursor_days = 0.0
        inserted_yet = False
        for i, o in enumerate(orders):
            dur_days = _of_duration_hours(o) / 24.0
            shift_for_this_one = 0.0

            # If this is the insertion line and we're at the slot
            if (
                line == int(insertion_line)
                and not inserted_yet
                and o["of"] == anchor_of
            ):
                # Add the anchor itself first (no shift)
                segs.append({
                    "of": o["of"],
                    "start": round(cursor_days, 2),
                    "w": round(dur_days, 2),
                    "oee": float(o.get("historical_oee") or 0.55),
                    "kind": "anchor",
                })
                cursor_days += dur_days
                # Then insert the urgent OF
                segs.append({
                    "of": urgent_label,
                    "start": round(cursor_days, 2),
                    "w": round(insertion_days, 2),
                    "oee": float(urgent_oee),
                    "kind": "ins",
                })
                cursor_days += insertion_days
                inserted_yet = True
                continue

            if line == int(insertion_line) and inserted_yet:
                # Order shifted by the insertion duration
                ghost_start = cursor_days - insertion_days
                ghosts.setdefault(str(line), []).append({
                    "of": o["of"],
                    "start": round(ghost_start, 2),
                    "w": round(dur_days, 2),
                })
                shift_hours = insertion_hours
                shift_for_this_one = shift_hours
                moves.append({
                    "of": o["of"],
                    "line": line,
                    "shift": f"+{int(round(shift_hours))}h",
                    "why": "pushed back to make room for the insertion",
                })
                orders_moved += 1
                segs.append({
                    "of": o["of"],
                    "start": round(cursor_days, 2),
                    "w": round(dur_days, 2),
                    "oee": float(o.get("historical_oee") or 0.55),
                    "kind": "shift",
                })
                cursor_days += dur_days
            else:
                segs.append({
                    "of": o["of"],
                    "start": round(cursor_days, 2),
                    "w": round(dur_days, 2),
                    "oee": float(o.get("historical_oee") or 0.55),
                    "kind": "planned",
                })
                cursor_days += dur_days

        plan[str(line)] = segs

    return {
        "plan": plan,
        "ghosts": ghosts,
        "moves": moves,
        "orders_moved": orders_moved,
        "insertion_hours": insertion_hours,
        "insertion_days": insertion_days,
    }


def _naive_band_for(
    current_plan: Dict[str, Any],
    naive_line: Optional[int],
    naive_anchor_of: Optional[str],
) -> Optional[Dict[str, Any]]:
    """Approximate left/width (in days) of the naive slot on its line."""
    if naive_line is None or naive_anchor_of is None:
        return None
    for plan_line in current_plan.get("lines", []):
        if int(plan_line["line"]) != int(naive_line):
            continue
        cursor = 0.0
        for o in plan_line.get("orders", []):
            dur = _of_duration_hours(o) / 24.0
            if o["of"] == naive_anchor_of:
                # Naive band sits right after this anchor
                return {
                    "line": int(naive_line),
                    "start": round(cursor + dur, 2),
                    "w": round(max(1.0, dur), 2),
                }
            cursor += dur
    return None


def _pain_score(
    predicted_oee: float,
    overrun: float,
    downtime: float,
    maint: str,
    cleaning: float,
    misses_deadline: bool,
    confidence: float,
    diagnostic_risk_level: str,
    feasible: bool,
) -> float:
    if not feasible:
        infeasible_penalty = 200.0
    else:
        infeasible_penalty = 0.0
    maint_penalty = {"high": 15.0, "medium": 7.0, "low": 0.0}[maint]
    cleaning_penalty = max(cleaning, 0.0) * 0.10
    deadline_penalty = 30.0 if misses_deadline else 0.0
    uncertainty_penalty = (1.0 - confidence) * 20.0
    diag_penalty = _diagnostic_risk_penalty(diagnostic_risk_level)
    return (
        (1.0 - predicted_oee) * 100.0
        + max(overrun, 0.0) * 0.25
        + max(downtime, 0.0) * 0.10
        + maint_penalty
        + cleaning_penalty
        + deadline_penalty
        + uncertainty_penalty
        + diag_penalty
        + infeasible_penalty
    )


# ---------------------------------------------------- historical benchmark


def _historical_benchmark(
    tt: pd.DataFrame,
    line: int,
    transition_type: str,
    cur_format_key: Optional[str],
) -> Dict[str, Any]:
    """Aggregate historical OEE references for the planner."""
    if tt is None or tt.empty:
        return {
            "line_format_benchmark_oee": None,
            "line_transition_benchmark_oee": None,
            "months_used": [],
            "cases_used": 0,
        }
    df = tt[tt["line"] == int(line)]
    transition_df = df[df["transition_type"] == transition_type] if "transition_type" in df.columns else df

    out: Dict[str, Any] = {
        "line_transition_benchmark_oee": None,
        "line_format_benchmark_oee": None,
        "months_used": [],
        "cases_used": 0,
    }
    if not transition_df.empty and transition_df["oee"].notna().any():
        out["line_transition_benchmark_oee"] = float(transition_df["oee"].dropna().mean())
        out["cases_used"] = int(transition_df["oee"].notna().sum())
        if "date" in transition_df.columns:
            months = (
                transition_df["date"]
                .dropna()
                .dt.to_period("M")
                .astype(str)
                .unique()
                .tolist()
            )
            out["months_used"] = sorted(months)[-6:]
    if not df.empty and df["oee"].notna().any():
        out["line_format_benchmark_oee"] = float(df["oee"].dropna().mean())
    return out


# ---------------------------------------------------- top factors / reasoning


def _top_factors(candidate: Dict[str, Any], naive_predicted_oee: Optional[float]) -> List[str]:
    factors: List[str] = []
    sim = candidate.get("_sim", {}) or {}
    diag = candidate.get("_diagnostic", {}) or {}
    cleaning = candidate.get("cleaning_impact", {}) or {}
    feasible = candidate.get("feasible", True)
    if not feasible:
        factors.append("Line cannot produce this format — hard rule blocks it")
    cur_env = candidate.get("_current_envase")
    prev_env = candidate.get("_previous_envase")

    if prev_env and cur_env and prev_env == cur_env:
        factors.append("Same-envase neighbor (no format change)")
    avg_oee = sim.get("historical_avg_oee")
    overrun = sim.get("historical_avg_overrun")
    maint_rate = sim.get("maintenance_nearby_rate")
    if avg_oee is not None and avg_oee >= 0.55:
        factors.append(f"Analogue OEE averages {avg_oee*100:.0f}%")
    if overrun is not None and overrun <= 8:
        factors.append(f"Low historical changeover overrun ({overrun:.0f} min)")
    if maint_rate is not None and maint_rate < 0.2:
        factors.append("Low maintenance interference on similar transitions")
    if diag.get("diagnostic_risk_level") == "low":
        factors.append(f"Diagnostic risk is low for transition type '{diag.get('transition_type')}'")
    elif diag.get("diagnostic_risk_level") == "high":
        factors.append(
            f"Diagnostic memory flags '{diag.get('transition_type')}' as historically high-risk"
        )
    if cleaning.get("cleaning_risk") == "low":
        factors.append("Cleaning / changeover effort is at or below the CF baseline")
    elif cleaning.get("cleaning_risk") == "high":
        factors.append("Cleaning / changeover effort is well above the CF baseline")
    if naive_predicted_oee is not None and candidate["predicted_oee"] - naive_predicted_oee >= 0.02:
        factors.append("Higher predicted OEE than the naive slot")
    return factors[:6]


def _reasoning_bullets(candidate: Dict[str, Any]) -> List[str]:
    """The cockpit's '1..5' reasoning lines, in fixed order."""
    feasible = candidate.get("feasible", True)
    cleaning = candidate.get("cleaning_impact", {}) or {}
    benchmark = candidate.get("historical_benchmark", {}) or {}
    biz = candidate.get("business_impact", {}) or {}

    lines: List[str] = []
    if feasible:
        lines.append(f"Line {candidate['line']} can physically produce this format.")
    else:
        lines.append(
            candidate.get("infeasibility_reason")
            or f"Line {candidate['line']} cannot produce this format."
        )

    cf = cleaning.get("cf_theoretical_minutes")
    actual = cleaning.get("historical_actual_changeover_minutes")
    if cf is not None and actual is not None:
        gap = actual - cf
        lines.append(
            f"CF table expects {cf:.0f} min; history averaged {actual:.0f} min (gap {gap:+.0f} min)."
        )
    elif cf is not None:
        lines.append(f"CF table expects a {cf:.0f}-min theoretical changeover here.")
    else:
        lines.append("CF baseline unknown for this transition — using historical median.")

    bench_oee = benchmark.get("line_transition_benchmark_oee")
    if bench_oee is not None:
        delta = (candidate["predicted_oee"] - bench_oee) * 100
        lines.append(
            f"Historical analogues averaged {bench_oee*100:.0f}% OEE on this line + transition "
            f"— prediction is {delta:+.0f} pts vs. that benchmark."
        )
    else:
        lines.append("Historical evidence is limited for this exact transition.")

    cleaning_risk = cleaning.get("cleaning_risk")
    if cleaning_risk == "low":
        lines.append("Cleaning risk is low — changeover effort tracks the CF baseline.")
    elif cleaning_risk == "medium":
        lines.append("Cleaning risk is moderate — execution typically slips beyond CF.")
    elif cleaning_risk == "high":
        lines.append("Cleaning risk is high — historical execution overran the CF baseline by ≥ 1h.")
    else:
        lines.append("Cleaning risk is unknown for this transition.")

    hl = biz.get("hl_protected")
    eur = biz.get("financial_delta_eur")
    if hl is not None and eur is not None:
        lines.append(
            f"Volume / financial: ~{hl:.0f} HL protected, est. €{eur:,.0f} versus the naive plan."
        )
    else:
        lines.append("Volume / financial impact: not estimable for this slot.")

    return lines[:5]


# ---------------------------------------------------- main


def generate_candidates(
    current_plan: Dict[str, Any],
    urgent: Dict[str, Any],
    tt: pd.DataFrame,
    model: OEEModel,
    product_info: Dict[str, Any],
    cf_matrix: Optional[CFMatrix] = None,
) -> Dict[str, Any]:
    cur_sku = urgent["sku"]
    cur_envase = product_info.get("format")
    cur_familia = product_info.get("family")
    cur_marca = product_info.get("marca")
    cur_format_key = product_info.get("format_key") or normalize_format(cur_envase)
    volume = float(urgent.get("volume", 0))

    all_candidates: List[Dict[str, Any]] = []
    infeasible: List[Dict[str, Any]] = []

    for plan_line in current_plan.get("lines", []):
        line = int(plan_line["line"])
        line_feasible = is_feasible(line, cur_format_key)

        orders = plan_line.get("orders", [])
        if not orders:
            continue
        for i, anchor in enumerate(orders):
            prev_sku = anchor.get("sku")
            prev_envase = anchor.get("envase") or anchor.get("format")
            prev_familia = anchor.get("familia") or anchor.get("family")
            prev_marca = anchor.get("marca")
            prev_format_key = anchor.get("format_key") or normalize_format(
                anchor.get("tipo_envase") or prev_envase
            )

            transition_type = derive_transition_type(
                prev_envase, prev_familia, prev_marca,
                cur_envase, cur_familia, cur_marca,
                prev_format_key, cur_format_key,
            )

            # CF lookup — first-class theoretical baseline
            cf_theoretical: Optional[float] = None
            if cf_matrix is not None and prev_format_key and cur_format_key:
                cf_theoretical = cf_matrix.format_change_minutes(line, prev_format_key, cur_format_key)
            if cf_theoretical is None and tt is not None and not tt.empty:
                sub = tt[(tt["line"] == line) & (tt["transition_type"] == transition_type)]
                if not sub.empty and "theoretical_changeover_minutes" in sub.columns:
                    v = sub["theoretical_changeover_minutes"].dropna().median()
                    cf_theoretical = float(v) if pd.notna(v) and v > 0 else None
            theo_co_for_features = cf_theoretical if cf_theoretical is not None else 30.0

            cleaning_min = median_cleaning_minutes(tt, line)

            cand_feat = {
                "line": line,
                "previous_sku": prev_sku,
                "current_sku": cur_sku,
                "current_envase": cur_envase,
                "current_familia": cur_familia,
                "transition_type": transition_type,
                "theoretical_changeover_minutes": theo_co_for_features,
                "volume": volume,
            }
            sim = find_similar_cases(cand_feat, tt, top_k=5)
            diag = diagnostic_risk_for(transition_type, line, tt)
            benchmark = _historical_benchmark(tt, line, transition_type, cur_format_key)

            features = {
                "line": str(line),
                "current_sku": str(cur_sku),
                "previous_sku": str(prev_sku),
                "change_type": transition_type,
                "format_change": float(prev_format_key != cur_format_key) if prev_format_key and cur_format_key else 0.0,
                "theoretical_changeover_minutes": float(theo_co_for_features),
                "historical_avg_oee": float(sim.get("historical_avg_oee") or 0.5),
                "historical_avg_actual_changeover": float(sim.get("historical_avg_actual_changeover") or theo_co_for_features),
                "historical_avg_overrun": float(sim.get("historical_avg_overrun") or 0.0),
                "maintenance_flag": 0.0,
                "volume": float(volume),
                "month": float(datetime.utcnow().month),
                "weekday": float(datetime.utcnow().weekday()),
            }
            predicted_oee = model.predict(features, sim)
            confidence = confidence_from_similar(sim.get("n_similar", 0))
            overrun_min = float(sim.get("historical_avg_overrun") or 0.0)
            actual_co = float(sim.get("historical_avg_actual_changeover") or theo_co_for_features)
            expected_downtime = max(0.0, actual_co + cleaning_min + (sim.get("historical_stop_risk") or 0.0))
            maint_rate = sim.get("maintenance_nearby_rate")
            maint_risk = _maintenance_risk(maint_rate)
            diag_level = diag.get("diagnostic_risk_level", "low")

            execution_gap = (actual_co - cf_theoretical) if cf_theoretical is not None else None
            cleaning_impact = {
                "cf_theoretical_minutes": cf_theoretical,
                "historical_actual_changeover_minutes": actual_co,
                "limpieza_minutes": round(cleaning_min, 1),
                "pnp_minutes": 0.0,
                "idle_minutes": 0.0,
                "execution_gap_minutes": (round(execution_gap, 1) if execution_gap is not None else None),
                "cleaning_risk": _cleaning_risk_label(cf_theoretical, actual_co),
            }

            pain = _pain_score(
                predicted_oee, overrun_min, expected_downtime, maint_risk,
                cleaning_min, False, confidence, diag_level, line_feasible,
            )
            evidence_label = _evidence_strength_label(int(diag.get("cases") or 0))

            recovery_hours = _estimate_recovery_hours(
                transition_type, actual_co, cleaning_min, diag_level
            )

            cand = {
                "candidate_id": f"L{line}_AFTER_{anchor['of']}",
                "line": line,
                "position_label": f"after {anchor['of']}",
                "anchor_of": anchor["of"],
                "recovery_hours": recovery_hours,
                "transition_type": transition_type,
                "diagnostic_risk_pattern": diag.get("risk_pattern"),
                "previous_format_key": prev_format_key,
                "current_format_key": cur_format_key,
                "feasible": line_feasible,
                "infeasibility_reason": infeasibility_reason(line, cur_format_key) if not line_feasible else None,
                "predicted_oee": float(predicted_oee),
                "expected_downtime_minutes": float(expected_downtime),
                "changeover_overrun_minutes": float(overrun_min),
                "maintenance_risk": maint_risk,
                "confidence": float(confidence),
                "evidence_strength": float(confidence),
                "evidence_strength_label": evidence_label,
                "similar_cases_count": int(diag.get("cases") or sim.get("n_similar", 0)),
                "pain_score": float(pain),
                "cleaning_impact": cleaning_impact,
                "historical_benchmark": benchmark,
                "_sim": sim,
                "_diagnostic": diag,
                "_features": features,
                "_change_type": transition_type,
                "_cleaning_minutes": float(cleaning_min),
                "_current_envase": cur_envase,
                "_previous_envase": prev_envase,
                "_anchor_order": anchor,
            }
            if line_feasible:
                all_candidates.append(cand)
            else:
                infeasible.append(cand)

    if not all_candidates and not infeasible:
        return {"ranked": [], "infeasible": [], "naive_idx": None, "naive_line": None}

    historical_lines = product_info.get("historical_lines") or []
    naive_line: Optional[int] = None
    for l in historical_lines:
        if is_feasible(l, cur_format_key):
            naive_line = l
            break
    if naive_line is None and all_candidates:
        per_line_pain = {}
        for c in all_candidates:
            per_line_pain.setdefault(c["line"], []).append(c["pain_score"])
        naive_line = max(per_line_pain, key=lambda L: sum(per_line_pain[L]) / len(per_line_pain[L]))

    naive_anchor_of: Optional[str] = None
    if naive_line is not None:
        for plan_line in current_plan.get("lines", []):
            if int(plan_line["line"]) == int(naive_line) and plan_line.get("orders"):
                naive_anchor_of = plan_line["orders"][0]["of"]
                break

    all_candidates.sort(key=lambda c: c["pain_score"])
    for i, c in enumerate(all_candidates):
        c["rank"] = i + 1
        if i == 0:
            c["verdict"] = "recommended"
        elif i <= 2:
            c["verdict"] = "backup"
        else:
            c["verdict"] = "avoid"

    naive_idx: Optional[int] = None
    if naive_anchor_of is not None:
        for i, c in enumerate(all_candidates):
            if c.get("anchor_of") == naive_anchor_of and c["line"] == naive_line:
                naive_idx = i
                break
    if naive_idx is None and all_candidates:
        line_pool = [(i, c) for i, c in enumerate(all_candidates) if naive_line is None or c["line"] == naive_line]
        if line_pool:
            naive_idx = max(line_pool, key=lambda t: t[1]["pain_score"])[0]
        else:
            naive_idx = len(all_candidates) - 1

    if naive_idx == 0 and len(all_candidates) > 1:
        same_line = [(i, c) for i, c in enumerate(all_candidates) if c["line"] == all_candidates[0]["line"] and i != 0]
        if same_line:
            naive_idx = max(same_line, key=lambda t: t[1]["pain_score"])[0]
        else:
            naive_idx = len(all_candidates) - 1

    naive = all_candidates[naive_idx] if naive_idx is not None and all_candidates else None
    naive_oee = naive["predicted_oee"] if naive else None
    naive_downtime = naive["expected_downtime_minutes"] if naive else None

    # Naive band for the timeline (start_days, width_days on the naive line)
    naive_band = _naive_band_for(
        current_plan,
        naive_line,
        naive["anchor_of"] if naive else None,
    )

    urgent_label = str(urgent.get("sku", "URGENT"))
    for c in all_candidates:
        c["naive_predicted_oee"] = naive_oee
        c["oee_gain_vs_naive"] = (c["predicted_oee"] - naive_oee) if naive_oee is not None else None
        # Proposed plan + ghosts + moves, computed per recommended line
        from .business_impact import ASSUMPTIONS
        proposed = _build_proposed_plan_and_moves(
            current_plan=current_plan,
            insertion_line=c["line"],
            anchor_of=c["anchor_of"],
            urgent_label=urgent_label,
            urgent_oee=c["predicted_oee"],
            urgent_volume_hl=volume,
            line_hl_per_hour=ASSUMPTIONS.hl_per_hour(c["line"]),
        )
        c["proposed_plan"] = proposed["plan"]
        c["ghosts"] = proposed["ghosts"]
        c["moves"] = proposed["moves"]
        c["orders_moved"] = proposed["orders_moved"]
        c["naive_band"] = naive_band if c["line"] != (naive_line or -1) else None
        biz = compute_business_impact(
            line=c["line"],
            volume_hl=volume,
            predicted_oee=c["predicted_oee"],
            naive_predicted_oee=naive_oee,
            expected_downtime_minutes=c["expected_downtime_minutes"],
            naive_expected_downtime_minutes=naive_downtime,
            feasible=c.get("feasible", True),
            is_naive_line=(c["line"] == naive_line),
            misses_deadline=False,
        )
        c["business_impact"] = biz
        c["decision"] = biz["decision"]
        c["top_factors"] = _top_factors(c, naive_oee)
        c["reasoning"] = _reasoning_bullets(c)

    for c in infeasible:
        c["rank"] = None
        c["verdict"] = "infeasible"
        c["naive_predicted_oee"] = naive_oee
        c["oee_gain_vs_naive"] = None
        c["decision"] = "ESCALATE"
        c["business_impact"] = compute_business_impact(
            line=c["line"], volume_hl=volume,
            predicted_oee=c["predicted_oee"], naive_predicted_oee=naive_oee,
            expected_downtime_minutes=c["expected_downtime_minutes"],
            naive_expected_downtime_minutes=naive_downtime,
            feasible=False, is_naive_line=False, misses_deadline=False,
        )
        c["top_factors"] = _top_factors(c, naive_oee)
        c["reasoning"] = _reasoning_bullets(c)

    return {
        "ranked": all_candidates,
        "infeasible": infeasible,
        "naive_idx": naive_idx,
        "naive_line": naive_line,
        "naive_band": naive_band,
        "naive_anchor_of": naive["anchor_of"] if naive else None,
    }
