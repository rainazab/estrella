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
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import pandas as pd

from .config import RAW_DIR
from .line_rules import LINE_FORMAT_CAPABILITIES

CF_FILE = RAW_DIR / "Tabla CF Prat 2026_14_17_19.xlsx"

# Canonical labels used as row/column keys in the parsed matrix
_FORMAT_KEYS = {"1/3", "1/2", "2/5"}
_AUX_KEYS = {"Cambio Packaging", "Cambio a Bandeja", "Cambio Paletizado"}

FORMAT_UI = {
    "1/2": {"key": "1/2", "label": "50cl", "name": "medio"},
    "1/3": {"key": "1/3", "label": "33cl", "name": "tercio"},
    "2/5": {"key": "2/5", "label": "44cl", "name": "2/5"},
}
FORMAT_ORDER = ("1/2", "1/3", "2/5")
DAY_CODE_TO_WEEKDAY = {
    "L": 0,
    "M": 1,
    "X": 2,
    "J": 3,
    "V": 4,
    "S": 5,
    "D": 6,
}
SHIFT_PATTERN_COLUMNS = {
    "1 turno": (3, 4),
    "2 turnos": (5, 6),
    "3 turnos": (7, 8),
    "5 turnos": (9, 10),
}


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


def _duration_hours(value) -> Optional[float]:
    minutes = _parse_duration(value)
    return round(minutes / 60.0, 2) if minutes is not None else None


def _text(value: Any) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    return str(value).strip()


def _weekly_offset_hours(anchor: date, day_code: str) -> Optional[float]:
    weekday = DAY_CODE_TO_WEEKDAY.get(day_code.upper())
    if weekday is None:
        return None
    delta_days = (weekday - anchor.weekday()) % 7
    return float(delta_days * 24)


def _first_matching_weekday(anchor: date, weekday: int) -> date:
    """Earliest date >= anchor whose weekday matches `weekday` (0=Mon)."""
    delta = (weekday - anchor.weekday()) % 7
    return anchor + timedelta(days=delta)


def _first_matching_weekday_in_month(year: int, month: int, weekday: int, *, on_or_after: date) -> Optional[date]:
    """First date in the given calendar month whose weekday matches,
    restricted to dates >= `on_or_after`. None if no such date exists."""
    from calendar import monthrange
    days_in_month = monthrange(year, month)[1]
    for day in range(1, days_in_month + 1):
        d = date(year, month, day)
        if d.weekday() == weekday and d >= on_or_after:
            return d
    return None


def _project_row_instances(row: Dict[str, Any], anchor: date, horizon_days: int) -> List[date]:
    """Expand one Tabla CF row into the concrete dates its cadence fires
    on within [anchor, anchor+horizon_days]. Recognised cadences:
    semanal (weekly), quincenal (fortnightly), mensual (monthly first
    matching weekday). Unknown cadences fall back to a single occurrence."""
    weekday = DAY_CODE_TO_WEEKDAY.get(str(row.get("day") or "").upper())
    if weekday is None:
        return []
    cadence = str(row.get("cadence") or "").lower()
    horizon_end = anchor + timedelta(days=horizon_days)

    if cadence == "semanal":
        step = timedelta(days=7)
        first = _first_matching_weekday(anchor, weekday)
    elif cadence == "quincenal":
        step = timedelta(days=14)
        first = _first_matching_weekday(anchor, weekday)
    elif cadence == "mensual":
        # One occurrence per month — the first matching weekday in each
        # calendar month within the horizon.
        occurrences: List[date] = []
        cursor = anchor
        while cursor <= horizon_end:
            first_in_month = _first_matching_weekday_in_month(
                cursor.year, cursor.month, weekday, on_or_after=anchor,
            )
            if first_in_month is not None and anchor <= first_in_month <= horizon_end:
                if not occurrences or first_in_month != occurrences[-1]:
                    occurrences.append(first_in_month)
            # advance to next month
            if cursor.month == 12:
                cursor = date(cursor.year + 1, 1, 1)
            else:
                cursor = date(cursor.year, cursor.month + 1, 1)
        return occurrences
    else:
        # Unknown cadence — emit one occurrence so the marker still shows
        # rather than silently dropping it.
        return [_first_matching_weekday(anchor, weekday)]

    occurrences: List[date] = []
    cursor = first
    while cursor <= horizon_end:
        occurrences.append(cursor)
        cursor = cursor + step
    return occurrences


