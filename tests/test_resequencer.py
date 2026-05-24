"""Unit tests for the global re-sequencer."""
from __future__ import annotations

import pytest

from app import resequencer as rs


# A miniature transition_type_stats that mimics the recommender's output.
# Numbers are chosen so the algorithm has a clear preference order:
#   same-sku (good) > brand (mid) > volume (bad)
STATS = {
    "same-sku":         {"n": 100, "mean_oee": 0.60},
    "brand":            {"n": 80,  "mean_oee": 0.45},
    "volume":           {"n": 50,  "mean_oee": 0.25},
    "brand+volume":     {"n": 30,  "mean_oee": 0.20},
    "primary_pack":     {"n": 40,  "mean_oee": 0.40},
    "multi":            {"n": 100, "mean_oee": 0.30},
}


def _seg(of, sku=None, fmt=None, start=0.0, w=4.0, oee=0.5):
    return {
        "of": of, "sku": sku or of, "format_key": fmt or "1/3",
        "start": float(start), "w": float(w), "oee": float(oee),
    }


def _svc(kind, start, w=8.0):
    return {"kind": kind, "start": float(start), "w": float(w), "locked": True}


class TestTransitionTypeDerivation:
    def test_same_of_is_same_sku(self):
        a = _seg("ED13LTNN")
        assert rs.derive_transition_type(a, a) == "same-sku"

    def test_different_brand_prefix_is_brand(self):
        ed = _seg("ED13LTNN", fmt="1/3")
        xi = _seg("XI13LTNN", fmt="1/3")
        assert rs.derive_transition_type(ed, xi) == "brand"

    def test_format_change_is_volume(self):
        a = _seg("ED13LTNN", fmt="1/3")  # 33cl
        b = _seg("ED12LTNN", fmt="1/2")  # 50cl
        # same brand prefix (ED), different format → volume only
        assert rs.derive_transition_type(a, b) == "volume"

    def test_brand_plus_volume_sorted_correctly(self):
        a = _seg("ED13LTNN", fmt="1/3")
        b = _seg("XI12LTNN", fmt="1/2")
        # both brand and volume change → brand+volume (alphabetical via _TAG_ORDER)
        assert rs.derive_transition_type(a, b) == "brand+volume"

    def test_primary_pack_detected_from_sku(self):
        a = _seg("ED13LT", sku="ESTRELLA 33CL LATA", fmt="1/3")
        b = _seg("ED13BO", sku="ESTRELLA 33CL BOTELLA", fmt="1/3")
        assert rs.derive_transition_type(a, b) == "primary_pack"

    def test_unknown_of_falls_back_to_product(self):
        a = _seg("ED13LTNN")
        b = _seg("ED13LTAB")  # different OF, same brand+format, no SKU hints
        # nothing observable changed → "product" placeholder so it doesn't
        # get the same-sku discount.
        assert rs.derive_transition_type(a, b) == "product"


class TestTransitionCost:
    def test_same_sku_cheaper_than_brand_change(self):
        a = _seg("ED13LT")
        b = _seg("ED13LT")
        c = _seg("XI13LT")
        cost_ab = rs.transition_cost(a, b, STATS)
        cost_ac = rs.transition_cost(a, c, STATS)
        assert cost_ab < cost_ac

    def test_first_run_costed_as_multi(self):
        # No prev → treated as multi (avoid free first slot).
        c = rs.transition_cost(None, _seg("ED13LT"), STATS)
        assert c == pytest.approx(1.0 - STATS["multi"]["mean_oee"])

    def test_unknown_bucket_falls_back_to_default(self):
        cost = rs.transition_cost(_seg("ZZ"), _seg("AA"), {})  # empty stats
        # default_oee = 0.5 → cost = 0.5
        assert cost == pytest.approx(0.5)


