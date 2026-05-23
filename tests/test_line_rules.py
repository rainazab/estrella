"""Line eligibility tests — hardcoded factory constraints, not derived."""
from __future__ import annotations

import pytest

from app.line_rules import (
    LINE_FORMAT_CAPABILITIES,
    infeasibility_reason,
    is_feasible,
    normalize_format,
)


class TestNormalizeFormat:
    @pytest.mark.parametrize("value, expected", [
        ("1/3", "1/3"),
        ("1/2", "1/2"),
        ("2/5", "2/5"),
        ("LATA 1/3 SR.", "1/3"),
        ("LATA 1/2", "1/2"),
        ("tercio", "1/3"),
        ("Tercio", "1/3"),
        ("medio", "1/2"),
        ("33cl", "1/3"),
        ("50 cl", "1/2"),
        ("44cl", "2/5"),
        ("330 ml", "1/3"),
        ("500ml", "1/2"),
        ("440ml", "2/5"),
        (None, None),
        ("", None),
        ("nan", None),
        ("DefaultValue", None),
    ])
    def test_normalizes(self, value, expected):
        assert normalize_format(value) == expected


class TestLineFormatCapabilities:
    def test_line_14_supports_one_third_and_half_only(self):
        assert LINE_FORMAT_CAPABILITIES[14] == {"1/2", "1/3"}

    def test_line_17_only_one_third(self):
        assert LINE_FORMAT_CAPABILITIES[17] == {"1/3"}

    def test_line_19_supports_all_three(self):
        assert LINE_FORMAT_CAPABILITIES[19] == {"1/2", "1/3", "2/5"}


class TestIsFeasible:
    def test_line_17_rejects_half(self):
        assert is_feasible(17, "1/2") is False

    def test_line_17_rejects_two_fifth(self):
        assert is_feasible(17, "2/5") is False

    def test_line_17_accepts_one_third(self):
        assert is_feasible(17, "1/3") is True

    def test_line_14_rejects_two_fifth(self):
        assert is_feasible(14, "2/5") is False

    def test_line_14_accepts_one_third(self):
        assert is_feasible(14, "1/3") is True

    def test_line_14_accepts_half(self):
        assert is_feasible(14, "1/2") is True

    def test_line_19_accepts_all_three(self):
        for fmt in ("1/2", "1/3", "2/5"):
            assert is_feasible(19, fmt) is True

    def test_unknown_format_passes(self):
        # Unknown formats are surfaced as uncertainty downstream, not rejected.
        assert is_feasible(17, None) is True


class TestInfeasibilityReason:
    def test_line_17_half_explains_only_supports_one_third(self):
        reason = infeasibility_reason(17, "1/2")
        assert reason is not None
        assert "Line 17" in reason
        assert "1/3" in reason

    def test_feasible_returns_none(self):
        assert infeasibility_reason(17, "1/3") is None
        assert infeasibility_reason(19, "2/5") is None