# Order of preference when a line has multiple rows for the same
# (kind, cadence) under different shift patterns. The line only runs
# one pattern at a time, so we keep the most operationally typical one
# (3 turnos for the everyday baseline, 5 turnos for the maintenance
# shift). Anything unknown sorts last.
_SHIFT_PATTERN_PRIORITY = {
    "3 turnos": 0,
    "5 turnos": 1,
    "2 turnos": 2,
    "1 turno": 3,
}

# Within a kind, Tabla CF lists several cadences (mensual / quincenal /
# semanal) keyed by shift pattern — these are *alternatives* for the
# active shift pattern, not additive events. A line on 3 turnos runs a
# weekly clean; on 1 turno it'd run a monthly clean instead. We pick
# the operationally typical cadence per kind so the same Monday isn't
# stacked with mensual + quincenal + semanal cleans (the previous
# behaviour put 3 cleanings on top of each other every week with a
# mensual Monday).
_KIND_PREFERRED_CADENCE = {
    "clean": "semanal",     # weekly baseline cleaning
    "maint": "quincenal",   # bi-weekly maintenance
}


def _dedupe_by_kind(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Pick exactly one row per kind, preferring the configured cadence
    (semanal for clean, quincenal for maint) and breaking ties on the
    highest-priority shift pattern.

    The earlier (kind, cadence) keying treated mensual/quincenal/semanal
    as additive events — they're not. The Tabla CF rows represent the
    cleaning cadence for *different operating modes*; only the active
    one fires."""
    by_kind: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        kind = row.get("kind")
        if not kind:
            continue
        preferred = _KIND_PREFERRED_CADENCE.get(kind)
        if preferred and str(row.get("cadence") or "").lower() != preferred:
            continue
        pri = _SHIFT_PATTERN_PRIORITY.get(str(row.get("shiftPattern") or ""), 99)
        existing = by_kind.get(kind)
        if existing is None or pri < _SHIFT_PATTERN_PRIORITY.get(
            str(existing.get("shiftPattern") or ""), 99,
        ):
            by_kind[kind] = row
    # Fallback: if a kind has no row matching the preferred cadence
    # (e.g. a line whose only maintenance cadence is mensual), keep the
    # best available row of that kind so we don't silently drop it.
    for row in rows:
        kind = row.get("kind")
        if not kind or kind in by_kind:
            continue
        pri = _SHIFT_PATTERN_PRIORITY.get(str(row.get("shiftPattern") or ""), 99)
        existing = by_kind.get(kind)
        if existing is None or pri < _SHIFT_PATTERN_PRIORITY.get(
            str(existing.get("shiftPattern") or ""), 99,
        ):
            by_kind[kind] = row
    return list(by_kind.values())


def _merge_simultaneous_service_events(events: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Collapse clean+maint events that land on the same line/date.

    Tabla CF can put weekly cleaning and fortnightly maintenance on the
    same weekday. For one packaging line that is one locked service window,
    not two independent 8h blocks drawn back-to-back in the Gantt.
    """
    grouped: Dict[Tuple[str, float], List[Dict[str, Any]]] = {}
    for event in events:
        grouped.setdefault((str(event.get("line") or ""), float(event.get("start") or 0.0)), []).append(event)

    merged: List[Dict[str, Any]] = []
    for (_line, _start), group in grouped.items():
        if len(group) == 1:
            merged.append(group[0])
            continue
        kinds = {str(item.get("kind") or "") for item in group}
        if not ({"clean", "maint"} <= kinds):
            merged.extend(group)
            continue

        primary = next((item for item in group if item.get("kind") == "maint"), group[0])
        duration = max(float(item.get("durationHours") or item.get("w") or 0.0) for item in group)
        merged.append({
            **primary,
            "id": "+".join(str(item.get("id") or "") for item in group if item.get("id")),
            "kind": "maint",
            "label": "Clean + maint.",
            "w": duration,
            "durationHours": duration,
            "includedKinds": sorted(kinds),
            "lockReason": "Cleaning and maintenance share this Tabla CF service window",
        })
    return sorted(merged, key=lambda e: (e["start"], 0 if e["kind"] == "clean" else 1))


def project_service_blocks(
    cadence_rows: Dict[str, List[Dict[str, Any]]],
    anchor: date,
    horizon_days: int = 90,
) -> Dict[str, List[Dict[str, Any]]]:
    """Project every row in the Tabla CF cadence list into concrete
    forward service blocks across the planning horizon.

    Returns `{ lineKey: [block, ...] }` where each block is the same shape
    a `Stop` would carry on the frontend: `{kind, start, w, durationHours,
    day, cadence, shiftPattern, locked, lockReason, source, id}`. Sorted
    by start ascending.

    Cadence-instance ids embed the ISO date so collisions are impossible
    across re-runs of the exporter: `L17-clean-semanal-2026-05-25`.

    The frontend reads these from `basePlan[line]` (where they get
    interleaved with production runs) and / or from `weeklyStops`. The
    exporter is responsible for injecting them into both."""
    out: Dict[str, List[Dict[str, Any]]] = {}
    for line, rows in (cadence_rows or {}).items():
        deduped = _dedupe_by_kind(list(rows or []))
        events: List[Dict[str, Any]] = []
        for row in deduped:
            for occurrence in _project_row_instances(row, anchor, horizon_days):
                start_hours = (occurrence - anchor).total_seconds() / 3600.0
                cadence = str(row.get("cadence") or "").lower()
                kind = row.get("kind") or "clean"
                events.append({
                    "id": f"L{line}-{kind}-{cadence}-{occurrence.isoformat()}",
                    "line": str(line),
                    "kind": kind,
                    "label": (
                        "Weekly cleaning" if kind == "clean" and cadence == "semanal"
                        else "Fortnightly cleaning" if kind == "clean" and cadence == "quincenal"
                        else "Monthly cleaning" if kind == "clean" and cadence == "mensual"
                        else "Fortnightly maintenance" if kind == "maint" and cadence == "quincenal"
                        else row.get("label") or ("Cleaning" if kind == "clean" else "Maintenance")
                    ),
                    "start": round(max(0.0, start_hours), 2),
                    "w": float(row.get("durationHours") or 8.0),
                    "durationHours": float(row.get("durationHours") or 8.0),
                    "day": row.get("day"),
                    "cadence": cadence,
                    "shiftPattern": row.get("shiftPattern"),
                    "locked": True,
                    "lockReason": f"{cadence.title()} {kind} ({row.get('shiftPattern')}) from Tabla CF Prat 2026",
                    "source": row.get("source") or "Tabla CF Prat 2026 · Tiempos adicionales",
                })
        out[str(line)] = _merge_simultaneous_service_events(events)
    return out


def _anchor_date(value: Optional[str | date | datetime]) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str) and value:
        try:
            return datetime.fromisoformat(value[:10]).date()
        except ValueError:
            pass
    return datetime.now().date()


