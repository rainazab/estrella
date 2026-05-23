"""Validate backend model/data invariants against the emitted data.json."""
from __future__ import annotations

import argparse
import math
import re
import sys
from pathlib import Path
from typing import Any

import pandas as pd

from . import data_loader, sample_data
from .block_classifier import classify_blocks
from .changeover_typing import annotate_master
from .config import BASE_DIR, LINES
from .export_data_json import build_line_baseline
from .line_rules import is_feasible
from .sequence_builder import build_sequence
from .validate_data_json import ValidationFailure, load_payload, original_plan_ofs, validate_payload

DEFAULT_DATA_JSON = BASE_DIR.parent / "frontend" / "public" / "data.json"


def _parse_float(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        number = float(value)
        return None if math.isnan(number) else number
    text = str(value).strip()
    if not text or text in {"-", "--"}:
        return None
    if text in {"\u2014"}:
        return None
    text = text.replace("\u2212", "-").replace("+", "")
    match = re.search(r"-?\d+(?:\.\d+)?", text)
    if not match:
        return None
    return float(match.group(0))


def _assert(problems: list[str], condition: bool, message: str) -> None:
    if not condition:
        problems.append(message)


def _compiled_history() -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
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
    sequence = build_sequence(master_blocks)
    transitions = sequence["transitions"]
    production_runs = master_blocks[master_blocks["block_type"] == "production"].copy()
    return master_blocks, production_runs, transitions


def _validate_baselines(problems: list[str], data: dict[str, Any], master_blocks: pd.DataFrame, production_runs: pd.DataFrame, transitions: pd.DataFrame) -> None:
    baseline = build_line_baseline(transitions, production_runs)
    exported = data.get("lineBaseline") or {}

    non_production = master_blocks[master_blocks["block_type"] != "production"]
    if "oee" in non_production.columns:
        contaminated = non_production["oee"].dropna()
        if not contaminated.empty:
            for line in LINES:
                line_key = str(line)
                prod_mean = production_runs[production_runs["tren"] == line]["oee"].dropna().mean()
                all_mean = master_blocks[master_blocks["tren"] == line]["oee"].dropna().mean()
                if pd.notna(prod_mean) and pd.notna(all_mean) and round(float(prod_mean), 3) != round(float(all_mean), 3):
                    break
            else:
                _assert(problems, False, "non-production rows have OEE values but baseline contamination could not be ruled out")

    for line in LINES:
        line_key = str(line)
        manual = production_runs[production_runs["tren"] == line]["oee"].dropna().mean()
        manual_rounded = round(float(manual), 3) if pd.notna(manual) else None
        computed = (baseline.get(line_key) or {}).get("avg_oee")
        emitted = (exported.get(line_key) or {}).get("avg_oee")
        _assert(
            problems,
            computed == manual_rounded,
            f"Line {line} baseline {computed!r} does not match production-only manual mean {manual_rounded!r}",
        )
        _assert(
            problems,
            emitted == manual_rounded,
            f"data.json lineBaseline[{line_key}].avg_oee {emitted!r} does not match production-only manual mean {manual_rounded!r}",
        )


def _validate_line_rules(problems: list[str]) -> None:
    expected = [
        (17, "1/3", True),
        (17, "1/2", False),
        (17, "2/5", False),
        (14, "1/3", True),
        (14, "1/2", True),
        (14, "2/5", False),
        (19, "1/3", True),
        (19, "1/2", True),
        (19, "2/5", True),
    ]
    for line, format_key, want in expected:
        _assert(
            problems,
            is_feasible(line, format_key) is want,
            f"is_feasible({line}, {format_key!r}) returned {not want}",
        )


def _validate_analogues(problems: list[str], data: dict[str, Any], production_runs: pd.DataFrame) -> None:
    runs = production_runs.copy()
    runs["of"] = runs["of"].astype(str)
    valid_ofs = set(runs["of"])
    oee_by_of = runs.drop_duplicates(subset=["of"], keep="last").set_index("of")["oee"].to_dict()

    for rec_key, rec in (data.get("recommendations") or {}).items():
        evidence = rec.get("evidence") or {}
        analogues = evidence.get("analogues") or []
        for idx, analogue in enumerate(analogues):
            of = str(analogue.get("of"))
            _assert(problems, of in valid_ofs, f"recommendations.{rec_key}.evidence.analogues[{idx}] references fake OF {of!r}")
            if of in oee_by_of:
                expected = _parse_float(oee_by_of[of])
                actual = _parse_float(analogue.get("oee"))
                _assert(
                    problems,
                    expected is not None and actual is not None and abs(actual - expected) < 0.01,
                    f"recommendations.{rec_key}.evidence.analogues[{idx}].oee {actual!r} does not match real OEE {expected!r}",
                )


def _validate_recommendations(problems: list[str], data: dict[str, Any]) -> None:
    for rec_key, rec in (data.get("recommendations") or {}).items():
        evidence = rec.get("evidence") or {}
        analogues = evidence.get("analogues") or []
        n = int(evidence.get("n") or 0)
        _assert(problems, n > 0, f"recommendations.{rec_key}.evidence.n must be > 0")
        _assert(problems, len(analogues) > 0, f"recommendations.{rec_key}.evidence.analogues must not be empty")
        if n < 5:
            reason = str(evidence.get("reason") or "").lower()
            limitations = " ".join(str(v).lower() for v in evidence.get("limitations") or [])
            _assert(
                problems,
                "limited" in reason or "limited" in limitations,
                f"recommendations.{rec_key} has low evidence but does not say it is limited",
            )

        analogue_mean = _parse_float(evidence.get("analogueMean"))
        naive_mean = _parse_float(evidence.get("naiveMean"))
        gain = _parse_float(evidence.get("gain"))
        if analogue_mean is not None and naive_mean is not None and gain is not None:
            expected_gain = (analogue_mean - naive_mean) * 100.0
            _assert(
                problems,
                abs(gain - expected_gain) < 0.2,
                f"recommendations.{rec_key}.evidence.gain {gain:.2f} != analogueMean - naiveMean ({expected_gain:.2f})",
            )
        _assert(
            problems,
            str(rec.get("oeeDelta")) == str(evidence.get("gain")),
            f"recommendations.{rec_key}.oeeDelta does not match evidence.gain",
        )

    primary_urgent = ((data.get("urgentOrders") or [{}])[0] or {})
    urgent_format = primary_urgent.get("format_key")
    for objective_key, objective in (data.get("objectives") or {}).items():
        order = objective.get("order") or []
        if not order:
            continue
        winner = str(order[0])
        if urgent_format:
            _assert(
                problems,
                is_feasible(int(winner), urgent_format),
                f"objectives.{objective_key}.order[0] selects infeasible line {winner} for format {urgent_format}",
            )
        if urgent_format == "1/2":
            _assert(problems, winner != "17", "Line 17 must not win for urgent format 1/2")


def _validate_timelines(problems: list[str], data: dict[str, Any]) -> None:
    base_ofs = original_plan_ofs(data)
    for rec_key, rec in (data.get("recommendations") or {}).items():
        inserted = [
            segment
            for segments in (rec.get("plan") or {}).values()
            for segment in (segments or [])
            if isinstance(segment, dict) and segment.get("kind") == "ins"
        ]
        _assert(problems, len(inserted) == 1, f"recommendations.{rec_key}.plan must have exactly one inserted urgent segment")
        for move in rec.get("moves") or []:
            _assert(problems, str(move.get("of")) in base_ofs, f"recommendations.{rec_key}.moves references non-plan OF {move.get('of')!r}")
        for ghost_line, ghosts in (rec.get("ghosts") or {}).items():
            for ghost in ghosts or []:
                _assert(
                    problems,
                    str(ghost.get("of")) in base_ofs,
                    f"recommendations.{rec_key}.ghosts.{ghost_line} references non-plan OF {ghost.get('of')!r}",
                )


def validate_model_outputs(data_path: Path) -> list[str]:
    data = load_payload(data_path)
    problems = validate_payload(data)

    master_blocks, production_runs, transitions = _compiled_history()
    _validate_baselines(problems, data, master_blocks, production_runs, transitions)
    _validate_line_rules(problems)
    _validate_analogues(problems, data, production_runs)
    _validate_recommendations(problems, data)
    _validate_timelines(problems, data)

    return problems


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate backend model output invariants.")
    parser.add_argument(
        "path",
        nargs="?",
        default=str(DEFAULT_DATA_JSON),
        help="Path to data.json. Defaults to ../frontend/public/data.json.",
    )
    args = parser.parse_args(argv)

    path = Path(args.path).expanduser()
    if not path.is_absolute():
        path = Path.cwd() / path

    try:
        problems = validate_model_outputs(path)
        if problems:
            raise ValidationFailure("\n".join(f"- {problem}" for problem in problems))
    except Exception as exc:
        print("model output validation failed", file=sys.stderr)
        print(str(exc), file=sys.stderr)
        return 1

    print("\u2705 OEE baselines valid")
    print("\u2705 cleaning rows excluded from OEE stats")
    print("\u2705 analogues are real OFs")
    print("\u2705 line eligibility rules enforced")
    print("\u2705 timeline segments valid")
    print("\u2705 recommendations valid")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
