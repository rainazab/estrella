"""LineWise HTTP server.

Endpoints (matching docs/API_CONTRACT.md):

  GET /health         — { "ok": true }
  GET /plan           — frontend-shape payload (ETag + Cache-Control: no-store)
  POST /plan/recompute — regenerate data/output/data.json on demand

The server reads `data/output/data.json` on every /plan request — the batch
exporter is still the source of truth. If the file is missing, the server
returns 503 with a JSON `{ "error", "detail" }` body so the frontend can
display the message.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import config
from .frontend_payload import build_frontend_payload


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
    try:
        canonical = json.loads(raw.decode("utf-8"))
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
        version="2.0",
        description="LineWise backend HTTP API (frontend contract v2.0).",
    )

    if allow_cors:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_methods=["GET", "POST", "OPTIONS"],
            allow_headers=["*"],
        )

    state_path = data_path or _default_data_path()
    app.state.data_path = state_path

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
        path: Path = request.app.state.data_path
        canonical, etag = _load_canonical(path)

        client_etag = request.headers.get("if-none-match")
        if client_etag and client_etag == etag:
            return Response(status_code=304, headers={"ETag": etag})

        payload = build_frontend_payload(canonical)
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
        return {"ok": True, "message": "data.json regenerated.", "output": str(path)}

    return app


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