def build_line_rules() -> Dict[str, Dict[str, Any]]:
    """Frontend-ready line-format capability rules.

    These are the ops constraints from `line_rules.py`, not inferred from
    history. The Tabla CF workbook is still the source for timing cadences.
    """
    rules: Dict[str, Dict[str, Any]] = {}
    for line, formats in sorted(LINE_FORMAT_CAPABILITIES.items()):
        allowed = [FORMAT_UI[f] for f in FORMAT_ORDER if f in formats]
        label = ", ".join(f["label"] for f in allowed)
        rules[str(line)] = {
            "line": str(line),
            "formats": allowed,
            "summary": f"L{line} only runs {label}",
            "locked": True,
            "source": "Damm operations line-format rules",
        }
    return rules


def _parse_line_cadence_rows(df: pd.DataFrame) -> Dict[str, list[Dict[str, Any]]]:
    rows: Dict[str, list[Dict[str, Any]]] = {str(line): [] for line in LINE_FORMAT_CAPABILITIES}
    current_line: Optional[str] = None

    for r in range(len(df)):
        first = _text(df.iloc[r, 0]).upper()
        if first.startswith("TREN "):
            match = re.search(r"\d+", first)
            current_line = match.group(0) if match else None

        if current_line not in rows:
            continue

        stop_label = _text(df.iloc[r, 1])
        if stop_label.lower() not in ("limpieza", "mantenimiento"):
            continue

        duration_h = _duration_hours(df.iloc[r, 2])
        if duration_h is None:
            continue

        kind = "clean" if stop_label.lower() == "limpieza" else "maint"
        for shift_pattern, (day_col, freq_col) in SHIFT_PATTERN_COLUMNS.items():
            day_code = _text(df.iloc[r, day_col]).upper()
            cadence = _text(df.iloc[r, freq_col]).upper()
            if not day_code or day_code == "-" or not cadence or cadence == "-":
                continue
            rows[current_line].append({
                "kind": kind,
                "label": "Cleaning" if kind == "clean" else "Maintenance",
                "durationHours": duration_h,
                "day": day_code,
                "cadence": cadence.lower(),
                "shiftPattern": shift_pattern,
                "source": "Tabla CF Prat 2026 · Tiempos adicionales",
            })
    return rows


