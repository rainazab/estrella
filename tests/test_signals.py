"""Tests for the Cala signals integration.

Cala is never called for real here — we drive parse_knowledge_search()
directly with synthetic Cala-shaped responses, and use httpx's mock
transport for the refresh path. The free-tier credit budget never gets
touched.
"""
from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest

from app import signals as signals_mod


# ----------------------------- fixtures -----------------------------


def _cala_response() -> dict:
    """Cala-shaped response with two explainability claims, one citing a
    sanctions URL (should map to severity=critical), one citing a
    competitor announcement (should stay at the floor severity)."""
    return {
        "content": "Two stories about supplier exposure...",
        "explainability": [
            {
                "content": "EU Council added two malt distributors to the sanctions list in March 2025.",
                "references": ["ctx-1"],
            },
            {
                "content": "Mahou announced a new canning line at its Alovera plant.",
                "references": ["ctx-2"],
            },
        ],
        "context": [
            {
                "id": "ctx-1",
                "content": "Council Regulation 2025/417 adds entities...",
                "origins": [{
                    "document": {"url": "https://eur-lex.europa.eu/foo", "date": "2025-03-14"},
                    "source": {"name": "Official Journal of the European Union"},
                }],
            },
            {
                "id": "ctx-2",
                "content": "Mahou plant expansion brings 90M€ of capex...",
                "origins": [{
                    "document": {"url": "https://cincodias.elpais.com/bar"},
                    "source": {"name": "Cinco Días"},
                }],
            },
        ],
    }


# ----------------------------- parser -------------------------------


class TestParser:
    def test_extracts_one_signal_per_cited_claim(self):
        sigs, cits = signals_mod.parse_knowledge_search(
            _cala_response(),
            {"category": "supplier", "severity_floor": "info",
             "title": "Supplier-risk signals", "linesAffected": ["14"]},
        )
        assert len(sigs) == 2
        assert all(s["category"] == "supplier" for s in sigs)
        assert all(s["title"] == "Supplier-risk signals" for s in sigs)
        # every signal carries at least one citation id
        for s in sigs:
            assert s["citationIds"]
            for cid in s["citationIds"]:
                assert cid in cits

    def test_sanctions_keyword_promotes_severity_to_critical(self):
        sigs, _ = signals_mod.parse_knowledge_search(
            _cala_response(),
            {"category": "supplier", "severity_floor": "info"},
        )
        sanctions = next(s for s in sigs if "sanctions" in s["body"].lower())
        assert sanctions["severity"] == "critical"

    def test_uncited_claims_are_dropped(self):
        body = _cala_response()
        body["explainability"].append({"content": "no refs", "references": []})
        sigs, _ = signals_mod.parse_knowledge_search(
            body, {"category": "regulatory", "severity_floor": "info"},
        )
        # the no-refs claim should not appear
        assert not any(s["body"] == "no refs" for s in sigs)

    def test_citation_has_publisher_and_url(self):
        _, cits = signals_mod.parse_knowledge_search(
            _cala_response(), {"category": "supplier", "severity_floor": "info"},
        )
        first = next(iter(cits.values()))
        assert first["source"]["url"].startswith("https://")
        assert first["source"]["name"]
        assert "claim" in first


# ----------------------------- refresh ------------------------------


