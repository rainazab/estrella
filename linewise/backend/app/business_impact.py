"""Turn predicted OEE + downtime + capacity into volume and money.

LineWise's recommendation must speak the same language as the planner —
capacity hours, hectolitres, euros — not just OEE points. This module is
the bridge from execution numbers to business consequence.

All financial constants are CONFIGURABLE assumptions because LineWise does
not have real margin data. They live in `Assumptions` and are surfaced in
the API so the UI can label them as "estimated operational value", not
guaranteed profit.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional


# -------------------------------------------------- assumptions


@dataclass(frozen=True)
class Assumptions:
    value_per_hl_eur: float = 45.0
    downtime_cost_per_hour_eur: float = 1_200.0
    overtime_recovery_cost_per_hour_eur: float = 800.0
    # Conservative line throughput in HL / hour (used when historical line
    # throughput is unknown). Damm canning lines vary by SKU, so this is a
    # baseline; the real number flows in when available.
    default_line_hl_per_hour: Dict[int, float] = None  # type: ignore

    def hl_per_hour(self, line: int) -> float:
        if self.default_line_hl_per_hour and int(line) in self.default_line_hl_per_hour:
            return float(self.default_line_hl_per_hour[int(line)])
        return 200.0  # demo default; documented in README


ASSUMPTIONS = Assumptions(default_line_hl_per_hour={14: 220.0, 17: 180.0, 19: 240.0})


# -------------------------------------------------- decision label


def _decision_for(
    feasible: bool,
    oee_gain: Optional[float],
    is_naive_line: bool,
    misses_deadline: bool,
) -> str:
    if not feasible:
        return "ESCALATE"
    if misses_deadline:
        return "DELAY"
    if oee_gain is None:
        return "ACCEPT"
    if oee_gain >= 0.04:
        return "ACCEPT_WITH_MOVE" if not is_naive_line else "ACCEPT"
    if oee_gain >= 0.01:
        return "ACCEPT"
    if oee_gain >= -0.01:
        return "ACCEPT"
    return "ESCALATE"


# -------------------------------------------------- impact


def compute_business_impact(
    *,
    line: int,
    volume_hl: float,
    predicted_oee: float,
    naive_predicted_oee: Optional[float],
    expected_downtime_minutes: float,
    naive_expected_downtime_minutes: Optional[float],
    feasible: bool = True,
    is_naive_line: bool = False,
    misses_deadline: bool = False,
    assumptions: Assumptions = ASSUMPTIONS,
) -> Dict[str, Any]:
    """Translate OEE/downtime numbers into capacity hours + HL + euros."""
    hl_hr = assumptions.hl_per_hour(line)

    # OEE delta is points (0–1), gain is fraction of line throughput recovered
    oee_gain = (
        predicted_oee - naive_predicted_oee if naive_predicted_oee is not None else 0.0
    )
    naive_downtime_hours = (naive_expected_downtime_minutes or expected_downtime_minutes) / 60.0
    chosen_downtime_hours = expected_downtime_minutes / 60.0
    downtime_hours_saved = max(0.0, naive_downtime_hours - chosen_downtime_hours)

    # Capacity protected by OEE gain ≈ available_runtime * oee_gain
    available_hours_after_downtime = max(0.0, 24.0 - chosen_downtime_hours)  # within one shift-day horizon
    capacity_hours_from_oee = max(0.0, oee_gain) * available_hours_after_downtime

    capacity_hours_saved = round(capacity_hours_from_oee + downtime_hours_saved, 2)
    hl_protected = round(capacity_hours_saved * hl_hr, 1)
    # 1 HL = 100 L of beer; units depends on can size — keep a rough multiplier
    units_protected = int(hl_protected * 100 / 0.33) if hl_protected else 0

    # Recovery cost the planner would pay if they took the naive plan
    recovery_hours_needed_naive = round(max(0.0, naive_downtime_hours - chosen_downtime_hours), 2)
    estimated_value_protected = round(
        hl_protected * assumptions.value_per_hl_eur
        + downtime_hours_saved * assumptions.downtime_cost_per_hour_eur,
        0,
    )
    estimated_cost_of_naive = round(
        recovery_hours_needed_naive * assumptions.overtime_recovery_cost_per_hour_eur
        + naive_downtime_hours * assumptions.downtime_cost_per_hour_eur,
        0,
    )
    estimated_cost_of_recommendation = round(
        chosen_downtime_hours * assumptions.downtime_cost_per_hour_eur,
        0,
    )
    financial_delta = round(estimated_cost_of_naive - estimated_cost_of_recommendation, 0)

    decision = _decision_for(feasible, oee_gain, is_naive_line, misses_deadline)

    return {
        "decision": decision,
        "feasible": feasible,
        "capacity_hours_saved": capacity_hours_saved,
        "hl_protected": hl_protected,
        "units_protected": units_protected,
        "recovery_hours_needed_naive": recovery_hours_needed_naive,
        "estimated_value_protected_eur": estimated_value_protected,
        "estimated_cost_of_naive_eur": estimated_cost_of_naive,
        "estimated_cost_of_recommendation_eur": estimated_cost_of_recommendation,
        "financial_delta_eur": financial_delta,
        "assumptions": {
            "value_per_hl_eur": assumptions.value_per_hl_eur,
            "downtime_cost_per_hour_eur": assumptions.downtime_cost_per_hour_eur,
            "overtime_recovery_cost_per_hour_eur": assumptions.overtime_recovery_cost_per_hour_eur,
            "hl_per_hour_for_line": hl_hr,
        },
    }
