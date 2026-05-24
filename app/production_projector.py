"""Forward-project the committed Planificado plan to a longer horizon.

Damm's Planificado workbook only covers ~7 days. The challenge brief
asks for sequencing recommendations and OEE prediction across the
whole forward calendar — so the timeline needs production runs past
the Planificado window.

This module tiles the existing week-shaped plan forward, repeating the
SKU mix until the requested end date. Each projected band carries:

  source:        "projected_from_planificado"
  cycleWeek:     1-indexed (1 = original Planificado, 2 = first tile, …)
  inferredWidth: true                    # signals "modelled, not committed"
  oee:           inherited from the source band
  vol:           inherited

That `source` tag is what makes this honest. The recommender + global
re-sequencer can score these projected bands using the same transition
buckets they use for committed runs (they observe `of`, `sku`, and
`format_key` — all preserved). Service blocks slot back in via
`cf_matrix.project_service_blocks` on the same extended horizon.

Approach (per line, independent):
  1. Snapshot the existing production runs (week 1).
  2. Determine the tile period (default 7d) and total cycles needed.
  3. For each cycle n >= 2, clone the week's runs with start shifted by
     `(n-1) × tile_period_hours`, stop when start crosses the horizon.

Limits & follow-ups:
  * Cross-line balancing not applied here — the resequencer can be
    re-run against the extended plan to redistribute if desired.
  * No due-date awareness (no `committedDelivery` on bands yet).
  * The 7-day tile assumes Planificado is a weekly commit. If Damm
    moves to a fortnightly commit, parameterise `cycle_period_days`.
"""
from __future__ import annotations

import copy
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional


PRODUCTION_KINDS_NULL = (None,)  # production bands have kind=None/absent


def _is_production(seg: Dict[str, Any]) -> bool:
    kind = seg.get("kind")
    return kind in (None, "ins", "shift")


def project_forward_production(
    base_plan: Dict[str, List[Dict[str, Any]]],
    *,
    target_horizon_days: float,
    cycle_period_days: float = 7.0,
) -> Dict[str, List[Dict[str, Any]]]:
    """Return a new basePlan where each line's production runs are tiled
    forward to roughly `target_horizon_days` from the anchor (start=0).

    The input is mutated only via deep copies; non-production blocks
    (clean / maint) in the original lane are preserved at their original
    positions.

    Note that this runs *before* `project_service_blocks` injects the
    extended cleaning cadence — i.e. when this function sees the lane,
    only the original Planificado weekly stops (if any) are present.
    The exporter sequences these calls so the new service-block events
    interleave with the tiled production correctly.
    """
    if not isinstance(base_plan, dict):
        return base_plan
    target_h = float(target_horizon_days) * 24.0
    cycle_h = float(cycle_period_days) * 24.0
    out: Dict[str, List[Dict[str, Any]]] = {}

    for line, lane in base_plan.items():
        if not isinstance(lane, list):
            out[line] = lane
            continue
        production_seed = [copy.deepcopy(s) for s in lane if _is_production(s)]
        non_production = [copy.deepcopy(s) for s in lane if not _is_production(s)]
        if not production_seed:
            out[line] = lane
            continue

        # Where does the original Planificado end on this line?
        seed_end = max(
            float(s.get("start") or 0.0) + float(s.get("w") or 0.0)
            for s in production_seed
        )
        if seed_end >= target_h:
            out[line] = lane
            continue

        # Tile the seed forward. cycle_n=1 is the original; cycles 2..N
        # are clones with start shifted by (n-1) * cycle_h.
        tiled: List[Dict[str, Any]] = list(production_seed)
        cycle_n = 2
        while True:
            offset = (cycle_n - 1) * cycle_h
            seed_start = min(float(s.get("start") or 0.0) for s in production_seed)
            if seed_start + offset >= target_h:
                break
            for orig in production_seed:
                start = float(orig.get("start") or 0.0) + offset
                if start >= target_h:
                    continue
                clone = copy.deepcopy(orig)
                clone["start"] = round(start, 2)
                clone["source"] = "projected_from_planificado"
                clone["cycleWeek"] = cycle_n
                # Mark as inferred so the UI can render it dimmed if
                # the frontend wants to distinguish committed vs modelled.
                clone["inferredWidth"] = True
                tiled.append(clone)
            cycle_n += 1
            # Defensive cap — should never trigger with sane horizons.
            if cycle_n > 100:
                break

        tiled.sort(key=lambda s: float(s.get("start") or 0.0))
        # Merge tiled production with the lane's existing non-production
        # blocks (kept where they were); service-block projection runs
        # separately in the exporter and will inject the extended cadence.
        merged = sorted(
            tiled + non_production,
            key=lambda s: float(s.get("start") or 0.0),
        )
        out[line] = merged

    return out


def horizon_days_to_eoy(anchor_date: Optional[str | date | datetime] = None) -> int:
    """Compute how many days from `anchor_date` to 31 December of the
    anchor's calendar year. Defaults to today."""
    if isinstance(anchor_date, datetime):
        a = anchor_date.date()
    elif isinstance(anchor_date, date):
        a = anchor_date
    elif isinstance(anchor_date, str) and anchor_date:
        try:
            a = datetime.fromisoformat(anchor_date[:10]).date()
        except ValueError:
            a = datetime.now().date()
    else:
        a = datetime.now().date()
    eoy = date(a.year, 12, 31)
    return max(1, (eoy - a).days)
