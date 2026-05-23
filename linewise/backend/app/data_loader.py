"""Load Damm canning line Excel data and normalize it for downstream use.

Tolerant to small column-name variations and missing files. If parsing fails
entirely, the caller can fall back to sample_data.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Dict, List, Optional

import pandas as pd
from unidecode import unidecode

from .config import RAW_DIR, LINES


def _norm(s: str) -> str:
    s = unidecode(str(s)).lower().strip()
    s = re.sub(r"[\s/.%\-\(\)]+", "_", s)
    s = re.sub(r"[^a-z0-9_]+", "", s)
    s = re.sub(r"_+", "_", s).strip("_")
    return s


def _normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df.columns = [_norm(c) for c in df.columns]
    return df


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


def _read_excel(path: Path) -> Optional[pd.DataFrame]:
    try:
        xl = pd.ExcelFile(path)
        for s in xl.sheet_names:
            try:
                df = pd.read_excel(path, sheet_name=s)
                if df.shape[0] > 0:
                    return _normalize_columns(df)
            except Exception:
                continue
    except Exception:
        return None
    return None


def load_oee() -> Optional[pd.DataFrame]:
    """OEE spine — one row per OF."""
    candidates = [
        RAW_DIR / "OEE 14_17_19_ 2025.xlsx",
        RAW_DIR / "data - 2026-05-18T181640.542.xlsx",
    ]
    frames = []
    for p in candidates:
        if not p.exists():
            continue
        df = _read_excel(p)
        if df is None:
            continue
        frames.append(df)
    if not frames:
        return None
    df = pd.concat(frames, ignore_index=True, sort=False)
    of_col = _find_col(df, ["of", "orden", "of_number"])
    if of_col:
        df = df.drop_duplicates(subset=[of_col], keep="last")
    return df


def load_tiempo() -> Optional[pd.DataFrame]:
    return _read_excel(RAW_DIR / "Tiempo 14_17_19_ 2025.xlsx")


def load_cambios() -> Optional[pd.DataFrame]:
    return _read_excel(RAW_DIR / "Cambios 14_17_19_ 2025.xlsx")


def load_mantenimiento() -> Optional[pd.DataFrame]:
    return _read_excel(RAW_DIR / "Mantenimiento 14_17_19_ 2025.xlsx")


def load_volumen() -> Optional[pd.DataFrame]:
    return _read_excel(RAW_DIR / "Volumen 14_17_19_ 2025.xlsx")


def load_planificado() -> Optional[pd.DataFrame]:
    return _read_excel(RAW_DIR / "Planificado - producciones 14 - 17 - 19.XLSX")


def load_produccion() -> Optional[pd.DataFrame]:
    return _read_excel(RAW_DIR / "Produccion_L14,17,19_18-22.xlsx")


def build_master_dataset() -> Optional[pd.DataFrame]:
    """Combine OEE (spine), Tiempo (WOID→OF), Volumen, Mantenimiento, Cambios.

    Per-order granularity. Returns a dataframe with normalized columns.
    """
    oee = load_oee()
    tiempo = load_tiempo()
    volumen = load_volumen()
    mant = load_mantenimiento()
    cambios = load_cambios()

    if oee is None and tiempo is None:
        return None

    base = oee if oee is not None else tiempo
    of_col = _find_col(base, ["of", "woid", "orden"])
    if of_col is None:
        return None
    base = base.rename(columns={of_col: "of"})

    line_col = _find_col(base, ["tren", "linea", "line"])
    if line_col and line_col != "tren":
        base = base.rename(columns={line_col: "tren"})

    sku_col = _find_col(base, ["sku", "material"])
    if sku_col and sku_col != "sku":
        base = base.rename(columns={sku_col: "sku"})

    fecha_col = _find_col(base, ["fecha_fin", "fecha", "date"])
    if fecha_col and fecha_col != "fecha_fin":
        base = base.rename(columns={fecha_col: "fecha_fin"})

    keep_cols = [c for c in [
        "of", "tren", "sku", "fecha_fin", "oee", "disponibilidad", "rendimiento",
        "ineficiencia", "calidad", "familia", "marca", "cerveza", "envase",
        "tipo_envase", "cambios", "material_precio", "mat_precio"
    ] if c in base.columns]
    base = base[keep_cols].copy()

    # Tiempo — WOID becomes OF; keep time fields in HOURS
    if tiempo is not None:
        t_of = _find_col(tiempo, ["of", "woid", "orden"])
        if t_of:
            tiempo = tiempo.rename(columns={t_of: "of"})
            t_keep = ["of"]
            for c in ["par_tot", "pnp", "limpieza", "idle", "h_tot"]:
                if c in tiempo.columns:
                    t_keep.append(c)
            tiempo = tiempo[t_keep].drop_duplicates(subset=["of"], keep="last")
            base = base.merge(tiempo, on="of", how="left")

    # Volumen — HL per OF
    if volumen is not None:
        v_of = _find_col(volumen, ["of", "woid"])
        if v_of:
            volumen = volumen.rename(columns={v_of: "of"})
            v_keep = ["of"]
            for c in ["hl", "uds"]:
                if c in volumen.columns:
                    v_keep.append(c)
            volumen = volumen[v_keep].drop_duplicates(subset=["of"], keep="last")
            base = base.merge(volumen, on="of", how="left")

    # Mantenimiento — collapse to OF and create maintenance_flag
    if mant is not None:
        m_of = _find_col(mant, ["of", "woid"])
        if m_of:
            mant = mant.rename(columns={m_of: "of"})
            tt_col = _find_col(mant, ["tiempo_total", "tiempo_intervencion", "n_llamadas"])
            if tt_col:
                mant = mant[["of", tt_col]].rename(columns={tt_col: "_mant_metric"})
                mant = mant.drop_duplicates(subset=["of"], keep="last")
                base = base.merge(mant, on="of", how="left")
                base["maintenance_flag"] = (base["_mant_metric"].fillna(0) > 0).astype(int)
                base = base.drop(columns=["_mant_metric"])
            else:
                base["maintenance_flag"] = 0
        else:
            base["maintenance_flag"] = 0
    else:
        base["maintenance_flag"] = 0

    # Cambios — collapse to OF (it has duplicates); pull tipo_cambio and binary change indicators
    if cambios is not None:
        c_of = _find_col(cambios, ["of", "woid"])
        if c_of:
            cambios = cambios.rename(columns={c_of: "of"})
            c_keep = ["of"]
            rename_map = {}
            principal = _find_col(cambios, ["c_principal"])
            if principal:
                rename_map[principal] = "tipo_cambio"
                c_keep.append(principal)
            for key, alias in [
                ("c_brand", "ch_brand"),
                ("c_envase", "ch_envase"),
                ("c_volum", "ch_volume"),
                ("c_palet", "ch_palet"),
                ("c_producto", "ch_product"),
                ("c_cap", "ch_cap"),
                ("c_primario", "ch_primary"),
                ("c_secundario", "ch_secondary"),
                ("n_de_cambios", "n_cambios"),
            ]:
                if key in cambios.columns:
                    rename_map[key] = alias
                    c_keep.append(key)
            cambios = cambios[c_keep].rename(columns=rename_map)
            cambios = cambios.drop_duplicates(subset=["of"], keep="last")
            base = base.merge(cambios, on="of", how="left")

    # Filter to relevant lines + parse types
    if "tren" in base.columns:
        base["tren"] = pd.to_numeric(base["tren"], errors="coerce")
        base = base[base["tren"].isin(LINES)]
    if "fecha_fin" in base.columns:
        base["fecha_fin"] = pd.to_datetime(base["fecha_fin"], errors="coerce")

    # Hours -> minutes
    for c in ["par_tot", "pnp", "limpieza", "idle"]:
        if c in base.columns:
            base[f"{c}_min"] = pd.to_numeric(base[c], errors="coerce") * 60.0

    base = base.dropna(subset=["of"]).reset_index(drop=True)
    return base


def get_products(master: pd.DataFrame, limit: int = 60) -> List[Dict]:
    """Distinct products with light metadata, including a canonical can format."""
    from .line_rules import normalize_format
    if master is None or master.empty:
        return []
    cols = ["sku"]
    for c in ["cerveza", "marca", "envase", "tipo_envase", "familia", "tren", "material_precio", "mat_precio"]:
        if c in master.columns:
            cols.append(c)
    df = master[cols].copy()
    df = df.dropna(subset=["sku"])
    df["sku"] = df["sku"].astype(str)
    df = df[~df["sku"].str.upper().isin(["LIMPIEZA", "DEFAULTVALUE", "NAN"])]
    if "familia" in df.columns:
        df = df[~df["familia"].astype(str).str.upper().isin(["LIMPIEZA", "DEFAULTVALUE"])]
    grouped = df.groupby("sku")
    products = []
    for sku, g in grouped:
        name_parts = []
        for c in ["material_precio", "mat_precio", "marca"]:
            if c in g.columns:
                v = g[c].dropna()
                if not v.empty and str(v.iloc[0]).lower() not in ("defaultvalue", "nan"):
                    name_parts.append(str(v.iloc[0]))
                    break
        for c in ["envase"]:
            if c in g.columns:
                v = g[c].dropna()
                if not v.empty:
                    name_parts.append(str(v.iloc[0]))
                    break
        name = " ".join(name_parts) if name_parts else sku
        lines = []
        if "tren" in g.columns:
            lines = sorted({int(x) for x in g["tren"].dropna().unique() if int(x) in LINES})
        fmt = None
        if "envase" in g.columns:
            v = g["envase"].dropna()
            if not v.empty:
                fmt = str(v.iloc[0])
        # Canonical can format derived from tipo_envase (preferred) or envase
        format_key = None
        if "tipo_envase" in g.columns:
            v = g["tipo_envase"].dropna()
            if not v.empty:
                format_key = normalize_format(str(v.iloc[0]))
        if format_key is None and fmt is not None:
            format_key = normalize_format(fmt)
        family = None
        if "familia" in g.columns:
            v = g["familia"].dropna()
            if not v.empty:
                family = str(v.iloc[0])
        products.append({
            "sku": sku,
            "name": name,
            "format": fmt,
            "format_key": format_key,
            "family": family,
            "historical_lines": lines,
        })
    products.sort(key=lambda p: -len(p["historical_lines"]))
    return products[:limit]


def save_processed(master: pd.DataFrame) -> None:
    if master is None or master.empty:
        return
    from .config import PROCESSED_DIR
    try:
        master.to_parquet(PROCESSED_DIR / "master.parquet", index=False)
    except Exception:
        master.to_csv(PROCESSED_DIR / "master.csv", index=False)
