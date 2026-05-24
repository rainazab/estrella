"""Transform the canonical data.json into the frontend HTTP contract shape.

The canonical export (`data/output/data.json`) is rich — it carries debug
metadata, the detailed per-line baseline object, and additive scoring
fields. The frontend wants a slimmer, strictly-typed shape served from
`GET /plan`. This module is the seam between them.

`build_frontend_payload(canonical)` is the in-process API used by the
FastAPI server. The CLI at the bottom of this file writes the same
payload out to disk for the Vite dev fake-API.
"""
from __future__ import annotations

import json
from typing import Any, Dict, List, Optional


# Strict allowlist for frontend Order — anything else is dropped.
_ORDER_FIELDS = ("of", "status", "sku", "units", "hl", "due")

# Recommendation contract fields (everything else is additive and dropped).
_REC_FIELDS = (
    "line", "position", "oeeDelta", "oeeGood", "deadline", "ordersMoved",
    "naiveBand", "plan", "ghosts", "recovery", "moves", "evidence",
)

# Evidence contract fields.
_EVIDENCE_FIELDS = (
    "reason", "breakdown", "analogues", "n", "analogueMean", "naiveMean", "gain",
)

_OBJECTIVE_FIELDS = ("label", "icon", "order", "notes")

_BAND_PROD_FIELDS = ("of", "sku", "vol", "start", "w", "oee", "due", "inferredWidth")
_BAND_NONPROD_FIELDS = ("kind", "start", "w", "locked", "lockReason", "cadence", "shiftPattern", "day")

_RECBAND_FIELDS = ("of", "sku", "vol", "start", "w", "oee", "kind", "due")

_DEFAULT_TIMELINE = {
    "anchorDate": "1970-01-01",
    "anchorLabel": "Today",
    "timeUnit": "hours",
    "views": {
        "week": {"daysBack": 7, "daysAhead": 14},
        "month": {"daysBack": 14, "daysAhead": 35},
        "quarter": {"daysBack": 30, "daysAhead": 90},
    },
}
_DEFAULT_LINE_RULES = {
    "14": {
        "line": "14",
        "formats": [
            {"key": "1/2", "label": "50cl", "name": "medio"},
            {"key": "1/3", "label": "33cl", "name": "tercio"},
        ],
        "summary": "L14 only runs 50cl, 33cl",
        "locked": True,
        "source": "fallback",
    },
    "17": {
        "line": "17",
        "formats": [{"key": "1/3", "label": "33cl", "name": "tercio"}],
        "summary": "L17 only runs 33cl",
        "locked": True,
        "source": "fallback",
    },
    "19": {
        "line": "19",
        "formats": [
            {"key": "1/2", "label": "50cl", "name": "medio"},
            {"key": "1/3", "label": "33cl", "name": "tercio"},
            {"key": "2/5", "label": "44cl", "name": "2/5"},
        ],
        "summary": "L19 only runs 50cl, 33cl, 44cl",
        "locked": True,
        "source": "fallback",
    },
}


def _pick(obj: Dict[str, Any], fields) -> Dict[str, Any]:
    return {k: obj[k] for k in fields if k in obj}


def _clean_band(seg: Dict[str, Any]) -> Dict[str, Any]:
    kind = seg.get("kind")
    if kind in ("clean", "maint"):
        out = _pick(seg, _BAND_NONPROD_FIELDS)
        # Default locked → False (the contract's "internal, soft-locked" state).
        # Only emit lockReason if non-empty so absent stays absent.
        if "locked" in out and out["locked"] is not None:
            out["locked"] = bool(out["locked"])
        if out.get("lockReason") in (None, ""):
            out.pop("lockReason", None)
        return out
    out = _pick(seg, _BAND_PROD_FIELDS)
    # If oee was synthesised in basePlan (e.g. Planificado), keep a sensible
    # baseline so the frontend's [0,1] check passes.
    if "oee" in out and out["oee"] is None:
        out["oee"] = 0.55
    # Only emit due if it parses as a non-empty string (ISO8601 expected).
    if out.get("due") in (None, ""):
        out.pop("due", None)
    # Only emit inferredWidth when true — false is the common case.
    if not out.get("inferredWidth"):
        out.pop("inferredWidth", None)
    return out


