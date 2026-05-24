"""Global re-sequencer for the forward plan.

The existing recommender picks an insertion slot for ONE urgent order at a
time, evaluated against historical analogues. This module steps up: it
takes the *entire forward plan* (per line) and re-orders production runs
to minimise total changeover cost, using the same transition-type buckets
the recommender already builds in
`app.export_data_json.transition_type_stats`.

What it does
------------
For each line independently:
  1. Separate fixed service blocks (clean / maint at locked cadence times)
     from movable production runs.
  2. Use nearest-neighbour greedy + 2-opt refinement to order the
     production runs minimising Σ transition-cost between consecutive
     pairs. The "anchor" of the search is the last executed OF on the
     line, so the first forward run is chosen against the lane's
     real previous state.
  3. Re-pack the start times: production runs flow consecutively, service
     blocks slot back in at their original `start` (their cadence is
     locked by Tabla CF and shouldn't slide).

What it explicitly does NOT do (limits & follow-ups)
----------------------------------------------------
* No cross-line moves. An OF stays on its current line; we only reorder
  within. Cross-line balancing is the natural next step once we trust the
  per-line gain.
* No due-date hard constraints. The exporter's bands don't carry
  `committedDelivery` today. If `due` lands on a band later, weight it
  into the cost as a soft penalty.
* Service-block positions are pinned. Tabla CF cadences are locked by
  the contract.

Transition cost
---------------
We can't read the Cambios flags for a *hypothetical* (a, b) pair —
those flags come from observed history. Instead we derive the
transition type from the two segments' observable attributes (`of`,
`sku`, `format_key`) and look up the matching bucket from
`transition_type_stats`. Cost = `1 - mean_oee_of_bucket`. Lower is
better.
"""
from __future__ import annotations

import copy
import re
from typing import Any, Dict, List, Optional, Sequence, Tuple


# ---- transition-type derivation -------------------------------------------

# Same priority order as changeover_typing._FLAG_TO_TAG so the emitted
# transition_type strings match the buckets the recommender already has.
_TAG_ORDER = {
    "brand": 0,
    "product": 1,
    "volume": 2,
    "cap": 3,
    "primary_pack": 4,
    "secondary_pack": 5,
    "palet": 6,
}

_PRIMARY_PACK_TOKENS = [
    ("lata", "can"),
    ("botella", "bottle"),
    ("botellin", "bottle"),
    ("pet", "pet"),
    ("barril", "keg"),
    ("keg", "keg"),
]

_SECONDARY_PACK_TOKENS = [
    ("pack", "pack"),
    ("caja", "box"),
    ("cart", "carton"),
    ("plast", "shrink"),
]


def _normalised(text: Optional[str]) -> str:
    return (text or "").lower()


def _primary_pack(sku: Optional[str]) -> Optional[str]:
    s = _normalised(sku)
    for token, label in _PRIMARY_PACK_TOKENS:
        if token in s:
            return label
    return None


def _secondary_pack(sku: Optional[str]) -> Optional[str]:
    s = _normalised(sku)
    for token, label in _SECONDARY_PACK_TOKENS:
        if token in s:
            return label
    return None


def _brand_prefix(of: Optional[str]) -> Optional[str]:
    """Damm's OF codes start with a 2-letter brand prefix (ED=Estrella
    Damm, XI=Xibeca, FD/FDT=Free Damm, VO=Voll, EX=Express, …). Same
    prefix → same brand."""
    if not of:
        return None
    m = re.match(r"[A-Za-z]+", of.strip())
    if not m:
        return None
    pref = m.group(0).upper()
    # Treat FD and FDT as the same brand (both Free Damm variants in the
    # source data).
    if pref.startswith("FD"):
        return "FD"
    return pref[:2]


def derive_transition_type(prev: Dict[str, Any], nxt: Dict[str, Any]) -> str:
    """Compare two production segments and return the transition_type
    string the recommender's stats are keyed by.

    Matches `app.changeover_typing.type_of_row` semantics: a sorted '+'-
    joined list of component tags, "same-sku" when nothing differs,
    "multi" when four or more attributes change.
    """
    if not prev or not nxt:
        return "same-sku"
    a_of = (prev.get("of") or "").upper()
    b_of = (nxt.get("of") or "").upper()
    if a_of and a_of == b_of:
        return "same-sku"

    tags: List[str] = []
    if _brand_prefix(a_of) != _brand_prefix(b_of):
        tags.append("brand")
    a_fmt = prev.get("format_key")
    b_fmt = nxt.get("format_key")
    if a_fmt and b_fmt and a_fmt != b_fmt:
        tags.append("volume")
    a_pp = _primary_pack(prev.get("sku"))
    b_pp = _primary_pack(nxt.get("sku"))
    if a_pp and b_pp and a_pp != b_pp:
        tags.append("primary_pack")
    a_sp = _secondary_pack(prev.get("sku"))
    b_sp = _secondary_pack(nxt.get("sku"))
    if a_sp and b_sp and a_sp != b_sp:
        tags.append("secondary_pack")

    if not tags:
        # Different OF codes but no observable attribute change — likely a
        # SKU variant of the same product. Treat as "product" change so
        # it doesn't get the same-sku discount.
        if a_of != b_of:
            tags.append("product")

    if not tags:
        return "same-sku"
    if len(tags) >= 4:
        return "multi"
    tags.sort(key=_TAG_ORDER.get)
    return "+".join(tags)


