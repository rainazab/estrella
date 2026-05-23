"""Hard line-format eligibility rules for Damm canning lines 14, 17 and 19.

These are factory constraints, not learned: a line either supports a given
can format or it does not. Used both by the optimizer (to filter or mark
candidates as infeasible) and by the explanation layer (to surface a clear
reason).

Format normalization: SAP / Cambios files use a few different conventions
for can sizes ("LATA 1/3 SR.", "1/3", "33cl", "tercio", ...). This module
normalizes any of them to one of: "1/3", "1/2", "2/5", or `None`.
"""
from __future__ import annotations

import re
from typing import Optional, Set

# Damm Prat canning-line capabilities (provided by ops):
#   Line 14: only 1/2 and 1/3 cans
#   Line 17: only 1/3 cans
#   Line 19: 1/2, 1/3 and 2/5 cans
LINE_FORMAT_CAPABILITIES: dict[int, Set[str]] = {
    14: {"1/2", "1/3"},
    17: {"1/3"},
    19: {"1/2", "1/3", "2/5"},
}

# Human-readable label per canonical key
FORMAT_LABEL: dict[str, str] = {
    "1/3": "Tercio · 33cl",
    "1/2": "Medio · 50cl",
    "2/5": "44cl",
}


def normalize_format(value: Optional[str]) -> Optional[str]:
    """Convert any of the source spellings to a canonical can-size key."""
    if value is None:
        return None
    s = str(value).strip().lower()
    if not s or s in ("nan", "defaultvalue", "sin asignar"):
        return None

    # Look for explicit fractions first (LATA 1/3 SR., LATA 1/2, "1/3", etc.)
    m = re.search(r"\b(\d)\s*/\s*(\d)\b", s)
    if m:
        frac = f"{m.group(1)}/{m.group(2)}"
        if frac in LINE_FORMAT_CAPABILITIES[19]:
            return frac

    # Spanish words
    if "tercio" in s:
        return "1/3"
    if "medio" in s:
        return "1/2"

    # cl notation
    if re.search(r"\b33\s*cl\b", s):
        return "1/3"
    if re.search(r"\b50\s*cl\b", s):
        return "1/2"
    if re.search(r"\b44\s*cl\b", s):
        return "2/5"

    # ml notation
    if "330" in s and "ml" in s:
        return "1/3"
    if "500" in s and "ml" in s:
        return "1/2"
    if "440" in s and "ml" in s:
        return "2/5"

    return None


def is_feasible(line: int, format_key: Optional[str]) -> bool:
    """Return True if `line` can physically run cans of `format_key`."""
    if format_key is None:
        # Unknown format — let it through and surface uncertainty downstream
        return True
    caps = LINE_FORMAT_CAPABILITIES.get(int(line))
    if not caps:
        return False
    return format_key in caps


def infeasibility_reason(line: int, format_key: Optional[str]) -> Optional[str]:
    """Human-readable reason the line is not feasible, or None if feasible."""
    if format_key is None:
        return None
    if is_feasible(line, format_key):
        return None
    caps = LINE_FORMAT_CAPABILITIES.get(int(line)) or set()
    caps_label = ", ".join(sorted(caps)) if caps else "no formats"
    return (
        f"Line {line} cannot run {FORMAT_LABEL.get(format_key, format_key)} cans "
        f"— it only supports {caps_label}."
    )


def line_format_summary(line: int) -> str:
    caps = LINE_FORMAT_CAPABILITIES.get(int(line)) or set()
    if not caps:
        return f"Line {line}: no canning capability registered."
    return f"Line {line}: " + ", ".join(
        FORMAT_LABEL.get(c, c) for c in sorted(caps)
    )
