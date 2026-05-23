"""Lightweight backtest for the LineWise recommendation logic.

The goal is a plausibility check: do the slots/lines the recommender ranks
highest actually have higher analogue OEE than a naive baseline picker?

Methodology:
  1. Sample up to N production rows from the historical master (production
     blocks only, with valid OEE + format).
  2. Treat each sampled row as a simulated urgent order — its SKU and format
     are the request.
  3. Rebuild candidate analogue scoring against the same transitions table,
     deliberately excluding the row itself (best-effort, identified by OF).
  4. The recommender's choice is the line + scope with the strongest
     analogue mean (after scope penalty).
  5. The naive baseline always picks the SKU's historically-most-common
     feasible line, no slot search, no scope penalty.
  6. Win = recommender's expected OEE > naive's expected OEE.

This is NOT a causal proof — there is overlap in the analogue pool. Leakage
makes the bar low; if the recommender doesn't comfortably win on a leaky
backtest there is something wrong with the scoring. The output report says
so plainly.
"""
from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path
from statistics import median
from typing import Any, Dict, List, Optional

import pandas as pd

from . import config, data_loader, sample_data
from .block_classifier import classify_blocks
from .changeover_typing import annotate_master
from .config import LINES
from .export_data_json import (
    SCOPE_PENALTY_PTS,
    evidence_quality_label,
    find_analogues,
)
from .line_rules import is_feasible, normalize_format
from .sequence_builder import build_sequence


def _ensure_master() -> Optional[pd.DataFrame]:
    master = data_loader.build_master_dataset()
    if master is None or master.empty or len(master) < 20:
        master = sample_data.build_master()
        master_blocks, _ = classify_blocks(master)
        master_blocks["transition_type"] = "same-sku"
        master_blocks["principal_label"] = None
        master_blocks["transition_components"] = ""
    else:
        master_blocks, _ = classify_blocks(master)
        master_blocks = annotate_master(master_blocks)
    return master_blocks


def _sample_targets(master_blocks: pd.DataFrame, n_cases: int, seed: int) -> pd.DataFrame:
    """Pick eligible production rows to use as simulated urgent orders."""
    prod = master_blocks[master_blocks["block_type"] == "production"].copy()
    if "oee" in prod.columns:
        prod = prod[prod["oee"].notna()]
    if "sku" in prod.columns:
        prod = prod[prod["sku"].astype(str).str.upper() != "DEFAULTVALUE"]
    # Need a normalizable format to score line feasibility
    src_col = "tipo_envase" if "tipo_envase" in prod.columns else (
        "envase" if "envase" in prod.columns else None
    )
    if src_col is None:
        return prod.iloc[0:0]
    prod["__fmt"] = prod[src_col].apply(lambda v: normalize_format(str(v)) if pd.notna(v) else None)
    prod = prod[prod["__fmt"].isin(["1/2", "1/3", "2/5"])]
    if prod.empty:
        return prod
    rng = random.Random(seed)
    indices = list(prod.index)
    rng.shuffle(indices)
    keep = indices[: min(n_cases, len(indices))]
    return prod.loc[keep].reset_index(drop=True)


def _historical_lines_for_sku(master_prod: pd.DataFrame, sku: str) -> List[int]:
    if master_prod is None or master_prod.empty or "sku" not in master_prod.columns:
        return list(LINES)
    sub = master_prod[master_prod["sku"].astype(str) == str(sku)]
    if sub.empty:
        return list(LINES)
    counts = sub["tren"].value_counts()
    return [int(l) for l in counts.index.tolist() if int(l) in LINES]


