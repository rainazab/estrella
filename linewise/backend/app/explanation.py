"""Build planner-friendly explanations for a candidate.

Aggregates only computed facts (no raw rows) for the OpenAI explanation step
and produces a deterministic fallback when no API key is configured.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from .openai_client import explain_with_openai


def _impact_for(value: Optional[float], good_threshold: float, bad_threshold: float, higher_is_better: bool = True) -> str:
    if value is None:
        return "neutral"
    if higher_is_better:
        if value >= good_threshold:
            return "positive"
        if value <= bad_threshold:
            return "negative"
        return "neutral"
    else:
        if value <= good_threshold:
            return "positive"
        if value >= bad_threshold:
            return "negative"
        return "neutral"


def _factors(candidate: Dict[str, Any], naive: Optional[Dict[str, Any]]) -> List[Dict[str, str]]:
    sim = candidate.get("_sim", {}) or {}
    diag = candidate.get("_diagnostic", {}) or {}
    factors: List[Dict[str, str]] = []

    hist_oee = sim.get("historical_avg_oee")
    if hist_oee is not None:
        factors.append({
            "factor": "Historical OEE",
            "impact": _impact_for(hist_oee, 0.65, 0.5),
            "detail": f"Similar transitions on Line {candidate['line']} averaged {hist_oee*100:.0f}% OEE.",
        })

    overrun = sim.get("historical_avg_overrun")
    if overrun is not None:
        factors.append({
            "factor": "Changeover overrun",
            "impact": _impact_for(overrun, 5, 25, higher_is_better=False),
            "detail": f"Analogue changeover overruns average {overrun:.0f} min.",
        })

    maint = candidate.get("maintenance_risk")
    if maint:
        impact = "positive" if maint == "low" else ("neutral" if maint == "medium" else "negative")
        factors.append({
            "factor": "Maintenance interference",
            "impact": impact,
            "detail": f"Nearby maintenance risk is {maint}.",
        })

    stop = sim.get("historical_stop_risk")
    if stop is not None:
        factors.append({
            "factor": "Restart stop-time",
            "impact": _impact_for(stop, 30, 90, higher_is_better=False),
            "detail": f"Historical stop minutes around similar slots average {stop:.0f}.",
        })

    diag_level = diag.get("diagnostic_risk_level")
    if diag_level:
        impact = "positive" if diag_level == "low" else ("neutral" if diag_level == "medium" else "negative")
        factors.append({
            "factor": "Diagnostic risk pattern",
            "impact": impact,
            "detail": f"Transition type '{diag.get('transition_type')}' — {diag.get('risk_pattern')} (memory: {diag.get('cases', 0)} cases).",
        })

    if naive is not None:
        diff = candidate["predicted_oee"] - naive["predicted_oee"]
        factors.append({
            "factor": "vs. Naive plan",
            "impact": _impact_for(diff, 0.02, -0.02),
            "detail": f"Predicted OEE is {diff*100:+.0f} points compared with the naive insertion (Line {naive['line']}).",
        })

    return factors


def _changeover_breakdown(candidate: Dict[str, Any]) -> List[Dict[str, Any]]:
    sim = candidate.get("_sim", {}) or {}
    cur_env = candidate.get("_current_envase")
    prev_env = candidate.get("_previous_envase")
    breakdown: List[Dict[str, Any]] = []

    if cur_env and prev_env:
        same = cur_env == prev_env
        breakdown.append({
            "label": "Envase / format",
            "value": cur_env if same else f"{prev_env} → {cur_env}",
            "detail": "Same format — no major mechanical setup." if same else "Format change — mechanical setup is required.",
            "impact": "positive" if same else "negative",
        })
    breakdown.append({
        "label": "Transition type",
        "value": candidate.get("transition_type"),
        "detail": (candidate.get("_diagnostic", {}) or {}).get("risk_pattern") or "—",
        "impact": "negative" if (candidate.get("_diagnostic", {}) or {}).get("diagnostic_risk_level") == "high"
        else ("neutral" if (candidate.get("_diagnostic", {}) or {}).get("diagnostic_risk_level") == "medium" else "positive"),
    })
    cleaning = candidate.get("_cleaning_minutes")
    if cleaning is not None:
        breakdown.append({
            "label": "Cleaning / CIP",
            "value": f"{cleaning:.0f} min",
            "detail": "Median cleaning time observed on this line.",
            "impact": _impact_for(cleaning, 30, 90, higher_is_better=False),
        })
    if sim.get("historical_avg_actual_changeover") is not None:
        breakdown.append({
            "label": "Analogue changeover",
            "value": f"{sim['historical_avg_actual_changeover']:.0f} min",
            "detail": "Average actual changeover from similar historical cases.",
            "impact": _impact_for(sim['historical_avg_actual_changeover'], 30, 90, higher_is_better=False),
        })
    if sim.get("maintenance_nearby_rate") is not None:
        rate = sim["maintenance_nearby_rate"]
        breakdown.append({
            "label": "Maintenance proximity",
            "value": f"{rate*100:.0f}%",
            "detail": "Share of analogue transitions where maintenance was active.",
            "impact": _impact_for(rate, 0.15, 0.45, higher_is_better=False),
        })
    return breakdown


LIMITATIONS_DEFAULT: List[str] = [
    "Crew experience and shift staffing are not in the data.",
    "Downstream micro-stoppages may not be fully captured in PNP.",
    "Theoretical changeover times are imputed from historical medians when the CF matrix is not parseable.",
]


def _facts_payload(candidate: Dict[str, Any], naive: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    sim = candidate.get("_sim", {}) or {}
    diag = candidate.get("_diagnostic", {}) or {}
    return {
        "candidate": {
            "line": candidate["line"],
            "position": candidate["position_label"],
            "transition_type": candidate.get("transition_type"),
            "predicted_oee": round(candidate["predicted_oee"], 4),
            "expected_downtime_minutes": round(candidate["expected_downtime_minutes"], 1),
            "changeover_overrun_minutes": round(candidate["changeover_overrun_minutes"], 1),
            "maintenance_risk": candidate["maintenance_risk"],
            "evidence_strength": round(candidate["evidence_strength"], 3),
            "evidence_strength_label": candidate["evidence_strength_label"],
            "similar_cases_count": candidate.get("similar_cases_count", 0),
            "pain_score": round(candidate["pain_score"], 2),
            "top_factors": candidate.get("top_factors", []),
        },
        "naive": None if naive is None else {
            "line": naive["line"],
            "position": naive["position_label"],
            "predicted_oee": round(naive["predicted_oee"], 4),
            "expected_downtime_minutes": round(naive["expected_downtime_minutes"], 1),
            "pain_score": round(naive["pain_score"], 2),
            "transition_type": naive.get("transition_type"),
        },
        "comparison": {
            "oee_gain": round(candidate["predicted_oee"] - (naive["predicted_oee"] if naive else candidate["predicted_oee"]), 4),
            "downtime_avoided_minutes": round(((naive["expected_downtime_minutes"] if naive else 0) - candidate["expected_downtime_minutes"]), 1),
        },
        "diagnostic_memory": {
            "transition_type": diag.get("transition_type"),
            "risk_pattern": diag.get("risk_pattern"),
            "avg_oee": diag.get("avg_oee"),
            "avg_overrun": diag.get("avg_overrun"),
            "cases": diag.get("cases"),
            "risk_level": diag.get("diagnostic_risk_level"),
        },
        "analogue_summary": {
            "n_similar": sim.get("n_similar", 0),
            "avg_oee": sim.get("historical_avg_oee"),
            "avg_actual_changeover_minutes": sim.get("historical_avg_actual_changeover"),
            "avg_overrun_minutes": sim.get("historical_avg_overrun"),
            "maintenance_nearby_rate": sim.get("maintenance_nearby_rate"),
        },
        "limitations": LIMITATIONS_DEFAULT,
    }


def _deterministic_explanation(candidate: Dict[str, Any], naive: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    line = candidate["line"]
    pos = candidate["position_label"]
    oee = candidate["predicted_oee"] * 100
    conf = candidate["evidence_strength"] * 100
    transition = candidate.get("transition_type") or "transition"
    diag = candidate.get("_diagnostic", {}) or {}

    bullets: List[str] = []
    bullets.append(f"Predicted OEE is {oee:.0f}% on Line {line} {pos}.")
    if naive is not None:
        gain = (candidate["predicted_oee"] - naive["predicted_oee"]) * 100
        bullets.append(
            f"Predicted OEE is {gain:+.0f} points vs. the naive insertion on Line {naive['line']}."
        )
    overrun = (candidate.get("_sim") or {}).get("historical_avg_overrun")
    if overrun is not None:
        bullets.append(f"Average historical changeover overrun on analogues: {overrun:.0f} min.")
    if diag.get("risk_pattern"):
        bullets.append(
            f"Diagnostic memory: '{diag.get('transition_type')}' historically tagged '{diag.get('risk_pattern')}' ({diag.get('cases', 0)} cases)."
        )

    n_sim = candidate.get("similar_cases_count") or 0
    if n_sim >= 3:
        risk_note = f"Evidence strength: {conf:.0f}%, backed by {n_sim} similar cases."
    else:
        risk_note = f"Historical evidence is limited ({n_sim} similar cases). Evidence strength {conf:.0f}%."

    return {
        "headline": f"Line {line} {pos} protects OEE best on this {transition.lower()} transition",
        "planner_explanation": (
            f"LineWise recommends Line {line} {pos} because historical {transition.lower()} transitions on this slot "
            f"had higher OEE and lower changeover overrun than the naive option. Predicted OEE is {oee:.0f}% "
            f"with {conf:.0f}% evidence strength."
        ),
        "risk_note": risk_note,
        "bullets": bullets,
        "limitations": "Crew experience, shift staffing, and downstream micro-stoppages are not in the data.",
    }


def build_explanation(candidate: Dict[str, Any], naive: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    facts = _facts_payload(candidate, naive)
    llm = explain_with_openai(facts) or _deterministic_explanation(candidate, naive)

    factors = _factors(candidate, naive)
    breakdown = _changeover_breakdown(candidate)
    sim = candidate.get("_sim", {}) or {}
    similar = list(sim.get("similar", []))[:5]

    naive_oee = naive["predicted_oee"] if naive else None
    metrics = {
        "analogue_mean_oee": sim.get("historical_avg_oee"),
        "naive_slot_mean_oee": naive_oee,
        "predicted_gain": (candidate["predicted_oee"] - naive_oee) if naive_oee is not None else None,
    }

    return {
        "candidate_id": candidate["candidate_id"],
        "title": f"Recommended Line {candidate['line']} {candidate['position_label']}",
        "llm_explanation": llm.get("planner_explanation", "") or "",
        "headline": llm.get("headline"),
        "risk_note": llm.get("risk_note"),
        "bullets": llm.get("bullets", []) or [],
        "openai_json": {
            "headline": llm.get("headline"),
            "planner_explanation": llm.get("planner_explanation"),
            "risk_note": llm.get("risk_note"),
            "bullets": llm.get("bullets", []) or [],
            "limitations": llm.get("limitations"),
        },
        "factors": factors,
        "changeover_breakdown": breakdown,
        "similar_cases": similar,
        "metrics": metrics,
        "limitations": LIMITATIONS_DEFAULT,
    }
