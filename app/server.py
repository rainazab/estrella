"""LineWise HTTP server.

Endpoints (matching docs/API_CONTRACT.md, contract v2.3):

  GET  /health                     — liveness probe
  GET  /plan                       — frontend-shape payload (ETag + no-store)
  POST /plan/recompute             — regenerate data/output/data.json
  POST /issues                     — log a line-side issue
  POST /stoppages                  — log a line stoppage (one active per line)
  POST /stoppages/{id}/resume      — clear an active stoppage
  POST /plan/stoppage-replan       — shift downstream runs by stoppage duration
  POST /plan/move/preview          — dry-run a manual move (ripple + collisions)
  POST /plan/move                  — commit a manual move

The server reads `data/output/data.json` on every /plan request — the batch
exporter is still the source of truth. If the file is missing, the server
returns 503 with a JSON `{ "error", "detail" }` body so the frontend can
display the message.

Issues, stoppages, and manually-moved plans are held in-process (no DB).
Restarting the server clears them. The frontend treats absent arrays as
empty (see linewise/API_CONTRACT.md), so this matches today's UX while
giving the frontend a real HTTP surface to swap onto.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import config
from .frontend_payload import (
    ISSUE_CATEGORIES,
    ISSUE_SEVERITIES,
    KNOWN_LINES,
    STOPPAGE_DURATIONS,
    STOPPAGE_REASONS,
    build_frontend_payload,
)


# ---- duration mapping shared with linewise/src/lib/stoppagePlan.js ----
_DURATION_HOURS = {
    "15m": 0.25,
    "30m": 0.5,
    "1h": 1.0,
    "2h+": 2.0,
    "unknown": 1.0,
}


def _default_data_path() -> Path:
    return Path(os.environ.get("LINEWISE_DATA_JSON", str(config.OUTPUT_DIR / "data.json")))


def _load_canonical(path: Path) -> tuple[dict, str]:
    """Read data.json and compute a content ETag. Raises 503 if missing."""
    if not path.exists():
        raise HTTPException(
            status_code=503,
            detail={
                "error": "data_unavailable",
                "detail": (
                    f"{path} does not exist yet. Run "
                    "`python -m app.export_data_json` (or POST /plan/recompute) to generate it."
                ),
            },
        )
    raw = path.read_bytes()
    def reject_constant(value: str):
        raise json.JSONDecodeError(f"invalid JSON constant {value}", value, 0)

    try:
        canonical = json.loads(raw.decode("utf-8"), parse_constant=reject_constant)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=500,
            detail={"error": "data_corrupt", "detail": f"data.json could not be decoded: {exc}"},
        )
    etag = '"' + hashlib.sha256(raw).hexdigest()[:24] + '"'
    return canonical, etag


def create_app(data_path: Optional[Path] = None, *, allow_cors: bool = True) -> FastAPI:
    app = FastAPI(
        title="LineWise",
        version="2.3",
        description="LineWise backend HTTP API (frontend contract v2.3).",
    )

    if allow_cors:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_methods=["GET", "POST", "OPTIONS", "DELETE"],
            allow_headers=["*"],
        )

    state_path = data_path or _default_data_path()
    app.state.data_path = state_path
    # In-memory stores for issues, stoppages, and plan overrides committed via
    # /plan/move and /plan/stoppage-replan. These are intentionally process-
    # local: the canonical pipeline is still the source of truth, these are
    # mutations layered on top so the frontend can round-trip writes.
    app.state.issues = []
    app.state.stoppages = []
    app.state.plan_override = None  # dict[lineKey, Band[]] or None

    @app.exception_handler(HTTPException)
    async def _http_exc_handler(_request: Request, exc: HTTPException):
        detail = exc.detail
        if isinstance(detail, dict) and "error" in detail and "detail" in detail:
            return JSONResponse(status_code=exc.status_code, content=detail)
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": "http_error", "detail": str(detail)},
        )

    @app.get("/health")
    def health() -> dict:
        return {"ok": True}

    @app.get("/plan")
    def plan(request: Request, response: Response):
        payload, etag = _build_plan_response(request.app)

        client_etag = request.headers.get("if-none-match")
        if client_etag and client_etag == etag:
            return Response(status_code=304, headers={"ETag": etag})

        response.headers["ETag"] = etag
        response.headers["Cache-Control"] = "no-store"
        return payload

    @app.post("/plan/recompute")
    def recompute(request: Request) -> dict:
        path: Path = request.app.state.data_path
        raw_dir = config.RAW_DIR
        processed_dir = config.PROCESSED_DIR

        if not raw_dir.exists():
            raise HTTPException(
                status_code=412,
                detail={
                    "error": "raw_missing",
                    "detail": f"Raw data directory not found: {raw_dir}. "
                              "Drop the Damm Excel exports into data/raw/ before recomputing.",
                },
            )

        cmd = [
            sys.executable, "-m", "app.export_data_json",
            "--raw", str(raw_dir),
            "--out", str(path),
            "--processed", str(processed_dir),
        ]
        try:
            result = subprocess.run(
                cmd,
                cwd=str(config.BASE_DIR),
                capture_output=True,
                text=True,
                timeout=180,
                check=False,
            )
        except subprocess.TimeoutExpired:
            raise HTTPException(
                status_code=504,
                detail={"error": "recompute_timeout", "detail": "export_data_json exceeded 180s"},
            )

        if result.returncode != 0:
            raise HTTPException(
                status_code=500,
                detail={
                    "error": "recompute_failed",
                    "detail": (result.stderr or result.stdout or "exporter failed").strip()[-2000:],
                },
            )
        # Recompute invalidates any in-memory plan override — the canonical
        # file is fresh, so the operator should see the new committed plan.
        request.app.state.plan_override = None
        return {"ok": True, "message": "data.json regenerated.", "output": str(path)}

    # ----------------------------- writes -----------------------------

    @app.post("/issues")
    async def post_issue(request: Request) -> dict:
        body = await _read_json(request)
        line = _require_line(body.get("line"))
        category = _require_choice(body.get("category"), ISSUE_CATEGORIES, "category")
        severity = _require_choice(body.get("severity"), ISSUE_SEVERITIES, "severity")
        note = str(body.get("note") or "")
        client_ts = _coerce_ts(body.get("ts"))

        issue = {
            "id": f"iss-{uuid.uuid4().hex[:12]}",
            "line": line,
            "category": category,
            "severity": severity,
            "note": note,
            "ts": _server_ts(client_ts),
        }
        request.app.state.issues.append(issue)
        return {"issue": issue}

    @app.post("/stoppages")
    async def post_stoppage(request: Request) -> dict:
        body = await _read_json(request)
        line = _require_line(body.get("line"))
        reason = _require_choice(body.get("reason"), STOPPAGE_REASONS, "reason")
        duration = _require_choice(body.get("duration"), STOPPAGE_DURATIONS, "duration")
        start_ago = body.get("startAgoMin")
        if start_ago not in (0, 5, 10, 15):
            raise HTTPException(
                status_code=400,
                detail={"error": "bad_request",
                        "detail": "startAgoMin must be one of 0, 5, 10, 15"},
            )
        started_at = _coerce_ts(body.get("startedAt"))
        client_ts = _coerce_ts(body.get("ts"))

        # one-active-per-line invariant
        request.app.state.stoppages = [
            s for s in request.app.state.stoppages if s.get("line") != line
        ]
        stoppage = {
            "id": f"stp-{uuid.uuid4().hex[:12]}",
            "line": line,
            "reason": reason,
            "startedAt": started_at,
            "startAgoMin": int(start_ago),
            "duration": duration,
            "ts": _server_ts(client_ts),
        }
        request.app.state.stoppages.append(stoppage)
        return {"stoppage": stoppage, "stoppages": list(request.app.state.stoppages)}

    @app.post("/stoppages/{stoppage_id}/resume")
    def resume_stoppage(stoppage_id: str, request: Request) -> dict:
        before = list(request.app.state.stoppages)
        remaining = [s for s in before if s.get("id") != stoppage_id]
        if len(remaining) == len(before):
            raise HTTPException(
                status_code=404,
                detail={"error": "not_found",
                        "detail": f"No active stoppage with id {stoppage_id!r}."},
            )
        request.app.state.stoppages = remaining
        return {"stoppages": remaining}

    @app.post("/plan/stoppage-replan")
    async def stoppage_replan(request: Request) -> dict:
        body = await _read_json(request)
        line = _require_line(body.get("line"))
        duration_key = _require_choice(
            body.get("durationKey"), STOPPAGE_DURATIONS, "durationKey",
        )
        stoppage_id = str(body.get("stoppageId") or "")

        plan, etag = _current_plan_payload(request.app)
        base_plan = plan.get("basePlan") or {}
        lane = list(base_plan.get(line) or [])
        hours = _DURATION_HOURS[duration_key]

        shifted_lane = [
            {**seg, "start": float(seg.get("start") or 0.0) + hours}
            for seg in lane
        ]
        new_base = {**base_plan, line: shifted_lane}
        request.app.state.plan_override = new_base

        # Surface the audit trail: which stoppage prompted the shift.
        for s in request.app.state.stoppages:
            if s.get("id") == stoppage_id:
                s["replanned"] = True
                break

        new_plan, _ = _build_plan_response(request.app)
        return {
            "plan": new_plan,
            "shiftedCount": len(lane),
            "shiftedHours": hours,
        }

    @app.post("/plan/move/preview")
    async def move_preview(request: Request) -> dict:
        body = await _read_json(request)
        return _move_response(request.app, body, commit=False)

    @app.post("/plan/move")
    async def move_commit(request: Request) -> dict:
        body = await _read_json(request)
        return _move_response(request.app, body, commit=True)

    return app


# ============================================================ helpers


async def _read_json(request: Request) -> Dict[str, Any]:
    try:
        body = await request.json()
    except Exception as exc:  # noqa: BLE001 — fastapi raises various types
        raise HTTPException(
            status_code=400,
            detail={"error": "bad_request", "detail": f"Body is not valid JSON: {exc}"},
        ) from exc
    if not isinstance(body, dict):
        raise HTTPException(
            status_code=400,
            detail={"error": "bad_request", "detail": "Body must be a JSON object."},
        )
    return body


def _require_line(value: Any) -> str:
    line = str(value or "")
    if line not in KNOWN_LINES:
        raise HTTPException(
            status_code=400,
            detail={"error": "bad_request",
                    "detail": f"line must be one of {list(KNOWN_LINES)}, got {value!r}"},
        )
    return line


def _require_choice(value: Any, allowed: tuple, field: str) -> str:
    if value not in allowed:
        raise HTTPException(
            status_code=400,
            detail={"error": "bad_request",
                    "detail": f"{field} must be one of {list(allowed)}, got {value!r}"},
        )
    return value


def _coerce_ts(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return int(time.time() * 1000)


def _server_ts(client_ts: int) -> int:
    """Take the server's clock as authoritative but fall back to the client's
    ts if the server clock is unreliable in tests."""
    now_ms = int(time.time() * 1000)
    return now_ms if now_ms > 0 else client_ts


def _current_plan_payload(app: FastAPI) -> tuple[Dict[str, Any], str]:
    """Build the plan payload (with overrides + issues + stoppages applied)."""
    return _build_plan_response(app)


def _build_plan_response(app: FastAPI) -> tuple[Dict[str, Any], str]:
    path: Path = app.state.data_path
    canonical, etag_base = _load_canonical(path)
    payload = build_frontend_payload(canonical)

    if isinstance(app.state.plan_override, dict):
        payload["basePlan"] = copy.deepcopy(app.state.plan_override)

    payload["issues"] = list(app.state.issues)
    payload["stoppages"] = list(app.state.stoppages)

    # ETag covers writeable state too, otherwise the frontend would 304 after
    # logging an issue and miss the update.
    state_hash = hashlib.sha256(
        json.dumps(
            [app.state.issues, app.state.stoppages, app.state.plan_override],
            sort_keys=True, default=str,
        ).encode("utf-8"),
    ).hexdigest()[:8]
    etag = etag_base[:-1] + "-" + state_hash + '"'
    return payload, etag


def _move_response(app: FastAPI, body: Dict[str, Any], *, commit: bool) -> Dict[str, Any]:
    run_id = str(body.get("runId") or "").strip()
    if not run_id:
        raise HTTPException(
            status_code=400,
            detail={"error": "bad_request", "detail": "runId is required."},
        )
    from_line = _require_line(body.get("fromLine"))
    to_line = _require_line(body.get("toLine"))
    slot_index = body.get("slotIndex")
    try:
        slot_index = int(slot_index)
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=400,
            detail={"error": "bad_request", "detail": "slotIndex must be an integer."},
        )

    plan, _ = _build_plan_response(app)
    base_plan = plan.get("basePlan") or {}
    src_lane = list(base_plan.get(from_line) or [])
    found_idx = next(
        (i for i, seg in enumerate(src_lane) if seg.get("of") == run_id), -1,
    )
    if found_idx < 0:
        raise HTTPException(
            status_code=404,
            detail={"error": "not_found",
                    "detail": f"Run {run_id!r} not found on line {from_line}."},
        )
    moving = src_lane[found_idx]
    push_amount = float(moving.get("w") or 0.0)

    # Source: drop the run, keep the gap. Destination: insert + shift forward.
    src_lane.pop(found_idx)
    if from_line == to_line:
        dest_lane = src_lane
        adj_idx = slot_index - 1 if slot_index > found_idx else slot_index
    else:
        dest_lane = list(base_plan.get(to_line) or [])
        adj_idx = slot_index
    adj_idx = max(0, min(adj_idx, len(dest_lane)))

    prev = dest_lane[adj_idx - 1] if adj_idx > 0 else None
    inserted_start = (
        float(prev.get("start") or 0.0) + float(prev.get("w") or 0.0) if prev else 0.0
    )

    pushed_count = 0
    collisions: List[Dict[str, Any]] = []
    for i in range(adj_idx, len(dest_lane)):
        seg = dest_lane[i]
        kind = seg.get("kind")
        if kind in ("clean", "maint"):
            collisions.append({
                "of": "Scheduled cleaning" if kind == "clean" else "Scheduled maintenance",
                "kind": kind,
                "byHours": push_amount,
            })
        dest_lane[i] = {**seg, "start": float(seg.get("start") or 0.0) + push_amount}
        pushed_count += 1

    inserted = {**moving, "start": inserted_start}
    dest_lane.insert(adj_idx, inserted)

    new_base = {**base_plan, to_line: dest_lane}
    if from_line != to_line:
        new_base[from_line] = src_lane

    dest_next = dest_lane[adj_idx + 1] if adj_idx + 1 < len(dest_lane) else None
    ripple = {
        "runId": run_id,
        "fromLine": from_line,
        "toLine": to_line,
        "destPrev": (prev.get("of") or prev.get("kind")) if prev else None,
        "destNext": (dest_next.get("of") or dest_next.get("kind")) if dest_next else None,
        "pushedCount": pushed_count,
        "formatSwitchesOld": _count_format_switches(base_plan, from_line)
            + (0 if from_line == to_line else _count_format_switches(base_plan, to_line)),
        "formatSwitchesNew": _count_format_switches(new_base, from_line)
            + (0 if from_line == to_line else _count_format_switches(new_base, to_line)),
        "collisions": collisions,
    }

    if commit:
        app.state.plan_override = new_base
        new_plan, _ = _build_plan_response(app)
        return {"plan": new_plan, "ripple": ripple}
    # preview: render the hypothetical plan without persisting
    hypothetical = copy.deepcopy(plan)
    hypothetical["basePlan"] = new_base
    return {"plan": hypothetical, "ripple": ripple}


def _count_format_switches(plan: Dict[str, Any], line: str) -> int:
    lane = plan.get(line) or []
    count = 0
    prev_fmt: Optional[str] = None
    for seg in lane:
        if seg.get("kind") in ("clean", "maint"):
            prev_fmt = None
            continue
        sku = (seg.get("sku") or "").upper()
        of = (seg.get("of") or "").upper()
        fmt = _derive_format(sku, of)
        if prev_fmt and fmt and prev_fmt != fmt:
            count += 1
        prev_fmt = fmt
    return count


def _derive_format(sku: str, of: str) -> Optional[str]:
    """Mirrors deriveFormat() in linewise/src/components/TimelineCard.jsx.
    Cheap heuristic — exact match to the frontend keeps the move preview
    deltas the same on either side."""
    blob = f"{sku} {of}"
    if "50CL" in blob or "1/2" in blob:
        return "50cl"
    if "44CL" in blob or "2/5" in blob:
        return "44cl"
    if "33CL" in blob or "1/3" in blob:
        return "33cl"
    return None


def _parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the LineWise HTTP API.")
    parser.add_argument("--host", default=os.environ.get("LINEWISE_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("LINEWISE_PORT", "8000")))
    parser.add_argument("--data", default=str(_default_data_path()),
                        help="Path to canonical data.json (default: data/output/data.json).")
    parser.add_argument("--reload", action="store_true",
                        help="Enable uvicorn auto-reload for local dev.")
    return parser.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    args = _parse_args(argv)
    data_path = Path(args.data).expanduser().resolve()

    # uvicorn's import-string mode is required for --reload; for stable runs
    # we hand it an app object directly so the path override sticks.
    if args.reload:
        os.environ["LINEWISE_DATA_JSON"] = str(data_path)
        import uvicorn  # local import keeps cold start cheap
        uvicorn.run("app.server:create_app", host=args.host, port=args.port,
                    factory=True, reload=True)
    else:
        import uvicorn

        app = create_app(data_path=data_path)
        uvicorn.run(app, host=args.host, port=args.port)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
