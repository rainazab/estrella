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
            "lineFormats", "issues", "stoppages",
        }
        assert isinstance(data["lineBaseline"]["19"], float)
        assert data["issues"] == []
        assert data["stoppages"] == []
        assert data["lineFormats"]["17"] == ["33cl"]

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


class TestIssues:
    def test_post_issue_returns_assigned_id_and_appears_on_plan(self, client):
        c, _ = client
        r = c.post("/issues", json={
            "line": "17", "category": "mech", "severity": "warn",
            "note": "vibration on capper", "ts": 1700000000000,
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["issue"]["id"].startswith("iss-")
        assert body["issue"]["line"] == "17"
        assert body["issue"]["category"] == "mech"
        # Plan now carries the new issue.
        plan = c.get("/plan").json()
        assert any(i["id"] == body["issue"]["id"] for i in plan["issues"])

    def test_post_issue_rejects_bad_category(self, client):
        c, _ = client
        r = c.post("/issues", json={
            "line": "17", "category": "lol", "severity": "warn",
            "note": "", "ts": 0,
        })
        assert r.status_code == 400
        assert r.json()["error"] == "bad_request"


class TestStoppages:
    def test_one_active_per_line_invariant(self, client):
        c, _ = client
        r1 = c.post("/stoppages", json={
            "line": "19", "reason": "breakdown",
            "startedAt": 1, "startAgoMin": 5, "duration": "1h", "ts": 1,
        })
        assert r1.status_code == 200
        r2 = c.post("/stoppages", json={
            "line": "19", "reason": "quality-hold",
            "startedAt": 2, "startAgoMin": 0, "duration": "30m", "ts": 2,
        })
        assert r2.status_code == 200
        actives = r2.json()["stoppages"]
        # The first stoppage on L19 was superseded by the second.
        assert len([s for s in actives if s["line"] == "19"]) == 1
        assert actives[-1]["reason"] == "quality-hold"

    def test_resume_clears_active_stoppage(self, client):
        c, _ = client
        sid = c.post("/stoppages", json={
            "line": "14", "reason": "breakdown",
            "startedAt": 1, "startAgoMin": 0, "duration": "15m", "ts": 1,
        }).json()["stoppage"]["id"]
        r = c.post(f"/stoppages/{sid}/resume")
        assert r.status_code == 200
        assert r.json()["stoppages"] == []

    def test_resume_unknown_id_returns_404(self, client):
        c, _ = client
        r = c.post("/stoppages/missing/resume")
        assert r.status_code == 404


class TestStoppageReplan:
    def test_shifts_lane_forward_by_duration(self, client):
        c, _ = client
        sid = c.post("/stoppages", json={
            "line": "19", "reason": "breakdown",
            "startedAt": 1, "startAgoMin": 0, "duration": "1h", "ts": 1,
        }).json()["stoppage"]["id"]
        r = c.post("/plan/stoppage-replan", json={
            "stoppageId": sid, "line": "19", "durationKey": "1h",
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["shiftedHours"] == 1.0
        assert body["shiftedCount"] == 1
        # L19's only band was originally at start=0; now it should be 1.0.
        assert body["plan"]["basePlan"]["19"][0]["start"] == 1.0


class TestMove:
    def test_preview_does_not_persist(self, client):
        c, _ = client
        preview = c.post("/plan/move/preview", json={
            "runId": "B14", "fromLine": "14", "toLine": "17", "slotIndex": 0,
        })
        assert preview.status_code == 200, preview.text
        body = preview.json()
        assert body["ripple"]["runId"] == "B14"
        # B14 now sits on L17 in the previewed plan
        assert any(b.get("of") == "B14" for b in body["plan"]["basePlan"]["17"])
        # …but the live /plan is untouched
        live = c.get("/plan").json()
        assert any(b.get("of") == "B14" for b in live["basePlan"]["14"])

    def test_commit_persists_and_pushes_downstream(self, client):
        c, _ = client
        r = c.post("/plan/move", json={
            "runId": "B14", "fromLine": "14", "toLine": "17", "slotIndex": 1,
        })
        assert r.status_code == 200, r.text
        live = c.get("/plan").json()
        # B14 lives on L17 after the commit; L14 lost it
        assert any(b.get("of") == "B14" for b in live["basePlan"]["17"])
        assert not any(b.get("of") == "B14" for b in live["basePlan"]["14"])

    def test_unknown_run_returns_404(self, client):
        c, _ = client
        r = c.post("/plan/move/preview", json={
            "runId": "GHOST", "fromLine": "14", "toLine": "17", "slotIndex": 0,
        })
        assert r.status_code == 404