def _expected_oee_for(
    tt: pd.DataFrame,
    *,
    line: int,
    transition_type: str,
    sku: str,
    format_key: Optional[str],
    drop_of: Optional[str],
) -> Dict[str, Any]:
    """Recommender estimate for a (line, transition, sku) candidate."""
    pool = tt
    if drop_of and "current_of" in pool.columns:
        pool = pool[pool["current_of"].astype(str) != str(drop_of)]
    analogue = find_analogues(
        pool,
        line=line,
        transition_type=transition_type,
        previous_sku=None,
        current_sku=sku,
        cur_format_key=format_key,
        top_k=8,
        min_n=3,
    )
    mean_oee = analogue.get("analogue_mean_oee")
    scope = analogue.get("scope") or "no_match"
    penalty_pts = float(SCOPE_PENALTY_PTS.get(scope, 6.0))
    n = int(analogue.get("n") or 0)
    return {
        "line": int(line),
        "expected_oee": mean_oee,
        "adjusted_oee_pts": (
            mean_oee * 100.0 - penalty_pts if mean_oee is not None else None
        ),
        "scope": scope,
        "n": n,
        "label": evidence_quality_label(n, scope),
    }


def run_backtest(
    *,
    raw_dir: Path,
    n_cases: int = 50,
    seed: int = 42,
) -> Dict[str, Any]:
    """Execute the backtest and return a structured report.

    Reads raw data on demand — the caller already applied path overrides.
    """
    master_blocks = _ensure_master()
    if master_blocks is None or master_blocks.empty:
        return {
            "status": "no_data",
            "message": "No master data could be loaded from data/raw/",
        }

    seq = build_sequence(master_blocks)
    transitions: pd.DataFrame = seq["transitions"]
    if transitions is None or transitions.empty:
        return {"status": "no_transitions", "message": "Empty transition table."}

    master_prod = master_blocks[master_blocks["block_type"] == "production"].copy()
    targets = _sample_targets(master_blocks, n_cases, seed)
    if targets.empty:
        return {"status": "no_targets", "message": "No eligible production rows to sample."}

    wins = 0
    ties = 0
    losses = 0
    naive_wins = 0
    active_cases = 0
    active_wins = 0
    active_losses = 0
    uplifts: List[float] = []
    active_uplifts: List[float] = []
    evidence_ns: List[int] = []
    weak_count = 0
    scope_counts: Dict[str, int] = {}
    examples: List[Dict[str, Any]] = []

    for _, row in targets.iterrows():
        sku = str(row.get("sku"))
        of = str(row.get("of"))
        format_key = row.get("__fmt")
        transition_type = str(row.get("transition_type") or "same-sku")

        historical_lines = _historical_lines_for_sku(master_prod, sku)
        feasible_lines = [
            l for l in historical_lines if is_feasible(l, format_key)
        ] or [l for l in LINES if is_feasible(l, format_key)]
        if not feasible_lines:
            continue
        naive_line = feasible_lines[0]

        # Score every feasible line; pick best by adjusted OEE
        scored = [
            _expected_oee_for(
                transitions,
                line=line,
                transition_type=transition_type,
                sku=sku,
                format_key=format_key,
                drop_of=of,
            )
            for line in feasible_lines
        ]
        scored = [s for s in scored if s.get("expected_oee") is not None]
        if not scored:
            continue

        rec = max(scored, key=lambda s: s.get("adjusted_oee_pts") or -1e9)
        naive = next((s for s in scored if s["line"] == naive_line), scored[0])

        rec_oee = float(rec.get("expected_oee") or 0.0)
        naive_oee = float(naive.get("expected_oee") or 0.0)
        delta = rec_oee - naive_oee

        if rec_oee > naive_oee + 1e-6:
            wins += 1
        elif rec_oee < naive_oee - 1e-6:
            losses += 1
            naive_wins += 1
        else:
            ties += 1

        if int(rec.get("line", -1)) != int(naive_line):
            active_cases += 1
            active_uplifts.append(delta * 100.0)
            if rec_oee > naive_oee + 1e-6:
                active_wins += 1
            elif rec_oee < naive_oee - 1e-6:
                active_losses += 1

        uplifts.append(delta * 100.0)
        n = int(rec.get("n") or 0)
        evidence_ns.append(n)
        if rec.get("label") in ("Limited", "Weak"):
            weak_count += 1
        scope = rec.get("scope") or "no_match"
        scope_counts[scope] = scope_counts.get(scope, 0) + 1

        if len(examples) < 8:
            examples.append({
                "sku": sku,
                "of_excluded": of,
                "transition_type": transition_type,
                "format": format_key,
                "naive_line": naive_line,
                "naive_oee": round(naive_oee, 3),
                "recommended_line": rec.get("line"),
                "recommended_oee": round(rec_oee, 3),
                "delta_pts": round(delta * 100.0, 2),
                "scope": scope,
                "n": n,
            })

    cases_tested = wins + losses + ties
    if cases_tested == 0:
        return {"status": "no_cases_scored", "message": "All sampled cases were skipped."}

    win_rate = wins / cases_tested
    avg_uplift = sum(uplifts) / cases_tested
    med_n = int(median(evidence_ns)) if evidence_ns else 0
    weak_rate = weak_count / cases_tested

    active_win_rate = (active_wins / active_cases) if active_cases else 0.0
    active_avg_uplift = (sum(active_uplifts) / active_cases) if active_cases else 0.0

    return {
        "status": "ok",
        "cases_tested": cases_tested,
        "recommendation_win_rate": round(win_rate, 3),
        "tie_rate": round(ties / cases_tested, 3),
        "loss_rate": round(losses / cases_tested, 3),
        "avg_expected_oee_uplift_points": round(avg_uplift, 2),
        "active_cases": active_cases,
        "active_win_rate": round(active_win_rate, 3),
        "active_loss_rate": round((active_losses / active_cases) if active_cases else 0.0, 3),
        "active_avg_uplift_points": round(active_avg_uplift, 2),
        "median_evidence_n": med_n,
        "weak_evidence_rate": round(weak_rate, 3),
        "scope_distribution": scope_counts,
        "examples": examples,
        "notes": (
            "Backtest is a plausibility check, not a causal proof. Many SKUs "
            "are line-locked (the SKU only ever ran on one feasible line), so "
            "the recommender and the naive baseline agree most of the time. "
            "active_cases counts the rows where the recommender chose a "
            "different line than naive; on those the win/loss numbers are the "
            "discriminating signal. The analogue pool overlaps with the target "
            "rows even after best-effort exclusion by OF — leakage tends to "
            "inflate win rate. A clean zero in active_loss_rate under leaky "
            "conditions still tells us the recommender does not strictly "
            "underperform the naive baseline."
        ),
    }


