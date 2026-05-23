"""Synthetic fallback dataset used when Excel parsing produces too little data."""
from __future__ import annotations

import random
from datetime import datetime, timedelta
from typing import Dict, List

import numpy as np
import pandas as pd

from .config import LINES

random.seed(7)
np.random.seed(7)

PRODUCTS = [
    {"sku": f"SKU_{i:03d}", "name": f"Estrella {fmt}", "format": fmt, "family": fam}
    for i, (fmt, fam) in enumerate(
        [
            ("Lata 33cl", "Estrella"),
            ("Lata 50cl", "Estrella"),
            ("Botella 25cl", "Estrella"),
            ("Botella 33cl", "Estrella"),
            ("Lata 33cl", "Voll-Damm"),
            ("Lata 50cl", "Voll-Damm"),
            ("Botella 33cl", "Voll-Damm"),
            ("Lata 33cl", "Daura"),
            ("Botella 25cl", "Daura"),
            ("Lata 33cl", "Inedit"),
            ("Botella 33cl", "Inedit"),
            ("Lata 33cl", "Free Damm"),
            ("Botella 25cl", "Free Damm"),
            ("Lata 33cl", "AK Damm"),
            ("Lata 50cl", "AK Damm"),
            ("Botella 25cl", "AK Damm"),
            ("Lata 33cl", "Bock-Damm"),
            ("Lata 50cl", "Bock-Damm"),
            ("Barril 30L", "Estrella"),
            ("Barril 30L", "Voll-Damm"),
        ],
        start=1,
    )
]


def build_master() -> pd.DataFrame:
    rows = []
    start = datetime(2025, 1, 5, 6, 0, 0)
    for line in LINES:
        t = start
        for i in range(60):
            prod = random.choice(PRODUCTS)
            par_tot_min = float(np.random.uniform(180, 540))
            pnp_min = float(np.random.uniform(5, 35))
            limp_min = float(np.random.uniform(30, 90))
            idle_min = float(np.random.uniform(0, 15))
            base_oee = 0.55 + 0.15 * np.random.random()
            if line == 14:
                base_oee += 0.06
            if line == 17:
                base_oee -= 0.03
            oee = float(np.clip(base_oee + np.random.normal(0, 0.04), 0.25, 0.95))
            hl = float(np.random.uniform(400, 1800))
            rows.append({
                "of": f"OF{line}{1000+i:04d}",
                "tren": line,
                "sku": prod["sku"],
                "fecha_fin": t,
                "oee": oee,
                "familia": prod["family"],
                "marca": prod["family"],
                "cerveza": prod["family"],
                "envase": prod["format"],
                "tipo_envase": "Lata" if "Lata" in prod["format"] else ("Botella" if "Botella" in prod["format"] else "Barril"),
                "par_tot_min": par_tot_min,
                "pnp_min": pnp_min,
                "limpieza_min": limp_min,
                "idle_min": idle_min,
                "hl": hl,
                "maintenance_flag": 1 if np.random.random() < 0.15 else 0,
            })
            t = t + timedelta(hours=float(par_tot_min) / 60.0 + 0.5)
    df = pd.DataFrame(rows)
    return df


def build_products() -> List[Dict]:
    out = []
    for p in PRODUCTS:
        out.append({
            "sku": p["sku"],
            "name": f"{p['family']} {p['format']}",
            "format": p["format"],
            "family": p["family"],
            "historical_lines": LINES,
        })
    return out
