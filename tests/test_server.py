"""Integration tests for the HTTP server.

Uses FastAPI's TestClient — no real network. Writes a synthetic canonical
data.json into a temp dir and points the server at it.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.server import create_app


def _canonical_payload() -> dict:
    rec = {
        "line": "Line 19",
        "position": "after EDX-001",
        "oeeDelta": "+5.2",
        "oeeGood": True,
        "deadline": "on time",
        "ordersMoved": 0,
        "naiveBand": None,
        "plan": {
            "14": [{"of": "B14", "start": 0.0, "w": 6.0, "sku": "X", "vol": 100, "oee": 0.6}],
            "17": [{"of": "B17", "start": 0.0, "w": 6.0, "sku": "X", "vol": 100, "oee": 0.55}],
            "19": [{"of": "B19", "start": 0.0, "w": 6.0, "sku": "X", "vol": 100, "oee": 0.6},
                   {"of": "URG", "start": 6.0, "w": 3.0, "sku": "URG", "vol": 50, "oee": 0.7, "kind": "ins"}],
        },
        "ghosts": {},
        "recovery": {"line": "19", "start": 9.0, "w": 12.0, "hours": 12, "note": "modelled"},
        "moves": [],
        "evidence": {
            "reason": "ok",
            "breakdown": [],
            "analogues": [{"of": "AOF1", "line": 19, "date": "01 Jan 2025", "type": "same-sku", "oee": 0.61}],
            "n": 1,
            "analogueMean": "0.610",
            "naiveMean": "0.550",
            "gain": "+6.0",
        },
    }
    return {
        "urgentOrders": [{"of": "URG", "status": "urgent", "sku": "X",
                          "productSku": "X", "units": 1, "hl": 1, "due": "today"}],
        "lineBaseline": {"14": {"avg_oee": 0.6}, "17": {"avg_oee": 0.5}, "19": {"avg_oee": 0.6}},
        "lineCentre": {"14": "CF Prat", "17": "CF Prat", "19": "CF Prat"},
        "timeline": {
            "anchorDate": "2026-05-24",
            "anchorLabel": "Today",
            "timeUnit": "hours",
            "views": {
                "week": {"daysBack": 7, "daysAhead": 14},
                "month": {"daysBack": 14, "daysAhead": 35},
                "quarter": {"daysBack": 30, "daysAhead": 90},
            },
        },
        "lineRules": {
            "14": {"formats": [{"key": "1/2", "label": "50cl", "name": "medio"}, {"key": "1/3", "label": "33cl", "name": "tercio"}]},
            "17": {"formats": [{"key": "1/3", "label": "33cl", "name": "tercio"}]},
            "19": {"formats": [{"key": "1/2", "label": "50cl", "name": "medio"}, {"key": "1/3", "label": "33cl", "name": "tercio"}, {"key": "2/5", "label": "44cl", "name": "2/5"}]},
        },
        "weeklyStops": {"14": [], "17": [], "19": []},
        "yearCompare": {"weekLabel": "Week 1", "lines": {}},
        "executedHistory": {"14": [], "17": [], "19": []},
        "basePlan": {
            "14": [{"of": "B14", "start": 0.0, "w": 6.0, "sku": "X", "vol": 100, "oee": 0.6}],
            "17": [{"of": "B17", "start": 0.0, "w": 6.0, "sku": "X", "vol": 100, "oee": 0.55}],
            "19": [{"of": "B19", "start": 0.0, "w": 6.0, "sku": "X", "vol": 100, "oee": 0.6}],
        },
        "recommendations": {"19": rec},
        "objectives": {"oee": {"label": "OEE", "icon": "◉", "order": ["19"], "notes": {}}},
        "manualSlots": {},
    }


@pytest.fixture
def client(tmp_path: Path):
    data_path = tmp_path / "data.json"
    data_path.write_text(json.dumps(_canonical_payload()), encoding="utf-8")
    app = create_app(data_path=data_path, allow_cors=False)
    return TestClient(app), data_path


class TestHealth:
    def test_returns_ok_true(self, client):
        c, _ = client
        r = c.get("/health")
        assert r.status_code == 200
        body = r.json()
        assert body.get("ok") is True


class TestPlan:
    def test_returns_frontend_shape(self, client):
        c, _ = client
        r = c.get("/plan")
        assert r.status_code == 200
        data = r.json()
        assert set(data.keys()) == {
            "urgentOrders", "lineBaseline", "timeline", "lineRules", "weeklyStops",
            "yearCompare", "executedHistory", "basePlan", "lineCentre",
            "recommendations", "objectives", "manualSlots",
        }
        assert isinstance(data["lineBaseline"]["19"], float)

    def test_sets_etag_and_no_store(self, client):
        c, _ = client
        r = c.get("/plan")
        assert r.headers.get("etag")
        assert "no-store" in r.headers.get("cache-control", "")

    def test_returns_304_on_matching_etag(self, client):
        c, _ = client
        r1 = c.get("/plan")
        etag = r1.headers["etag"]
        r2 = c.get("/plan", headers={"If-None-Match": etag})
        assert r2.status_code == 304
        assert r2.headers.get("etag") == etag

    def test_returns_503_when_data_missing(self, tmp_path):
        missing = tmp_path / "nope.json"
        app = create_app(data_path=missing, allow_cors=False)
        c = TestClient(app)
        r = c.get("/plan")
        assert r.status_code == 503
        body = r.json()
        assert body.get("error") == "data_unavailable"
        assert "detail" in body

    def test_returns_500_on_corrupt_data(self, tmp_path):
        bad = tmp_path / "bad.json"
        bad.write_text("{not json", encoding="utf-8")
        app = create_app(data_path=bad, allow_cors=False)
        c = TestClient(app)
        r = c.get("/plan")
        assert r.status_code == 500
        body = r.json()
        assert body.get("error") == "data_corrupt"