def _write_text_report(report: Dict[str, Any], path: Path) -> None:
    lines = ["LineWise Backtest Report", ""]
    if report.get("status") != "ok":
        lines.append(f"Status: {report.get('status')} — {report.get('message', '')}")
        path.write_text("\n".join(lines), encoding="utf-8")
        return
    lines.extend([
        f"Cases tested            : {report['cases_tested']}",
        f"Recommendation win rate : {report['recommendation_win_rate']*100:.1f}%",
        f"Tie rate                : {report['tie_rate']*100:.1f}%",
        f"Loss rate               : {report['loss_rate']*100:.1f}%",
        f"Average OEE uplift      : {report['avg_expected_oee_uplift_points']:+.2f} pts",
        f"Active cases (rec ≠ naive line): {report['active_cases']}",
        f"Active win rate         : {report['active_win_rate']*100:.1f}%",
        f"Active loss rate        : {report['active_loss_rate']*100:.1f}%",
        f"Active avg uplift       : {report['active_avg_uplift_points']:+.2f} pts",
        f"Median evidence n       : {report['median_evidence_n']}",
        f"Weak evidence rate      : {report['weak_evidence_rate']*100:.1f}%",
        "",
        "Scope distribution:",
    ])
    for scope, count in sorted(report["scope_distribution"].items(), key=lambda kv: -kv[1]):
        lines.append(f"  {scope:28s} {count}")
    lines.extend(["", "Sample cases:"])
    for ex in report["examples"]:
        lines.append(
            f"  sku={ex['sku']!s:24s} naive={ex['naive_line']}({ex['naive_oee']:.2f})"
            f"  rec={ex['recommended_line']}({ex['recommended_oee']:.2f})"
            f"  Δ={ex['delta_pts']:+.2f}pts  scope={ex['scope']}  n={ex['n']}"
        )
    lines.extend(["", "Notes:", "  " + report["notes"]])
    path.write_text("\n".join(lines), encoding="utf-8")