class TestLaneReorder:
    def test_already_optimal_lane_is_left_alone(self):
        # ED → ED → ED is already same-sku transitions throughout.
        lane = [_seg("ED13LT", start=0, w=4),
                _seg("ED13LT", start=4, w=4),
                _seg("ED13LT", start=8, w=4)]
        new_lane, before, after = rs.resequence_lane(lane, [], STATS)
        assert after == pytest.approx(before)
        # OF order unchanged
        assert [s["of"] for s in new_lane] == ["ED13LT", "ED13LT", "ED13LT"]

    def test_worst_case_input_improves(self):
        """Adversarial seed: ED → XI → ED → XI → ED. Best ordering groups
        same-brand runs together to skip the brand changeover repeatedly."""
        lane = [
            _seg("ED13LT", start=0,  w=4),
            _seg("XI13LT", start=4,  w=4),
            _seg("ED13LT", start=8,  w=4),
            _seg("XI13LT", start=12, w=4),
            _seg("ED13LT", start=16, w=4),
        ]
        new_lane, before, after = rs.resequence_lane(lane, [], STATS)
        assert after < before
        # Reordered to cluster: ED ED ED XI XI (or XI XI ED ED ED).
        ofs = [s["of"] for s in new_lane if s.get("kind") not in ("clean", "maint")]
        # All ED's consecutive, all XI's consecutive
        assert ofs.count("ED13LT") == 3 and ofs.count("XI13LT") == 2
        ed_indices = [i for i, of in enumerate(ofs) if of == "ED13LT"]
        xi_indices = [i for i, of in enumerate(ofs) if of == "XI13LT"]
        # Contiguous indices in each group
        assert max(ed_indices) - min(ed_indices) == 2
        assert max(xi_indices) - min(xi_indices) == 1

    def test_service_blocks_keep_their_start_times(self):
        lane = [
            _seg("ED13LT", start=0,  w=4),
            _svc("clean", start=12, w=8),
            _seg("XI13LT", start=20, w=4),
            _seg("ED13LT", start=24, w=4),
        ]
        new_lane, _, _ = rs.resequence_lane(lane, [], STATS)
        # Service block keeps its locked start at 12.
        clean = next(s for s in new_lane if s.get("kind") == "clean")
        assert clean["start"] == 12.0
        # Two production runs still present.
        prod = [s for s in new_lane if s.get("kind") not in ("clean", "maint")]
        assert len(prod) == 3

    def test_single_production_run_is_a_noop(self):
        lane = [_seg("ED13LT", start=0, w=4)]
        new_lane, before, after = rs.resequence_lane(lane, [], STATS)
        assert before == 0.0 and after == 0.0
        assert new_lane == lane


class TestTopLevelResequence:
    def test_summary_shape(self):
        base = {
            "14": [_seg("ED13LT", w=4), _seg("XI13LT", w=4), _seg("ED13LT", w=4)],
            "17": [_seg("XI13LT", w=4), _seg("XI13LT", w=4)],
            "19": [],  # empty lane is fine
        }
        out = rs.resequence(base, executed_history={}, transition_stats=STATS)
        assert set(out.keys()) == {
            "plan", "byLine", "totalCostBefore", "totalCostAfter",
            "totalCostDelta", "totalReordered",
        }
        assert "14" in out["byLine"]
        assert out["totalCostDelta"] >= 0   # never negative (no regressions)

    def test_executed_history_seeds_the_search(self):
        base = {"14": [_seg("XI13LT", w=4), _seg("ED13LT", w=4)]}
        # If the last executed run on L14 was ED, the algorithm should
        # prefer starting with ED (same-sku) over XI (brand-change).
        executed = {"14": [_seg("ED13LT", w=8)]}
        out = rs.resequence(base, executed_history=executed, transition_stats=STATS)
        first_of = next(
            s["of"] for s in out["plan"]["14"] if s.get("kind") not in ("clean", "maint")
        )
        assert first_of == "ED13LT"

    def test_idempotent(self):
        base = {"14": [_seg("ED13LT", w=4), _seg("ED13LT", w=4), _seg("XI13LT", w=4)]}
        once = rs.resequence(base, {}, STATS)
        twice = rs.resequence(once["plan"], {}, STATS)
        assert twice["totalCostAfter"] == pytest.approx(once["totalCostAfter"])