def _preferred_weekly_marker(
    rows: list[Dict[str, Any]],
    *,
    kind: str,
    anchor: date,
) -> Optional[Dict[str, Any]]:
    candidates = [r for r in rows if r.get("kind") == kind]
    if not candidates:
        return None

    if kind == "clean":
        preferred = next(
            (r for r in candidates if r.get("shiftPattern") == "3 turnos" and r.get("cadence") == "semanal"),
            None,
        )
    else:
        preferred = next(
            (r for r in candidates if r.get("shiftPattern") == "5 turnos"),
            None,
        )
    row = preferred or candidates[0]
    start = _weekly_offset_hours(anchor, str(row.get("day") or ""))
    if start is None:
        return None
    cadence = str(row.get("cadence") or "").lower()
    return {
        "kind": row["kind"],
        "label": (
            "Weekly cleaning" if row["kind"] == "clean" and cadence == "semanal"
            else "Fortnightly maintenance" if row["kind"] == "maint" and cadence == "quincenal"
            else row["label"]
        ),
        "start": round(start, 2),
        "w": float(row["durationHours"]),
        "durationHours": float(row["durationHours"]),
        "day": row["day"],
        "cadence": row["cadence"],
        "shiftPattern": row["shiftPattern"],
        "locked": True,
        "source": row["source"],
    }


def load_operational_contract(anchor_date: Optional[str | date | datetime] = None) -> Dict[str, Any]:
    """Load frontend-visible operating rules from hard rules + Tabla CF.

    Returns `lineRules` and `weeklyStops`. Missing workbook data degrades to
    an empty stop list while preserving the line capability rules.
    """
    anchor = _anchor_date(anchor_date)
    out = {
        "lineRules": build_line_rules(),
        "weeklyStops": {str(line): [] for line in LINE_FORMAT_CAPABILITIES},
        "cleaningSchedule": {str(line): [] for line in LINE_FORMAT_CAPABILITIES},
    }
    if not CF_FILE.exists():
        return out

    try:
        df = pd.read_excel(CF_FILE, sheet_name="Tiempos adicionales", header=None)
    except Exception:
        return out

    cadence_rows = _parse_line_cadence_rows(df)
    out["cleaningSchedule"] = cadence_rows
    for line_key, rows in cadence_rows.items():
        stops = []
        for kind in ("clean", "maint"):
            marker = _preferred_weekly_marker(rows, kind=kind, anchor=anchor)
            if marker:
                marker["id"] = f"L{line_key}-{kind}-{marker['day']}-{marker['cadence']}"
                marker["line"] = line_key
                stops.append(marker)
        stops.sort(key=lambda s: (float(s.get("start", 0)), s.get("kind") != "clean"))
        out["weeklyStops"][line_key] = stops
    return out


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
