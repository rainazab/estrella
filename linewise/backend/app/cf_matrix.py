"""Parse the Tabla CF Prat 2026 LATA_BARRIL matrix.

That matrix is the planning truth for *theoretical* changeover times by
line and from→to format. LineWise uses it as the first-class baseline; the
historical median is only the fallback.

The sheet is laid out as three blocks, each headed by "TREN <line>", with a
square matrix of changeover labels: 1/3, 1/2, 2/5 (line 19 only),
"Cambio Packaging", "Cambio a Bandeja", "Cambio Paletizado". Cells contain
strings like "3 h", "1 h 15 min", "40 min", "30 min".

Public API:
    load_cf_matrix() -> CFMatrix
    CFMatrix.changeover_minutes(line, prev_format, cur_format) -> float | None
    CFMatrix.format_change_minutes(line, prev_format, cur_format) -> float | None
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Optional, Tuple

import pandas as pd

from .config import RAW_DIR

CF_FILE = RAW_DIR / "Tabla CF Prat 2026_14_17_19.xlsx"

# Canonical labels used as row/column keys in the parsed matrix
_FORMAT_KEYS = {"1/3", "1/2", "2/5"}
_AUX_KEYS = {"Cambio Packaging", "Cambio a Bandeja", "Cambio Paletizado"}


# Documented fallback transcribed from Tabla CF Prat 2026, sheet LATA_BARRIL.
# Used when the Excel parser can't reach a particular cell. Values in minutes.
FALLBACK_CHANGEOVER_MINUTES: Dict[int, Dict[tuple, float]] = {
    14: {
        ("1/3", "1/2"): 180.0,
        ("1/2", "1/3"): 180.0,
    },
    17: {
        ("1/3", "1/2"): 480.0,
        ("1/2", "1/3"): 480.0,
    },
    19: {
        ("1/3", "1/2"): 360.0, ("1/2", "1/3"): 360.0,
        ("1/3", "2/5"): 360.0, ("2/5", "1/3"): 360.0,
        ("1/2", "2/5"): 360.0, ("2/5", "1/2"): 360.0,
    },
}


def _parse_duration(value) -> Optional[float]:
    """Convert '3 h', '1 h 15 min', '40 min', '30 min' → minutes (float)."""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    s = str(value).strip().lower()
    if not s or s == "nan":
        return None
    minutes = 0.0
    h = re.search(r"(\d+(?:[.,]\d+)?)\s*h", s)
    m = re.search(r"(\d+(?:[.,]\d+)?)\s*min", s)
    if h:
        minutes += float(h.group(1).replace(",", ".")) * 60.0
    if m:
        minutes += float(m.group(1).replace(",", "."))
    if h is None and m is None:
        # Bare number — assume minutes
        try:
            return float(s.replace(",", "."))
        except ValueError:
            return None
    return minutes


@dataclass
class CFMatrix:
    """In-memory lookup of theoretical changeover times from Tabla CF."""

    # nested dict: line → from_label → to_label → minutes
    table: Dict[int, Dict[str, Dict[str, float]]] = field(default_factory=dict)
    loaded: bool = False
    source_path: Optional[str] = None

    def changeover_minutes(
        self, line: int, prev_format: Optional[str], cur_format: Optional[str]
    ) -> Optional[float]:
        """Look up the theoretical changeover (min) between two formats on a line."""
        if not self.loaded or prev_format is None or cur_format is None:
            return None
        line_block = self.table.get(int(line))
        if not line_block:
            return None
        row = line_block.get(prev_format) or {}
        return row.get(cur_format)

    def format_change_minutes(
        self, line: int, prev_format: Optional[str], cur_format: Optional[str]
    ) -> Optional[float]:
        """Same as changeover_minutes but returns 0 when formats are equal."""
        if prev_format and cur_format and prev_format == cur_format:
            return 0.0
        return self.changeover_minutes(line, prev_format, cur_format)

    def with_fallback(
        self, line: int, prev_format: Optional[str], cur_format: Optional[str]
    ) -> Optional[float]:
        """Look up the theoretical CO, falling back to FALLBACK_CHANGEOVER_MINUTES.

        The parsed Excel is the first source of truth. When a cell isn't
        reachable (sheet drift, label rename) we fall through to the
        documented dictionary so the demo doesn't lose this baseline.
        """
        if prev_format and cur_format and prev_format == cur_format:
            return 0.0
        v = self.changeover_minutes(line, prev_format, cur_format)
        if v is not None:
            return v
        fb = FALLBACK_CHANGEOVER_MINUTES.get(int(line), {})
        return fb.get((prev_format, cur_format))


def _parse_block(df: pd.DataFrame, header_row: int) -> Tuple[int, Dict[str, Dict[str, float]]]:
    """Parse one TREN block starting at `header_row` (which is the 'TREN N' row)."""
    header = df.iloc[header_row]
    line_label = str(header.iloc[0]) if pd.notna(header.iloc[0]) else ""
    m = re.search(r"\d+", line_label)
    if not m:
        return 0, {}
    line = int(m.group(0))

    columns: list[str] = []
    for col_idx in range(1, df.shape[1]):
        v = header.iloc[col_idx]
        if pd.isna(v):
            continue
        columns.append(str(v).strip())

    table: Dict[str, Dict[str, float]] = {}
    r = header_row + 1
    while r < len(df):
        label = df.iloc[r, 0]
        if pd.isna(label):
            break
        label_s = str(label).strip()
        # Stop at next TREN block
        if re.match(r"(?i)^tren\b", label_s):
            break
        row_dict: Dict[str, float] = {}
        for col_offset, col_label in enumerate(columns, start=1):
            val = df.iloc[r, col_offset] if col_offset < df.shape[1] else None
            minutes = _parse_duration(val)
            if minutes is not None:
                row_dict[col_label] = minutes
        if row_dict:
            table[label_s] = row_dict
        r += 1
    return line, table


def load_cf_matrix() -> CFMatrix:
    """Parse LATA_BARRIL sheet — never raises; returns an empty CFMatrix on failure."""
    cf = CFMatrix()
    if not CF_FILE.exists():
        return cf
    try:
        df = pd.read_excel(CF_FILE, sheet_name="LATA_BARRIL", header=None)
    except Exception:
        return cf

    # Find every row that starts a TREN <n> block
    for r in range(len(df)):
        first = df.iloc[r, 0]
        if pd.notna(first) and re.match(r"(?i)^tren\b", str(first)):
            line, block = _parse_block(df, r)
            if line and block:
                cf.table[line] = block

    cf.loaded = bool(cf.table)
    cf.source_path = str(CF_FILE)
    return cf
