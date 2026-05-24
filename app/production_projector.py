"""Forward-project the committed Planificado plan to a longer horizon.

Damm's Planificado workbook only covers ~7 days. The challenge brief
asks for sequencing recommendations and OEE prediction across the
whole forward calendar — so the timeline needs production runs past
the Planificado window.

Two projection modes, controlled by whether `historical_runs` is passed:

* **History-replay mode** (preferred). Per line, walks the 2025 Master
  OEE production pool. Each forward week is filled by a rotating slice
  of consecutive historical runs (real OFs, real SKUs, real OEEs).
  Looping back through the pool starts at a different offset, so even
  successive passes through the same line's history don't produce
  identical weeks. This is the move that makes "Onward week N" feel
  like a different week, not a clone of week 1.

* **Clone-Planificado mode** (fallback when no history). Tiles the
  current Planificado week forward unchanged.

Every projected band carries:

  source:             "projected_from_history" | "projected_from_planificado"
  cycleWeek:          1-indexed (1 = committed, 2..N = modelled)
  inferredWidth:      true                # UI cue: "modelled, not committed"
  sourceHistoryIndex: int (history mode only)

The recommender + global re-sequencer can score these bands using the
same transition buckets they use for committed runs — they read `of`,
`sku`, and `format_key`, all of which are inherited from real history.

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


def _fill_week_from_history(
    *,
    line_pool: List[Dict[str, Any]],
    week_start_h: float,
    cycle_n: int,
    cycle_h: float,
    target_h: float,
    pool_offset: int,
) -> List[Dict[str, Any]]:
    """Pull consecutive runs from a line's historical pool, starting at
    `pool_offset` (wraps around), accumulating until ~`cycle_h` of run
    time is placed at `week_start_h`. Returns the projected bands."""
    if not line_pool:
        return []
    out: List[Dict[str, Any]] = []
    cursor = week_start_h
    accumulated = 0.0
    idx = pool_offset
    safety = 0
    while accumulated < cycle_h:
        safety += 1
        if safety > len(line_pool) * 2:
            break  # defensive — never loop more than twice through the pool
        run = line_pool[idx % len(line_pool)]
        idx += 1
        w = float(run.get("w") or 0.0)
        if w <= 0:
            continue
        if cursor + w > target_h:
            break  # don't overshoot the horizon
        clone = copy.deepcopy(run)
        clone["start"] = round(cursor, 2)
        clone["w"] = round(w, 2)
        clone["source"] = "projected_from_history"
        clone["cycleWeek"] = cycle_n
        clone["inferredWidth"] = True
        clone["sourceHistoryIndex"] = (idx - 1) % len(line_pool)
        out.append(clone)
        cursor += w
        accumulated += w
    return out


def project_forward_production(
    base_plan: Dict[str, List[Dict[str, Any]]],
    *,
    target_horizon_days: float,
    cycle_period_days: float = 7.0,
    historical_runs: Optional[Dict[str, List[Dict[str, Any]]]] = None,
) -> Dict[str, List[Dict[str, Any]]]:
    """Return a new basePlan where each line's production runs are tiled
    forward to roughly `target_horizon_days` from the anchor (start=0).

    When `historical_runs[line]` is supplied with a non-empty list of
    {of, sku, vol, oee, w, format_key, …} runs from the 2025 master
    history, each forward week is filled by a different rotating slice
    of that pool (history-replay mode). Otherwise the original
    Planificado week is cloned forward (clone-Planificado fallback).

    Non-production blocks (clean / maint) in the original lane are
    preserved at their original positions. The exporter calls
    `project_service_blocks` *after* this function so the extended
    cleaning cadence interleaves with the projected production.
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

        line_pool = (historical_runs or {}).get(str(line)) or []
        tiled: List[Dict[str, Any]] = list(production_seed)

        cycle_n = 2
        while True:
            week_start = (cycle_n - 1) * cycle_h
            if week_start >= target_h:
                break

            if line_pool:
                # History-replay mode. Rotate the pool offset each cycle
                # so successive weeks draw different slices of 2025.
                # ~5 runs per cycle of offset is enough to produce a
                # visibly different SKU mix even on short pools.
                pool_offset = ((cycle_n - 2) * 5) % len(line_pool)
                tiled.extend(_fill_week_from_history(
                    line_pool=line_pool,
                    week_start_h=week_start,
                    cycle_n=cycle_n,
                    cycle_h=cycle_h,
                    target_h=target_h,
                    pool_offset=pool_offset,
                ))
            else:
                # Fallback: clone the Planificado seed forward unchanged.
                offset = (cycle_n - 1) * cycle_h
                for orig in production_seed:
                    start = float(orig.get("start") or 0.0) + offset
                    if start >= target_h:
                        continue
                    clone = copy.deepcopy(orig)
                    clone["start"] = round(start, 2)
                    clone["source"] = "projected_from_planificado"
                    clone["cycleWeek"] = cycle_n
                    clone["inferredWidth"] = True
                    tiled.append(clone)

            cycle_n += 1
            if cycle_n > 100:
                break  # defensive

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
