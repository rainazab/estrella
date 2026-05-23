"""Unit tests for the canonical→frontend payload transformer.

These tests construct minimal canonical payloads (no I/O, no real data) so
they pass even without `data/output/data.json` on disk.
"""
from __future__ import annotations

import copy

import pytest

from app.frontend_payload import build_frontend_payload


def _canonical() -> dict:
    """Minimal canonical payload covering every transform path."""
    rec = {
        "line": "Line 19",
        "position": "after EDX-001",
        "oeeDelta": "+5.2",
        "oeeGood": True,
        "deadline": "on time",
        "ordersMoved": 0,
        "naiveBand": None,
        "plan": {
            "14": [
                {"of": "B14", "start": 0.0, "w": 6.0, "sku": "X", "vol": 100, "oee": 0.6},
            ],
            "17": [
                {"of": "B17", "start": 0.0, "w": 6.0, "sku": "X", "vol": 100, "oee": 0.55},
            ],
            "19": [
                {"of": "B19", "start": 0.0, "w": 6.0, "sku": "X", "vol": 100, "oee": 0.62, "kind": "anchor"},
                {"of": "URG", "start": 6.0, "w": 3.0, "sku": "URG", "vol": 50, "oee": 0.7, "kind": "ins"},
            ],
        },
        "ghosts": {
            "19": [{"of": "GH1", "start": 9.0, "w": 4.0, "extra_ignored": "x"}],
        },
        "recovery": {"line": "19", "start": 9.0, "w": 12.0, "hours": 12, "note": "modelled"},
        "moves": [{"of": "GH1", "line": 19, "shift": "+3h", "why": "pushed back"}],
        "evidence": {
            "reason": "test reason",
            "qualityLabel": "Strong",     # additive — must be dropped
            "scope": "line_transition",   # additive — must be dropped
            "breakdown": [{"name": "Format / Envase CF", "pct": 30, "band": "lo", "val": "0 min — same format"}],
            "analogues": [
                {"of": "AOF1", "previous_of": "PREV1", "line": 19, "date": "01 Jan 2025",
                 "type": "same-sku", "oee": 0.61, "principal": "—"},
            ],
            "n": 1,
            "analogueMean": "0.610",
            "naiveMean": "0.550",
            "gain": "+6.0",
            "oeeComparison": {"metric": "comparative_oee_points"},  # additive
        },
        # Additive recommendation fields that MUST be dropped:
        "candidateSlotsEvaluated": 7,
        "adjustedOeeGain": 4.5,
    }
    return {
        "urgentOrders": [{
            "of": "URG", "status": "urgent", "sku": "Estrella", "productSku": "X",
            "units": 18000, "hl": 594, "due": "28 May",
            "volume_hl": 594, "format_key": "1/3",   # additive
        }],
        "lineBaseline": {
            "14": {"avg_oee": 0.62, "avg_changeover_minutes": 64.0},
            "17": {"avg_oee": 0.52, "avg_changeover_minutes": 80.0},
            "19": {"avg_oee": 0.64, "avg_changeover_minutes": 70.0},
        },
        "lineCentre": {"14": "CF Prat", "17": "CF Prat", "19": "CF Prat"},
        "yearCompare": {
            "weekLabel": "Week 21 · 18–24 May",
            "lines": {
                "14": {"oeeNow": 0.62, "oeeLast": 0.58, "volNow": 1000, "volLast": 950,
                       "changesNow": 5, "changesLast": 4},
            },
        },
        "executedHistory": {
            "14": [{"of": "E14", "start": 0.0, "w": 6.0, "sku": "X", "vol": 100, "oee": 0.6},
                   {"start": 6.0, "w": 1.0, "kind": "clean"}],
            "17": [], "19": [],
        },
        "basePlan": {
            "14": [{"of": "B14", "start": 0.0, "w": 6.0, "sku": "X", "vol": 100, "oee": 0.6}],
            "17": [], "19": [],
        },
        "recommendations": {"19": rec},
        "objectives": {"oee": {"label": "OEE", "icon": "◉", "order": ["19"], "notes": {}}},
        "manualSlots": {
            "19-after-EDX-001": {"recKey": "19", "verdict": "match",
                                 "label": "Line 19 · after EDX-001", "banner": "Recommended slot."},
        },
        # Additive top-level that must be dropped:
        "metadata": {"contract_version": "2.0"},
        "infeasibleByLine": {},
        "planReview": {},
    }