def _clean_recband(seg: Dict[str, Any]) -> Dict[str, Any]:
    out = _pick(seg, _RECBAND_FIELDS)
    kind = out.get("kind")
    if kind not in ("ins", "shift"):
        out.pop("kind", None)
    if "oee" in out and out["oee"] is None:
        out["oee"] = 0.55
    return out


def _line_segments(by_line: Dict[str, Any]) -> Dict[str, List[Dict[str, Any]]]:
    out: Dict[str, List[Dict[str, Any]]] = {}
    for line, segs in (by_line or {}).items():
        if not isinstance(segs, list):
            continue
        out[str(line)] = [_clean_band(s) for s in segs if isinstance(s, dict)]
    return out


def _flatten_line_baseline(line_baseline: Any) -> Dict[str, float]:
    out: Dict[str, float] = {}
    if not isinstance(line_baseline, dict):
        return out
    for line, val in line_baseline.items():
        if isinstance(val, dict):
            oee = val.get("avg_oee")
            if oee is not None:
                out[str(line)] = float(oee)
        elif isinstance(val, (int, float)):
            out[str(line)] = float(val)
    return out


def _trim_orders(orders: Any) -> List[Dict[str, Any]]:
    if not isinstance(orders, list):
        return []
    return [_pick(o, _ORDER_FIELDS) for o in orders if isinstance(o, dict)]


def _clean_recommendation(rec: Dict[str, Any]) -> Dict[str, Any]:
    out = _pick(rec, _REC_FIELDS)
    plan = rec.get("plan") or {}
    if isinstance(plan, dict):
        out["plan"] = {
            str(line): [_clean_recband(s) for s in segs if isinstance(s, dict)]
            for line, segs in plan.items()
            if isinstance(segs, list)
        }
    ghosts = rec.get("ghosts") or {}
    if isinstance(ghosts, dict):
        out["ghosts"] = {
            str(line): [
                {k: g[k] for k in ("of", "start", "w") if k in g}
                for g in segs if isinstance(g, dict)
            ]
            for line, segs in ghosts.items()
            if isinstance(segs, list)
        }
    evidence = rec.get("evidence") or {}
    if isinstance(evidence, dict):
        # analogues use the rich shape — trim each to the contract fields.
        analogues = evidence.get("analogues") or []
        clean_analogues = []
        for a in analogues:
            if not isinstance(a, dict):
                continue
            clean_analogues.append({
                "of": a.get("of"),
                "date": a.get("date"),
                "line": str(a.get("line") or ""),
                "type": a.get("type") or "—",
                "oee": (
                    f"{float(a['oee']):.2f}" if isinstance(a.get("oee"), (int, float))
                    else (a.get("oee") if a.get("oee") is not None else "—")
                ),
            })
        ev = _pick(evidence, _EVIDENCE_FIELDS)
        ev["analogues"] = clean_analogues
        ev["n"] = int(ev.get("n") or 0)
        out["evidence"] = ev
    return out


def _clean_objectives(objectives: Any) -> Dict[str, Any]:
    if not isinstance(objectives, dict):
        return {}
    out: Dict[str, Any] = {}
    for key, obj in objectives.items():
        if not isinstance(obj, dict):
            continue
        out[key] = _pick(obj, _OBJECTIVE_FIELDS)
    return out


def _clean_manual_slots(slots: Any) -> Dict[str, Dict[str, Any]]:
    if not isinstance(slots, dict):
        return {}
    out: Dict[str, Dict[str, Any]] = {}
    for key, slot in slots.items():
        if not isinstance(slot, dict):
            continue
        out[str(key)] = {
            "recKey": str(slot.get("recKey") or ""),
            "verdict": slot.get("verdict") or "ok",
            "label": slot.get("label") or "",
            "banner": slot.get("banner") or "",
        }
    return out


