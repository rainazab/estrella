"""Operational rules from Tabla CF + hard line capabilities."""
from __future__ import annotations

from datetime import date

from app.cf_matrix import CF_FILE, load_operational_contract, project_service_blocks


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


# --- project_service_blocks --------------------------------------------------


def _row(kind: str, cadence: str, day: str, shift="3 turnos", dur=8.0):
    return {
        "kind": kind, "label": kind.title(), "cadence": cadence,
        "day": day, "shiftPattern": shift, "durationHours": dur,
        "source": "test",
    }


class TestProjectServiceBlocks:
    def test_semanal_emits_one_per_week_in_horizon(self):
        rows = {"14": [_row("clean", "semanal", "L")]}
        out = project_service_blocks(rows, anchor=date(2026, 5, 24), horizon_days=28)
        # Anchor 2026-05-24 (Sun). Mondays inside [2026-05-24, 2026-06-21]:
        # 05-25, 06-01, 06-08, 06-15 → 4 events.
        assert len(out["14"]) == 4
        assert out["14"][0]["start"] == 24.0       # one day from Sun → Mon
        assert all(b["cadence"] == "semanal" for b in out["14"])

    def test_quincenal_emits_every_two_weeks(self):
        rows = {"17": [_row("maint", "quincenal", "J")]}
        out = project_service_blocks(rows, anchor=date(2026, 5, 24), horizon_days=60)
        # Thursday on/after 2026-05-24 (Sun) is 2026-05-28; over 60d expect 5 (28, Jun 11, 25, Jul 9, 23).
        assert len(out["17"]) == 5
        starts_days = [b["start"] / 24 for b in out["17"]]
        # 14-day spacing between consecutive events
        for a, b in zip(starts_days, starts_days[1:]):
            assert b - a == 14.0

    def test_mensual_emits_one_per_calendar_month(self):
        rows = {"19": [_row("clean", "mensual", "L")]}
        out = project_service_blocks(rows, anchor=date(2026, 5, 24), horizon_days=90)
        # Touches May, Jun, Jul, Aug = 4 months. (May has no L on/after 5-24 *except* 5-25.)
        assert len(out["19"]) == 4

    def test_unknown_cadence_emits_one_marker(self):
        rows = {"14": [_row("clean", "anual", "L")]}
        out = project_service_blocks(rows, anchor=date(2026, 5, 24), horizon_days=90)
        assert len(out["14"]) == 1

    def test_event_id_is_stable_across_runs(self):
        rows = {"14": [_row("clean", "semanal", "L")]}
        out1 = project_service_blocks(rows, anchor=date(2026, 5, 24), horizon_days=14)
        out2 = project_service_blocks(rows, anchor=date(2026, 5, 24), horizon_days=14)
        assert [b["id"] for b in out1["14"]] == [b["id"] for b in out2["14"]]
        # IDs embed ISO date so re-runs don't collide and they sort naturally
        assert "2026-05-25" in out1["14"][0]["id"]

    def test_blocks_are_sorted_clean_before_maint_at_same_time(self):
        rows = {"14": [
            _row("maint", "semanal", "L"),
            _row("clean", "semanal", "L"),
        ]}
        out = project_service_blocks(rows, anchor=date(2026, 5, 24), horizon_days=7)
        same_start = [b for b in out["14"] if b["start"] == out["14"][0]["start"]]
        assert same_start[0]["kind"] == "clean"

    def test_blocks_carry_locked_and_lock_reason(self):
        rows = {"14": [_row("clean", "semanal", "L")]}
        out = project_service_blocks(rows, anchor=date(2026, 5, 24), horizon_days=7)
        block = out["14"][0]
        assert block["locked"] is True
        assert "semanal" in block["lockReason"].lower()
        # source is preserved verbatim from the Tabla CF row; defaults are
        # supplied only if the row didn't carry one.
        assert block["source"] == "test"

    def test_alternative_cadences_collapse_to_one_per_kind(self):
        """Tabla CF lists mensual / quincenal / semanal cleans for
        different shift patterns. They are alternatives, not additive
        events — only one shift pattern is active at a time. The
        projection should fire ONE cleaning cadence per Monday, not
        three stacked at the same hour."""
        rows = {"14": [
            _row("clean", "mensual",   "L", shift="1 turno"),
            _row("clean", "quincenal", "L", shift="2 turnos"),
            _row("clean", "semanal",   "L", shift="3 turnos"),
            _row("clean", "semanal",   "V", shift="5 turnos"),
            _row("maint", "quincenal", "L", shift="5 turnos"),
        ]}
        out = project_service_blocks(rows, anchor=date(2026, 5, 24), horizon_days=14)
        # Expect ONE cleaning cadence × occurrences + ONE maint cadence.
        clean_cadences = {b["cadence"] for b in out["14"] if b["kind"] == "clean"}
        maint_cadences = {b["cadence"] for b in out["14"] if b["kind"] == "maint"}
        assert clean_cadences == {"semanal"}, "should keep only the semanal clean"
        assert maint_cadences == {"quincenal"}
        # No two clean events should land at the same start hour.
        clean_starts = [b["start"] for b in out["14"] if b["kind"] == "clean"]
        assert len(clean_starts) == len(set(clean_starts)), "no stacking"

    def test_kind_with_only_non_preferred_cadence_still_kept(self):
        """A line whose only maintenance row is mensual (not the
        preferred quincenal) should still emit maintenance events —
        not silently lose the entire kind."""
        rows = {"14": [_row("maint", "mensual", "L", shift="1 turno")]}
        out = project_service_blocks(rows, anchor=date(2026, 5, 24), horizon_days=90)
        assert any(b["kind"] == "maint" for b in out["14"])