class TestRefresh:
    def test_no_api_key_returns_seed(self, tmp_path: Path):
        seed = tmp_path / "signals.json"
        seed.write_text(json.dumps({
            "signals": [{"id": "sig-1"}], "citations": {}, "source": "seed",
            "stale": True, "generatedAt": 0, "error": None,
        }))
        out = signals_mod.refresh_signals(api_key=None, seed_path=seed, write=False)
        assert out["source"] == "seed"
        assert out["signals"][0]["id"] == "sig-1"

    def test_live_refresh_overwrites_seed(self, tmp_path: Path):
        seed = tmp_path / "signals.json"

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json=_cala_response())

        client = httpx.Client(transport=httpx.MockTransport(handler))
        out = signals_mod.refresh_signals(
            api_key="test-key",
            queries=[{"category": "supplier", "title": "X",
                      "severity_floor": "info", "linesAffected": ["14"],
                      "query": "anything"}],
            client=client,
            seed_path=seed,
        )
        assert out["source"] == "cala"
        assert len(out["signals"]) >= 1
        # persisted to disk
        on_disk = json.loads(seed.read_text())
        assert on_disk["source"] == "cala"

    def test_429_short_circuits_and_keeps_seed(self, tmp_path: Path):
        seed = tmp_path / "signals.json"
        seed.write_text(json.dumps({
            "signals": [{"id": "sig-existing"}], "citations": {}, "source": "seed",
            "stale": True, "generatedAt": 0, "error": None,
        }))

        def handler(_req: httpx.Request) -> httpx.Response:
            return httpx.Response(429, json={"detail": "rate limit"})

        client = httpx.Client(transport=httpx.MockTransport(handler))
        out = signals_mod.refresh_signals(
            api_key="test-key",
            queries=[{"category": "supplier", "title": "X",
                      "severity_floor": "info", "linesAffected": [],
                      "query": "q"}],
            client=client,
            seed_path=seed,
        )
        assert out["source"] == "seed"
        assert "rate-limited" in (out.get("error") or "")
        # seed untouched on disk
        assert json.loads(seed.read_text())["signals"][0]["id"] == "sig-existing"

    def test_auth_failure_keeps_seed(self, tmp_path: Path):
        seed = tmp_path / "signals.json"
        seed.write_text(json.dumps({
            "signals": [], "citations": {}, "source": "seed",
            "stale": True, "generatedAt": 0, "error": None,
        }))

        def handler(_req: httpx.Request) -> httpx.Response:
            return httpx.Response(401, json={"detail": "bad key"})

        client = httpx.Client(transport=httpx.MockTransport(handler))
        out = signals_mod.refresh_signals(
            api_key="bad-key",
            queries=[{"category": "supplier", "title": "X",
                      "severity_floor": "info", "linesAffected": [],
                      "query": "q"}],
            client=client,
            seed_path=seed,
        )
        assert out["source"] == "seed"
        assert "auth" in (out.get("error") or "").lower()


# ----------------------------- HTTP ---------------------------------


class TestEndpoints:
    @pytest.fixture
    def client(self, tmp_path: Path, monkeypatch):
        # Point SIGNALS_PATH at a tmp seed so tests are hermetic.
        seed = tmp_path / "signals.json"
        seed.write_text(json.dumps({
            "signals": [{
                "id": "sig-test-1", "category": "supplier", "severity": "warn",
                "title": "Supplier-risk signals", "body": "test",
                "citationIds": ["cit-test-1"], "linesAffected": ["14"],
                "actionHint": "watch", "ts": 0,
            }],
            "citations": {"cit-test-1": {
                "id": "cit-test-1", "claim": "test claim",
                "source": {"name": "Test", "url": "https://example.com", "date": None},
            }},
            "source": "seed", "stale": True, "generatedAt": 0, "error": None,
        }), encoding="utf-8")
        monkeypatch.setattr(signals_mod, "SIGNALS_PATH", seed)

        # /plan still needs data.json
        from fastapi.testclient import TestClient
        from app.server import create_app

        # Reuse the canonical fixture from test_server
        from tests.test_server import _canonical_payload
        data = tmp_path / "data.json"
        data.write_text(json.dumps(_canonical_payload()), encoding="utf-8")
        app = create_app(data_path=data, allow_cors=False)
        return TestClient(app)

    def test_get_signals_returns_seed_shape(self, client):
        r = client.get("/signals")
        assert r.status_code == 200
        body = r.json()
        assert body["source"] == "seed"
        assert body["signals"][0]["id"] == "sig-test-1"
        assert "cit-test-1" in body["citations"]

    def test_get_signals_sets_etag(self, client):
        r1 = client.get("/signals")
        etag = r1.headers["etag"]
        r2 = client.get("/signals", headers={"If-None-Match": etag})
        assert r2.status_code == 304

    def test_refresh_without_api_key_returns_seed(self, client, monkeypatch):
        monkeypatch.delenv("CALA_API_KEY", raising=False)
        r = client.post("/signals/refresh")
        assert r.status_code == 200
        body = r.json()
        assert body["source"] == "seed"
