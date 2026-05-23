"""Train a GradientBoostingRegressor on the transition table OEE target.

Falls back to a heuristic blend when there aren't enough usable rows.
"""
from __future__ import annotations

from typing import Dict, Optional

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

from .build_features import (
    ALL_FEATURES,
    CATEGORICAL_FEATURES,
    NUMERIC_FEATURES,
    build_training_frame,
)


class OEEModel:
    """Wrapper holding either a fitted sklearn pipeline or a fallback blender."""

    def __init__(self):
        self.pipeline: Optional[Pipeline] = None
        self.fallback_stats: Dict = {}
        self.n_train: int = 0
        self.feature_importances: Dict[str, float] = {}

    def fit(self, tt: pd.DataFrame) -> "OEEModel":
        df = build_training_frame(tt)
        self.n_train = int(len(df))
        if self.n_train < 50:
            self._fit_fallback(tt)
            return self

        X = df[ALL_FEATURES]
        y = df["oee"].astype(float).clip(0.0, 1.0)

        preproc = ColumnTransformer(
            transformers=[
                ("cat", OneHotEncoder(handle_unknown="ignore"), CATEGORICAL_FEATURES),
                ("num", SimpleImputer(strategy="median"), NUMERIC_FEATURES),
            ]
        )
        model = GradientBoostingRegressor(
            n_estimators=200,
            max_depth=3,
            learning_rate=0.05,
            random_state=42,
        )
        pipe = Pipeline([("preprocess", preproc), ("model", model)])
        pipe.fit(X, y)
        self.pipeline = pipe
        self._compute_global_stats(tt)
        return self

    def _fit_fallback(self, tt: pd.DataFrame) -> None:
        self.pipeline = None
        self._compute_global_stats(tt)

    def _compute_global_stats(self, tt: pd.DataFrame) -> None:
        if tt is None or tt.empty:
            self.fallback_stats = {"global_line_oee": {l: 0.6 for l in [14, 17, 19]}}
            return
        line_oee = tt.groupby("line")["oee"].mean().to_dict() if "oee" in tt.columns else {}
        prod_line_oee = {}
        if "current_sku" in tt.columns and "oee" in tt.columns:
            g = tt.groupby(["line", "current_sku"])["oee"].mean().to_dict()
            for (l, sku), v in g.items():
                prod_line_oee[(int(l), str(sku))] = float(v)
        self.fallback_stats = {
            "global_line_oee": {int(k): float(v) for k, v in line_oee.items()},
            "product_line_oee": prod_line_oee,
            "global_oee": float(tt["oee"].dropna().mean()) if "oee" in tt.columns else 0.6,
        }

    def predict(self, features: Dict, similar: Dict | None = None) -> float:
        if self.pipeline is not None:
            row = pd.DataFrame([{k: features.get(k) for k in ALL_FEATURES}])
            for c in NUMERIC_FEATURES:
                row[c] = pd.to_numeric(row[c], errors="coerce").fillna(0.0)
            # Cap numeric features at training-time medians + a wide multiple so
            # urgent orders with extreme volumes don't push the GBM into
            # extrapolation leaves
            for c, cap in [("volume", 5000.0), ("theoretical_changeover_minutes", 400.0), ("cleaning_minutes", 300.0), ("pnp_minutes", 200.0), ("stop_minutes", 300.0), ("historical_avg_actual_changeover", 400.0), ("historical_avg_overrun", 200.0)]:
                if c in row.columns:
                    row[c] = row[c].clip(lower=0.0, upper=cap)
            for c in CATEGORICAL_FEATURES:
                row[c] = row[c].astype(str)
            try:
                pred = float(self.pipeline.predict(row)[0])
                return float(np.clip(pred, 0.0, 1.0))
            except Exception:
                pass
        # Fallback blend
        sim_avg = (similar or {}).get("historical_avg_oee")
        line = int(features.get("line", 14)) if str(features.get("line", "14")).isdigit() else 14
        sku = str(features.get("current_sku"))
        line_oee = self.fallback_stats.get("global_line_oee", {}).get(line, self.fallback_stats.get("global_oee", 0.6))
        prod_line_oee = self.fallback_stats.get("product_line_oee", {}).get((line, sku), line_oee)
        sim_avg = sim_avg if sim_avg is not None else line_oee
        pred = 0.5 * sim_avg + 0.3 * prod_line_oee + 0.2 * line_oee
        return float(np.clip(pred, 0.0, 1.0))


def confidence_from_similar(n_similar: int) -> float:
    return float(min(0.9, max(0.45, 0.45 + 0.05 * n_similar)))