def _parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the LineWise plausibility backtest.")
    parser.add_argument("--raw", default=str(config.RAW_DIR),
                        help="Directory containing the source Excel files.")
    parser.add_argument("--processed", default=str(config.PROCESSED_DIR),
                        help="Directory for the txt report.")
    parser.add_argument("--out", default=str(config.PROCESSED_DIR / "backtest_report.json"),
                        help="JSON output path.")
    parser.add_argument("--cases", type=int, default=50,
                        help="Max number of historical rows to backtest.")
    parser.add_argument("--seed", type=int, default=42, help="RNG seed.")
    return parser.parse_args(argv)


def _apply_overrides(raw_dir: Path, processed_dir: Path) -> None:
    from . import cf_matrix as _cf

    config.RAW_DIR = raw_dir
    config.PROCESSED_DIR = processed_dir
    data_loader.RAW_DIR = raw_dir
    _cf.RAW_DIR = raw_dir
    _cf.CF_FILE = raw_dir / "Tabla CF Prat 2026_14_17_19.xlsx"
    processed_dir.mkdir(parents=True, exist_ok=True)


def main(argv: Optional[List[str]] = None) -> int:
    args = _parse_args(argv)
    raw_dir = Path(args.raw).expanduser().resolve()
    processed_dir = Path(args.processed).expanduser().resolve()
    out_json = Path(args.out).expanduser().resolve()

    if not raw_dir.exists():
        print(
            f"✗ raw directory not found: {raw_dir}\n"
            "  Drop the Damm Excel exports into this directory and rerun.",
            file=sys.stderr,
        )
        return 1

    _apply_overrides(raw_dir, processed_dir)

    try:
        report = run_backtest(raw_dir=raw_dir, n_cases=args.cases, seed=args.seed)
    except Exception as exc:  # pragma: no cover - defensive
        print(f"backtest crashed: {exc}", file=sys.stderr)
        return 2

    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    txt_path = out_json.with_suffix(".txt") if out_json.suffix == ".json" else (processed_dir / "backtest_report.txt")
    _write_text_report(report, txt_path)

    status = report.get("status")
    if status != "ok":
        print(f"backtest status: {status} — {report.get('message', '')}")
        return 0

    print("─── backtest ─────────────────────────────────────────")
    print(f"  cases_tested            : {report['cases_tested']}")
    print(f"  recommendation_win_rate : {report['recommendation_win_rate']*100:.1f}%")
    print(f"  avg_oee_uplift          : {report['avg_expected_oee_uplift_points']:+.2f} pts")
    print(f"  active_cases            : {report['active_cases']}")
    print(f"  active_win_rate         : {report['active_win_rate']*100:.1f}%")
    print(f"  active_loss_rate        : {report['active_loss_rate']*100:.1f}%")
    print(f"  active_avg_uplift       : {report['active_avg_uplift_points']:+.2f} pts")
    print(f"  median_evidence_n       : {report['median_evidence_n']}")
    print(f"  weak_evidence_rate      : {report['weak_evidence_rate']*100:.1f}%")
    print(f"  json: {out_json}")
    print(f"  txt : {txt_path}")
    print("──────────────────────────────────────────────────────")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
