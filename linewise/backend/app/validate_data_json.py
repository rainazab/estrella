"""Strict CLI validation for the frontend data.json contract.

Run from backend/:

    python -m app.validate_data_json ../frontend/public/data.json
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any, Iterable

from .config import BASE_DIR, LINES
from .data_contract import (
    REQUIRED_EVIDENCE_FIELDS,
    REQUIRED_RECOMMENDATION_FIELDS,
    REQUIRED_TOP_LEVEL,
)

DEFAULT_DATA_JSON = BASE_DIR.parent / "frontend" / "public" / "data.json"
LINE_KEYS = [str(line) for line in LINES]
NON_PRODUCTION_KINDS = {"clean", "maint"}


class ValidationFailure(AssertionError):
    """Raised when the data.json payload violates the frontend contract."""


def _fail(problems: list[str], message: str) -> None:
    problems.append(message)


def _is_number(value: Any) -> bool:
    if isinstance(value, bool):
        return False
    try:
        number = float(value)
    except (TypeError, ValueError):
        return False
    return not math.isnan(number)


def _require_mapping(problems: list[str], value: Any, path: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        _fail(problems, f"{path} must be an object")
        return {}
    return value


def _require_list(problems: list[str], value: Any, path: str) -> list[Any]:
    if not isinstance(value, list):
        _fail(problems, f"{path} must be a list")
        return []
    return value


def _require_keys(problems: list[str], obj: dict[str, Any], required: Iterable[str], path: str) -> None:
    for key in required:
        if key not in obj:
            _fail(problems, f"{path} missing key {key!r}")


def _validate_segment(problems: list[str], segment: Any, path: str) -> None:
    if not isinstance(segment, dict):
        _fail(problems, f"{path} must be an object")
        return

    if not segment.get("of"):
        _fail(problems, f"{path} missing 'of'")

    start = segment.get("start")
    width = segment.get("w")
    if not _is_number(start) or float(start) < 0:
        _fail(problems, f"{path}.start must be >= 0")
    if not _is_number(width) or float(width) <= 0:
        _fail(problems, f"{path}.w must be > 0")

    if "oee" in segment:
        oee = segment.get("oee")
        if not _is_number(oee) or not (0 <= float(oee) <= 1):
            _fail(problems, f"{path}.oee must be between 0 and 1")

    kind = segment.get("kind")
    if kind in NON_PRODUCTION_KINDS:
        if "oee" in segment:
            _fail(problems, f"{path} is {kind!r} but includes OEE")
        if "vol" in segment:
            _fail(problems, f"{path} is {kind!r} but includes volume")
        return

    for key in ("sku", "vol"):
        if key not in segment:
            _fail(problems, f"{path} production segment missing {key!r}")


def _validate_line_segments(problems: list[str], block: Any, path: str) -> None:
    by_line = _require_mapping(problems, block, path)
    for line in LINE_KEYS:
        if line not in by_line:
            _fail(problems, f"{path} missing line {line}")
            continue
        for idx, segment in enumerate(_require_list(problems, by_line[line], f"{path}.{line}")):
            _validate_segment(problems, segment, f"{path}.{line}[{idx}]")


def original_plan_ofs(data: dict[str, Any]) -> set[str]:
    ofs: set[str] = set()
    base_plan = data.get("basePlan") or {}
    if not isinstance(base_plan, dict):
        return ofs
    for segments in base_plan.values():
        if not isinstance(segments, list):
            continue
        for segment in segments:
            if isinstance(segment, dict) and segment.get("of"):
                ofs.add(str(segment["of"]))
    return ofs


def validate_payload(data: dict[str, Any]) -> list[str]:
    problems: list[str] = []

    _require_keys(problems, data, REQUIRED_TOP_LEVEL, "data")
    for key in REQUIRED_TOP_LEVEL:
        if key not in data:
            return problems

    for key in ("lineBaseline", "executedHistory", "basePlan"):
        block = _require_mapping(problems, data.get(key), key)
        for line in LINE_KEYS:
            if line not in block:
                _fail(problems, f"{key} missing line {line}")

    _validate_line_segments(problems, data.get("executedHistory"), "executedHistory")
    _validate_line_segments(problems, data.get("basePlan"), "basePlan")

    recs = _require_mapping(problems, data.get("recommendations"), "recommendations")
    infeasible = data.get("infeasibleByLine") or {}
    if not isinstance(infeasible, dict):
        _fail(problems, "infeasibleByLine must be an object when present")
        infeasible = {}

    for line in LINE_KEYS:
        if line not in recs and line not in infeasible:
            _fail(problems, f"line {line} has neither a recommendation nor an infeasible reason")

    base_ofs = original_plan_ofs(data)
    for line, rec in recs.items():
        path = f"recommendations.{line}"
        if not isinstance(rec, dict):
            _fail(problems, f"{path} must be an object")
            continue

        _require_keys(problems, rec, REQUIRED_RECOMMENDATION_FIELDS, path)
        if str(line) in infeasible:
            _fail(problems, f"{path} exists but line is also marked infeasible")

        plan = _require_mapping(problems, rec.get("plan"), f"{path}.plan")
        for plan_line in LINE_KEYS:
            if plan_line not in plan:
                _fail(problems, f"{path}.plan missing line {plan_line}")
                continue
            for idx, segment in enumerate(_require_list(problems, plan[plan_line], f"{path}.plan.{plan_line}")):
                _validate_segment(problems, segment, f"{path}.plan.{plan_line}[{idx}]")

        inserted = [
            segment
            for segments in plan.values()
            if isinstance(segments, list)
            for segment in segments
            if isinstance(segment, dict) and segment.get("kind") == "ins"
        ]
        if len(inserted) != 1:
            _fail(problems, f"{path}.plan must include exactly one inserted urgent segment")

        ghosts = _require_mapping(problems, rec.get("ghosts"), f"{path}.ghosts")
        for ghost_line, ghost_list in ghosts.items():
            for idx, ghost in enumerate(_require_list(problems, ghost_list, f"{path}.ghosts.{ghost_line}")):
                if not isinstance(ghost, dict):
                    _fail(problems, f"{path}.ghosts.{ghost_line}[{idx}] must be an object")
                    continue
                if str(ghost.get("of")) not in base_ofs:
                    _fail(problems, f"{path}.ghosts.{ghost_line}[{idx}] references non-plan OF {ghost.get('of')!r}")

        for idx, move in enumerate(_require_list(problems, rec.get("moves"), f"{path}.moves")):
            if not isinstance(move, dict):
                _fail(problems, f"{path}.moves[{idx}] must be an object")
                continue
            if str(move.get("of")) not in base_ofs:
                _fail(problems, f"{path}.moves[{idx}] references non-plan OF {move.get('of')!r}")

        evidence = _require_mapping(problems, rec.get("evidence"), f"{path}.evidence")
        _require_keys(problems, evidence, REQUIRED_EVIDENCE_FIELDS, f"{path}.evidence")
        analogues = _require_list(problems, evidence.get("analogues"), f"{path}.evidence.analogues")
        if evidence.get("n") != len(analogues):
            _fail(problems, f"{path}.evidence.n does not match analogue count")
        for idx, analogue in enumerate(analogues):
            if not isinstance(analogue, dict):
                _fail(problems, f"{path}.evidence.analogues[{idx}] must be an object")
                continue
            for key in ("of", "line", "oee"):
                if analogue.get(key) in (None, ""):
                    _fail(problems, f"{path}.evidence.analogues[{idx}] missing {key!r}")
            if "oee" in analogue and (not _is_number(analogue["oee"]) or not (0 <= float(analogue["oee"]) <= 1)):
                _fail(problems, f"{path}.evidence.analogues[{idx}].oee must be between 0 and 1")

    objectives = _require_mapping(problems, data.get("objectives"), "objectives")
    for objective_key, objective in objectives.items():
        if not isinstance(objective, dict):
            _fail(problems, f"objectives.{objective_key} must be an object")
            continue
        order = _require_list(problems, objective.get("order"), f"objectives.{objective_key}.order")
        for idx, line in enumerate(order):
            line_key = str(line)
            if line_key not in recs:
                _fail(problems, f"objectives.{objective_key}.order[{idx}] references non-recommended line {line_key}")

    return problems


def load_payload(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise ValidationFailure("data.json root must be an object")
    return data


def validate_file(path: Path) -> None:
    data = load_payload(path)
    problems = validate_payload(data)
    if problems:
        raise ValidationFailure("\n".join(f"- {problem}" for problem in problems))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate frontend/public/data.json.")
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
        validate_file(path)
    except Exception as exc:
        print("data.json contract validation failed", file=sys.stderr)
        print(str(exc), file=sys.stderr)
        return 1

    print("\u2705 data.json contract valid")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
