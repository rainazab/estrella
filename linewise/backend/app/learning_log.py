"""Persistent log of LineWise recommendations and planner feedback.

Stored as a single JSON file under data/processed/. Each record is one
recommendation snapshot plus optional planner_action and post-execution
actuals. When we later get the real OEE for the chosen slot the record
gets the error and a one-line cause hint.
"""
from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from .config import PROCESSED_DIR

LOG_PATH: Path = PROCESSED_DIR / "learning_log.json"
_lock = threading.Lock()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _load_raw() -> List[Dict[str, Any]]:
    if not LOG_PATH.exists():
        return []
    try:
        with LOG_PATH.open("r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _save_raw(records: List[Dict[str, Any]]) -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with LOG_PATH.open("w", encoding="utf-8") as f:
        json.dump(records, f, indent=2, default=str)


def record_recommendation(
    *,
    run_id: str,
    mode: str,
    candidate_id: str,
    line: int,
    transition_type: Optional[str],
    predicted_oee: float,
    naive_predicted_oee: Optional[float],
    hl_protected: Optional[float],
    financial_delta_eur: Optional[float],
    request_payload: Dict[str, Any],
) -> Dict[str, Any]:
    with _lock:
        records = _load_raw()
        rec_id = f"REC-{len(records)+1:04d}"
        rec = {
            "recommendation_id": rec_id,
            "run_id": run_id,
            "timestamp": _now(),
            "mode": mode,
            "selected_candidate_id": candidate_id,
            "line": line,
            "transition_type": transition_type,
            "predicted_oee": predicted_oee,
            "naive_predicted_oee": naive_predicted_oee,
            "predicted_hl_protected": hl_protected,
            "predicted_financial_delta_eur": financial_delta_eur,
            "planner_action": "pending",
            "override_reason": None,
            "actual_oee": None,
            "actual_changeover_minutes": None,
            "actual_observed_at": None,
            "prediction_error_oee": None,
            "miss_cause_hint": None,
            "request_payload": request_payload,
            "status": "awaiting_action",
        }
        records.append(rec)
        _save_raw(records)
        return rec


def _find(records: List[Dict[str, Any]], rec_id: str) -> Optional[int]:
    for i, r in enumerate(records):
        if r.get("recommendation_id") == rec_id:
            return i
    return None


def update_action(rec_id: str, *, action: str, override_reason: Optional[str] = None) -> Optional[Dict[str, Any]]:
    with _lock:
        records = _load_raw()
        idx = _find(records, rec_id)
        if idx is None:
            return None
        records[idx]["planner_action"] = action
        records[idx]["override_reason"] = override_reason
        records[idx]["status"] = (
            "accepted" if action == "accepted" else ("overridden" if action == "overridden" else "awaiting_execution")
        )
        records[idx]["action_recorded_at"] = _now()
        _save_raw(records)
        return records[idx]


def update_actuals(
    rec_id: str,
    *,
    actual_oee: Optional[float],
    actual_changeover_minutes: Optional[float] = None,
    miss_cause_hint: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    with _lock:
        records = _load_raw()
        idx = _find(records, rec_id)
        if idx is None:
            return None
        r = records[idx]
        r["actual_oee"] = actual_oee
        r["actual_changeover_minutes"] = actual_changeover_minutes
        r["actual_observed_at"] = _now()
        if actual_oee is not None and r.get("predicted_oee") is not None:
            r["prediction_error_oee"] = round(actual_oee - r["predicted_oee"], 4)
        r["miss_cause_hint"] = miss_cause_hint
        r["status"] = "closed"
        _save_raw(records)
        return r


def list_records(limit: int = 50) -> List[Dict[str, Any]]:
    records = _load_raw()
    return records[-limit:][::-1]


def summary() -> Dict[str, Any]:
    records = _load_raw()
    accepted = sum(1 for r in records if r.get("planner_action") == "accepted")
    overridden = sum(1 for r in records if r.get("planner_action") == "overridden")
    pending = sum(1 for r in records if r.get("planner_action") == "pending")
    errors = [r["prediction_error_oee"] for r in records if r.get("prediction_error_oee") is not None]
    avg_abs_err_pts = (sum(abs(e) for e in errors) / len(errors) * 100.0) if errors else None
    miss_counts: Dict[str, int] = {}
    for r in records:
        h = r.get("miss_cause_hint")
        if h:
            miss_counts[h] = miss_counts.get(h, 0) + 1
    most_common_miss = (
        max(miss_counts.items(), key=lambda kv: kv[1])[0] if miss_counts else None
    )
    return {
        "total_recommendations": len(records),
        "accepted": accepted,
        "overridden": overridden,
        "pending": pending,
        "average_abs_prediction_error_points": (
            round(avg_abs_err_pts, 2) if avg_abs_err_pts is not None else None
        ),
        "most_common_miss_cause": most_common_miss,
    }
