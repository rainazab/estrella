"""Documented modelling assumptions baked into the exporter.

These are surfaced verbatim in docs/ASSUMPTIONS.md and consumed by the
recommendation evidence panel. Editing this file is a contract event — keep
the doc in lockstep.
"""
from __future__ import annotations

from typing import Dict, List


GRANULARITY = "per-OF, per-block"

BLOCK_CLASSIFICATION = {
    "production": "Rows with a real OF and recorded OEE.",
    "clean": "Rows where the activity matches the cleaning rules in block_classifier.",
    "maint": "Rows tagged as maintenance in the Mantenimiento export.",
    "other": "Unknown / ambiguous rows — excluded from OEE baselines and analogues.",
}

WOID_OF_JOIN = (
    "Tiempo + OEE files are joined on the OF key. If Tiempo carries a WOID "
    "column instead of OF, block_classifier.verify_of_woid_join() renames it. "
    "Join coverage is reported in data/processed/validation_report.txt."
)

OEE_CAP = (
    "Any OEE value > 1.0 in the source data is capped to 1.0. The number of "
    "rows capped is reported in metadata.oee_capped."
)

SEQUENCE_RECONSTRUCTION = (
    "Sequences are reconstructed per line, ordered by Fecha Fin. "
    "Cleaning and maintenance blocks remain in the sequence as kind='clean'/"
    "'maint' segments — they never enter OEE baselines or analogue means."
)

CF_FALLBACK = (
    "When the CF Prat theoretical matrix does not cover a (line, prev_format, "
    "cur_format) triple, the exporter falls back to the mean actual changeover "
    "duration observed for that transition_type in 2025 history. The fallback "
    "is recorded in the recommendation evidence."
)

RECOVERY_TAIL = (
    "Recovery hours are a MODELLED ESTIMATE — not a measurement. They are "
    "derived from CF baseline + transition-type-specific tail and labelled as "
    "such in each recommendation's recovery.note field."
)

ANALOGUE_REQUIREMENTS = (
    "Every analogue surfaced in evidence.analogues references a real 2025 OF "
    "with the recorded OEE from the source files. validate_model_outputs.py "
    "asserts that analogue OFs and OEE values match production_runs."
)

NO_COSTS_EMITTED = (
    "No €/cost figures are emitted — no validated cost data exists in the "
    "source files. Recommendations are comparative (OEE points) only."
)

EXECUTED_2025_IMMUTABLE = (
    "Executed 2025 history is read-only. The exporter never overwrites or "
    "rewrites historical blocks; recommendations only modify the forward plan."
)

PRIVACY = (
    "Raw Damm Excel files are never committed. data/raw/* and *.xlsx are in "
    ".gitignore. data/output/data.json is the only artifact intended for "
    "handoff."
)


def as_dict() -> Dict[str, str]:
    return {
        "granularity": GRANULARITY,
        "woid_of_join": WOID_OF_JOIN,
        "oee_cap": OEE_CAP,
        "sequence_reconstruction": SEQUENCE_RECONSTRUCTION,
        "cf_fallback": CF_FALLBACK,
        "recovery_tail": RECOVERY_TAIL,
        "analogue_requirements": ANALOGUE_REQUIREMENTS,
        "no_costs_emitted": NO_COSTS_EMITTED,
        "executed_2025_immutable": EXECUTED_2025_IMMUTABLE,
        "privacy": PRIVACY,
    }


def as_lines() -> List[str]:
    return [f"- {key}: {val}" for key, val in as_dict().items()]
