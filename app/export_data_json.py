"""Export the LineWise frontend data contract (data.json).

This is the canonical handoff between the data layer and the frontend team.

    Excel files (data/raw)
       ↓        data_loader.build_master_dataset()
    master table (one row per line-time block, keyed by OF)
       ↓        block_classifier.classify_blocks()
    master + block_type (production / clean / maint / other), OEE capped
       ↓        changeover_typing.annotate_master()
    master + transition_type + principal_label
       ↓        sequence_builder.build_sequence()
    line_blocks (incl. clean/maint) + production-only transition table
       ↓        analogue search + recommendation
    LineWiseData payload → data/output/data.json

Run from the repo root:

    python -m app.export_data_json \\
        --raw data/raw \\
        --out data/output/data.json \\
        --processed data/processed

Hard rules baked into this exporter:
  - History is immutable. Past blocks render as-is.
  - Clean/maint rows are NEVER used in OEE baselines, analogue means or
    transition statistics. They DO appear on the timeline as kind='clean'/'maint'.
  - All analogues are real 2025 OFs with real recorded OEE. No fakes.
  - No invented €/cost figures.
  - No OpenAI dependency — explanations are deterministic.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from . import config, data_loader, sample_data
from .block_classifier import classify_blocks, verify_of_woid_join
from .cf_matrix import load_cf_matrix, load_operational_contract, project_service_blocks
from .production_projector import project_forward_production, horizon_days_to_eoy
from .changeover_typing import annotate_master
from .config import LINES
from .data_contract import CONTRACT_VERSION, summarize, validate
from .line_rules import LINE_FORMAT_CAPABILITIES, infeasibility_reason, is_feasible, normalize_format
from .plan_loader import load_forward_plan
from .sequence_builder import build_sequence

DEFAULT_OUTPUT_PATH = config.OUTPUT_DIR / "data.json"


# ============================================================ helpers


def _fnone(v) -> Optional[float]:
    if v is None:
        return None
    try:
        f = float(v)
        return None if math.isnan(f) else f
    except (TypeError, ValueError):
        return None


def _round_oee(v) -> Optional[float]:
    f = _fnone(v)
    return round(f, 3) if f is not None else None


def _round_min(v) -> Optional[float]:
    f = _fnone(v)
    return round(f, 1) if f is not None else None


def _json_safe(value: Any) -> Any:
    """Recursively convert NaN/Inf and numpy scalars into strict JSON values."""
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_json_safe(v) for v in value]
    if isinstance(value, tuple):
        return [_json_safe(v) for v in value]
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, np.floating):
        f = float(value)
        return f if math.isfinite(f) else None
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    return value


def _row_duration_hours(row) -> float:
    v = row.get("par_tot_min") if hasattr(row, "get") else row["par_tot_min"]
    try:
        v = float(v)
        if not math.isnan(v) and v > 0:
            return v / 60.0
    except (TypeError, ValueError):
        pass
    return 4.0


def build_historical_runs_pool(master_blocks: pd.DataFrame) -> Dict[str, List[Dict[str, Any]]]:
    """Per-line pool of real 2025 production runs (no `start` — caller
    assigns positions during forward projection). Used by
    `production_projector.project_forward_production` to fill W23+ with
    varied historical SKU mix instead of cloning the Planificado week.

    Returns `{ "14": [run, ...], "17": [...], "19": [...] }` sorted by
    historical timestamp so consecutive entries reflect actual run
    sequences from 2025.
    """
    out: Dict[str, List[Dict[str, Any]]] = {str(l): [] for l in LINES}
    if master_blocks is None or master_blocks.empty:
        return out
    df = master_blocks.copy()
    if "block_type" in df.columns:
        df = df[df["block_type"] == "production"]
    if "fecha_fin" in df.columns:
        df["fecha_fin"] = pd.to_datetime(df["fecha_fin"], errors="coerce")
        df = df.sort_values("fecha_fin")
    for line in LINES:
        sub = df[df["tren"] == line]
        if sub.empty:
            continue
        runs: List[Dict[str, Any]] = []
        for _, r in sub.iterrows():
            dur = max(0.25, _row_duration_hours(r))
            envase = str(r.get("envase")) if r.get("envase") else None
            tipo_envase = str(r.get("tipo_envase")) if r.get("tipo_envase") else None
            hl = r.get("hl")
            try:
                vol = int(hl) if hl is not None and not math.isnan(float(hl)) else 0
            except (TypeError, ValueError):
                vol = 0
            runs.append({
                "of": str(r.get("of")) if r.get("of") else None,
                "sku": str(r.get("sku")) if r.get("sku") else None,
                "vol": vol,
                "oee": _round_oee(r.get("oee")) or 0.55,
                "w": round(dur, 2),
                "envase": envase,
                "tipo_envase": tipo_envase,
                "format_key": normalize_format(tipo_envase) or normalize_format(envase),
                "marca": str(r.get("marca")) if r.get("marca") else None,
                "familia": str(r.get("familia")) if r.get("familia") else None,
            })
        out[str(line)] = runs
    return out


# ============================================================ executed + plan


def build_executed_and_plan(
    master_blocks: pd.DataFrame,
) -> Tuple[Dict[str, List[Dict[str, Any]]], Dict[str, List[Dict[str, Any]]]]:
    """Build the timeline segments (per line) from the classified master table.

    Convention (consumed by `frontend/components/Timeline.tsx`):
      * executedHistory[line]: segments with `start = 0..N` (oldest first),
        rendered in the past zone.
      * basePlan[line]: segments with `start = 0..N` (today first), rendered
        right of the today divider.

    Cleaning / maintenance rows are surfaced with `kind = "clean" | "maint"`.
    """
    executed: Dict[str, List[Dict[str, Any]]] = {}
    plan: Dict[str, List[Dict[str, Any]]] = {}
    if master_blocks is None or master_blocks.empty:
        return executed, plan

    df = master_blocks.copy()
    if "fecha_fin" in df.columns:
        df["fecha_fin"] = pd.to_datetime(df["fecha_fin"], errors="coerce")
        df = df.sort_values("fecha_fin", ascending=False)

    for line in LINES:
        sub = df[df["tren"] == line].head(15)
        if sub.empty:
            continue
        sub = sub.sort_values("fecha_fin") if "fecha_fin" in sub.columns else sub
        rows = sub.to_dict("records")
        executed_rows = rows[:5]
        plan_rows = rows[5:]

        def seg_from_row(r: dict, cursor: float) -> Tuple[dict, float]:
            dur_hours = max(0.25, _row_duration_hours(r))
            btype = r.get("block_type") or "production"
            base = {
                "of": str(r.get("of")),
                "start": round(cursor, 2),
                "w": round(dur_hours, 2),
            }
            if btype == "production":
                envase = str(r.get("envase")) if r.get("envase") else None
                tipo_envase = str(r.get("tipo_envase")) if r.get("tipo_envase") else None
                base.update({
                    "sku": str(r.get("sku")) if r.get("sku") else None,
                    "vol": int(r.get("hl")) if r.get("hl") and not math.isnan(float(r.get("hl"))) else 0,
                    "oee": _round_oee(r.get("oee")) or 0.55,
                    "envase": envase,
                    "tipo_envase": tipo_envase,
                    "format_key": normalize_format(tipo_envase) or normalize_format(envase),
                    "marca": str(r.get("marca")) if r.get("marca") else None,
                    "familia": str(r.get("familia")) if r.get("familia") else None,
                })
            else:
                base.update({"kind": btype})
            return base, cursor + dur_hours

        # plan: cursor starts at 0 = today
        cursor = 0.0
        plan_list: List[Dict[str, Any]] = []
        for r in plan_rows:
            seg, cursor = seg_from_row(r, cursor)
            plan_list.append(seg)
        plan[str(line)] = plan_list

        # executed: cursor 0 = leftmost (oldest)
        cursor = 0.0
        exec_list: List[Dict[str, Any]] = []
        for r in executed_rows:
            seg, cursor = seg_from_row(r, cursor)
            exec_list.append(seg)
        executed[str(line)] = exec_list

    return executed, plan


# ============================================================ urgent orders


def build_urgent_orders(products: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Pick real products: two 1/3 urgent examples + one 1/2 queued."""
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)

    def due_in(days: int) -> str:
        return (today + timedelta(days=days)).strftime("%d %b")

    def product_format_key(product: Dict[str, Any]) -> Optional[str]:
        return product.get("format_key") or normalize_format(product.get("format"))

    out: List[Dict[str, Any]] = []
    one_thirds = [p for p in products if product_format_key(p) == "1/3"]
    one_third = one_thirds[0] if one_thirds else None
    second_one_third = next(
        (p for p in one_thirds[1:] if p.get("sku") != one_third.get("sku")),
        None,
    ) if one_third else None
    half = next((p for p in products if product_format_key(p) == "1/2"), None)
    if one_third:
        out.append({
            "of": "ED13LTNN",
            "status": "urgent",
            "sku": one_third.get("name") or one_third["sku"],
            "productSku": one_third["sku"],
            "units": 18000,
            "hl": 594,
            "due": due_in(5),
            "volume_hl": 594,
            "format_key": product_format_key(one_third),
        })
    if second_one_third:
        out.append({
            "of": "ED13LTEX",
            "status": "urgent",
            "sku": second_one_third.get("name") or second_one_third["sku"],
            "productSku": second_one_third["sku"],
            "units": 12000,
            "hl": 396,
            "due": due_in(6),
            "volume_hl": 396,
            "format_key": product_format_key(second_one_third),
        })
    if half:
        out.append({
            "of": "ED12LTW",
            "status": "queued",
            "sku": half.get("name") or half["sku"],
            "productSku": half["sku"],
            "units": 6000,
            "hl": 198,
            "due": due_in(8),
            "volume_hl": 198,
            "format_key": product_format_key(half),
        })
    return out


# ============================================================ diagnostics


