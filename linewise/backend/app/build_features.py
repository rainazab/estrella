"""Feature engineering shared between the predictor and the simulator."""
from __future__ import annotations

from typing import Dict, List

import numpy as np
import pandas as pd

CATEGORICAL_FEATURES = ["line", "change_type"]
# Features known at planning time. pnp/stop/cleaning are execution outcomes
# and would leak future state — keep them out of the model.
NUMERIC_FEATURES = [
    "format_change",
    "theoretical_changeover_minutes",
    "historical_avg_oee",
    "historical_avg_actual_changeover",
    "historical_avg_overrun",
    "maintenance_flag",
    "volume",
    "month",
    "weekday",
]
ALL_FEATURES = CATEGORICAL_FEATURES + NUMERIC_FEATURES


def features_from_transition_row(row: pd.Series, similar: Dict | None = None) -> Dict:
    """Build a feature dict for the model from a transition_table row."""
    f = {
        "line": str(int(row.get("line"))) if pd.notna(row.get("line")) else "0",
        "current_sku": str(row.get("current_sku")),
        "previous_sku": str(row.get("previous_sku")),
        "change_type": str(row.get("change_type")),
        "format_change": float(row.get("format_change") or 0),
        "theoretical_changeover_minutes": float(row.get("theoretical_changeover_minutes") or 0),
        "historical_avg_oee": float(similar.get("historical_avg_oee") if similar and similar.get("historical_avg_oee") is not None else (row.get("oee") or 0.6)),
        "historical_avg_actual_changeover": float(similar.get("historical_avg_actual_changeover") if similar and similar.get("historical_avg_actual_changeover") is not None else (row.get("actual_changeover_minutes") or 0.0)),
        "historical_avg_overrun": float(similar.get("historical_avg_overrun") if similar and similar.get("historical_avg_overrun") is not None else (row.get("changeover_overrun_minutes") or 0.0)),
        "cleaning_minutes": float(row.get("cleaning_minutes") or 0.0),
        "pnp_minutes": float(row.get("pnp_minutes") or 0.0),
        "stop_minutes": float(row.get("stop_minutes") or 0.0),
        "maintenance_flag": float(row.get("maintenance_flag") or 0),
        "volume": float(row.get("volume") or 0.0),
        "month": float(row.get("month") or 0.0),
        "weekday": float(row.get("weekday") or 0.0),
    }
    return f


def build_training_frame(tt: pd.DataFrame) -> pd.DataFrame:
    """Return a wide feature frame + target oee from the transition table.

    Mirrors inference: builds leave-one-out per-line rolling stats so that
    historical_avg_oee / overrun / changeover features have the same
    distribution at train and inference time.
    """
    if tt is None or tt.empty:
        return pd.DataFrame()
    df = tt.copy()
    df = df.dropna(subset=["oee"])
    df["line"] = df["line"].astype(str)
    df["change_type"] = df["change_type"].astype(str)

    df = df.sort_values(["line", "date"]) if "date" in df.columns else df.sort_values(["line"])
    df["historical_avg_oee"] = (
        df.groupby("line")["oee"].transform(lambda s: s.shift().expanding().mean()).fillna(df["oee"].mean())
    )
    if "actual_changeover_minutes" in df.columns:
        df["historical_avg_actual_changeover"] = (
            df.groupby("line")["actual_changeover_minutes"].transform(lambda s: s.shift().expanding().mean()).fillna(0.0)
        )
    else:
        df["historical_avg_actual_changeover"] = 0.0
    if "changeover_overrun_minutes" in df.columns:
        df["historical_avg_overrun"] = (
            df.groupby("line")["changeover_overrun_minutes"].transform(lambda s: s.shift().expanding().mean()).fillna(0.0)
        )
    else:
        df["historical_avg_overrun"] = 0.0

    for c in NUMERIC_FEATURES:
        if c not in df.columns:
            df[c] = 0.0
    df[NUMERIC_FEATURES] = df[NUMERIC_FEATURES].apply(pd.to_numeric, errors="coerce").fillna(0.0)
    df["oee"] = df["oee"].clip(0.0, 1.0)
    df = df[ALL_FEATURES + ["oee"]]
    return df
