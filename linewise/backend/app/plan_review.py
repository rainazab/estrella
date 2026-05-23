"""Plan Review mode — score the loaded plan as it stands.

Rush Order mode asks: "Where do I put this new order?".
Plan Review mode asks: "Given what's already scheduled this week, where am I
about to lose OEE and money?".

The review walks every (previous OF → current OF) transition in the current
plan, compares each one against:
  * the line-format eligibility rules (line_rules)
  * the CF theoretical changeover (cf_matrix)
  * the diagnostic memory by transition type (diagnostics)
  * the historical analogue OEE for that line + transition (transition_memory)
and turns the result into a plan-health score with risky-transition + swap
recommendations.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

from .business_impact import ASSUMPTIONS, compute_business_impact
from .cf_matrix import CFMatrix
from .diagnostics import diagnostic_risk_for
from .line_rules import infeasibility_reason, is_feasible, normalize_format
from .optimizer import derive_transition_type
from .transition_memory import find_similar_cases


def _benchmark_oee(tt: pd.DataFrame, line: int, transition_type: str) -> Optional[float]:
    if tt is None or tt.empty:
        return None
    sub = tt[(tt["line"] == line) & (tt["transition_type"] == transition_type)]
    if sub.empty:
        return None
    v = sub["oee"].dropna().mean()
    return float(v) if pd.notna(v) else None


def review_plan(
    current_plan: Dict[str, Any],
    tt: pd.DataFrame,
    cf_matrix: Optional[CFMatrix] = None,
) -> Dict[str, Any]:
    risky: List[Dict[str, Any]] = []
    cleaning_heavy: List[Dict[str, Any]] = []
    infeasible: List[Dict[str, Any]] = []
    recommended_swaps: List[Dict[str, Any]] = []

    total_leakage_points = 0.0
    total_value_at_risk = 0.0
    total_capacity_at_risk = 0.0
    transitions_evaluated = 0

    for plan_line in current_plan.get("lines", []):
        line = int(plan_line["line"])
        orders = plan_line.get("orders", [])
        for i in range(1, len(orders)):
            prev = orders[i - 1]
            cur = orders[i]

            prev_format_key = prev.get("format_key") or normalize_format(prev.get("tipo_envase") or prev.get("envase"))
            cur_format_key = cur.get("format_key") or normalize_format(cur.get("tipo_envase") or cur.get("envase"))

            feasible = is_feasible(line, cur_format_key)
            transition_type = derive_transition_type(
                prev.get("envase"), prev.get("familia"), prev.get("marca"),
                cur.get("envase"), cur.get("familia"), cur.get("marca"),
                prev_format_key, cur_format_key,
            )

            cf_theo: Optional[float] = None
            if cf_matrix is not None and prev_format_key and cur_format_key:
                cf_theo = cf_matrix.format_change_minutes(line, prev_format_key, cur_format_key)

            sim = find_similar_cases({
                "line": line, "previous_sku": prev.get("sku"), "current_sku": cur.get("sku"),
                "current_envase": cur.get("envase"), "current_familia": cur.get("familia"),
                "transition_type": transition_type, "theoretical_changeover_minutes": cf_theo or 30.0,
                "volume": float(cur.get("volume") or 0),
            }, tt, top_k=5)
            diag = diagnostic_risk_for(transition_type, line, tt)
            bench = _benchmark_oee(tt, line, transition_type)

            actual_co = float(sim.get("historical_avg_actual_changeover") or cf_theo or 30.0)
            execution_gap = (actual_co - cf_theo) if cf_theo is not None else None
            current_oee = float(cur.get("historical_oee") or sim.get("historical_avg_oee") or bench or 0.55)

            leakage = (bench - current_oee) * 100.0 if bench is not None else 0.0
            volume_hl = float(cur.get("volume") or 0)
            biz = compute_business_impact(
                line=line, volume_hl=volume_hl,
                predicted_oee=current_oee,
                naive_predicted_oee=current_oee - max(leakage, 0) / 100.0,
                expected_downtime_minutes=actual_co + (sim.get("historical_stop_risk") or 0.0),
                naive_expected_downtime_minutes=actual_co + (sim.get("historical_stop_risk") or 0.0) + max(execution_gap or 0, 0),
                feasible=feasible, is_naive_line=False, misses_deadline=False,
            )
            transitions_evaluated += 1
            total_leakage_points += min(0.0, current_oee - (bench or current_oee)) * 100.0
            total_value_at_risk += max(0.0, biz["estimated_cost_of_naive_eur"] - biz["estimated_cost_of_recommendation_eur"])
            total_capacity_at_risk += max(0.0, (execution_gap or 0) / 60.0)

            row = {
                "line": line,
                "previous_of": prev.get("of"),
                "current_of": cur.get("of"),
                "previous_product": prev.get("product"),
                "current_product": cur.get("product"),
                "transition_type": transition_type,
                "feasible": feasible,
                "infeasibility_reason": None if feasible else infeasibility_reason(line, cur_format_key),
                "cf_theoretical_minutes": cf_theo,
                "historical_actual_changeover_minutes": actual_co,
                "execution_gap_minutes": execution_gap,
                "diagnostic_risk_pattern": diag.get("risk_pattern"),
                "diagnostic_risk_level": diag.get("diagnostic_risk_level"),
                "line_transition_benchmark_oee": bench,
                "estimated_value_at_risk_eur": round(max(0.0, biz["estimated_cost_of_naive_eur"] - biz["estimated_cost_of_recommendation_eur"]), 0),
                "capacity_hours_at_risk": round(max(0.0, (execution_gap or 0) / 60.0), 2),
            }
            if not feasible:
                infeasible.append(row)
            elif diag.get("diagnostic_risk_level") in ("high", "medium") or (execution_gap or 0) >= 30:
                risky.append(row)
            if (execution_gap or 0) >= 30 or transition_type == "Volumen Envase":
                cleaning_heavy.append(row)

    # Simple swap recommendation: if any risky transition is "Volumen Envase"
    # on a line that is NOT the diagnostic-safest line for that transition,
    # propose moving it to the safer line (if feasible).
    from .diagnostics import get_transition_detail
    seen_swap_keys: set = set()
    for r in risky[:6]:
        detail = get_transition_detail(tt, r["transition_type"]) if tt is not None else None
        if not detail:
            continue
        safer = next((lc for lc in detail.get("line_comparison", []) if lc.get("verdict") == "safer"), None)
        if not safer:
            continue
        if safer["line"] == r["line"]:
            continue
        key = (r["previous_of"], r["current_of"])
        if key in seen_swap_keys:
            continue
        seen_swap_keys.add(key)
        recommended_swaps.append({
            "from_line": r["line"],
            "to_line": safer["line"],
            "transition_type": r["transition_type"],
            "previous_of": r["previous_of"],
            "current_of": r["current_of"],
            "rationale": (
                f"On the '{r['transition_type']}' transition, Line {safer['line']} "
                f"historically averaged {safer['avg_oee']*100:.0f}% OEE with overrun "
                f"~{(safer.get('avg_overrun_minutes') or 0):.0f} min — vs. Line {r['line']} "
                f"which is currently scheduled to absorb it."
            ),
        })

    # Plan health: start at 100, subtract for issues, normalize.
    avg_leakage = (
        total_leakage_points / transitions_evaluated if transitions_evaluated else 0.0
    )
    plan_health = (
        100.0
        + avg_leakage  # already negative when there's leakage
        - 3.0 * len(risky)
        - 10.0 * len(infeasible)
        - 1.0 * len(cleaning_heavy)
    )
    plan_health = max(15.0, min(100.0, plan_health))

    return {
        "plan_health_score": round(plan_health, 1),
        "transitions_evaluated": transitions_evaluated,
        "expected_oee_leakage_points": round(total_leakage_points, 1),
        "estimated_value_at_risk_eur": round(total_value_at_risk, 0),
        "capacity_hours_at_risk": round(total_capacity_at_risk, 2),
        "risky_transitions": risky[:12],
        "cleaning_heavy_transitions": cleaning_heavy[:12],
        "infeasible_transitions": infeasible,
        "recommended_swaps": recommended_swaps,
        "assumptions": {
            "value_per_hl_eur": ASSUMPTIONS.value_per_hl_eur,
            "downtime_cost_per_hour_eur": ASSUMPTIONS.downtime_cost_per_hour_eur,
            "overtime_recovery_cost_per_hour_eur": ASSUMPTIONS.overtime_recovery_cost_per_hour_eur,
        },
    }