def build_line_baseline(tt: pd.DataFrame, master_prod: pd.DataFrame) -> Dict[str, Dict[str, Any]]:
    """Per-line baseline computed ONLY from production blocks."""
    out: Dict[str, Dict[str, Any]] = {}
    for line in LINES:
        m_sub = master_prod[master_prod["tren"] == line] if master_prod is not None else pd.DataFrame()
        tt_sub = tt[tt["line"] == line] if tt is not None and not tt.empty else pd.DataFrame()
        avg_oee = _fnone(m_sub["oee"].dropna().mean()) if not m_sub.empty and "oee" in m_sub.columns else None
        avg_co = (
            _fnone(tt_sub["actual_changeover_minutes"].dropna().mean())
            if not tt_sub.empty and "actual_changeover_minutes" in tt_sub.columns
            else None
        )
        avg_limp = (
            _fnone(tt_sub["limpieza_minutes"].dropna().mean())
            if not tt_sub.empty and "limpieza_minutes" in tt_sub.columns
            else None
        )
        avg_pnp = (
            _fnone(tt_sub["pnp_minutes"].dropna().mean())
            if not tt_sub.empty and "pnp_minutes" in tt_sub.columns
            else None
        )
        out[str(line)] = {
            "avg_oee": _round_oee(avg_oee),
            "avg_changeover_minutes": _round_min(avg_co),
            "avg_limpieza_minutes": _round_min(avg_limp),
            "avg_pnp_minutes": _round_min(avg_pnp),
            "production_orders": int(len(m_sub)),
            "supports_formats": sorted(list(LINE_FORMAT_CAPABILITIES.get(line, set()))),
        }
    return out


def build_timeline_metadata(
    base_plan: Dict[str, List[Dict[str, Any]]],
    *,
    exported_at: datetime,
) -> Dict[str, Any]:
    """Describe how timeline offsets should be interpreted by clients.

    Segment `start` and `w` values are measured in hours. The frontend can
    render day/week/month views by anchoring offset 0 at `anchorDate` and
    converting hours to days for geometry.
    """
    anchor_dt: Optional[datetime] = None
    for segments in (base_plan or {}).values():
        for seg in segments or []:
            raw = seg.get("planned_start_iso") if isinstance(seg, dict) else None
            if not raw:
                continue
            try:
                dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
            except ValueError:
                continue
            if anchor_dt is None or dt < anchor_dt:
                anchor_dt = dt

    return {
        "anchorDate": exported_at.date().isoformat(),
        "anchorLabel": "Today",
        "timeUnit": "hours",
        "views": {
            "week": {"daysBack": 7, "daysAhead": 14},
            "month": {"daysBack": 14, "daysAhead": 35},
            "quarter": {"daysBack": 30, "daysAhead": 90},
        },
        "source": "exported_at",
        "sourcePlanStartDate": anchor_dt.date().isoformat() if anchor_dt is not None else None,
    }


