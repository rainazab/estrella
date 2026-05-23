# Modelling assumptions

The exporter encodes a set of explicit assumptions about the source data.
Each one is mirrored in `app/assumptions.py` so the code and the docs cannot
drift.

## Granularity

The pipeline operates **per OF, per block**. Every row in the master table
represents a single line-time block keyed by OF. Lines, days and weeks are
aggregated views over those blocks — never the unit of analysis.

## Block classification

`app/block_classifier.py` tags every row as one of:

| Tag | Meaning |
|---|---|
| `production` | A real OF with recorded OEE. |
| `clean` | Cleaning activity (matched against the Cambios/Tiempo patterns). |
| `maint` | Maintenance block from the Mantenimiento file. |
| `other` | Ambiguous — excluded from OEE baselines and analogues. |

`clean`, `maint` and `other` rows **never enter** OEE baselines, transition
statistics or analogue means. They appear on the timeline only as
`kind: "clean" | "maint"` segments.

## WOID → OF join

The Tiempo export sometimes carries a `WOID` column rather than `OF`.
`block_classifier.verify_of_woid_join()` detects this and renames it. The
join coverage is reported in `data/processed/validation_report.txt`. If
coverage drops below a sensible threshold the exporter will flag it in
metadata.

## OEE > 1.0 handling

Source OEE values above 1.0 are clamped to 1.0. The number of capped rows is
reported in `metadata.oee_capped`. This is a defensive cap — a value of 1.05
in the source is almost always a unit / fraction mismatch, not real
super-100% performance.

## Sequence reconstruction

Sequences are reconstructed **per line, ordered by `Fecha Fin`**. Cleaning
and maintenance blocks remain in the sequence as `kind` segments. Production
transitions are only counted across consecutive production blocks — a
cleaning row between two production rows breaks the transition chain by
design.

## basePlan source — Planificado first, historical fallback

`basePlan` is built from `data/raw/Planificado - producciones 14 - 17 - 19.XLSX`
when it parses cleanly. The exporter:

- Reads `Material`, `Tren`, `Fecha ini.`, `Hora ini.`, `Cntd plan`,
  `Secuencia` and `Denominación`.
- Sorts each line by start datetime, then by `Secuencia`.
- Derives segment width from the gap to the next planned start (1h floor,
  24h ceiling, 8h fallback for the tail segment).
- Estimates HL from `Cntd plan` using a per-format cases→HL ratio.
- Stamps `metadata.basePlanSource = "planificado"`.

If the file is missing or unparseable, the exporter falls back to a
historical-rows-derived plan and stamps `metadata.basePlanSource =
"historical_fallback"`. Warnings are emitted on stdout and recorded in
`data/processed/validation_report.txt`.

## Full insertion-slot search

For every feasible line, the recommender evaluates *every* valid
production anchor in `basePlan[line]`, scores each candidate, and selects
the best by adjusted OEE gain. The number of slots evaluated per line is
written to each recommendation as `candidateSlotsEvaluated` (additive
field). The chosen anchor index is `selectedAnchorIndex`.

The naive baseline is the SKU's historically-most-common feasible line's
*first* production anchor — that anchor is what `evidence.naiveMean` /
`naiveBand` represent on the timeline.

## Evidence scope and penalty

Analogues are pulled from a five-level ladder, strongest first:

| Scope                       | Penalty (OEE pts) |
|-----------------------------|-------------------|
| `line_transition_format`    | 0.0  |
| `line_transition`           | 0.5  |
| `transition_all_lines`      | 1.5  |
| `line_only`                 | 3.0  |
| `global_fallback`           | 5.0  |
| `no_match` / `no_history`   | 6.0  |

The penalty is subtracted from the raw OEE gain (in points) to compute
`adjustedOeeGain`. Objective ranking uses `adjustedOeeGain` so that a
recommendation with a thin scope cannot beat a stronger-evidence
recommendation by a tiny raw delta.