def transition_cost(
    prev: Optional[Dict[str, Any]],
    nxt: Dict[str, Any],
    stats: Dict[str, Any],
    *,
    default_oee: float = 0.5,
) -> float:
    """Cost of running `nxt` immediately after `prev` on a line.

    Cost ≡ 1 - mean_oee of the matching transition bucket. Higher means
    worse changeover (more OEE expected to be lost during the
    transition). `prev` of None means "starting from cold" → treat as
    multi to avoid a free first run.
    """
    if prev is None:
        ttype = "multi"
    else:
        ttype = derive_transition_type(prev, nxt)
    bucket = stats.get(ttype) if isinstance(stats, dict) else None
    if not isinstance(bucket, dict):
        # Fall back to coarse bucket, then default.
        bucket = (stats or {}).get("multi") if isinstance(stats, dict) else None
    if isinstance(bucket, dict) and bucket.get("mean_oee") is not None:
        try:
            mean = float(bucket["mean_oee"])
        except (TypeError, ValueError):
            mean = default_oee
    else:
        mean = default_oee
    # Clamp to [0, 1] so cost is bounded.
    mean = max(0.0, min(1.0, mean))
    return 1.0 - mean


# ---- per-lane reorder -----------------------------------------------------


def _last_executed_seg(executed: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """The right-most non-service segment in the lane's history. None if
    there isn't one (lane is brand-new)."""
    for seg in reversed(executed or []):
        if seg.get("kind") in (None, "ins", "shift"):
            return seg
    return None


def _nearest_neighbour_order(
    items: List[Dict[str, Any]],
    anchor: Optional[Dict[str, Any]],
    stats: Dict[str, Any],
) -> List[Dict[str, Any]]:
    remaining = list(items)
    ordered: List[Dict[str, Any]] = []
    current = anchor
    while remaining:
        # Pick the segment that gives the lowest transition cost from
        # `current`. Ties broken by original index (stable).
        best_idx = 0
        best_cost = transition_cost(current, remaining[0], stats)
        for i in range(1, len(remaining)):
            c = transition_cost(current, remaining[i], stats)
            if c < best_cost:
                best_cost = c
                best_idx = i
        chosen = remaining.pop(best_idx)
        ordered.append(chosen)
        current = chosen
    return ordered


def _sequence_cost(
    seq: Sequence[Dict[str, Any]],
    anchor: Optional[Dict[str, Any]],
    stats: Dict[str, Any],
) -> float:
    total = 0.0
    prev = anchor
    for seg in seq:
        total += transition_cost(prev, seg, stats)
        prev = seg
    return total


def _two_opt(
    seq: List[Dict[str, Any]],
    anchor: Optional[Dict[str, Any]],
    stats: Dict[str, Any],
    *,
    max_passes: int = 12,
) -> List[Dict[str, Any]]:
    """2-opt refinement: repeatedly reverse the [i, j] slice if it lowers
    total cost. Bounded by `max_passes` so a pathological input can't
    spin forever; in practice the seed runs converge in <5 passes for
    lanes of ~30 OFs."""
    if len(seq) < 3:
        return list(seq)
    best = list(seq)
    best_cost = _sequence_cost(best, anchor, stats)
    for _ in range(max_passes):
        improved = False
        for i in range(len(best) - 1):
            for j in range(i + 1, len(best)):
                candidate = best[:i] + list(reversed(best[i:j + 1])) + best[j + 1:]
                c = _sequence_cost(candidate, anchor, stats)
                if c + 1e-9 < best_cost:
                    best = candidate
                    best_cost = c
                    improved = True
        if not improved:
            break
    return best


def _split_segments(lane: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Partition a lane into (production, service). Production keeps
    insertion order; service keeps its original `start` for re-anchoring."""
    prod: List[Dict[str, Any]] = []
    svc: List[Dict[str, Any]] = []
    for seg in lane or []:
        if seg.get("kind") in ("clean", "maint"):
            svc.append(seg)
        else:
            prod.append(seg)
    return prod, svc


def _repack_lane(
    production: List[Dict[str, Any]],
    service: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Reassign `start` so production runs flow contiguously while service
    blocks stay at their original times.

    The repack honours the contract: service blocks are time-locked by
    Tabla CF. Production runs flow into the gaps between (and around)
    them in the order we chose. If a production run would overlap a
    service block, it slides forward to start at `service.start +
    service.w`.
    """
    service_sorted = sorted(service or [], key=lambda s: float(s.get("start") or 0.0))
    out: List[Dict[str, Any]] = []
    cursor = 0.0
    svc_idx = 0
    for run in production:
        w = float(run.get("w") or 0.0)
        # Walk past any service block that's wholly before cursor; surface
        # blocks that overlap [cursor, cursor+w].
        while svc_idx < len(service_sorted):
            s = service_sorted[svc_idx]
            s_start = float(s.get("start") or 0.0)
            s_end = s_start + float(s.get("w") or 0.0)
            if s_end <= cursor:
                # service block is in the past relative to our cursor;
                # emit it and move on.
                out.append({**s, "start": s_start})
                svc_idx += 1
                continue
            if s_start < cursor + w:
                # service block sits inside this run's footprint; emit
                # the service first, then push the run after it.
                out.append({**s, "start": s_start})
                cursor = max(cursor, s_end)
                svc_idx += 1
                continue
            break  # next service block is after this run; emit run first
        out.append({**run, "start": round(cursor, 2), "w": round(w, 2)})
        cursor += w
    # Any service blocks left over after the last production run keep
    # their original positions.
    while svc_idx < len(service_sorted):
        out.append({**service_sorted[svc_idx]})
        svc_idx += 1
    return out


def resequence_lane(
    lane: List[Dict[str, Any]],
    executed: List[Dict[str, Any]],
    stats: Dict[str, Any],
) -> Tuple[List[Dict[str, Any]], float, float]:
    """Reorder one lane. Returns `(new_lane, before_cost, after_cost)`."""
    production, service = _split_segments(lane)
    if len(production) < 2:
        return list(lane), 0.0, 0.0
    anchor = _last_executed_seg(executed)
    before_cost = _sequence_cost(production, anchor, stats)
    seeded = _nearest_neighbour_order(production, anchor, stats)
    refined = _two_opt(seeded, anchor, stats)
    after_cost = _sequence_cost(refined, anchor, stats)
    # Never return a worse sequence than we started with — degrade to the
    # original ordering if 2-opt / NN somehow regress (shouldn't happen
    # but defensive).
    if after_cost > before_cost + 1e-9:
        return list(lane), before_cost, before_cost
    new_lane = _repack_lane(refined, service)
    return new_lane, before_cost, after_cost


def resequence(
    base_plan: Dict[str, List[Dict[str, Any]]],
    executed_history: Dict[str, List[Dict[str, Any]]],
    transition_stats: Dict[str, Any],
) -> Dict[str, Any]:
    """Top-level entry point.

    Returns:
        {
          "plan":              { lineKey: [seg, ...] },   # the new basePlan
          "byLine":            { lineKey: {before, after, delta, reorderedOf} },
          "totalCostBefore":   float,
          "totalCostAfter":    float,
          "totalCostDelta":    float,   # positive = saved
          "totalReordered":    int,     # production runs whose position changed
        }
    """
    new_plan: Dict[str, List[Dict[str, Any]]] = {}
    by_line: Dict[str, Dict[str, Any]] = {}
    total_before = 0.0
    total_after = 0.0
    total_reordered = 0

    for line, lane in (base_plan or {}).items():
        line_key = str(line)
        executed_lane = (executed_history or {}).get(line_key, [])
        new_lane, before, after = resequence_lane(
            list(lane or []), list(executed_lane), transition_stats or {},
        )
        # Count how many production runs moved index.
        before_order = [s.get("of") for s in (lane or []) if s.get("kind") not in ("clean", "maint")]
        after_order = [s.get("of") for s in new_lane if s.get("kind") not in ("clean", "maint")]
        reordered = sum(1 for a, b in zip(before_order, after_order) if a != b)
        new_plan[line_key] = new_lane
        by_line[line_key] = {
            "before": round(before, 4),
            "after": round(after, 4),
            "delta": round(before - after, 4),
            "reorderedOf": reordered,
            "anchorOf": (executed_lane and _last_executed_seg(executed_lane) or {}).get("of"),
        }
        total_before += before
        total_after += after
        total_reordered += reordered

    return {
        "plan": new_plan,
        "byLine": by_line,
        "totalCostBefore": round(total_before, 4),
        "totalCostAfter": round(total_after, 4),
        "totalCostDelta": round(total_before - total_after, 4),
        "totalReordered": total_reordered,
    }