def _num_or_default(value: Any, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _clean_timeline(timeline: Any) -> Dict[str, Any]:
    if not isinstance(timeline, dict):
        return {
            "anchorDate": _DEFAULT_TIMELINE["anchorDate"],
            "anchorLabel": _DEFAULT_TIMELINE["anchorLabel"],
            "timeUnit": _DEFAULT_TIMELINE["timeUnit"],
            "views": dict(_DEFAULT_TIMELINE["views"]),
        }

    defaults = _DEFAULT_TIMELINE["views"]
    views_in = timeline.get("views") if isinstance(timeline.get("views"), dict) else {}
    views: Dict[str, Dict[str, float]] = {}
    for key, fallback in defaults.items():
        cfg = views_in.get(key) if isinstance(views_in.get(key), dict) else {}
        views[key] = {
            "daysBack": _num_or_default(cfg.get("daysBack"), fallback["daysBack"]),
            "daysAhead": _num_or_default(cfg.get("daysAhead"), fallback["daysAhead"]),
        }

    time_unit = timeline.get("timeUnit")
    if time_unit not in ("hours", "days"):
        time_unit = _DEFAULT_TIMELINE["timeUnit"]

    return {
        "anchorDate": str(timeline.get("anchorDate") or _DEFAULT_TIMELINE["anchorDate"]),
        "anchorLabel": str(timeline.get("anchorLabel") or _DEFAULT_TIMELINE["anchorLabel"]),
        "timeUnit": time_unit,
        "views": views,
    }


def _clean_line_rules(value: Any) -> Dict[str, Any]:
    if not isinstance(value, dict):
        return dict(_DEFAULT_LINE_RULES)
    out: Dict[str, Any] = {}
    for line in ("14", "17", "19"):
        rule = value.get(line) if isinstance(value.get(line), dict) else _DEFAULT_LINE_RULES[line]
        formats = []
        for fmt in rule.get("formats") or []:
            if not isinstance(fmt, dict):
                continue
            formats.append({
                "key": str(fmt.get("key") or ""),
                "label": str(fmt.get("label") or fmt.get("key") or ""),
                "name": str(fmt.get("name") or fmt.get("label") or ""),
            })
        if not formats:
            formats = list(_DEFAULT_LINE_RULES[line]["formats"])
        out[line] = {
            "line": str(rule.get("line") or line),
            "formats": formats,
            "summary": str(rule.get("summary") or _DEFAULT_LINE_RULES[line]["summary"]),
            "locked": bool(rule.get("locked", True)),
            "source": str(rule.get("source") or ""),
        }
    return out


def _derive_line_formats(line_rules: Dict[str, Any]) -> Dict[str, List[str]]:
    """Project lineRules.formats → {lineKey: [label, ...]} for the move flow.

    Replaces the LINE_FORMATS hardcode in linewise/src/lib/movePlan.js. Format
    labels stay strings to match what `deriveFormat()` emits on the client.
    """
    out: Dict[str, List[str]] = {}
    for line, rule in (line_rules or {}).items():
        labels: List[str] = []
        for fmt in (rule.get("formats") or []):
            label = fmt.get("label") if isinstance(fmt, dict) else None
            if label:
                labels.append(str(label))
        out[str(line)] = labels
    return out


ISSUE_CATEGORIES = ("mech", "elec", "quality", "material")
ISSUE_SEVERITIES = ("warn", "critical")
STOPPAGE_REASONS = ("breakdown", "no-material", "no-operator", "quality-hold", "other")
STOPPAGE_DURATIONS = ("15m", "30m", "1h", "2h+", "unknown")
STOPPAGE_AGOS = (0, 5, 10, 15)
KNOWN_LINES = ("14", "17", "19")

# Back-compat aliases for the in-module helpers below.
_ISSUE_CATEGORIES = ISSUE_CATEGORIES
_ISSUE_SEVERITIES = ISSUE_SEVERITIES
_STOPPAGE_REASONS = STOPPAGE_REASONS
_STOPPAGE_DURATIONS = STOPPAGE_DURATIONS
_STOPPAGE_AGOS = STOPPAGE_AGOS


def _clean_issue(value: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(value, dict):
        return None
    line = str(value.get("line") or "")
    category = value.get("category")
    severity = value.get("severity")
    if category not in _ISSUE_CATEGORIES or severity not in _ISSUE_SEVERITIES:
        return None
    return {
        "id": str(value.get("id") or ""),
        "line": line,
        "category": category,
        "severity": severity,
        "note": str(value.get("note") or ""),
        "ts": int(value.get("ts") or 0),
    }


def _clean_stoppage(value: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(value, dict):
        return None
    reason = value.get("reason")
    duration = value.get("duration")
    start_ago = value.get("startAgoMin")
    if reason not in _STOPPAGE_REASONS or duration not in _STOPPAGE_DURATIONS:
        return None
    if start_ago not in _STOPPAGE_AGOS:
        start_ago = 0
    return {
        "id": str(value.get("id") or ""),
        "line": str(value.get("line") or ""),
        "reason": reason,
        "startedAt": int(value.get("startedAt") or 0),
        "startAgoMin": int(start_ago),
        "duration": duration,
        "ts": int(value.get("ts") or 0),
    }


def _clean_issues(value: Any) -> List[Dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [iss for iss in (_clean_issue(v) for v in value) if iss is not None]


def _clean_stoppages(value: Any) -> List[Dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [s for s in (_clean_stoppage(v) for v in value) if s is not None]


def _clean_weekly_stops(value: Any) -> Dict[str, List[Dict[str, Any]]]:
    out: Dict[str, List[Dict[str, Any]]] = {"14": [], "17": [], "19": []}
    if not isinstance(value, dict):
        return out
    for line in out:
        stops = value.get(line)
        if not isinstance(stops, list):
            continue
        for stop in stops:
            if not isinstance(stop, dict) or stop.get("kind") not in ("clean", "maint"):
                continue
            out[line].append({
                "id": str(stop.get("id") or f"L{line}-{stop.get('kind')}-{len(out[line])}"),
                "line": str(stop.get("line") or line),
                "kind": stop["kind"],
                "label": str(stop.get("label") or ("Cleaning" if stop["kind"] == "clean" else "Maintenance")),
                "start": _num_or_default(stop.get("start"), 0.0),
                "w": _num_or_default(stop.get("w"), _num_or_default(stop.get("durationHours"), 8.0)),
                "durationHours": _num_or_default(stop.get("durationHours"), _num_or_default(stop.get("w"), 8.0)),
                "day": str(stop.get("day") or ""),
                "cadence": str(stop.get("cadence") or ""),
                "shiftPattern": str(stop.get("shiftPattern") or ""),
                "locked": bool(stop.get("locked", True)),
                "source": str(stop.get("source") or ""),
            })
    return out


def build_frontend_payload(canonical: Dict[str, Any]) -> Dict[str, Any]:
    """Convert the canonical data.json shape into the frontend HTTP contract.

    The canonical payload is preserved on disk; this is the per-request
    serialisation. Missing keys default to empty rather than raise so the
    server can return *something* even mid-export.
    """
    if not isinstance(canonical, dict):
        default_rules = _clean_line_rules(None)
        return {
            "urgentOrders": [],
            "lineBaseline": {},
            "timeline": _clean_timeline(None),
            "lineRules": default_rules,
            "weeklyStops": _clean_weekly_stops(None),
            "yearCompare": {"weekLabel": "—", "lines": {}},
            "executedHistory": {},
            "basePlan": {},
            "lineCentre": {},
            "recommendations": {},
            "objectives": {},
            "manualSlots": {},
            "lineFormats": _derive_line_formats(default_rules),
            "issues": [],
            "stoppages": [],
        }

    recs_in = canonical.get("recommendations") or {}
    recs_out: Dict[str, Any] = {}
    if isinstance(recs_in, dict):
        for line, rec in recs_in.items():
            if isinstance(rec, dict):
                recs_out[str(line)] = _clean_recommendation(rec)

    line_rules = _clean_line_rules(canonical.get("lineRules"))
    canonical_line_formats = canonical.get("lineFormats")
    if isinstance(canonical_line_formats, dict) and canonical_line_formats:
        line_formats = {
            str(line): [str(label) for label in (labels or []) if label]
            for line, labels in canonical_line_formats.items()
        }
    else:
        line_formats = _derive_line_formats(line_rules)

    return {
        "urgentOrders": _trim_orders(canonical.get("urgentOrders")),
        "lineBaseline": _flatten_line_baseline(canonical.get("lineBaseline")),
        "timeline": _clean_timeline(canonical.get("timeline")),
        "lineRules": line_rules,
        "weeklyStops": _clean_weekly_stops(canonical.get("weeklyStops")),
        "yearCompare": canonical.get("yearCompare") or {"weekLabel": "—", "lines": {}},
        "executedHistory": _line_segments(canonical.get("executedHistory") or {}),
        "basePlan": _line_segments(canonical.get("basePlan") or {}),
        "lineCentre": dict(canonical.get("lineCentre") or {}),
        "recommendations": recs_out,
        "objectives": _clean_objectives(canonical.get("objectives")),
        "manualSlots": _clean_manual_slots(canonical.get("manualSlots")),
        "lineFormats": line_formats,
        "issues": _clean_issues(canonical.get("issues")),
        "stoppages": _clean_stoppages(canonical.get("stoppages")),
    }


# ============================================================ CLI


def main(argv: Optional[list] = None) -> int:
    """Transform a canonical data.json file into the frontend plan.json shape.

    Examples:
        # repo root → linewise dev seed
        python -m app.frontend_payload \\
            --in data/output/data.json --out linewise/data/plan.json

        # read stdin → stdout
        cat data.json | python -m app.frontend_payload --out -
    """
    import argparse
    import sys
    from pathlib import Path

    from . import config  # noqa: WPS433 — kept inside main() to avoid heavy import on direct use

    parser = argparse.ArgumentParser(
        description="Transform canonical data.json into the frontend plan.json shape.",
    )
    parser.add_argument(
        "--in",
        dest="src",
        default=str(config.OUTPUT_DIR / "data.json"),
        help="Canonical data.json path. Default: data/output/data.json. Use '-' for stdin.",
    )
    parser.add_argument(
        "--out",
        dest="dst",
        default=str(config.BASE_DIR / "linewise" / "data" / "plan.json"),
        help="Frontend plan.json output path. Default: linewise/data/plan.json. Use '-' for stdout.",
    )
    args = parser.parse_args(argv)

    def reject_constant(value: str):
        raise ValueError(f"non-standard JSON constant {value}")

    if args.src == "-":
        canonical = json.loads(sys.stdin.read(), parse_constant=reject_constant)
    else:
        src_path = Path(args.src).expanduser().resolve()
        if not src_path.exists():
            print(
                f"✗ source data.json not found: {src_path}\n"
                "  Run `python -m app.export_data_json` first.",
                file=sys.stderr,
            )
            return 1
        canonical = json.loads(src_path.read_text(encoding="utf-8"), parse_constant=reject_constant)

    payload = build_frontend_payload(canonical)
    body = json.dumps(payload, indent=2, ensure_ascii=False, allow_nan=False)

    if args.dst == "-":
        sys.stdout.write(body + "\n")
    else:
        dst_path = Path(args.dst).expanduser().resolve()
        dst_path.parent.mkdir(parents=True, exist_ok=True)
        dst_path.write_text(body + "\n", encoding="utf-8")
        size_kb = dst_path.stat().st_size / 1024
        print(f"✔ wrote {dst_path}  ({size_kb:.1f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
