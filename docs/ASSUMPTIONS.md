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

## CF Prat theoretical baseline + fallback

The CF Prat matrix (`Tabla CF Prat 2026_14_17_19.xlsx`) is the primary
reference for changeover minutes. When a `(line, prev_format, cur_format)`
triple is missing from the matrix, the exporter falls back to the historical
mean actual changeover for that transition_type. The fallback is documented
inside the recommendation evidence and reported in the validation report.

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
