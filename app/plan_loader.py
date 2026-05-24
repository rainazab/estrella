"""Load the forward production plan from the Planificado Excel export.

The Damm Planificado file lists planned production rows per line, with start
date+time, planned quantity (cases) and a sequence index. This module turns
those rows into the per-line timeline segments the LineWise frontend expects
for `basePlan`.

Fallback: when Planificado is missing or unparseable, the caller can fall
back to a historical-rows-as-plan derivation. Whichever source was used is
reported in `metadata.basePlanSource` and the validation report.
"""
from __future__ import annotations

import math
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
from unidecode import unidecode

from .line_rules import LINE_FORMAT_CAPABILITIES, normalize_format


# Cases → HL conversion per format. Conservative — the planner sees a
# relative-size number, not a contractual HL.
_HL_PER_CASE = {
    "1/3": 24 * 0.33 / 100.0,   # 24 × 33cl
    "1/2": 12 * 0.50 / 100.0,   # 12 × 50cl
    "2/5": 12 * 0.44 / 100.0,   # 12 × 44cl
}
_FALLBACK_HL_PER_CASE = 0.080


def _norm(s: str) -> str:
    s = unidecode(str(s)).lower().strip()
    s = re.sub(r"[\s/.%\-\(\)]+", "_", s)
    s = re.sub(r"[^a-z0-9_]+", "", s)
    s = re.sub(r"_+", "_", s).strip("_")
    return s


def _find_col(df: pd.DataFrame, candidates: List[str]) -> Optional[str]:
    cols = list(df.columns)
    for cand in candidates:
        c = _norm(cand)
        if c in cols:
            return c
    for cand in candidates:
        c = _norm(cand)
        for col in cols:
            if c and c in col:
                return col
    return None


def _format_key_from_text(text: Optional[str]) -> Optional[str]:
    if not text:
        return None
    return normalize_format(str(text))


def _find_plan_file(raw_dir: Path) -> Optional[Path]:
    """Locate any Planificado file by name pattern, tolerant of small renames."""
    if not raw_dir.exists():
        return None
    direct = raw_dir / "Planificado - producciones 14 - 17 - 19.XLSX"
    if direct.exists():
        return direct
    pattern = re.compile(r"planificad.*14.*17.*19", re.IGNORECASE)
    for p in sorted(raw_dir.iterdir()):
        if p.suffix.lower() not in (".xlsx", ".xlsm", ".xls"):
            continue
        if pattern.search(p.name):
            return p
    return None


def _read_plan_excel(path: Path) -> Optional[pd.DataFrame]:
    try:
        xl = pd.ExcelFile(path)
    except Exception:
        return None
    for sheet in xl.sheet_names:
        try:
            df = pd.read_excel(path, sheet_name=sheet)
        except Exception:
            continue
        if df is None or df.empty:
            continue
        df = df.copy()
        df.columns = [_norm(c) for c in df.columns]
        return df
    return None


def _row_start(row: pd.Series, fecha_col: str, hora_col: Optional[str]) -> Optional[pd.Timestamp]:
    base = pd.to_datetime(row.get(fecha_col), errors="coerce")
    if pd.isna(base):
        return None
    if hora_col and hora_col in row.index:
        hora = row.get(hora_col)
        if isinstance(hora, str):
            try:
                hora = pd.to_datetime(hora).time()
            except Exception:
                hora = None
        if hasattr(hora, "hour"):
            try:
                base = base.normalize() + pd.Timedelta(
                    hours=int(hora.hour),
                    minutes=int(getattr(hora, "minute", 0)),
                )
            except Exception:
                pass
    return base


def _seg_volume(qty: Optional[float], format_key: Optional[str]) -> int:
    if qty is None or (isinstance(qty, float) and math.isnan(qty)):
        return 0
    per = _HL_PER_CASE.get(format_key or "", _FALLBACK_HL_PER_CASE)
    try:
        return int(round(float(qty) * per))
    except (TypeError, ValueError):
        return 0


def _line_sku_oee(master: Optional[pd.DataFrame], line: int, material: Optional[str]) -> Optional[float]:
    if master is None or master.empty or not material:
        return None
    if "tren" not in master.columns or "sku" not in master.columns or "oee" not in master.columns:
        return None
    mask = (master["tren"] == line) & (master["sku"].astype(str) == str(material))
    sub = master[mask & master["oee"].notna()]
    if sub.empty:
        return None
    return float(sub["oee"].mean())


