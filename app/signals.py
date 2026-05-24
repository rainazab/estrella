"""LineWise external signals — publicly-verified context about the
brewing/beverage supply chain, regulatory environment, and competitive
landscape, sourced via Cala (https://cala.ai).

Two channels:

  * `fetch_signals()` — read the cached `signals.json` from disk. The
    server's `GET /signals` calls this on every request (cheap).
  * `refresh_signals()` — call Cala, parse the response into the
    signal/citation contract, and overwrite `signals.json`. Triggered
    by `POST /signals/refresh`.

The free tier (100 req/mo, 10 req/min) is the design constraint: never
call Cala from the request path. Each refresh runs N
`knowledge_search` calls (one per category in DEFAULT_QUERIES) and
costs N credits.

When `CALA_API_KEY` is unset, `refresh_signals()` returns the seed
file unchanged — the demo still works offline against a hand-curated
signals.json shaped identically to a live Cala response.
"""
from __future__ import annotations

import json
import os
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx

from . import config


CALA_BASE_URL = "https://api.cala.ai/v1"
CALA_TIMEOUT_SECONDS = 60.0          # Cala docs say up to 180s, but free tier is fast enough
SIGNALS_PATH = config.OUTPUT_DIR / "signals.json"
SIGNALS_SEED_PATH = Path(__file__).resolve().parent / "signals_seed.json"

# One Cala call per category. Keep this list small — each entry burns
# one credit from the free-tier 100/mo cap.
DEFAULT_QUERIES: List[Dict[str, Any]] = [
    {
        "category": "supplier",
        "severity_floor": "warn",
        "title": "Supplier-risk signals",
        "query": (
            "Recent EU sanctions or trade restrictions affecting "
            "beverage industry suppliers and barley/malt producers in 2025"
        ),
        "linesAffected": ["14", "17", "19"],
        "actionHint": "watch",
    },
    {
        "category": "regulatory",
        "severity_floor": "info",
        "title": "Regulatory signals",
        "query": (
            "Recent EU regulations on beverage packaging, deposit-return "
            "schemes, or PFAS limits affecting Spanish brewers in 2025"
        ),
        "linesAffected": ["14", "17", "19"],
        "actionHint": "watch",
    },
    {
        "category": "competitor",
        "severity_floor": "info",
        "title": "Competitor signals",
        "query": (
            "Recent capacity, M&A, or expansion announcements by "
            "Spanish brewing companies in 2025"
        ),
        "linesAffected": [],
        "actionHint": None,
    },
]


# ============================================================ data load