def transition_type_stats(tt: pd.DataFrame, line_baseline: Dict[str, Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """For every transition_type seen in history, compute the diagnostic stats."""
    if tt is None or tt.empty:
        return {}
    out: Dict[str, Dict[str, Any]] = {}
    for ttype, g in tt.groupby("transition_type"):
        if not ttype or pd.isna(ttype):
            continue
        # OEE damage vs line baseline (weighted by per-line cases)
        damages: List[float] = []
        worst_line, worst_oee = None, None
        for line, lg in g.groupby("line"):
            line_oee = lg["oee"].dropna().mean()
            base = (line_baseline.get(str(int(line))) or {}).get("avg_oee")
            if pd.notna(line_oee) and base is not None:
                damages.append((line_oee - base) * 100.0)
            if pd.notna(line_oee) and (worst_oee is None or line_oee < worst_oee):
                worst_oee, worst_line = float(line_oee), int(line)

        out[str(ttype)] = {
            "cases": int(len(g)),
            "mean_oee": _round_oee(g["oee"].dropna().mean()),
            "mean_oee_damage_pts": (round(sum(damages) / len(damages), 2) if damages else None),
            "mean_actual_changeover_minutes": _round_min(g["actual_changeover_minutes"].dropna().mean()),
            "mean_limpieza_minutes": _round_min(g["limpieza_minutes"].dropna().mean()),
            "mean_pnp_minutes": _round_min(g["pnp_minutes"].dropna().mean()),
            "worst_line": worst_line,
            "worst_line_avg_oee": _round_oee(worst_oee),
        }
    return out


# ============================================================ analogues + prediction


# Evidence scope ladder — strongest to weakest.
SCOPE_ORDER = [
    "line_transition_format",
    "line_transition",
    "transition_all_lines",
    "line_only",
    "global_fallback",
]

# Penalty applied to predicted gain (in OEE points) per scope.
SCOPE_PENALTY_PTS: Dict[str, float] = {
    "line_transition_format": 0.0,
    "line_transition":        0.5,
    "transition_all_lines":   1.5,
    "line_only":              3.0,
    "global_fallback":        5.0,
    "no_match":               6.0,
    "no_history":             6.0,
}

WEAK_SCOPES = {"line_only", "global_fallback", "no_match", "no_history"}


def scope_penalty_pts(scope: Optional[str]) -> float:
    return SCOPE_PENALTY_PTS.get(scope or "no_match", 6.0)


def find_analogues(
    tt: pd.DataFrame,
    *,
    line: int,
    transition_type: str,
    previous_sku: Optional[str],
    current_sku: Optional[str],
    cur_format_key: Optional[str],
    top_k: int = 6,
    min_n: int = 3,
) -> Dict[str, Any]:
    """Score and return top-k REAL historical analogues (production-only).

    Backs off through five scopes, strongest first:

      1. line_transition_format — same line + transition_type + can format
      2. line_transition        — same line + transition_type
      3. transition_all_lines   — same transition_type, any line
      4. line_only              — same line, any transition
      5. global_fallback        — any production transition

    The actual scope used is returned alongside the per-scope penalty.
    """
    empty_payload = {
        "analogues": [],
        "n": 0,
        "scope": "no_history",
        "analogue_mean_oee": None,
        "pool_size": 0,
        "scope_penalty_pts": scope_penalty_pts("no_history"),
        "had_cleaning_between_rate": 0.0,
        "mean_cleaning_minutes_between": None,
    }
    if tt is None or tt.empty:
        return empty_payload

    base = tt[tt["oee"].notna()].copy()
    if base.empty:
        return {**empty_payload, "scope": "no_match", "scope_penalty_pts": scope_penalty_pts("no_match")}

    # Per-row normalized format key for the line_transition_format scope.
    if "current_tipo_envase" in base.columns:
        base["_fmt"] = base["current_tipo_envase"].apply(
            lambda x: normalize_format(str(x)) if pd.notna(x) else None
        )
    else:
        base["_fmt"] = None

    ladder = [
        ("line_transition_format",
         (base["line"] == int(line))
         & (base["transition_type"] == transition_type)
         & (base["_fmt"] == cur_format_key)),
        ("line_transition",
         (base["line"] == int(line)) & (base["transition_type"] == transition_type)),
        ("transition_all_lines",
         (base["transition_type"] == transition_type)),
        ("line_only",
         (base["line"] == int(line))),
        ("global_fallback",
         pd.Series([True] * len(base), index=base.index)),
    ]

    scope = "no_match"
    pool = base.iloc[0:0]
    for name, mask in ladder:
        candidate = base[mask]
        if len(candidate) >= min_n:
            pool, scope = candidate, name
            break

    if pool.empty:
        return {**empty_payload, "scope": "no_match", "scope_penalty_pts": scope_penalty_pts("no_match")}

    def score_row(r):
        s = 0.5  # base
        if previous_sku and r.get("previous_sku") == previous_sku:
            s += 2.0
        if current_sku and r.get("current_sku") == current_sku:
            s += 2.5
        if cur_format_key and r.get("_fmt") == cur_format_key:
            s += 1.0
        return s

    pool = pool.copy()
    pool["_score"] = pool.apply(score_row, axis=1)
    pool = pool.sort_values("_score", ascending=False)

    top = pool.head(top_k)
    analogues = []
    for _, r in top.iterrows():
        analogue = {
            "of": str(r.get("current_of")),
            "previous_of": str(r.get("previous_of")),
            "line": str(int(r.get("line"))),
            "date": pd.to_datetime(r.get("date")).strftime("%d %b %Y") if pd.notna(r.get("date")) else "—",
            "type": str(r.get("transition_type") or "—"),
            "principal": r.get("principal_label") or "—",
            "actual_changeover_minutes": _round_min(r.get("actual_changeover_minutes")),
            "oee": _round_oee(r.get("oee")),
        }
        if "cleaning_minutes_between" in r.index:
            analogue["cleaning_minutes_between"] = _round_min(r.get("cleaning_minutes_between"))
        if "had_cleaning_between" in r.index:
            analogue["had_cleaning_between"] = bool(r.get("had_cleaning_between"))
        analogues.append(analogue)

    cleaning_rate = 0.0
    mean_cleaning_minutes = None
    if "had_cleaning_between" in pool.columns:
        cleaning_rate = float(pool["had_cleaning_between"].fillna(False).astype(int).mean())
    if "cleaning_minutes_between" in pool.columns:
        mean_cleaning_minutes = _round_min(
            pool["cleaning_minutes_between"].dropna().mean()
        )

    return {
        "analogues": analogues,
        "n": int(len(top)),
        "scope": scope,
        "analogue_mean_oee": _round_oee(pool["oee"].dropna().mean()),
        "pool_size": int(len(pool)),
        "scope_penalty_pts": scope_penalty_pts(scope),
        "had_cleaning_between_rate": round(cleaning_rate, 3),
        "mean_cleaning_minutes_between": mean_cleaning_minutes,
    }


# ============================================================ recommendations


def _derive_transition_type_from_attrs(
    prev_envase: Optional[str], cur_envase: Optional[str],
    prev_marca: Optional[str], cur_marca: Optional[str],
    prev_fam: Optional[str], cur_fam: Optional[str],
    prev_format_key: Optional[str], cur_format_key: Optional[str],
) -> str:
    """Derive a transition_type tag for the urgent insertion (no Cambios data yet)."""
    tags = []
    if prev_format_key and cur_format_key and prev_format_key != cur_format_key:
        tags.append("volume")
    if prev_marca and cur_marca and prev_marca != cur_marca:
        tags.append("brand")
    if prev_fam and cur_fam and prev_fam != cur_fam:
        tags.append("product")
    if not tags:
        return "same-sku"
    return "+".join(tags)


def _signed_pts(delta_fraction: Optional[float]) -> str:
    """0.062 → '+6.2'  ·  -0.004 → '−0.4'  (Unicode minus)."""
    if delta_fraction is None:
        return "—"
    pts = float(delta_fraction) * 100.0
    return f"+{pts:.1f}" if pts >= 0 else f"−{abs(pts):.1f}"


def _signed_pts_value(value: Any) -> float:
    if value is None:
        return 0.0
    text = str(value).strip().replace("−", "-").replace("+", "")
    if not text or text == "—":
        return 0.0
    try:
        return float(text)
    except ValueError:
        return 0.0


def _of_duration_hours(o: Dict[str, Any]) -> float:
    try:
        a = datetime.fromisoformat(o["start"])
        b = datetime.fromisoformat(o["end"])
        return max((b - a).total_seconds() / 3600.0, 1.0)
    except Exception:
        return 4.0


def _build_proposed_plan(
    plan_by_line: Dict[str, List[Dict[str, Any]]],
    insertion_line: int,
    anchor_of: str,
    urgent_label: str,
    urgent_oee: float,
    urgent_volume_hl: float,
    line_hl_per_hour: float,
) -> Dict[str, Any]:
    """Produce the per-line plan with the urgent OF inserted on `insertion_line`.

    Returns: {plan, ghosts, moves, ordersMoved, insertion_hours}.
    All start / w fields are in hours (matching the frontend contract).
    """
    insertion_hours = max(1.0, urgent_volume_hl / max(line_hl_per_hour, 1.0))

    plan: Dict[str, List[Dict[str, Any]]] = {}
    ghosts: Dict[str, List[Dict[str, Any]]] = {}
    moves: List[Dict[str, Any]] = []
    orders_moved = 0

    for line_str, segs in plan_by_line.items():
        line = int(line_str)
        new_segs: List[Dict[str, Any]] = []
        cursor = 0.0
        inserted_yet = False
        for s in segs:
            if line == int(insertion_line) and not inserted_yet and s.get("of") == anchor_of:
                # 1) The anchor first
                anchor_seg = {**s, "start": round(cursor, 2)}
                anchor_seg["kind"] = "anchor"
                new_segs.append(anchor_seg)
                cursor += float(s["w"])
                # 2) Then the urgent insertion
                new_segs.append({
                    "of": urgent_label,
                    "sku": urgent_label,
                    "vol": int(urgent_volume_hl),
                    "start": round(cursor, 2),
                    "w": round(insertion_hours, 2),
                    "oee": round(float(urgent_oee), 3),
                    "kind": "ins",
                })
                cursor += insertion_hours
                inserted_yet = True
                continue

            if line == int(insertion_line) and inserted_yet and s.get("kind") in (None, "production"):
                # Shifted downstream production order
                ghost_start = cursor - insertion_hours
                ghosts.setdefault(line_str, []).append({
                    "of": s["of"], "start": round(ghost_start, 2), "w": float(s["w"]),
                })
                moves.append({
                    "of": s["of"], "line": line,
                    "shift": f"+{int(round(insertion_hours))}h",
                    "why": "pushed back to make room for the insertion",
                })
                orders_moved += 1
                new_segs.append({**s, "start": round(cursor, 2), "kind": "shift"})
                cursor += float(s["w"])
            else:
                new_segs.append({**s, "start": round(cursor, 2)})
                cursor += float(s["w"])

        plan[line_str] = new_segs

    return {
        "plan": plan,
        "ghosts": ghosts,
        "moves": moves,
        "ordersMoved": orders_moved,
        "insertion_hours": insertion_hours,
    }


def _recovery_hours(transition_type: str, analogue_mean_oee: Optional[float], cf_baseline_min: Optional[float]) -> float:
    """Modelled estimate. Documented as such in recovery.note."""
    base = (cf_baseline_min or 60.0) / 60.0
    tail = 6.0
    if "volume" in transition_type:
        tail += 12.0
    if "brand" in transition_type:
        tail += 6.0
    if "product" in transition_type:
        tail += 4.0
    if analogue_mean_oee is not None and analogue_mean_oee < 0.45:
        tail += 8.0
    return round(base + tail, 1)


_COMPONENT_LABELS = {
    "brand": "Brand change",
    "product": "Product change",
    "volume": "Packaging / volume change",
    "format": "Format change",
}


def build_changeover_breakdown(
    *,
    cf_format_minutes: Optional[float],
    analogue_mean_oee: Optional[float],
    line_baseline_oee: Optional[float],
    transition_components: List[str],
    historical_actual_minutes: Optional[float],
    cleaning_minutes_between: Optional[float],
    had_cleaning_between_rate: Optional[float],
    pnp_minutes: Optional[float],
    same_format: bool,
) -> List[Dict[str, Any]]:
    """Honest breakdown rows. Truthful values only — no invented placeholders."""
    rows: List[Dict[str, Any]] = []

    # 1. Format CF — explicit "0 min — same format" message when no format change
    if cf_format_minutes is not None and cf_format_minutes > 0:
        rows.append({
            "name": "Format / Envase CF",
            "pct": min(80, int(cf_format_minutes / 6)),
            "band": "hi" if cf_format_minutes >= 120 else "lo",
            "val": f"{int(cf_format_minutes)} min CF theoretical",
        })
    else:
        rows.append({
            "name": "Format / Envase CF",
            "pct": 0,
            "band": "lo",
            "val": "0 min — same format" if same_format else "Not available",
        })

    # 2. Discrete component changes (brand / product / volume / packaging)
    other_changes = [c for c in transition_components if c and c != "same-sku"]
    if other_changes:
        for comp in other_changes:
            label = _COMPONENT_LABELS.get(comp, f"Change: {comp.replace('_', ' ')}")
            rows.append({
                "name": label,
                "pct": 55,
                "band": "hi",
                "val": "active",
            })
    elif not same_format:
        # format already shown above; nothing else changes
        pass
    else:
        rows.append({
            "name": "Brand / product / packaging change",
            "pct": 0,
            "band": "lo",
            "val": "none",
        })

    # 3. Cleaning between runs (historical mean for same-line / same-transition pool)
    if cleaning_minutes_between is not None and cleaning_minutes_between > 0:
        rows.append({
            "name": "Cleaning between runs",
            "pct": min(70, int(cleaning_minutes_between / 4)),
            "band": "hi" if cleaning_minutes_between >= 60 else "lo",
            "val": f"{int(round(cleaning_minutes_between))} min (mean of analogue pool)",
        })
    elif had_cleaning_between_rate and had_cleaning_between_rate > 0:
        rows.append({
            "name": "Cleaning between runs",
            "pct": int(min(100, max(0, had_cleaning_between_rate * 100))),
            "band": "hi" if had_cleaning_between_rate >= 0.3 else "lo",
            "val": f"{had_cleaning_between_rate*100:.0f}% of analogues had cleaning between runs",
        })
    else:
        rows.append({
            "name": "Cleaning between runs",
            "pct": 0,
            "band": "lo",
            "val": "Not available",
        })

    # 4. PNP / restart — from same-transition stats if available
    if pnp_minutes is not None and pnp_minutes > 0:
        rows.append({
            "name": "PNP / restart",
            "pct": min(70, int(pnp_minutes / 4)),
            "band": "hi" if pnp_minutes >= 90 else "lo",
            "val": f"{int(round(pnp_minutes))} min historical mean",
        })
    else:
        rows.append({
            "name": "PNP / restart",
            "pct": 0,
            "band": "lo",
            "val": "Not available",
        })

    # 5. Historical actual changeover (vs CF theoretical)
    if historical_actual_minutes is not None and historical_actual_minutes > 0:
        rows.append({
            "name": "Historical actual changeover",
            "pct": min(80, int(historical_actual_minutes / 6)),
            "band": "hi" if historical_actual_minutes > (cf_format_minutes or 0) + 20 else "lo",
            "val": f"{int(round(historical_actual_minutes))} min mean",
        })

    # 6. Predicted OEE bar (anchored on analogue mean)
    if analogue_mean_oee is not None:
        rows.append({
            "name": "Predicted OEE (analogue mean)",
            "pct": int(round(analogue_mean_oee * 100)),
            "band": "lo" if analogue_mean_oee >= 0.55 else "hi",
            "val": f"{analogue_mean_oee:.2f}",
        })
    if line_baseline_oee is not None:
        rows.append({
            "name": "Line baseline OEE",
            "pct": int(round(line_baseline_oee * 100)),
            "band": "lo" if line_baseline_oee >= 0.55 else "hi",
            "val": f"{line_baseline_oee:.2f}",
        })
    return rows


def evidence_quality_label(n: int, scope: Optional[str] = None) -> str:
    """Strength label combining sample size with evidence scope.

    Strong requires both a large analogue pool AND a strong scope (same line,
    same transition_type — optionally same format).
    """
    strong_scopes = {"line_transition_format", "line_transition"}
    if n >= 20 and (scope is None or scope in strong_scopes):
        return "Strong"
    if n >= 8 and (scope is None or scope != "global_fallback"):
        return "Medium"
    if n >= 3:
        return "Limited"
    return "Weak"


def evidence_quality_note(n: int, scope: Optional[str] = None) -> str:
    label = evidence_quality_label(n, scope)
    if label == "Strong":
        return f"Strong evidence: {n} historical analogues support this estimate."
    if label == "Medium":
        return f"Medium evidence: {n} historical analogues support this estimate."
    if label == "Limited":
        return f"Limited evidence: only {n} historical analogues matched this estimate."
    return f"Weak evidence: only {n} historical analogue(s) matched this estimate."


_SCOPE_LABEL = {
    "line_transition_format": "same-line, same-transition, same-format",
    "line_transition":        "same-line, same-transition",
    "transition_all_lines":   "same-transition across all lines",
    "line_only":              "same-line, any transition",
    "global_fallback":        "any production transition across all lines",
    "no_match":               "no comparable historical transitions",
    "no_history":             "no transition history loaded",
}


def _deterministic_reason(
    *,
    insertion_line: int,
    position: str,
    transition_type: str,
    analogue_mean_oee: Optional[float],
    naive_oee: Optional[float],
    n: int,
    scope: str,
    same_format: bool,
    transition_components: List[str],
    cf_format_minutes: Optional[float],
) -> str:
    """Plain-English explanation, deterministic — no LLM."""
    parts: List[str] = []
    parts.append(
        f"On Line {insertion_line} {position}, the urgent order matches a "
        f"<b>{transition_type}</b> changeover."
    )

    # Honest CF interpretation for the same-format case.
    components_active = [c for c in transition_components if c and c != "same-sku"]
    if same_format and not components_active and not cf_format_minutes:
        parts.append(
            "CF format matrix shows no format change and no other change components."
        )
    elif same_format and (components_active or cf_format_minutes is None):
        if components_active:
            parts.append(
                "CF format matrix shows no format change, but Cambios flags "
                f"<b>{', '.join(components_active)}</b> — cleaning / restart "
                "loss is still expected."
            )
        else:
            parts.append(
                "CF format matrix shows no format change; cleaning / restart "
                "burden depends on the cleaning between runs and PNP rows below."
            )

    scope_label = _SCOPE_LABEL.get(scope, scope.replace("_", " "))
    if analogue_mean_oee is not None:
        parts.append(
            f"History across <b>{n}</b> {scope_label} cases shows an average "
            f"OEE of <b>{analogue_mean_oee:.2f}</b>."
        )

    if naive_oee is not None and analogue_mean_oee is not None:
        gain = (analogue_mean_oee - naive_oee) * 100.0
        if gain >= 0:
            parts.append(f"That is <b>{gain:+.1f}</b> OEE points above the naive slot.")
        else:
            parts.append(
                f"That is <b>{gain:+.1f}</b> OEE points below the naive slot — "
                "consider another option."
            )

    if scope in WEAK_SCOPES:
        parts.append(
            "Evidence is <b>limited</b>: this estimate falls back to "
            f"{scope_label} because few stronger analogues exist."
        )

    return " ".join(parts)


def _evaluate_candidate(
    *,
    line: int,
    anchor_idx: int,
    anchor: Dict[str, Any],
    base_plan: Dict[str, List[Dict[str, Any]]],
    transitions: pd.DataFrame,
    transition_stats: Dict[str, Dict[str, Any]],
    line_baseline: Dict[str, Dict[str, Any]],
    cf,
    urgent: Dict[str, Any],
    cur_product: Dict[str, Any],
    cur_format_key: Optional[str],
) -> Dict[str, Any]:
    """Build a single candidate (insertion after `anchor` on `line`)."""
    prev_envase = anchor.get("envase") or anchor.get("sku")
    prev_format_key = anchor.get("format_key") or normalize_format(prev_envase)
    prev_marca = anchor.get("marca")
    prev_fam = anchor.get("familia")
    prev_sku = anchor.get("sku")

    transition_type = _derive_transition_type_from_attrs(
        prev_envase, cur_product.get("format"),
        prev_marca, cur_product.get("marca"),
        prev_fam, cur_product.get("family"),
        prev_format_key, cur_format_key,
    )

    analogue = find_analogues(
        transitions,
        line=line,
        transition_type=transition_type,
        previous_sku=prev_sku,
        current_sku=urgent["productSku"],
        cur_format_key=cur_format_key,
        top_k=6,
    )

    # CF — strictly the format-vs-format theoretical baseline.
    cf_format_minutes = cf.with_fallback(line, prev_format_key, cur_format_key) if cf else None
    # Historical actual changeover for the same transition_type (fallback).
    hist_actual_minutes = (transition_stats.get(transition_type) or {}).get(
        "mean_actual_changeover_minutes"
    )
    pnp_minutes_for_breakdown = (transition_stats.get(transition_type) or {}).get(
        "mean_pnp_minutes"
    )

    same_format = bool(prev_format_key and cur_format_key and prev_format_key == cur_format_key)

    # Throughput per line in HL/hr — used to estimate insertion duration only.
    line_throughput = {14: 220.0, 17: 180.0, 19: 240.0}.get(line, 200.0)
    proposed = _build_proposed_plan(
        plan_by_line=base_plan,
        insertion_line=line,
        anchor_of=anchor["of"],
        urgent_label=urgent["of"],
        urgent_oee=(analogue.get("analogue_mean_oee") or (line_baseline.get(str(line)) or {}).get("avg_oee") or 0.55),
        urgent_volume_hl=urgent["volume_hl"],
        line_hl_per_hour=line_throughput,
    )

    return {
        "line": line,
        "anchor": anchor,
        "anchor_idx": anchor_idx,
        "transition_type": transition_type,
        "analogue": analogue,
        "cf_format_minutes": cf_format_minutes,
        "historical_actual_minutes": hist_actual_minutes,
        "pnp_minutes": pnp_minutes_for_breakdown,
        "previous_sku": prev_sku,
        "previous_envase": prev_envase,
        "previous_format_key": prev_format_key,
        "prev_marca": prev_marca,
        "same_format": same_format,
        "proposed": proposed,
    }


def _candidate_scores(
    candidate: Dict[str, Any],
    *,
    naive_oee: Optional[float],
    line_baseline_oee: Optional[float],
) -> Dict[str, float]:
    """Derive raw + adjusted scores for objective ranking and slot picking."""
    analogue = candidate["analogue"]
    analogue_mean = analogue.get("analogue_mean_oee")
    predicted = analogue_mean if analogue_mean is not None else (line_baseline_oee or 0.55)
    raw_gain_pts = ((predicted - naive_oee) * 100.0) if (naive_oee is not None) else 0.0

    penalty = float(analogue.get("scope_penalty_pts") or 0.0)
    if int(analogue.get("n") or 0) < 3:
        penalty += 1.0  # very small sample additional caution

    proposed = candidate["proposed"]
    orders_moved = int(proposed.get("ordersMoved") or 0)
    ghost_count = sum(len(v) for v in (proposed.get("ghosts") or {}).values())

    cf_min = candidate.get("cf_format_minutes") or 0.0
    hist_min = candidate.get("historical_actual_minutes") or 0.0
    overrun_min = max(0.0, hist_min - cf_min)
    recovery_h = _recovery_hours(candidate["transition_type"], analogue_mean, cf_min)

    adjusted_gain = raw_gain_pts - penalty
    disruption = orders_moved * 1.0 + ghost_count * 0.5 + recovery_h * 0.05 + penalty * 0.3
    time_score = float(cf_min) + overrun_min + recovery_h * 60.0 + orders_moved * 30.0

    return {
        "predicted_oee": round(float(predicted), 4),
        "raw_oee_gain_pts": round(raw_gain_pts, 2),
        "evidence_penalty_pts": round(penalty, 2),
        "adjusted_oee_gain_pts": round(adjusted_gain, 2),
        "disruption_score": round(disruption, 3),
        "time_score": round(time_score, 1),
        "recovery_hours": float(recovery_h),
        "orders_moved": int(orders_moved),
        "ghost_count": int(ghost_count),
    }


def build_recommendations(
    *,
    base_plan: Dict[str, List[Dict[str, Any]]],
    line_baseline: Dict[str, Dict[str, Any]],
    transition_stats: Dict[str, Dict[str, Any]],
    transitions: pd.DataFrame,
    cf,
    urgent: Dict[str, Any],
    products: List[Dict[str, Any]],
) -> Tuple[Dict[str, Any], Dict[str, str], Dict[int, Dict[str, Any]]]:
    """Build one recommendation per feasible line, after evaluating every slot.

    Returns (recommendations, infeasible_by_line, candidates_by_line).
    """
    cur_product = next((p for p in products if p["sku"] == urgent["productSku"]), {})
    cur_format_key = cur_product.get("format_key") or normalize_format(cur_product.get("format"))

    historical_lines = cur_product.get("historical_lines") or [14, 17, 19]
    naive_line = next((l for l in historical_lines if is_feasible(l, cur_format_key)), None)

    infeasible_by_line: Dict[str, str] = {}
    candidates_by_line: Dict[int, Dict[str, Any]] = {}
    all_candidates_by_line: Dict[int, List[Dict[str, Any]]] = {}

    # Pass A: enumerate every valid insertion slot per feasible line.
    for line in LINES:
        if not is_feasible(line, cur_format_key):
            infeasible_by_line[str(line)] = infeasibility_reason(line, cur_format_key) or (
                f"Line {line} cannot run this format."
            )
            continue

        line_segs = base_plan.get(str(line), [])
        valid_anchors = [
            (idx, seg) for idx, seg in enumerate(line_segs)
            if seg.get("kind") not in ("clean", "maint", "shift")
        ]
        if not valid_anchors:
            infeasible_by_line[str(line)] = (
                f"Line {line} has no valid production anchor in the current plan."
            )
            continue

        line_candidates = []
        for idx, anchor in valid_anchors:
            cand = _evaluate_candidate(
                line=line,
                anchor_idx=idx,
                anchor=anchor,
                base_plan=base_plan,
                transitions=transitions,
                transition_stats=transition_stats,
                line_baseline=line_baseline,
                cf=cf,
                urgent=urgent,
                cur_product=cur_product,
                cur_format_key=cur_format_key,
            )
            line_candidates.append(cand)
        all_candidates_by_line[line] = line_candidates

    # Naive baseline: analogue mean on the SKU's historically-most-common line,
    # using its first production anchor.
    naive_oee: Optional[float] = None
    if naive_line is not None and naive_line in all_candidates_by_line and all_candidates_by_line[naive_line]:
        first = all_candidates_by_line[naive_line][0]
        naive_oee = first["analogue"].get("analogue_mean_oee")
        if naive_oee is None:
            naive_oee = (line_baseline.get(str(naive_line)) or {}).get("avg_oee")

    # Pass B: score each candidate, pick the best per line.
    for line, candidates in all_candidates_by_line.items():
        line_base = (line_baseline.get(str(line)) or {}).get("avg_oee")
        scored = []
        for c in candidates:
            scores = _candidate_scores(c, naive_oee=naive_oee, line_baseline_oee=line_base)
            c["scores"] = scores
            scored.append(c)
        # Highest adjusted OEE gain wins; tie-break on lower disruption.
        scored.sort(key=lambda c: (-c["scores"]["adjusted_oee_gain_pts"], c["scores"]["disruption_score"]))
        best = scored[0]
        best["slots_evaluated"] = len(scored)
        candidates_by_line[line] = best

    # Pass C: build the recommendation contract objects.
    recommendations: Dict[str, Any] = {}
    for line, c in candidates_by_line.items():
        analogue = c["analogue"]
        analogue_mean_oee = analogue.get("analogue_mean_oee")
        line_base = (line_baseline.get(str(line)) or {}).get("avg_oee")
        cf_format_minutes = c["cf_format_minutes"]
        hist_actual_minutes = c["historical_actual_minutes"]
        pnp_min = c["pnp_minutes"]
        transition_type = c["transition_type"]
        anchor = c["anchor"]
        proposed = c["proposed"]
        scores = c["scores"]

        predicted_oee = scores["predicted_oee"]
        gain = (analogue_mean_oee - naive_oee) if (analogue_mean_oee is not None and naive_oee is not None) else None

        recovery_hours = scores["recovery_hours"]
        ins_seg = next(
            (s for s in proposed["plan"].get(str(line), []) if s.get("kind") == "ins"),
            None,
        )
        recovery_start = (float(ins_seg["start"]) + float(ins_seg["w"])) if ins_seg else 0.0
        recovery_width = max(1.0, float(recovery_hours))  # hours

        comps: List[str] = [t for t in transition_type.split("+") if t and t != "same-sku"]
        breakdown = build_changeover_breakdown(
            cf_format_minutes=cf_format_minutes,
            analogue_mean_oee=analogue_mean_oee,
            line_baseline_oee=line_base,
            transition_components=comps,
            historical_actual_minutes=hist_actual_minutes,
            cleaning_minutes_between=analogue.get("mean_cleaning_minutes_between"),
            had_cleaning_between_rate=analogue.get("had_cleaning_between_rate"),
            pnp_minutes=pnp_min,
            same_format=c["same_format"],
        )

        n = int(analogue["n"] or 0)
        scope = analogue["scope"]
        evidence_label = evidence_quality_label(n, scope)
        evidence_note = evidence_quality_note(n, scope)
        reason = _deterministic_reason(
            insertion_line=line,
            position=f"after {anchor['of']}",
            transition_type=transition_type,
            analogue_mean_oee=analogue_mean_oee,
            naive_oee=naive_oee,
            n=n,
            scope=scope,
            same_format=c["same_format"],
            transition_components=comps,
            cf_format_minutes=cf_format_minutes,
        )

        evidence = {
            "reason": reason,
            "qualityLabel": evidence_label,
            "riskNote": evidence_note if evidence_label in ("Limited", "Weak") else None,
            "scope": scope,
            "scopeLabel": _SCOPE_LABEL.get(scope, scope),
            "scopePenaltyPts": round(float(analogue.get("scope_penalty_pts") or 0.0), 2),
            "breakdown": breakdown,
            "analogues": analogue["analogues"],
            "n": n,
            "analogueMean": (f"{analogue_mean_oee:.3f}" if analogue_mean_oee is not None else "—"),
            "naiveMean": (f"{naive_oee:.3f}" if naive_oee is not None else "—"),
            "gain": _signed_pts(gain),
            "comparisonBasis": "Analogue mean OEE minus naive historical placement mean OEE.",
            "historicalWindow": "Executed 2025 production history.",
            "oeeComparison": {
                "metric": "comparative_oee_points",
                "analogueMean": _round_oee(analogue_mean_oee),
                "naiveMean": _round_oee(naive_oee),
                "gainPoints": round(float(gain) * 100.0, 1) if gain is not None else None,
                "lineHistoricalMean": _round_oee(line_base),
            },
            "lineBaselineOee": _round_oee(line_base),
            "transitionTypeStats": transition_stats.get(transition_type) or {},
            "transitionComponents": comps,
            "cfTheoreticalMinutes": _round_min(cf_format_minutes),
            "historicalActualChangeoverMinutes": _round_min(hist_actual_minutes),
            "meanCleaningMinutesBetween": analogue.get("mean_cleaning_minutes_between"),
            "hadCleaningBetweenRate": analogue.get("had_cleaning_between_rate"),
            "sameFormatTransition": c["same_format"],
            "limitations": [
                evidence_note,
                "Crew experience and shift staffing are not in the data.",
                "Downstream micro-stoppages may not be fully captured in PNP.",
                "Recovery hours are a modelled estimate, not a measurement.",
            ],
        }

        # Naive band (visual marker on the SKU's historical line, if different).
        naive_band = None
        if naive_line is not None and naive_line != line:
            naive_segs = base_plan.get(str(naive_line), [])
            naive_anchor = next(
                (s for s in naive_segs if s.get("kind") not in ("clean", "maint")), None
            )
            if naive_anchor:
                naive_band = {
                    "line": str(naive_line),
                    "start": round(float(naive_anchor["start"]) + float(naive_anchor["w"]), 2),
                    "w": round(float(proposed["insertion_hours"]), 2),
                }

        rec = {
            "line": f"Line {line}",
            "position": f"after {anchor['of']}",
            "oeeDelta": _signed_pts(gain),
            "oeeGood": (gain is None) or (gain >= 0),
            "deadline": "+~1 day" if proposed["ordersMoved"] > 0 else "on time",
            "ordersMoved": proposed["ordersMoved"],
            "naiveBand": naive_band,
            "plan": proposed["plan"],
            "ghosts": proposed["ghosts"],
            "recovery": {
                "line": str(line),
                "start": round(recovery_start, 2),
                "w": round(recovery_width, 2),
                "hours": int(round(recovery_hours)),
                "note": (
                    "Modelled estimate: hours for the line to return to baseline "
                    "OEE after the urgent insertion. Built from changeover + "
                    "transition-type tail; not a measurement."
                ),
            },
            "moves": proposed["moves"],
            "decision": (
                "ESCALATE" if gain is not None and gain < -0.02
                else "ACCEPT"
            ),
            "predictedOee": predicted_oee,
            "naivePredictedOee": (round(float(naive_oee), 4) if naive_oee is not None else None),
            "evidenceStrengthLabel": evidence_label,
            "transitionType": transition_type,
            "evidence": evidence,
            # Slot-search transparency (additive — not required by the contract).
            "candidateSlotsEvaluated": int(c["slots_evaluated"]),
            "selectedAnchorIndex": int(c["anchor_idx"]),
            "adjustedOeeGain": float(scores["adjusted_oee_gain_pts"]),
            "evidencePenaltyPts": float(scores["evidence_penalty_pts"]),
            "disruptionScore": float(scores["disruption_score"]),
            "timeScore": float(scores["time_score"]),
        }
        recommendations[str(line)] = rec

    return recommendations, infeasible_by_line, candidates_by_line


# ============================================================ objectives


def build_plan_review(
    base_plan: Dict[str, List[Dict[str, Any]]],
    line_baseline: Dict[str, Dict[str, Any]],
    transition_stats: Dict[str, Dict[str, Any]],
    transitions: pd.DataFrame,
    master_blocks: pd.DataFrame,
    cf,
) -> Dict[str, Any]:
    """Annotate the base plan with risk markers + scrub it for the cockpit.

    For every same-line, production→production transition in the forward
    plan, we attach:
      - transition_type (heuristic, from anchor/cur SKU+envase+familia attrs)
      - risk_level (none / low / med / high) based on the transition-type's
        historical OEE damage and the line baseline
      - cf_theoretical_minutes
      - line_transition_benchmark_oee (the mean OEE for this line+transition
        in history)
      - risk_reason — short, planner-readable

    The result is a per-line list of risky transitions and per-line summary
    counters the HeroStrip can consume directly.
    """
    risky_by_line: Dict[str, List[Dict[str, Any]]] = {"14": [], "17": [], "19": []}
    plan_health_components: List[float] = []
    total_risky = 0
    total_cleaning_heavy = 0

    if master_blocks is None or master_blocks.empty:
        return {
            "risky_by_line": risky_by_line,
            "plan_health_score": 50.0,
            "total_risky": 0,
            "total_cleaning_heavy": 0,
            "summary": "No master data — plan review unavailable.",
        }

    # Lookup: of → master row (for envase/familia/marca on plan OFs)
    of_lookup = {str(r["of"]): r for _, r in master_blocks.iterrows()}

    def _row_attrs(of: str) -> Dict[str, Optional[str]]:
        r = of_lookup.get(of)
        if r is None:
            return {"envase": None, "familia": None, "marca": None, "tipo_envase": None}
        return {
            "envase": (str(r.get("envase")) if pd.notna(r.get("envase")) else None),
            "tipo_envase": (str(r.get("tipo_envase")) if pd.notna(r.get("tipo_envase")) else None),
            "familia": (str(r.get("familia")) if pd.notna(r.get("familia")) else None),
            "marca": (str(r.get("marca")) if pd.notna(r.get("marca")) else None),
        }

    for line_str, segs in base_plan.items():
        line = int(line_str)
        production_segs = [s for s in segs if s.get("kind") not in ("clean", "maint")]
        for i in range(1, len(production_segs)):
            prev = production_segs[i - 1]
            cur = production_segs[i]
            prev_attrs = _row_attrs(prev["of"])
            cur_attrs = _row_attrs(cur["of"])
            prev_fk = normalize_format(prev_attrs["tipo_envase"]) or normalize_format(prev_attrs["envase"])
            cur_fk = normalize_format(cur_attrs["tipo_envase"]) or normalize_format(cur_attrs["envase"])

            t = _derive_transition_type_from_attrs(
                prev_attrs["envase"], cur_attrs["envase"],
                prev_attrs["marca"], cur_attrs["marca"],
                prev_attrs["familia"], cur_attrs["familia"],
                prev_fk, cur_fk,
            )

            stats = transition_stats.get(t, {})
            mean_oee = stats.get("mean_oee")
            damage = stats.get("mean_oee_damage_pts")
            line_base_oee = (line_baseline.get(line_str) or {}).get("avg_oee")
            mean_co = stats.get("mean_actual_changeover_minutes") or 0.0
            mean_limp = stats.get("mean_limpieza_minutes") or 0.0
            mean_pnp = stats.get("mean_pnp_minutes") or 0.0
            cf_minutes = cf.with_fallback(line, prev_fk, cur_fk) if cf else None

            # Risk scoring — simple and explainable
            risk_score = 0
            reasons: List[str] = []
            if damage is not None and damage <= -3:
                risk_score += 2
                reasons.append(f"This transition type historically loses {abs(damage):.1f} OEE pts vs the line baseline.")
            elif damage is not None and damage <= -1:
                risk_score += 1
                reasons.append(f"Slight OEE damage on average ({damage:.1f} pts).")

            if mean_co > 60:
                risk_score += 1
                reasons.append(f"Average actual changeover is {mean_co:.0f} min — above the 1-hour mark.")

            if mean_limp > 90:
                risk_score += 1
                reasons.append(f"Cleaning effort averages {mean_limp:.0f} min on this transition.")

            if mean_pnp > 180:
                risk_score += 1
                reasons.append(f"PNP / restart minutes average {mean_pnp:.0f} on this transition.")

            if not (prev_fk and cur_fk and prev_fk == cur_fk):
                # Format change — get the CF baseline if known
                if cf_minutes and cf_minutes >= 180:
                    risk_score += 1
                    reasons.append(f"Cross-format changeover — CF baseline is {int(cf_minutes)} min.")

            if risk_score >= 3:
                risk_level = "high"
            elif risk_score == 2:
                risk_level = "med"
            elif risk_score == 1:
                risk_level = "low"
            else:
                risk_level = "none"

            if risk_level != "none":
                total_risky += 1
                if mean_limp > 90 or (cf_minutes and cf_minutes >= 180):
                    total_cleaning_heavy += 1

            # Contribution to plan health: each risky transition costs a few points
            if risk_level == "high":
                plan_health_components.append(-7.0)
            elif risk_level == "med":
                plan_health_components.append(-3.0)
            elif risk_level == "low":
                plan_health_components.append(-1.0)

            if risk_level != "none":
                risky_by_line[line_str].append({
                    "previous_of": prev["of"],
                    "current_of": cur["of"],
                    "previous_sku": prev.get("sku"),
                    "current_sku": cur.get("sku"),
                    "marker_start": round(prev["start"] + prev["w"], 2),
                    "marker_w": round(cur["w"], 2),  # marker spans the current order
                    "transition_type": t,
                    "principal_label": stats.get("principal_label"),
                    "cf_theoretical_minutes": _round_min(cf_minutes),
                    "line_transition_benchmark_oee": _round_oee(mean_oee),
                    "line_baseline_oee": _round_oee(line_base_oee),
                    "oee_damage_pts": (round(damage, 1) if damage is not None else None),
                    "mean_actual_changeover_minutes": _round_min(mean_co),
                    "mean_limpieza_minutes": _round_min(mean_limp),
                    "mean_pnp_minutes": _round_min(mean_pnp),
                    "risk_level": risk_level,
                    "risk_reasons": reasons,
                    "cases": int(stats.get("cases", 0)),
                })

    plan_health_score = round(max(15.0, min(100.0, 100.0 + sum(plan_health_components))), 1)
    summary_bits: List[str] = []
    if total_risky:
        summary_bits.append(f"{total_risky} risky transitions across the plan")
    if total_cleaning_heavy:
        summary_bits.append(f"{total_cleaning_heavy} cleaning-heavy")
    if not summary_bits:
        summary_bits.append("No high-risk transitions detected in this plan window.")

    return {
        "risky_by_line": risky_by_line,
        "plan_health_score": plan_health_score,
        "total_risky": total_risky,
        "total_cleaning_heavy": total_cleaning_heavy,
        "summary": " · ".join(summary_bits),
    }


def build_manual_slots(
    *,
    base_plan: Dict[str, List[Dict[str, Any]]],
    recommendations: Dict[str, Any],
    infeasible_by_line: Dict[str, str],
    max_slots_per_line: int = 6,
) -> Dict[str, Dict[str, Any]]:
    """Per-slot verdict cards for hand-placed insertions.

    Key format follows the frontend convention:
      - "{line}-after-{anchor_of}"  → production-anchor slot
      - "{line}-end"                → end-of-queue slot

    Each value is { recKey, verdict, label, banner }. Verdicts:
      - "match"  : this slot matches the system's recommendation
      - "ok"     : feasible alternative slot
      - "worse"  : infeasible line (still surfaced so the UI can warn)
    """
    out: Dict[str, Dict[str, Any]] = {}

    # Infeasible lines: emit one "worse" slot so the UI can display the reason.
    for line, reason in infeasible_by_line.items():
        out[f"{line}-after"] = {
            "recKey": str(line),
            "verdict": "worse",
            "label": f"Line {line}",
            "banner": reason or f"Line {line} cannot run this format.",
        }

    for line, rec in recommendations.items():
        line_segs = [
            seg for seg in (base_plan.get(str(line)) or [])
            if seg.get("kind") not in ("clean", "maint", "shift")
        ]
        chosen_anchor_of = None
        position = str(rec.get("position") or "")
        if position.startswith("after "):
            chosen_anchor_of = position[len("after "):].strip()

        # Production-anchor slots
        for seg in line_segs[:max_slots_per_line]:
            anchor_of = str(seg.get("of") or "")
            if not anchor_of:
                continue
            is_match = anchor_of == chosen_anchor_of
            key = f"{line}-after-{anchor_of}"
            label = f"Line {line} · after {anchor_of}"
            if is_match:
                banner = "Recommended slot — best evidence-adjusted OEE on this line."
            else:
                banner = "Alternative slot on this line — feasible but not the chosen one."
            out[key] = {
                "recKey": str(line),
                "verdict": "match" if is_match else "ok",
                "label": label,
                "banner": banner,
            }

        # End-of-queue slot
        end_key = f"{line}-end"
        out[end_key] = {
            "recKey": str(line),
            "verdict": "ok",
            "label": f"Line {line} · end of queue",
            "banner": "End of queue — zero knock-on to scheduled orders.",
        }

    return out


def build_objectives(recs: Dict[str, Any]) -> Dict[str, Any]:
    if not recs:
        return {}
    items = list(recs.items())  # (line_key, rec)

    def by_oee_gain(it):
        # Adjusted gain (penalty-discounted) — preferred. Falls back to raw.
        adj = it[1].get("adjustedOeeGain")
        if adj is not None:
            return -float(adj)
        return -_signed_pts_value(it[1].get("oeeDelta"))

    def by_time(it):
        ts = it[1].get("timeScore")
        if ts is not None:
            return float(ts)
        # Fallback: orders moved + recovery hours
        return int(it[1].get("ordersMoved") or 0) * 30 + int((it[1].get("recovery") or {}).get("hours") or 0) * 60

    def by_disruption(it):
        ds = it[1].get("disruptionScore")
        if ds is not None:
            return float(ds)
        return float(it[1].get("ordersMoved") or 0)

    order_oee = [k for k, _ in sorted(items, key=by_oee_gain)]
    order_time = [k for k, _ in sorted(items, key=by_time)]
    order_dis = [k for k, _ in sorted(items, key=by_disruption)]

    def notes(kind: str) -> Dict[str, str]:
        out: Dict[str, str] = {}
        for k, r in items:
            gain = r.get("oeeDelta", "")
            moved = int(r.get("ordersMoved") or 0)
            if kind == "oee":
                msg = f"Expected OEE {gain} pts vs comparable naive history."
            elif kind == "time":
                msg = ("Nothing else moves — deadline respected." if moved == 0
                       else f"Shifts {moved} order(s) on Line {k}.")
            else:
                msg = ("Zero knock-on — nothing else moves." if moved == 0
                       else f"Shifts {moved} order(s) on Line {k}.")
            out[k] = msg
        return out

    return {
        "oee": {"label": "OEE", "icon": "◉", "order": order_oee, "notes": notes("oee")},
        "time": {"label": "Time", "icon": "◷", "order": order_time, "notes": notes("time")},
        "dis": {"label": "Disruption", "icon": "⇄", "order": order_dis, "notes": notes("dis")},
    }


# ============================================================ year compare


_MONTH_ABBREV = {
    1: "Jan", 2: "Feb", 3: "Mar", 4: "Apr", 5: "May", 6: "Jun",
    7: "Jul", 8: "Aug", 9: "Sep", 10: "Oct", 11: "Nov", 12: "Dec",
}


def _format_week_label(week_start, week_end, iso_year: int, iso_week: int) -> str:
    if week_start.month == week_end.month:
        span = f"{week_start.day}–{week_end.day} {_MONTH_ABBREV[week_start.month]}"
    else:
        span = (
            f"{week_start.day} {_MONTH_ABBREV[week_start.month]}–"
            f"{week_end.day} {_MONTH_ABBREV[week_end.month]}"
        )
    return f"Week {iso_week} · {span}"


def _week_metrics(
    df: pd.DataFrame,
    transitions: Optional[pd.DataFrame],
    iso_year: int,
    iso_week: int,
    line: int,
) -> Dict[str, float]:
    """Mean OEE, total HL, and changeover count for a (year, week, line)."""
    sub = df[(df["__iso_year"] == iso_year) & (df["__iso_week"] == iso_week) & (df["tren"] == line)]
    if sub.empty:
        return {"oee": 0.0, "vol": 0.0, "changes": 0.0}
    mean_oee = float(sub["oee"].dropna().mean()) if "oee" in sub.columns else 0.0
    vol = float(sub["hl"].dropna().sum()) if "hl" in sub.columns else 0.0
    changes = 0
    if transitions is not None and not transitions.empty and "date" in transitions.columns:
        tx = transitions.copy()
        tx["date"] = pd.to_datetime(tx["date"], errors="coerce")
        tx = tx.dropna(subset=["date"])
        if not tx.empty:
            tx["__iso_year"] = tx["date"].dt.isocalendar().year.astype(int)
            tx["__iso_week"] = tx["date"].dt.isocalendar().week.astype(int)
            changes = int(((tx["__iso_year"] == iso_year) & (tx["__iso_week"] == iso_week) & (tx["line"] == line)).sum())
    return {
        "oee": round(mean_oee, 3) if mean_oee == mean_oee else 0.0,
        "vol": round(vol, 1),
        "changes": float(changes),
    }


def build_year_compare(
    master_prod: pd.DataFrame,
    transitions: Optional[pd.DataFrame] = None,
) -> Dict[str, Any]:
    """Weekly compare strip: current ISO week vs same ISO week of previous year.

    Returned shape (matches the frontend contract):

        {
          "weekLabel": "Week 21 · 18–24 May",
          "lines": {
            "14": { "oeeNow": 0.62, "oeeLast": 0.58,
                     "volNow": 12345, "volLast": 11042,
                     "changesNow": 7,  "changesLast": 5 },
            ...
          }
        }

    "Current" means the most recent ISO week present in the data; "last"
    means the same ISO week one year earlier.
    """
    if (
        master_prod is None or master_prod.empty
        or "fecha_fin" not in master_prod.columns
    ):
        return {"weekLabel": "—", "lines": {}}

    df = master_prod.copy()
    df["fecha_fin"] = pd.to_datetime(df["fecha_fin"], errors="coerce")
    df = df.dropna(subset=["fecha_fin"])
    if df.empty:
        return {"weekLabel": "—", "lines": {}}

    iso = df["fecha_fin"].dt.isocalendar()
    df["__iso_year"] = iso.year.astype(int)
    df["__iso_week"] = iso.week.astype(int)

    # Pick the most recent (year, week) with data.
    latest_dt = df["fecha_fin"].max()
    iso_year = int(latest_dt.isocalendar().year)
    iso_week = int(latest_dt.isocalendar().week)

    # Compute week bounds for the label.
    week_start = pd.Timestamp.fromisocalendar(iso_year, iso_week, 1)
    week_end = pd.Timestamp.fromisocalendar(iso_year, iso_week, 7)
    week_label = _format_week_label(week_start, week_end, iso_year, iso_week)

    lines_out: Dict[str, Dict[str, float]] = {}
    for line in LINES:
        cur = _week_metrics(df, transitions, iso_year, iso_week, line)
        last = _week_metrics(df, transitions, iso_year - 1, iso_week, line)
        lines_out[str(line)] = {
            "oeeNow": cur["oee"],
            "oeeLast": last["oee"],
            "volNow": cur["vol"],
            "volLast": last["vol"],
            "changesNow": cur["changes"],
            "changesLast": last["changes"],
        }

    return {"weekLabel": week_label, "lines": lines_out}


# ============================================================ validation report


def _source_join_stats(master_blocks: pd.DataFrame, source: Optional[pd.DataFrame], of_candidates: List[str]) -> Dict[str, Any]:
    """Return lightweight join diagnostics for a raw side table."""
    if source is None or source.empty or master_blocks is None or master_blocks.empty:
        return {"available": False, "matched": 0, "total": int(len(master_blocks) if master_blocks is not None else 0), "duplicates": 0}

    of_col = data_loader._find_col(source, of_candidates)  # normalized helper; safe inside backend package
    if not of_col:
        return {"available": False, "matched": 0, "total": int(len(master_blocks)), "duplicates": 0}

    source_ofs = source[of_col].dropna().astype(str)
    unique_source_ofs = set(source_ofs)
    master_ofs = set(master_blocks["of"].dropna().astype(str)) if "of" in master_blocks.columns else set()
    return {
        "available": True,
        "matched": int(len(master_ofs & unique_source_ofs)),
        "total": int(len(master_ofs)),
        "duplicates": int(len(source_ofs) - len(unique_source_ofs)),
    }


def write_validation_report(
    *,
    master_blocks: pd.DataFrame,
    block_summary: Dict[str, Any],
    transitions: pd.DataFrame,
    join: Dict[str, Any],
    output_path: Path,
    processed_dir: Path,
    plan_info: Optional[Dict[str, Any]] = None,
    recommendations: Optional[Dict[str, Any]] = None,
) -> Path:
    """Persist a concise ingestion/contract report for demos and reviewers."""
    volumen_stats = _source_join_stats(master_blocks, data_loader.load_volumen(), ["of", "woid"])
    cambios_stats = _source_join_stats(master_blocks, data_loader.load_cambios(), ["of", "woid"])
    transitions_by_line = (
        transitions.groupby("line").size().to_dict()
        if transitions is not None and not transitions.empty and "line" in transitions.columns
        else {}
    )

    report_lines = [
        "LineWise Data Validation Report",
        "",
        f"OEE rows loaded: {join.get('oee_rows', len(master_blocks))}",
        f"Production blocks: {block_summary.get('production', 0)}",
        f"Cleaning blocks: {block_summary.get('clean', 0)}",
        f"Maintenance blocks: {block_summary.get('maint', 0)}",
        f"OEE values > 1.0 capped: {block_summary.get('oee_capped', 0)}",
        "",
        "WOID -> OF join:",
        f"Tiempo rows: {join.get('tiempo_rows', 'unavailable')}",
        f"Matched to OEE: {join.get('intersection_ofs', 'unavailable')}",
        f"Unmatched Tiempo rows: {join.get('only_in_tiempo', 'unavailable')}",
        "",
        "Volumen join:",
        f"Matched: {volumen_stats['matched']} / {volumen_stats['total']}",
        "",
        "Cambios join:",
        f"Matched: {cambios_stats['matched']} / {cambios_stats['total']}",
        f"Duplicate OFs collapsed: {cambios_stats['duplicates']}",
        "",
        "Transitions reconstructed:",
    ]
    for line in LINES:
        report_lines.append(f"Line {line}: {int(transitions_by_line.get(line, 0))}")

    if plan_info is not None:
        report_lines.extend([
            "",
            "basePlan source:",
            f"  source: {plan_info.get('source')}",
            f"  file:   {plan_info.get('file') or '—'}",
            f"  rows:   {plan_info.get('rows', 0)}",
        ])
        for warning in plan_info.get("warnings") or []:
            report_lines.append(f"  ! {warning}")

    if recommendations:
        report_lines.extend(["", "Recommendations (slot search):"])
        for line_key, rec in recommendations.items():
            slots = rec.get("candidateSlotsEvaluated")
            scope = (rec.get("evidence") or {}).get("scope")
            n = (rec.get("evidence") or {}).get("n")
            adj = rec.get("adjustedOeeGain")
            adj_text = f"{adj:+.2f} pts" if isinstance(adj, (int, float)) else "—"
            report_lines.append(
                f"  Line {line_key}: slots={slots}  scope={scope}  n={n}  adjusted_gain={adj_text}"
            )

    report_lines.extend([
        "",
        "data.json written:",
        str(output_path),
        "",
    ])

    report_path = processed_dir / "validation_report.txt"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text("\n".join(report_lines), encoding="utf-8")
    return report_path


# ============================================================ main


def _apply_path_overrides(raw_dir: Path, processed_dir: Path, output_dir: Path) -> None:
    """Push CLI-provided paths into the modules that hold them as module-level
    globals. Keeps the pipeline single-process and avoids env-var ordering issues.
    """
    from . import cf_matrix as _cf

    config.RAW_DIR = raw_dir
    config.PROCESSED_DIR = processed_dir
    config.OUTPUT_DIR = output_dir

    data_loader.RAW_DIR = raw_dir
    _cf.RAW_DIR = raw_dir
    _cf.CF_FILE = raw_dir / "Tabla CF Prat 2026_14_17_19.xlsx"

    processed_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)


def _parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate the LineWise frontend data contract (data.json).",
    )
    parser.add_argument(
        "--raw",
        default=str(config.RAW_DIR),
        help="Directory containing the source Excel files. Default: data/raw",
    )
    parser.add_argument(
        "--out",
        default=str(DEFAULT_OUTPUT_PATH),
        help="Output path for data.json. Default: data/output/data.json",
    )
    parser.add_argument(
        "--processed",
        default=str(config.PROCESSED_DIR),
        help="Directory for intermediate / report artifacts. Default: data/processed",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Echo extra diagnostics during the run.",
    )
    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = _parse_args(argv)
    raw_dir = Path(args.raw).expanduser().resolve()
    output_path = Path(args.out).expanduser().resolve()
    processed_dir = Path(args.processed).expanduser().resolve()
    output_dir = output_path.parent

    if not raw_dir.exists():
        print(
            f"✗ raw directory not found: {raw_dir}\n"
            "  Place the Damm Excel exports in this directory and rerun. "
            "See docs/HANDOFF.md for the file list.",
            file=sys.stderr,
            flush=True,
        )
        return 1

    _apply_path_overrides(raw_dir, processed_dir, output_dir)
    verbose = bool(args.verbose)
    if verbose:
        print(f"   raw_dir       = {raw_dir}", flush=True)
        print(f"   processed_dir = {processed_dir}", flush=True)
        print(f"   output_path   = {output_path}", flush=True)

    print("→ Step 1: verifying OF/WOID join", flush=True)
    try:
        oee_raw = pd.read_excel(raw_dir / "OEE 14_17_19_ 2025.xlsx")
        tiempo_raw = pd.read_excel(raw_dir / "Tiempo 14_17_19_ 2025.xlsx")
        join = verify_of_woid_join(oee_raw, tiempo_raw)
        print(
            f"   OEE={join['oee_rows']} · Tiempo={join['tiempo_rows']} · "
            f"shared={join['intersection_ofs']} · "
            f"OEE-only={join['only_in_oee']} · Tiempo-only={join['only_in_tiempo']} · "
            f"coverage={join['coverage_share']*100:.1f}% · "
            f"rename WOID→OF: {join['should_rename_woid_to_of']}",
            flush=True,
        )
    except Exception as e:
        print(f"   join check skipped: {e}", flush=True)
        join = {"ok": False}

    print("→ Step 2: loading master + classifying blocks", flush=True)
    master = data_loader.build_master_dataset()
    using_fallback = False
    if master is None or master.empty or len(master) < 20:
        print("   parsing yielded too little — falling back to synthetic", flush=True)
        master = sample_data.build_master()
        using_fallback = True

    master_blocks, block_summary = classify_blocks(master)
    print(
        f"   blocks: total={block_summary['rows_total']} · "
        f"production={block_summary['production']} · "
        f"clean={block_summary['clean']} · "
        f"maint={block_summary['maint']} · "
        f"other={block_summary['other']} · "
        f"oee_capped={block_summary['oee_capped']}",
        flush=True,
    )

    if using_fallback:
        # synthetic data has no Cambios columns; skip changeover annotation
        master_blocks["transition_type"] = "same-sku"
        master_blocks["principal_label"] = None
        master_blocks["transition_components"] = ""
    else:
        master_blocks = annotate_master(master_blocks)

    print("→ Step 4+5: building sequence + transition table (production-only)", flush=True)
    seq = build_sequence(master_blocks)
    transitions = seq["transitions"]
    print(f"   transitions: {len(transitions)}", flush=True)

    print("→ Step 6: loading CF matrix", flush=True)
    cf = load_cf_matrix()
    print(f"   CF loaded: {cf.loaded}", flush=True)

    print("→ Step 2 (cont.): products", flush=True)
    products = data_loader.get_products(master_blocks)
    if not products:
        products = sample_data.build_products()
    print(f"   products: {len(products)}", flush=True)

    print("→ Step 7: line baseline + transition-type stats", flush=True)
    master_prod = master_blocks[master_blocks["block_type"] == "production"].copy()
    line_baseline = build_line_baseline(transitions, master_prod)
    transition_stats = transition_type_stats(transitions, line_baseline)

    print("→ Step 10: executed history (from master)", flush=True)
    executed_history, historical_plan = build_executed_and_plan(master_blocks)

    print("→ Step 10b: forward plan from Planificado (with fallback)", flush=True)
    plan_info = load_forward_plan(raw_dir, master_blocks)
    if plan_info["by_line"] and all(plan_info["by_line"].get(str(l)) for l in LINES):
        base_plan = plan_info["by_line"]
        base_plan_source = "planificado"
        print(
            f"   basePlan source: planificado ({plan_info['rows']} rows from {Path(plan_info['file']).name})",
            flush=True,
        )
    else:
        base_plan = historical_plan
        base_plan_source = "historical_fallback"
        for warning in plan_info.get("warnings") or []:
            print(f"   ! {warning}", flush=True)
        print("   basePlan source: historical_fallback", flush=True)

    print("→ urgent orders", flush=True)
    urgents = build_urgent_orders(products)
    if not urgents:
        print("   no urgent orders could be built — aborting", flush=True)
        sys.exit(2)
    primary = urgents[0]
    print(f"   primary: {primary['of']} · {primary['sku']} ({primary['volume_hl']} HL, {primary.get('format_key')})", flush=True)

    print("→ Step 9: building recommendations", flush=True)
    recommendations, infeasible_by_line, candidates_by_line = build_recommendations(
        base_plan=base_plan,
        line_baseline=line_baseline,
        transition_stats=transition_stats,
        transitions=transitions,
        cf=cf,
        urgent=primary,
        products=products,
    )
    print(
        f"   recommendations: {sorted(recommendations.keys())} · "
        f"infeasible: {sorted(infeasible_by_line.keys()) or 'none'}",
        flush=True,
    )

    print("→ plan review risk overlay", flush=True)
    plan_review = build_plan_review(
        base_plan=base_plan,
        line_baseline=line_baseline,
        transition_stats=transition_stats,
        transitions=transitions,
        master_blocks=master_blocks,
        cf=cf,
    )
    print(
        f"   plan_health={plan_review['plan_health_score']} · "
        f"risky={plan_review['total_risky']} · "
        f"cleaning_heavy={plan_review['total_cleaning_heavy']}",
        flush=True,
    )

    print("→ objectives + year compare", flush=True)
    objectives = build_objectives(recommendations)
    year_compare = build_year_compare(master_prod, transitions)
    manual_slots = build_manual_slots(
        base_plan=base_plan,
        recommendations=recommendations,
        infeasible_by_line=infeasible_by_line,
    )

    line_centre = {str(l): "CF Prat" for l in LINES}
    exported_at = datetime.now(timezone.utc)
    timeline = build_timeline_metadata(base_plan, exported_at=exported_at)
    operational = load_operational_contract(timeline.get("anchorDate"))

    # Extend the planning horizon to end-of-year. Damm's Planificado
    # workbook only carries ~7 days of committed plan; this step fills
    # W23 onwards through 2026-12-31 with rotating slices of the 2025
    # Master OEE history per line, so every forward week is a different
    # real week (real OFs, real SKUs, real OEEs) — not a clone of W22.
    # The recommender + resequencer can then reason about the whole year.
    horizon_days = horizon_days_to_eoy(timeline.get("anchorDate"))
    anchor_dt = datetime.fromisoformat(timeline["anchorDate"]).date()
    historical_pool = build_historical_runs_pool(master_blocks)
    base_plan = project_forward_production(
        base_plan,
        target_horizon_days=horizon_days,
        cycle_period_days=7.0,
        historical_runs=historical_pool,
    )
    pool_sizes = ", ".join(f"L{k}={len(v)}" for k, v in historical_pool.items())
    print(
        f"   forward production projection: "
        f"tiled to {horizon_days}-day horizon (EOY {anchor_dt.year}-12-31) "
        f"from history pool [{pool_sizes}]",
        flush=True,
    )

    # Project every Tabla CF cadence row across the same horizon and
    # interleave the resulting service blocks into the (now extended)
    # basePlan. The contract (v2.3+) says clean/maint blocks live in
    # basePlan for the move-flow collision check; weeklyStops keeps
    # the per-line summary markers separately.
    projected_blocks = project_service_blocks(
        operational.get("cleaningSchedule") or {},
        anchor=anchor_dt,
        horizon_days=horizon_days,
    )
    for line, blocks in projected_blocks.items():
        lane = list(base_plan.get(line) or [])
        # Keep the blocks alongside production runs sorted by start so
        # the move flow can reason about gaps; the frontend already
        # discriminates production vs service by the `kind` field.
        merged = sorted(lane + list(blocks), key=lambda s: float(s.get("start") or 0.0))
        base_plan[line] = merged
    print(
        f"   service-block projection: "
        f"{sum(len(b) for b in projected_blocks.values())} blocks across {len(projected_blocks)} lines "
        f"({horizon_days}-day horizon)",
        flush=True,
    )

    payload: Dict[str, Any] = {
        "urgentOrders": urgents,
        "lineBaseline": line_baseline,
        "lineCentre": line_centre,
        "timeline": timeline,
        "lineRules": operational["lineRules"],
        "weeklyStops": operational["weeklyStops"],
        "yearCompare": year_compare,
        "executedHistory": executed_history,
        "basePlan": base_plan,
        "recommendations": recommendations,
        "objectives": objectives,
        "manualSlots": manual_slots,
        # additive metadata
        "metadata": {
            "contract_version": CONTRACT_VERSION,
            "exported_at": exported_at.isoformat(),
            "using_fallback_data": using_fallback,
            "master_rows": int(len(master_blocks)),
            "production_runs": block_summary["production"],
            "clean_blocks": block_summary["clean"],
            "maint_blocks": block_summary["maint"],
            "oee_capped": block_summary["oee_capped"],
            "transitions": int(len(transitions)),
            "cf_matrix_loaded": bool(cf.loaded),
            "primary_urgent_of": primary["of"],
            "join_check": join,
            "transition_type_stats": transition_stats,
            "basePlanSource": base_plan_source,
            "basePlanFile": plan_info.get("file"),
            "basePlanRows": plan_info.get("rows", 0),
            "basePlanWarnings": plan_info.get("warnings") or [],
            "cleaningSchedule": operational["cleaningSchedule"],
        },
        "infeasibleByLine": infeasible_by_line,
        "planReview": plan_review,
    }

    payload = _json_safe(payload)

    print("→ Step 12: validating contract", flush=True)
    ok, problems = validate(payload)
    if not ok:
        print("   ✗ contract validation failed:", flush=True)
        for p in problems:
            print(f"     - {p}", flush=True)
        return 3
    print("   ✔ contract OK", flush=True)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, default=str, ensure_ascii=False, allow_nan=False)
    report_path = write_validation_report(
        master_blocks=master_blocks,
        block_summary=block_summary,
        transitions=transitions,
        join=join,
        output_path=output_path,
        processed_dir=processed_dir,
        plan_info=plan_info,
        recommendations=recommendations,
    )

    # Per-recommendation analogue counts, for the terminal summary
    per_rec_n = {k: int((r.get("evidence") or {}).get("n") or 0) for k, r in recommendations.items()}

    print("", flush=True)
    print(f"✔ wrote {output_path}  ({output_path.stat().st_size/1024:.1f} KB)", flush=True)
    print(f"✔ validation report: {report_path}", flush=True)
    print("", flush=True)
    print("─── summary ─────────────────────────────────────────────", flush=True)
    print(f"  OEE rows loaded         : {join.get('oee_rows', len(master_blocks))}", flush=True)
    print(f"  Production blocks       : {block_summary['production']}", flush=True)
    print(f"  Cleaning blocks         : {block_summary['clean']}", flush=True)
    print(f"  Maintenance blocks      : {block_summary['maint']}", flush=True)
    print(f"  OEE values capped (>1.0): {block_summary['oee_capped']}", flush=True)
    coverage = join.get("coverage_share")
    if isinstance(coverage, (int, float)):
        print(f"  Tiempo WOID/OF match    : {coverage*100:.1f}%", flush=True)
    print(f"  Transitions             : {int(len(transitions))}", flush=True)
    print(f"  basePlan source         : {base_plan_source}", flush=True)
    print(f"  Recommendations         : {sorted(recommendations.keys()) or 'none'}", flush=True)
    if per_rec_n:
        analogues = ", ".join(f"L{k}: n={v}" for k, v in per_rec_n.items())
        print(f"  Analogues per rec       : {analogues}", flush=True)
    slot_counts = ", ".join(
        f"L{k}: slots={r.get('candidateSlotsEvaluated', 0)} (idx={r.get('selectedAnchorIndex')})"
        for k, r in recommendations.items()
    )
    if slot_counts:
        print(f"  Slot search             : {slot_counts}", flush=True)
    scope_dist = ", ".join(
        f"L{k}: {(r.get('evidence') or {}).get('scope')}"
        for k, r in recommendations.items()
    )
    if scope_dist:
        print(f"  Evidence scopes         : {scope_dist}", flush=True)
    print(f"  Output path             : {output_path}", flush=True)
    print("─────────────────────────────────────────────────────────", flush=True)
    print(f"  {summarize(payload)}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
