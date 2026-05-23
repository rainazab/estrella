# LineWise model card

LineWise is a recommender that places one urgent canning order onto Damm
lines 14, 17 or 19, choosing both the line and the sequence position.
Recommendations are local, deterministic, and tied to recorded 2025
production.

## Inputs

The recommender consumes the cleaned master table built by
`app.data_loader.build_master_dataset()` from these Excel exports:

- `OEE 14_17_19_ 2025.xlsx` — per-OF OEE spine.
- `Tiempo 14_17_19_ 2025.xlsx` — PNP / cleaning / changeover time
  decomposition, joined on WOID→OF.
- `Cambios 14_17_19_ 2025.xlsx` — per-OF changeover principal and
  binary indicators (brand, format, palet, etc.).
- `Mantenimiento 14_17_19_ 2025.xlsx` — maintenance interventions.
- `Volumen 14_17_19_ 2025.xlsx` — HL produced per OF.
- `Tabla CF Prat 2026_14_17_19.xlsx` — theoretical format-vs-format
  changeover matrix.
- `Planificado - producciones 14 - 17 - 19.XLSX` — forward production
  plan per line (drives `basePlan`).

Sample data from `app/sample_data.py` provides a synthetic master if the
real data is missing.

## Outputs

`data/output/data.json` matching the contract described in
[`DATA_CONTRACT.md`](DATA_CONTRACT.md). Key recommendation fields:

- `line`, `position`, `oeeDelta`, `oeeGood`, `deadline`, `ordersMoved`
- `plan`, `ghosts`, `moves`, `recovery`
- `naiveBand` — comparison marker on the SKU's historical line
- `evidence` — analogues, breakdown rows, scope, qualityLabel, gain
- Additive (not contract-required): `candidateSlotsEvaluated`,
  `selectedAnchorIndex`, `adjustedOeeGain`, `evidencePenaltyPts`,
  `disruptionScore`, `timeScore`, `predictedOee`, `naivePredictedOee`,
  `evidenceStrengthLabel`, `transitionType`.

Plus a `metadata.basePlanSource` of `"planificado"` or
`"historical_fallback"`.

## What the model learns

There is no trained ML model. The recommender is a deterministic scoring
pipeline:

1. **Classify** every line-time block into production / clean / maint
   / other.
2. **Reconstruct** per-line sequences ordered by `Fecha Fin`, attributing
   cleaning / maintenance blocks to the next production transition.
3. **Annotate** each production transition with a `transition_type` tag
   built from Cambios indicators.
4. **Aggregate** per-line baselines (production rows only) and
   per-transition_type statistics.
5. **Score** an urgent order against historical analogues using a
   five-level scope ladder.

## Recommendation algorithm

For each feasible line:

```
for anchor in basePlan[line]:
    candidate = evaluate(line, anchor, urgent_order)
    score(candidate)              # raw OEE gain, penalty, time, disruption
best_per_line = argmax(candidates, key=adjusted_oee_gain)
```

A candidate carries:

- `analogue_mean_oee` — mean OEE of the matched analogue pool.
- `scope` and `scope_penalty_pts` — see Evidence scope below.
- `cf_format_minutes` — format-vs-format CF from the Prat matrix.
- `historical_actual_minutes` — same-transition_type mean actual
  changeover.
- `cleaning_minutes_between` and `had_cleaning_between_rate` — from the
  transition table.
- `proposed.plan / ghosts / moves` — what the timeline looks like after
  insertion.

Scoring:
- `raw_oee_gain_pts   = (predicted_oee − naive_oee) × 100`
- `evidence_penalty   = SCOPE_PENALTY_PTS[scope]  (+1.0 if n < 3)`
- `adjusted_oee_gain  = raw_oee_gain_pts − evidence_penalty`
- `disruption_score   = ordersMoved + 0.5·ghost_count + 0.05·recovery_h + 0.3·penalty`
- `time_score         = cf_min + max(0, hist_min−cf_min) + 60·recovery_h + 30·ordersMoved`

Per-line winner: highest `adjusted_oee_gain`, tie-break on lowest
`disruption_score`. Objective ranking uses adjusted gain (OEE), time
score (Time), disruption score (Disruption).

## Evidence scope ladder

| Scope                       | Definition                                | Penalty |
|-----------------------------|-------------------------------------------|---------|
| `line_transition_format`    | Same line + transition_type + can format | 0.0 pts |
| `line_transition`           | Same line + transition_type              | 0.5 pts |
| `transition_all_lines`      | Same transition_type, any line           | 1.5 pts |
| `line_only`                 | Same line, any transition                | 3.0 pts |
| `global_fallback`           | Any production transition                | 5.0 pts |
| `no_match` / `no_history`   | (sentinel)                               | 6.0 pts |

Strength labels combine sample size with scope (see
[`ASSUMPTIONS.md`](ASSUMPTIONS.md)). Recommendations on `line_only` or
weaker scopes are required to say *limited* or *fallback* in their
evidence reason — the validators enforce this.

## Known limitations

- Per-OF granularity only — crew, shift staffing and downstream
  micro-stoppages are not in the source data.
- Recovery hours are a modelled tail, not a measurement.
- No €/cost figures — no validated cost data exists. Recommendations are
  comparative in OEE points.
- The naive baseline is the SKU's historically-most-common feasible
  line's first anchor. Alternative baselines (e.g. randomised slots)
  are not currently exercised.
- The backtest leaks across the analogue pool; see
  [`ASSUMPTIONS.md`](ASSUMPTIONS.md).

## Validation performed

Run via `./scripts/run_checks.sh`:

1. `app.validate_data_json` — contract shape (required top-level keys,
   per-recommendation fields, per-evidence fields, segment validity,
   non-empty position, slot-search transparency, anchor present in
   basePlan).
2. `app.validate_model_outputs` — model invariants (production-only
   baselines, analogue OFs exist, analogue OEE matches source,
   `gain == analogueMean − naiveMean`, infeasible lines cannot top any
   objective, OEE order matches max `adjustedOeeGain`, CF=0 +
   same-format must not claim "no changeover", weak-scope recommendations
   must mention *limited* or *fallback*).
3. `pytest tests/ -q` — contract / line-rules / data-quality.
4. `app.backtest` — plausibility report at
   `data/processed/backtest_report.{json,txt}`.

Latest backtest snapshot (50-row sample, seed 42, 2026-05-23):

- `cases_tested`: 50
- `recommendation_win_rate`: 22.0%
- `active_cases`: 11   (rows where recommender picked a different line)
- `active_win_rate`: 100.0%   |   `active_loss_rate`: 0.0%
- `active_avg_uplift`: +5.57 OEE pts
- `median_evidence_n`: 8
- `weak_evidence_rate`: 10.0%
- `scope_distribution`: line_transition_format 49 · line_transition 1

The high tie rate reflects how many SKUs are line-locked. The active
metrics are the discriminating signal: zero active losses + a positive
uplift means the slot search and scope penalty are doing real work
without hallucinating better lines.

## Why no Hugging Face / OpenAI

LineWise is a deterministic recommender over a small, structured table of
historical events. Every output is reproducible from the inputs without
external model calls. Adding an LLM here would (a) introduce a network
dependency the planner cannot audit, (b) risk fabricating analogues, and
(c) make `validate_model_outputs.py` impossible to write. The evidence
reasons are templated text generated from real numbers; the analogues
are real OFs.