def load_signals(path: Optional[Path] = None) -> Dict[str, Any]:
    """Read the cached signals.json, falling back to the in-package seed
    when the cache is missing. Returns an empty payload only when both
    are unreachable, so `GET /signals` can always answer."""
    target = path or SIGNALS_PATH
    for candidate in (target, SIGNALS_SEED_PATH):
        if not candidate.exists():
            continue
        try:
            return json.loads(candidate.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
    return _empty_payload(source="seed", stale=True)


def save_signals(payload: Dict[str, Any], path: Optional[Path] = None) -> Path:
    target = path or SIGNALS_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    return target


# ============================================================ refresh


def refresh_signals(
    api_key: Optional[str] = None,
    *,
    queries: Optional[List[Dict[str, Any]]] = None,
    client: Optional[httpx.Client] = None,
    seed_path: Optional[Path] = None,
    write: bool = True,
) -> Dict[str, Any]:
    """Re-fetch signals from Cala and (optionally) persist to disk.

    Returns the new payload. When `api_key` is None we leave the existing
    seed file in place and return it with `source: "seed"` so callers
    can distinguish a live refresh from a fallback. Any Cala failure
    (network, auth, rate-limit) is logged via the returned payload's
    `error` field but does not raise — the demo keeps working off the
    seed.
    """
    api_key = api_key if api_key is not None else os.environ.get("CALA_API_KEY")
    target = seed_path or SIGNALS_PATH

    if not api_key:
        existing = load_signals(target if target.exists() else SIGNALS_SEED_PATH)
        existing["source"] = "seed"
        existing["stale"] = True
        existing["error"] = None
        return existing

    queries = queries or DEFAULT_QUERIES
    owned_client = client is None
    client = client or httpx.Client(timeout=CALA_TIMEOUT_SECONDS)
    try:
        signals: List[Dict[str, Any]] = []
        citations: Dict[str, Dict[str, Any]] = {}
        errors: List[str] = []

        for spec in queries:
            try:
                resp = client.post(
                    f"{CALA_BASE_URL}/knowledge_search",
                    headers={"X-API-KEY": api_key, "Content-Type": "application/json"},
                    json={"input": spec["query"], "return_entities": False},
                )
            except httpx.RequestError as exc:
                errors.append(f"{spec['category']}: network error: {exc}")
                continue

            if resp.status_code == 429:
                errors.append(f"{spec['category']}: rate-limited (HTTP 429)")
                break  # stop early — no point hammering after a 429
            if resp.status_code == 401 or resp.status_code == 403:
                errors.append(f"{spec['category']}: auth failed (HTTP {resp.status_code})")
                break
            if resp.status_code >= 400:
                errors.append(f"{spec['category']}: HTTP {resp.status_code}")
                continue

            try:
                body = resp.json()
            except json.JSONDecodeError as exc:
                errors.append(f"{spec['category']}: non-JSON response: {exc}")
                continue

            sigs, cits = parse_knowledge_search(body, spec)
            signals.extend(sigs)
            citations.update(cits)

        if errors and not signals:
            # Everything failed — keep the seed in place. Surface the errors
            # so the operator knows refresh didn't take.
            existing = load_signals(target if target.exists() else SIGNALS_SEED_PATH)
            existing["source"] = "seed"
            existing["stale"] = True
            existing["error"] = "; ".join(errors)
            return existing

        payload = {
            "signals": signals,
            "citations": citations,
            "generatedAt": int(time.time() * 1000),
            "source": "cala",
            "stale": False,
            "error": "; ".join(errors) if errors else None,
        }
        if write:
            save_signals(payload, target)
        return payload
    finally:
        if owned_client:
            client.close()


# ============================================================ parser


def parse_knowledge_search(
    body: Dict[str, Any],
    spec: Dict[str, Any],
) -> Tuple[List[Dict[str, Any]], Dict[str, Dict[str, Any]]]:
    """Turn one knowledge_search response into the signal+citation
    contract. The mapping is intentionally simple: each `explainability`
    claim becomes one Signal; the `references` it carries become its
    citations, resolved via the `context[*].origins[*].document.url`.

    Cala's response shape is documented at https://docs.cala.ai —
    `content`, `explainability[{content, references}]`, `context[{id, origins[{document, source}]}]`.
    """
    explain = body.get("explainability") or []
    context_list = body.get("context") or []
    by_id = {item.get("id"): item for item in context_list if isinstance(item, dict)}

    citations: Dict[str, Dict[str, Any]] = {}
    signals: List[Dict[str, Any]] = []

    severity_floor = spec.get("severity_floor") or "info"

    for claim in explain:
        if not isinstance(claim, dict):
            continue
        content = (claim.get("content") or "").strip()
        if not content:
            continue
        ref_ids = claim.get("references") or []

        claim_citation_ids: List[str] = []
        for rid in ref_ids:
            ctx = by_id.get(rid)
            if not isinstance(ctx, dict):
                continue
            origins = ctx.get("origins") or []
            if not origins:
                continue
            origin = origins[0]  # take the first publisher-attributed origin
            doc = origin.get("document") if isinstance(origin, dict) else None
            src = origin.get("source") if isinstance(origin, dict) else None
            if not isinstance(doc, dict):
                continue
            url = doc.get("url") or ""
            if not url:
                continue
            cit_id = f"cit-{uuid.uuid4().hex[:10]}"
            citations[cit_id] = {
                "id": cit_id,
                "claim": (ctx.get("content") or content)[:600],
                "source": {
                    "name": (src or {}).get("name") if isinstance(src, dict) else None,
                    "url": url,
                    "date": doc.get("date") or doc.get("published_at"),
                },
            }
            claim_citation_ids.append(cit_id)

        if not claim_citation_ids:
            # Skip uncited claims — the whole point is provenance.
            continue

        signals.append({
            "id": f"sig-{uuid.uuid4().hex[:10]}",
            "category": spec.get("category", "other"),
            "severity": _infer_severity(content, severity_floor),
            "title": spec.get("title") or spec.get("category", "signal").title(),
            "body": content,
            "citationIds": claim_citation_ids,
            "linesAffected": list(spec.get("linesAffected") or []),
            "actionHint": spec.get("actionHint"),
            "ts": int(time.time() * 1000),
        })

    return signals, citations


# ============================================================ helpers


_CRITICAL_WORDS = ("sanction", "block", "ban", "recall", "halted", "shutdown")
_WARN_WORDS = ("delay", "shortage", "investigation", "warning", "fine", "violation")


def _infer_severity(text: str, floor: str) -> str:
    lower = text.lower()
    if any(w in lower for w in _CRITICAL_WORDS):
        return "critical"
    if any(w in lower for w in _WARN_WORDS):
        return "warn"
    return floor


def _empty_payload(*, source: str, stale: bool) -> Dict[str, Any]:
    return {
        "signals": [],
        "citations": {},
        "generatedAt": 0,
        "source": source,
        "stale": stale,
        "error": None,
    }
