"""Contract-shape tests — exercise validate() against synthetic payloads.

These tests do not require any raw data; they construct minimal-but-legal
payloads and then mutate them to ensure validate() catches each defect.
"""
from __future__ import annotations

import copy

import pytest

from app.data_contract import (
    REQUIRED_EVIDENCE_FIELDS,
    REQUIRED_RECOMMENDATION_FIELDS,
    REQUIRED_TOP_LEVEL,
    validate,
)


def _seg(of: str, start: float, w: float, *, kind: str | None = None) -> dict:
    base: dict = {"of": of, "start": start, "w": w}
    if kind is not None:
        base["kind"] = kind
    else:
        base.update({"sku": "BEER", "vol": 100, "oee": 0.6})
    return base


def _evidence() -> dict:
    return {
        "reason": "...",
        "breakdown": [],
        "analogues": [
            {"of": "EDABC", "line": "19", "oee": 0.7}
        ],
        "n": 1,
        "analogueMean": "0.700",
        "naiveMean": "0.620",
        "gain": "+8.0",
    }


def _recommendation() -> dict:
    return {
        "line": "Line 19",
        "position": "after EDX-001",
        "oeeDelta": "+8.0",
        "oeeGood": True,
        "deadline": "on time",
        "ordersMoved": 0,
        "naiveBand": None,
        "plan": {
            "14": [_seg("EDX-100", 0.0, 0.4)],
            "17": [_seg("EDX-200", 0.0, 0.4)],
            "19": [
                _seg("EDX-001", 0.0, 0.4),
                {"of": "URG", "kind": "ins", "start": 0.4, "w": 0.3,
                 "sku": "URG", "vol": 50, "oee": 0.7},
            ],
        },
        "ghosts": {},
        "recovery": {"line": "19", "start": 0.7, "w": 0.4, "hours": 12,
                     "note": "Modelled estimate."},
        "moves": [],
        "evidence": _evidence(),
    }


def _payload() -> dict:
    rec = _recommendation()
    return {
        "urgentOrders": [{
            "of": "URG", "status": "urgent", "sku": "BEER ...",
            "productSku": "3BVMLLB0", "volume_hl": 50,
        }],
        "lineBaseline": {l: {"avg_oee": 0.6} for l in ("14", "17", "19")},
        "lineCentre": {"14": "CF Prat", "17": "CF Prat", "19": "CF Prat"},
        "yearCompare": {},
        "executedHistory": {l: [_seg(f"E{l}", 0.0, 0.4)] for l in ("14", "17", "19")},
        "basePlan": {l: [_seg(f"B{l}", 0.0, 0.4)] for l in ("14", "17", "19")},
        "recommendations": {"19": rec},
        "objectives": {"oee": {"label": "OEE", "icon": "◉", "order": ["19"], "notes": {}}},
    }


class TestRequiredKeysExist:
    def test_required_top_level_constants_match_expected(self):
        assert set(REQUIRED_TOP_LEVEL) == {
            "urgentOrders", "lineBaseline", "lineCentre", "yearCompare",
            "executedHistory", "basePlan", "recommendations", "objectives",
        }

    def test_required_recommendation_fields_include_plan_and_evidence(self):
        assert "plan" in REQUIRED_RECOMMENDATION_FIELDS
        assert "evidence" in REQUIRED_RECOMMENDATION_FIELDS

    def test_required_evidence_fields_include_n_and_analogues(self):
        for field in ("reason", "breakdown", "analogues", "n",
                      "analogueMean", "naiveMean", "gain"):
            assert field in REQUIRED_EVIDENCE_FIELDS


class TestValidateAcceptsLegalPayload:
    def test_minimal_legal_payload_validates(self):
        ok, problems = validate(_payload())
        assert ok, problems


class TestValidateCatchesDefects:
    @pytest.mark.parametrize("key", REQUIRED_TOP_LEVEL)
    def test_missing_top_level_key_fails(self, key):
        payload = _payload()
        payload.pop(key)
        ok, problems = validate(payload)
        assert not ok
        assert any(key in p for p in problems)

    def test_recommendation_missing_evidence_fields_fails(self):
        payload = _payload()
        payload["recommendations"]["19"]["evidence"].pop("n")
        ok, problems = validate(payload)
        assert not ok
        assert any("'n'" in p for p in problems)

    def test_analogue_missing_oee_fails(self):
        payload = _payload()
        payload["recommendations"]["19"]["evidence"]["analogues"][0].pop("oee")
        ok, problems = validate(payload)
        assert not ok
        assert any("oee" in p for p in problems)