def load_forward_plan(
    raw_dir: Path,
    master: Optional[pd.DataFrame] = None,
    *,
    lines: Tuple[int, ...] = (14, 17, 19),
) -> Dict[str, Any]:
    """Parse the Planificado Excel into per-line timeline segments.

    Returns:
        {
          "source": "planificado" | "missing" | "unreadable" | "empty",
          "file":   "<path>" | None,
          "by_line": {"14": [seg, ...], "17": [...], "19": [...]},
          "rows":   <int>,
          "warnings": [<str>, ...],
        }
    """
    warnings: List[str] = []
    plan_path = _find_plan_file(Path(raw_dir))
    if plan_path is None:
        warnings.append("Planificado file not found in data/raw")
        return {"source": "missing", "file": None, "by_line": {}, "rows": 0, "warnings": warnings}

    df = _read_plan_excel(plan_path)
    if df is None or df.empty:
        warnings.append(f"Planificado file '{plan_path.name}' could not be parsed")
        return {"source": "unreadable", "file": str(plan_path), "by_line": {}, "rows": 0, "warnings": warnings}

    line_col = _find_col(df, ["tren", "linea", "line"])
    material_col = _find_col(df, ["material", "sku"])
    name_col = _find_col(df, ["denominacion", "denominacin", "descripcion", "nombre"])
    fecha_col = _find_col(df, ["fecha_ini", "fecha_inicio", "fecha"])
    hora_col = _find_col(df, ["hora_ini", "hora_inicio", "hora"])
    qty_col = _find_col(df, ["cntd_plan", "cntd", "cantidad", "qty"])
    seq_col = _find_col(df, ["secuencia", "sequence"])

    missing = [name for col, name in [
        (line_col, "tren"),
        (material_col, "material"),
        (fecha_col, "fecha_ini"),
    ] if col is None]
    if missing:
        warnings.append(f"Planificado missing required columns: {missing}")
        return {"source": "unreadable", "file": str(plan_path), "by_line": {}, "rows": 0, "warnings": warnings}

    df["__line"] = pd.to_numeric(df[line_col], errors="coerce")
    df = df[df["__line"].isin(lines)].copy()
    if df.empty:
        warnings.append("Planificado contains no rows for lines 14/17/19")
        return {"source": "empty", "file": str(plan_path), "by_line": {}, "rows": 0, "warnings": warnings}

    df["__start"] = df.apply(lambda r: _row_start(r, fecha_col, hora_col), axis=1)
    df = df.dropna(subset=["__start"]).copy()
    if seq_col:
        df["__seq"] = pd.to_numeric(df[seq_col], errors="coerce")
    else:
        df["__seq"] = np.nan

    by_line: Dict[str, List[Dict[str, Any]]] = {}
    for line in lines:
        sub = df[df["__line"] == line].copy()
        if sub.empty:
            continue
        sub = sub.sort_values(by=["__start", "__seq"], na_position="last").reset_index(drop=True)
        # plan timeline starts at 0 (today) relative to first row
        first_start = sub["__start"].iloc[0]
        starts = sub["__start"].tolist()
        line_segs: List[Dict[str, Any]] = []
        for i, row in sub.iterrows():
            start_dt = starts[i]
            next_dt = starts[i + 1] if i + 1 < len(starts) else None
            inferred_width = False
            if next_dt is not None and next_dt > start_dt:
                dur_hours = (next_dt - start_dt).total_seconds() / 3600.0
            else:
                # No next row to bracket against. We don't know the true
                # length — surface that fact rather than silently picking
                # 8h. Frontend can render an `inferredWidth` band as a
                # dashed/dimmed tail so the planner sees the estimate.
                dur_hours = 8.0
                inferred_width = True
            # Only floor — never cap. A run that genuinely spans 36h is
            # 36h on the timeline.
            dur_hours = max(1.0, dur_hours)
            start_hours = (start_dt - first_start).total_seconds() / 3600.0
            material = row.get(material_col)
            material_str = str(material) if pd.notna(material) else None
            name = row.get(name_col) if name_col else None
            name_str = str(name) if pd.notna(name) else None
            qty = row.get(qty_col) if qty_col else None
            qty_val: Optional[float] = float(qty) if pd.notna(qty) else None
            fmt = _format_key_from_text(name_str)
            vol = _seg_volume(qty_val, fmt)
            # NOTE: no `kind` field — planned segments render and validate as
            # production. Source-of-truth metadata lives in the extra fields.
            seg: Dict[str, Any] = {
                "of": material_str or f"PLN-{int(line)}-{i+1:02d}",
                "start": round(max(0.0, start_hours), 2),
                "w": round(dur_hours, 2),
                "sku": (name_str or material_str or "—"),
                "vol": vol,
                "envase": None,
                "tipo_envase": None,
                "format_key": fmt,
                "marca": None,
                "familia": None,
                "source": "planificado",
                "planned_qty": qty_val,
                "planned_unit": "cases",
                "planned_shift": str(row.get("definicion_de_turno")) if "definicion_de_turno" in row.index and pd.notna(row.get("definicion_de_turno")) else None,
                "planned_start_iso": start_dt.isoformat() if hasattr(start_dt, "isoformat") else None,
                "inferredWidth": inferred_width,
            }
            mean_oee = _line_sku_oee(master, int(line), material_str)
            if mean_oee is not None:
                seg["oee"] = round(mean_oee, 3)
            line_segs.append(seg)
        by_line[str(int(line))] = line_segs

    return {
        "source": "planificado",
        "file": str(plan_path),
        "by_line": by_line,
        "rows": int(df.shape[0]),
        "warnings": warnings,
    }
