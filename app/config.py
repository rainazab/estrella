"""Project paths and line constants for the LineWise backend.

BASE_DIR is the repository root (the parent of `app/`). Every CLI accepts
overrides, but these defaults make the pipeline run identically from any
working directory.
"""
from __future__ import annotations

import os
from pathlib import Path

try:
    from dotenv import load_dotenv  # type: ignore

    load_dotenv()
except Exception:
    # python-dotenv is optional — env vars can be set in the shell.
    pass


BASE_DIR = Path(__file__).resolve().parent.parent

RAW_DIR = Path(os.environ.get("LINEWISE_RAW_DIR", BASE_DIR / "data" / "raw"))
PROCESSED_DIR = Path(os.environ.get("LINEWISE_PROCESSED_DIR", BASE_DIR / "data" / "processed"))
OUTPUT_DIR = Path(os.environ.get("LINEWISE_OUTPUT_DIR", BASE_DIR / "data" / "output"))

PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

LINES = [14, 17, 19]
