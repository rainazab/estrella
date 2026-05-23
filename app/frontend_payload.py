"""Transform the canonical data.json into the frontend HTTP contract shape.

The canonical export (`data/output/data.json`) is rich — it carries debug
metadata, the detailed per-line baseline object, and additive scoring
fields. The frontend wants a slimmer, strictly-typed shape served from
`GET /plan`. This module is the seam between them.

The transformation is intentionally one-way and stateless: pass it the
canonical payload, get back the frontend payload. No I/O.
"""
from __future__ import annotations

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

_BAND_PROD_FIELDS = ("of", "sku", "vol", "start", "w", "oee")
_BAND_NONPROD_FIELDS = ("kind", "start", "w")

_RECBAND_FIELDS = ("of", "sku", "vol", "start", "w", "oee", "kind")


def _pick(obj: Dict[str, Any], fields) -> Dict[str, Any]:
    return {k: obj[k] for k in fields if k in obj}


def _clean_band(seg: Dict[str, Any]) -> Dict[str, Any]:
    kind = seg.get("kind")
    if kind in ("clean", "maint"):
        return _pick(seg, _BAND_NONPROD_FIELDS)
    out = _pick(seg, _BAND_PROD_FIELDS)
    # If oee was synthesised in basePlan (e.g. Planificado), keep a sensible
    # baseline so the frontend's [0,1] check passes.
    if "oee" in out and out["oee"] is None:
        out["oee"] = 0.55
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


def build_frontend_payload(canonical: Dict[str, Any]) -> Dict[str, Any]:
    """Convert the canonical data.json shape into the frontend HTTP contract.

    The canonical payload is preserved on disk; this is the per-request
    serialisation. Missing keys default to empty rather than raise so the
    server can return *something* even mid-export.
    """
    if not isinstance(canonical, dict):
        return {
            "urgentOrders": [],
            "lineBaseline": {},
            "yearCompare": {"weekLabel": "—", "lines": {}},
            "executedHistory": {},
            "basePlan": {},
            "lineCentre": {},
            "recommendations": {},
            "objectives": {},
            "manualSlots": {},
        }

    recs_in = canonical.get("recommendations") or {}
    recs_out: Dict[str, Any] = {}
    if isinstance(recs_in, dict):
        for line, rec in recs_in.items():
            if isinstance(rec, dict):
                recs_out[str(line)] = _clean_recommendation(rec)

    return {
        "urgentOrders": _trim_orders(canonical.get("urgentOrders")),
        "lineBaseline": _flatten_line_baseline(canonical.get("lineBaseline")),
        "yearCompare": canonical.get("yearCompare") or {"weekLabel": "—", "lines": {}},
        "executedHistory": _line_segments(canonical.get("executedHistory") or {}),
        "basePlan": _line_segments(canonical.get("basePlan") or {}),
        "lineCentre": dict(canonical.get("lineCentre") or {}),
        "recommendations": recs_out,
        "objectives": _clean_objectives(canonical.get("objectives")),
        "manualSlots": _clean_manual_slots(canonical.get("manualSlots")),
    }
