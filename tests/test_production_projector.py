"""Unit tests for the forward-production projector."""
from __future__ import annotations

from datetime import date

import pytest

from app import production_projector as pp


def _prod(of, start, w=4.0, sku=None, fmt='1/3', oee=0.5):
    return {
        'of': of, 'sku': sku or of, 'format_key': fmt,
        'start': float(start), 'w': float(w), 'oee': float(oee),
    }


def _svc(kind, start, w=8.0):
    return {'kind': kind, 'start': float(start), 'w': float(w), 'locked': True}


class TestProjectForwardProduction:
    def test_short_seed_tiles_to_target_horizon(self):
        # A 7-day seed (start 0..168h, end 168h) tiled to a 21-day horizon
        # → 3 cycles total (1 original + 2 tiles).
        seed = [_prod('ED13LT', start=0, w=168.0)]
        base = {'14': seed}
        out = pp.project_forward_production(
            base, target_horizon_days=21, cycle_period_days=7.0,
        )
        lane = out['14']
        # cycle 1 (original) at start=0; cycle 2 at start=168; cycle 3 at 336.
        starts = sorted(s['start'] for s in lane)
        assert starts == [0.0, 168.0, 336.0]

    def test_projected_bands_carry_provenance_tags(self):
        seed = [_prod('ED13LT', start=0, w=24.0)]
        out = pp.project_forward_production(
            {'14': seed}, target_horizon_days=14, cycle_period_days=7.0,
        )
        lane = out['14']
        original = lane[0]
        projected = lane[1]
        assert 'source' not in original or original.get('source') != 'projected_from_planificado'
        assert projected['source'] == 'projected_from_planificado'
        assert projected['cycleWeek'] == 2
        assert projected['inferredWidth'] is True
        # SKU, OEE, OF preserved
        assert projected['sku'] == original['sku']
        assert projected['oee'] == original['oee']
        assert projected['of'] == original['of']

    def test_service_blocks_preserved_in_place(self):
        seed = [_prod('ED13LT', start=0, w=24.0)]
        svc = [_svc('clean', start=48.0, w=8.0)]
        out = pp.project_forward_production(
            {'14': seed + svc}, target_horizon_days=14,
        )
        lane = out['14']
        clean = next(s for s in lane if s.get('kind') == 'clean')
        # Service block kept its original start
        assert clean['start'] == 48.0

    def test_no_seed_returns_lane_unchanged(self):
        empty = {'14': []}
        out = pp.project_forward_production(empty, target_horizon_days=14)
        assert out['14'] == []

    def test_already_past_horizon_is_noop(self):
        seed = [_prod('ED13LT', start=0, w=400.0)]  # 17 days wide
        out = pp.project_forward_production(
            {'14': seed}, target_horizon_days=14, cycle_period_days=7.0,
        )
        # Seed already exceeds horizon; no tiles added.
        assert len(out['14']) == 1
        assert out['14'][0]['start'] == 0.0

    def test_multiple_seed_runs_each_tiled(self):
        seed = [
            _prod('ED13LT', start=0, w=24.0),
            _prod('XI13LT', start=24, w=24.0),
            _prod('FD13LT', start=48, w=24.0),
        ]
        out = pp.project_forward_production(
            {'14': seed}, target_horizon_days=14, cycle_period_days=7.0,
        )
        lane = [s for s in out['14'] if not s.get('kind')]
        # week 1: 3 runs, week 2: 3 runs = 6 total
        assert len(lane) == 6
        # First three keep their original `of` ordering; second three
        # mirror that ordering with start += 168h.
        week2 = [s for s in lane if s.get('cycleWeek') == 2]
        ofs = [s['of'] for s in week2]
        assert ofs == ['ED13LT', 'XI13LT', 'FD13LT']
        starts = [s['start'] for s in week2]
        assert starts == [168.0, 192.0, 216.0]


class TestHorizonDaysToEoy:
    def test_january_yields_a_long_horizon(self):
        assert pp.horizon_days_to_eoy('2026-01-01') == 364

    def test_late_year_yields_short_horizon(self):
        assert pp.horizon_days_to_eoy('2026-12-30') == 1

    def test_iso_date_string_accepted(self):
        # 2026-05-24 → 2026-12-31 = 221 days
        assert pp.horizon_days_to_eoy('2026-05-24') == 221

    def test_date_object_accepted(self):
        assert pp.horizon_days_to_eoy(date(2026, 5, 24)) == 221
