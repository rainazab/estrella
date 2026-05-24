"""Validate the data.json payload before writing.

The frontend boots from /data.json without any backend dependency, so the
shape MUST be right. This module:

  1. Defines the required top-level keys.
  2. Defines the required per-recommendation fields.
  3. `validate(payload)` returns (ok, problems[]).
  4. `summarize(payload)` returns a human-readable stats string for the CLI.

Adding/removing a top-level key is a CONTRACT CHANGE — bump
`CONTRACT_VERSION` and notify the frontend team. See docs/DATA_CONTRACT.md.
"""
from __future__ import annotations

from typing import Any, Dict, List, Tuple

CONTRACT_VERSION = "2.2"

REQUIRED_TOP_LEVEL: List[str] = [
    "urgentOrders",
    "lineBaseline",
    "lineCentre",
    "timeline",
    "lineRules",
    "weeklyStops",
    "yearCompare",
    "executedHistory",
    "basePlan",
    "recommendations",
    "objectives",
    "manualSlots",
]

REQUIRED_RECOMMENDATION_FIELDS: List[str] = [
    "line", "position", "oeeDelta", "oeeGood",
    "deadline", "ordersMoved", "naiveBand",
    "plan", "ghosts", "recovery", "moves", "evidence",
]

REQUIRED_EVIDENCE_FIELDS: List[str] = [
    "reason", "breakdown", "analogues", "n", "analogueMean", "naiveMean", "gain",
]


def validate(payload: Dict[str, Any]) -> Tuple[bool, List[str]]:
    problems: List[str] = []

    for key in REQUIRED_TOP_LEVEL:
        if key not in payload:
            problems.append(f"missing top-level key: {key!r}")

    recs = payload.get("recommendations") or {}
    if not isinstance(recs, dict):
        problems.append("recommendations must be a dict keyed by line")
    else:
        for line_key, rec in recs.items():
            if not isinstance(rec, dict):
                problems.append(f"recommendations[{line_key}] is not a dict")
                continue
            for fld in REQUIRED_RECOMMENDATION_FIELDS:
                if fld not in rec:
                    problems.append(f"recommendations[{line_key}] missing field {fld!r}")
            ev = rec.get("evidence") or {}
            if not isinstance(ev, dict):
                problems.append(f"recommendations[{line_key}].evidence is not a dict")
                continue
            for fld in REQUIRED_EVIDENCE_FIELDS:
                if fld not in ev:
                    problems.append(f"recommendations[{line_key}].evidence missing field {fld!r}")
            # All analogues must be real OFs with real OEE
            analogues = ev.get("analogues") or []
            for i, a in enumerate(analogues):
                if not isinstance(a, dict):
                    problems.append(f"recommendations[{line_key}].evidence.analogues[{i}] not a dict")
                    continue
                for need in ("of", "line", "oee"):
                    if a.get(need) in (None, ""):
                        problems.append(
                            f"recommendations[{line_key}].evidence.analogues[{i}] missing {need!r}"
                        )

    # urgentOrders sanity
    urgents = payload.get("urgentOrders") or []
    if not isinstance(urgents, list):
        problems.append("urgentOrders must be a list")
    else:
        for i, u in enumerate(urgents):
            for need in ("of", "status", "sku", "productSku", "volume_hl"):
                if u.get(need) in (None, ""):
                    problems.append(f"urgentOrders[{i}] missing {need!r}")

    # executedHistory / basePlan must have lines as keys
    for key in ("executedHistory", "basePlan"):
        block = payload.get(key) or {}
        if not isinstance(block, dict):
            problems.append(f"{key} must be a dict")
            continue
        for line_key, segs in block.items():
            if not isinstance(segs, list):
                problems.append(f"{key}[{line_key}] not a list")

    timeline = payload.get("timeline") or {}
    if not isinstance(timeline, dict):
        problems.append("timeline must be a dict")
    else:
        if not timeline.get("anchorDate"):
            problems.append("timeline.anchorDate is required")
        if timeline.get("timeUnit") not in ("hours", "days"):
            problems.append("timeline.timeUnit must be 'hours' or 'days'")
        views = timeline.get("views") or {}
        if not isinstance(views, dict):
            problems.append("timeline.views must be a dict")
        else:
            for view in ("week", "month", "quarter"):
                cfg = views.get(view) or {}
                if not isinstance(cfg, dict):
                    problems.append(f"timeline.views.{view} must be a dict")
                    continue
                if "daysBack" not in cfg or "daysAhead" not in cfg:
                    problems.append(f"timeline.views.{view} must include daysBack and daysAhead")

    line_rules = payload.get("lineRules") or {}
    if not isinstance(line_rules, dict):
        problems.append("lineRules must be a dict keyed by line")
    else:
        for line in ("14", "17", "19"):
            rule = line_rules.get(line)
            if not isinstance(rule, dict):
                problems.append(f"lineRules[{line}] must be a dict")
                continue
            formats = rule.get("formats")
            if not isinstance(formats, list) or not formats:
                problems.append(f"lineRules[{line}].formats must be a non-empty list")

    weekly_stops = payload.get("weeklyStops") or {}
    if not isinstance(weekly_stops, dict):
        problems.append("weeklyStops must be a dict keyed by line")
    else:
        for line in ("14", "17", "19"):
            stops = weekly_stops.get(line)
            if not isinstance(stops, list):
                problems.append(f"weeklyStops[{line}] must be a list")
                continue
            for i, stop in enumerate(stops):
                if not isinstance(stop, dict):
                    problems.append(f"weeklyStops[{line}][{i}] must be a dict")
                    continue
                if stop.get("kind") not in ("clean", "maint"):
                    problems.append(f"weeklyStops[{line}][{i}].kind must be 'clean' or 'maint'")
                if "start" not in stop or "w" not in stop:
                    problems.append(f"weeklyStops[{line}][{i}] must include start and w")

    return (not problems), problems


def summarize(payload: Dict[str, Any]) -> str:
    """One-shot stats line for the CLI."""
    meta = payload.get("metadata") or {}
    recs = payload.get("recommendations") or {}
    urgents = payload.get("urgentOrders") or []
    parts = [
        f"urgentOrders={len(urgents)}",
        f"recommendations={len(recs)}",
    ]
    if recs:
        # Tally analogues
        per_rec = ", ".join(
            f"L{k}:n={(r.get('evidence') or {}).get('n', '?')}"
            for k, r in recs.items()
        )
        parts.append(f"analogues=[{per_rec}]")
    if "production_runs" in meta:
        parts.append(f"prod={meta['production_runs']}")
    if "clean_blocks" in meta:
        parts.append(f"clean={meta['clean_blocks']}")
    if "maint_blocks" in meta:
        parts.append(f"maint={meta['maint_blocks']}")
    if "oee_capped" in meta:
        parts.append(f"oee_capped={meta['oee_capped']}")
    if "transitions" in meta:
        parts.append(f"tx={meta['transitions']}")
    return " · ".join(parts)