`evidenceStrengthLabel` combines sample size and scope:
- `Strong`  — `n >= 20` AND scope in `{line_transition_format, line_transition}`.
- `Medium`  — `n >= 8` (and scope better than `global_fallback`).
- `Limited` — `n >= 3`.
- `Weak`    — `n < 3`.

When the scope is `line_only` or weaker, `evidence.reason` is required to
contain the word *limited* or *fallback*. The validators enforce this.

## Cleaning / maintenance between production runs

`sequence_builder.build_sequence` now records the cleaning and maintenance
blocks that sit between two production OFs on the same line. Each row in
the transition table carries:

- `clean_blocks_between`, `maint_blocks_between`
- `cleaning_minutes_between`, `maintenance_minutes_between`,
  `nonprod_minutes_between`
- `had_cleaning_between`, `had_maintenance_between`

The recommendation evidence breakdown surfaces the analogue-pool mean for
`cleaning_minutes_between` and the % of analogues that had cleaning
between runs.

## CF Prat theoretical baseline + same-format honesty

The CF Prat matrix (`Tabla CF Prat 2026_14_17_19.xlsx`) is the primary
reference for **format-vs-format** changeover minutes. When a
`(line, prev_format, cur_format)` triple is missing, the exporter falls
back to the historical mean actual changeover for the transition_type.

A CF value of **0 min for a same-format transition** is *not* "no
changeover". When `transitionComponents` carry brand / product /
packaging changes, the exporter:

- Splits the breakdown into discrete rows: Format CF, Brand change,
  Product change, Packaging change, Cleaning between runs, PNP / restart,
  Historical actual changeover, Predicted OEE.
- Phrases the reason as: *"CF format matrix shows no format change, but
  Cambios flags … — cleaning / restart loss is still expected."*
- Validators block any `reason` that says "no changeover" when format is
  the same but other components are active.

## Backtest is plausibility, not causal proof

`app/backtest.py` samples up to N historical production runs, treats each
as a simulated urgent order, and compares the recommender's slot choice
against a naive same-line baseline. Many SKUs are line-locked so most
sampled cases tie; the *active* metrics (rows where the recommender
chooses a different line than naive) are the discriminating signal. The
analogue pool overlaps with the target rows even after best-effort
exclusion by OF — leakage tends to inflate win rate. A clean zero in
`active_loss_rate` under leaky conditions still tells us the recommender
does not strictly underperform the naive baseline. See
[`MODEL_CARD.md`](MODEL_CARD.md) for the latest figures.

## Recovery tail (modelled, not measured)

The "recovery hours" attached to every recommendation are a **modelled
estimate** built from CF baseline + a transition-type-specific tail. They
are not measured. The exporter writes
`recovery.note = "Modelled estimate ... not a measurement."` on every
recommendation, and the frontend renders it as a caveat.

## Analogue requirements

Every analogue surfaced in `evidence.analogues` references a **real 2025
OF**. `validate_model_outputs.py` asserts:

- The OF exists in `production_runs`.
- The OEE on the analogue matches the OEE on the source row (within 0.01).

If you see an analogue with a fabricated OF, the validator will refuse the
output.

## No €/cost figures

No validated cost data exists in the source files. Recommendations are
comparative in OEE points only (`gainPoints`). The frontend can label them
with units but must not convert to euros.

## Executed 2025 history is read-only

The exporter never overwrites historical blocks. Recommendations only
modify the **forward plan** (`basePlan` → per-recommendation `plan`).

## Privacy

Raw Damm Excel files are confidential and must not be committed.
`.gitignore` excludes:

- `data/raw/*` (except `.gitkeep`)
- `data/processed/*` (except `.gitkeep`)
- `data/output/*` (except `.gitkeep`)
- `*.xlsx`, `*.xls`, `*.xlsm`, `*.csv`, `*.parquet`

`data/output/data.json` may be shared with the frontend teammate directly,
but is also gitignored by default to avoid accidentally committing
generated artifacts.