class TestFrontendShape:
    def test_top_level_keys_match_contract_exactly(self):
        payload = build_frontend_payload(_canonical())
        assert set(payload.keys()) == {
            "urgentOrders", "lineBaseline", "yearCompare",
            "executedHistory", "basePlan", "lineCentre",
            "recommendations", "objectives", "manualSlots",
        }

    def test_line_baseline_flattens_to_number_per_line(self):
        payload = build_frontend_payload(_canonical())
        assert payload["lineBaseline"] == {"14": 0.62, "17": 0.52, "19": 0.64}

    def test_urgent_orders_only_contract_fields(self):
        payload = build_frontend_payload(_canonical())
        order = payload["urgentOrders"][0]
        assert set(order.keys()) == {"of", "status", "sku", "units", "hl", "due"}

    def test_executed_history_clean_blocks_have_no_oee_or_vol(self):
        payload = build_frontend_payload(_canonical())
        clean = next(s for s in payload["executedHistory"]["14"] if s.get("kind") == "clean")
        assert "oee" not in clean
        assert "vol" not in clean
        assert set(clean.keys()) == {"kind", "start", "w"}


class TestRecommendationShape:
    def test_only_contract_fields_present(self):
        payload = build_frontend_payload(_canonical())
        rec = payload["recommendations"]["19"]
        assert set(rec.keys()) == {
            "line", "position", "oeeDelta", "oeeGood", "deadline", "ordersMoved",
            "naiveBand", "plan", "ghosts", "recovery", "moves", "evidence",
        }

    def test_additive_scoring_fields_are_dropped(self):
        payload = build_frontend_payload(_canonical())
        rec = payload["recommendations"]["19"]
        for forbidden in ("candidateSlotsEvaluated", "adjustedOeeGain",
                          "evidencePenaltyPts", "disruptionScore", "timeScore",
                          "evidenceStrengthLabel", "transitionType"):
            assert forbidden not in rec

    def test_evidence_keys_match_contract(self):
        payload = build_frontend_payload(_canonical())
        evidence = payload["recommendations"]["19"]["evidence"]
        assert set(evidence.keys()) == {
            "reason", "breakdown", "analogues", "n",
            "analogueMean", "naiveMean", "gain",
        }

    def test_analogue_shape_matches_contract(self):
        payload = build_frontend_payload(_canonical())
        analogue = payload["recommendations"]["19"]["evidence"]["analogues"][0]
        assert set(analogue.keys()) == {"of", "date", "line", "type", "oee"}
        assert analogue["line"] == "19"
        # oee is a string per contract
        assert analogue["oee"] == "0.61"

    def test_plan_bands_keep_ins_and_shift_kind(self):
        payload = build_frontend_payload(_canonical())
        line19 = payload["recommendations"]["19"]["plan"]["19"]
        ins = next(s for s in line19 if s.get("kind") == "ins")
        assert ins["of"] == "URG"
        # anchor's "kind: anchor" should be dropped (not in {ins, shift})
        anchor = next(s for s in line19 if s.get("of") == "B19")
        assert "kind" not in anchor

    def test_ghosts_trim_to_of_start_w(self):
        payload = build_frontend_payload(_canonical())
        ghost = payload["recommendations"]["19"]["ghosts"]["19"][0]
        assert set(ghost.keys()) == {"of", "start", "w"}


class TestManualSlots:
    def test_match_slot_preserved(self):
        payload = build_frontend_payload(_canonical())
        slot = payload["manualSlots"]["19-after-EDX-001"]
        assert slot == {
            "recKey": "19", "verdict": "match",
            "label": "Line 19 · after EDX-001", "banner": "Recommended slot.",
        }


class TestRobustness:
    def test_missing_top_level_keys_default_to_empty(self):
        payload = build_frontend_payload({})
        assert payload["urgentOrders"] == []
        assert payload["lineBaseline"] == {}
        assert payload["recommendations"] == {}
        assert payload["manualSlots"] == {}

    def test_none_input_returns_empty_shape(self):
        payload = build_frontend_payload(None)  # type: ignore[arg-type]
        assert payload["urgentOrders"] == []
