"""Quality invariants — run against a generated data.json if present.

If `data/output/data.json` does not exist (eg. on a CI box with no raw data),
the tests skip cleanly rather than fail.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

DATA_JSON = Path(__file__).resolve().parents[1] / "data" / "output" / "data.json"


def _load_data():
    if not DATA_JSON.exists():
        pytest.skip(f"{DATA_JSON} not present — run scripts/run_export.sh first")
    def reject_constant(value: str):
        raise ValueError(value)

    with DATA_JSON.open("r", encoding="utf-8") as handle:
        return json.load(handle, parse_constant=reject_constant)


@pytest.fixture(scope="module")
def data():
    return _load_data()


class TestTopLevel:
    def test_data_json_is_strict_json(self):
        if not DATA_JSON.exists():
            pytest.skip(f"{DATA_JSON} not present — run scripts/run_export.sh first")

        def reject_constant(value: str):
            raise ValueError(value)

        json.loads(DATA_JSON.read_text(encoding="utf-8"), parse_constant=reject_constant)

    def test_has_all_required_top_level_keys(self, data):
        for key in (
            "urgentOrders", "lineBaseline", "lineCentre", "yearCompare",
            "timeline", "lineRules", "weeklyStops", "executedHistory",
            "basePlan", "recommendations", "objectives", "manualSlots",
        ):
            assert key in data, f"missing top-level key {key!r}"

    def test_three_lines_present(self, data):
        for key in ("lineBaseline", "executedHistory", "basePlan"):
            assert set(data[key].keys()) >= {"14", "17", "19"}


class TestSegments:
    def test_clean_maint_segments_have_no_oee_or_volume(self, data):
        for block_key in ("executedHistory", "basePlan"):
            for line, segments in (data.get(block_key) or {}).items():
                for idx, seg in enumerate(segments):
                    if seg.get("kind") in ("clean", "maint"):
                        assert "oee" not in seg, \
                            f"{block_key}.{line}[{idx}] is {seg['kind']!r} but has oee"
                        assert "vol" not in seg, \
                            f"{block_key}.{line}[{idx}] is {seg['kind']!r} but has vol"

    def test_production_segments_have_sku_and_vol(self, data):
        for block_key in ("executedHistory", "basePlan"):
            for line, segments in (data.get(block_key) or {}).items():
                for idx, seg in enumerate(segments):
                    if seg.get("kind") in ("clean", "maint"):
                        continue
                    assert "sku" in seg, f"{block_key}.{line}[{idx}] missing sku"
                    assert "vol" in seg, f"{block_key}.{line}[{idx}] missing vol"

    def test_segment_widths_are_positive(self, data):
        for block_key in ("executedHistory", "basePlan"):
            for line, segments in (data.get(block_key) or {}).items():
                for idx, seg in enumerate(segments):
                    assert float(seg.get("w", 0)) > 0, \
                        f"{block_key}.{line}[{idx}].w must be > 0"
                    assert float(seg.get("start", -1)) >= 0, \
                        f"{block_key}.{line}[{idx}].start must be >= 0"

    def test_weekly_stops_are_locked_nonproduction_blocks(self, data):
        for line in ("14", "17", "19"):
            stops = data.get("weeklyStops", {}).get(line)
            assert isinstance(stops, list), f"weeklyStops.{line} missing"
            assert stops, f"weeklyStops.{line} should include Tabla CF cleaning/maintenance"
            for idx, stop in enumerate(stops):
                assert stop.get("kind") in ("clean", "maint"), f"weeklyStops.{line}[{idx}] invalid kind"
                assert stop.get("locked") is True, f"weeklyStops.{line}[{idx}] should be locked"
                assert float(stop.get("w", 0)) > 0


class TestLineRules:
    def test_line_format_rules_match_ops_constraints(self, data):
        rules = data.get("lineRules") or {}
        labels = {
            line: {fmt["label"] for fmt in rules.get(line, {}).get("formats", [])}
            for line in ("14", "17", "19")
        }
        assert labels["14"] == {"50cl", "33cl"}
        assert labels["17"] == {"33cl"}
        assert labels["19"] == {"50cl", "33cl", "44cl"}


class TestRecommendations:
    def test_each_feasible_line_has_recommendation_or_infeasible(self, data):
        recs = data.get("recommendations") or {}
        infeasible = data.get("infeasibleByLine") or {}
        for line in ("14", "17", "19"):
            assert line in recs or line in infeasible, \
                f"line {line} has neither a recommendation nor an infeasible reason"

    def test_each_plan_has_exactly_one_inserted_segment(self, data):
        for line, rec in (data.get("recommendations") or {}).items():
            inserted = [
                seg
                for segs in (rec.get("plan") or {}).values()
                for seg in segs
                if seg.get("kind") == "ins"
            ]
            assert len(inserted) == 1, \
                f"recommendations.{line}.plan must have exactly one inserted segment"

    def test_all_analogues_have_oee_between_zero_and_one(self, data):
        for line, rec in (data.get("recommendations") or {}).items():
            for idx, analogue in enumerate((rec.get("evidence") or {}).get("analogues") or []):
                oee = analogue.get("oee")
                assert oee is not None, \
                    f"recommendations.{line}.evidence.analogues[{idx}].oee is missing"
                assert 0 <= float(oee) <= 1, \
                    f"recommendations.{line}.evidence.analogues[{idx}].oee={oee} out of range"


class TestObjectives:
    def test_objectives_reference_only_recommended_lines(self, data):
        recs = data.get("recommendations") or {}
        for objective_key, objective in (data.get("objectives") or {}).items():
            for line in (objective.get("order") or []):
                assert str(line) in recs, \
                    f"objectives.{objective_key}.order references non-recommended line {line!r}"
