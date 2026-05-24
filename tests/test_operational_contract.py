"""Operational rules from Tabla CF + hard line capabilities."""
from __future__ import annotations

from app.cf_matrix import CF_FILE, load_operational_contract


def test_line_rules_expose_locked_ops_constraints():
    contract = load_operational_contract("2026-05-24")
    labels = {
        line: [fmt["label"] for fmt in rule["formats"]]
        for line, rule in contract["lineRules"].items()
    }
    assert labels["14"] == ["50cl", "33cl"]
    assert labels["17"] == ["33cl"]
    assert labels["19"] == ["50cl", "33cl", "44cl"]


def test_tiempo_adicional_parser_extracts_weekly_stops():
    if not CF_FILE.exists():
        return
    contract = load_operational_contract("2026-05-24")
    stops = contract["weeklyStops"]

    for line in ("14", "17", "19"):
        kinds = {stop["kind"] for stop in stops[line]}
        assert {"clean", "maint"} <= kinds
        clean = next(stop for stop in stops[line] if stop["kind"] == "clean")
        assert clean["w"] == 8.0
        assert clean["cadence"] == "semanal"
