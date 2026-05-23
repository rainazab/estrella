# LineWise

Monorepo for the LineWise demo:

- `app/` — Python backend: ingests Damm's 2025 Excel exports, scores the
  best line + slot for an urgent order, serves the result over HTTP.
- `linewise/` — React + Vite + Tailwind web app (see
  [`linewise/README.md`](linewise/README.md)).
- `docs/` — contract, assumptions, model card, handoff, API contract.

The backend turns Damm's 2025 Excel exports for canning lines 14, 17 and
19 into the LineWise frontend data contract (`data.json` + `GET /plan`).

## Dev loop in 60 seconds

```bash
# 1. Generate the canonical data + refresh the frontend dev seed
./scripts/run_export.sh

# 2. Boot the frontend (the Vite middleware serves linewise/data/plan.json)
cd linewise && npm install && npm run dev
```

That's it for an offline demo. To swap the Vite middleware for the real
HTTP backend, start `./scripts/run_server.sh` in another terminal and
set `VITE_API_BASE=http://localhost:8000` in `linewise/.env.local`.

```
Excel exports (data/raw)
   ↓  app.data_loader        → master table (per-line, per-block, keyed by OF)
   ↓  app.block_classifier   → production / clean / maint, OEE capped at 1.0
   ↓  app.changeover_typing  → transition_type + principal_label (from Cambios)
   ↓  app.sequence_builder   → per-line sequence + production-only transitions
   ↓  app.cf_matrix          → CF Prat theoretical baseline (with fallback)
   ↓  app.export_data_json   → analogue search + recommendation + data.json
```

The output is `data/output/data.json` — a single static file that the frontend
team loads directly (no API). See [`docs/DATA_CONTRACT.md`](docs/DATA_CONTRACT.md)
for the exact shape.

## 1. What this repo does

- Ingests the seven Damm Excel exports for the 2025 canning year.
- Cleans, classifies and joins them on the OF key.
- Reconstructs per-line sequences and types every changeover.
- Generates recommendations for an urgent order, scored against real 2025
  analogues.
- Emits a single self-contained `data.json` matching the frontend contract.

## 2. What this repo does NOT do

- No frontend code. The dashboard lives in a separate repo and only consumes
  `data/output/data.json`.
- No FastAPI / live API. The pipeline is a batch exporter.
- No OpenAI / LLM calls. All explanations are deterministic.
- No €/cost figures — no validated cost data exists in the source files.
- No mutation of executed 2025 history — past blocks render as-is.

## 3. Required raw files

Place the following Excel files in `data/raw/`:

| File | Source export |
|---|---|
| `OEE 14_17_19_ 2025.xlsx` | Per-OF OEE rows for the three lines. |
| `Tiempo 14_17_19_ 2025.xlsx` | Per-OF time decomposition (PNP, changeover, …). |
| `Cambios 14_17_19_ 2025.xlsx` | Changeover decomposition (principal labels). |
| `Mantenimiento 14_17_19_ 2025.xlsx` | Maintenance blocks. |
| `Volumen 14_17_19_ 2025.xlsx` | Production volume per OF. |
| `Tabla CF Prat 2026_14_17_19.xlsx` | CF Prat theoretical changeover matrix. |
| `Planificado - producciones 14 - 17 - 19.XLSX` | Forward plan. |
| `Produccion_L14,17,19_18-22.xlsx` | Multi-year production reference. |
| `data - 2026-05-18T181640.542.xlsx` | OF master. |
| `Diario Hl_Planif.xlsx` | Daily HL planning reference. |

Filenames are matched verbatim — keep them exactly as exported.

## 4. Install

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## 5. Generate data.json

```bash
python -m app.export_data_json \
  --raw data/raw \
  --out data/output/data.json \
  --processed data/processed
```

Or via the shell wrapper:

```bash
./scripts/run_export.sh
```

The exporter prints a summary including OEE rows, block counts, capping count,
WOID→OF match rate, transitions reconstructed, analogue counts per
recommendation and the output path.

## 6. Validate data.json

```bash
python -m app.validate_data_json data/output/data.json
python -m app.validate_model_outputs data/output/data.json
```

Or in one shot:

```bash
./scripts/run_checks.sh
```

### What the validators check

- `validate_data_json` — contract shape: top-level keys, per-recommendation
  required fields, evidence fields, segment validity, non-empty position,
  slot-search counters, anchor OF present in `basePlan`.
- `validate_model_outputs` — model invariants: OEE baselines exclude
  cleaning/maintenance, every analogue OF is real and its OEE matches the
  source row, `gain == analogueMean − naiveMean`, weak-scope recommendations
  must mention *limited* / *fallback*, same-format zero CF must not claim
  "no changeover", infeasible lines cannot top any objective ranking,
  objectives.oee winner has the highest `adjustedOeeGain`.

## 7. Backtest

A plausibility check that the recommender does not strictly underperform
the naive baseline:

```bash
python -m app.backtest \
  --raw data/raw \
  --processed data/processed \
  --out data/processed/backtest_report.json \
  --cases 50 \
  --seed 42
```

Outputs `data/processed/backtest_report.{json,txt}`. The active-case win
rate / loss rate are the discriminating signal — see
[`docs/MODEL_CARD.md`](docs/MODEL_CARD.md).

## Recommendation scoring in one paragraph

For each feasible line, the recommender evaluates every valid production
anchor in `basePlan[line]`, scores each candidate, and picks the best by
penalty-adjusted OEE gain. The analogue pool is selected via a five-level
scope ladder (strongest: same line + transition + format; weakest: any
production transition); each scope carries a penalty in OEE points that
discounts the raw gain. The naive baseline is the urgent SKU's
historically-most-common feasible line's first anchor — its analogue
mean is `evidence.naiveMean`. Objective rankings use the
penalty-adjusted gain (OEE), a time score combining CF + overrun +
recovery + shifted orders (Time), and a disruption score (Disruption).
No LLM, no €/cost numbers, no fabricated analogues.

## 8. Frontend handoff

The frontend now consumes an HTTP API. Start the server:

```bash
./scripts/run_server.sh                 # 127.0.0.1:8000
./scripts/run_server.sh --reload        # auto-reload during dev
```

Endpoints:

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/health` | Liveness probe — `{ "ok": true }` |
| `GET`  | `/plan`   | Full planning payload (frontend contract v2.0). ETag + `Cache-Control: no-store`. |
| `POST` | `/plan/recompute` | Re-run the exporter from `data/raw/` |

The frontend's `.env`:

```
VITE_API_BASE=http://localhost:8000
```

The frontend can also still consume `data/output/data.json` directly
(canonical, richer) if it prefers — but the HTTP `/plan` returns the
trimmed contract shape described in
[`docs/API_CONTRACT.md`](docs/API_CONTRACT.md).

## 9. Assumptions

See [`docs/ASSUMPTIONS.md`](docs/ASSUMPTIONS.md). Headlines:

- Granularity is per-OF / per-block.
- Production vs cleaning/maintenance is classified before any OEE math.
- OEE values > 1.0 are capped to 1.0 (count reported in metadata).
- Sequences are reconstructed per line, ordered by `Fecha Fin`.
- CF Prat theoretical baseline is the primary changeover reference; the
  exporter falls back to historical mean when the matrix has a gap.
- Recovery hours are a **modelled estimate**, not a measurement.
- Every analogue is a real 2025 OF with the recorded OEE from the source.
- No raw confidential data is committed.

## 10. Troubleshooting

| Symptom | Likely cause |
|---|---|
| `raw directory not found` | `data/raw/` is missing or empty. Drop the Excel files in. |
| Pipeline aborts at "loading master" | One of the required exports is missing or renamed. Check section 3. |
| `using_fallback_data: true` in metadata | Real data parsing yielded too few rows; the exporter fell back to synthetic. Inspect the validation report in `data/processed/`. |
| `validate_model_outputs` complains about non-matching OEE | A recommendation references an OF that does not appear in production runs. Re-run the export — the analogue index has drifted. |
| Frontend renders blanks for a line | That line is in `infeasibleByLine` for the urgent format. Expected for Line 17 with 1/2 cans. |

## 11. Handoff checklist

- [ ] `data/raw/` contains all ten Excel files.
- [ ] `./scripts/run_checks.sh` exits 0.
- [ ] `data/output/data.json` exists and is non-empty.
- [ ] `data/processed/validation_report.txt` looks sane (join coverage, block counts).
- [ ] Frontend teammate has either the file or the command to regenerate it.
- [ ] No `*.xlsx` or `data/raw/*` files are tracked by git (`git status` is clean).

## Repo layout

```
.
├── app/                     # backend modules
│   ├── data_loader.py
│   ├── block_classifier.py
│   ├── sequence_builder.py
│   ├── changeover_typing.py
│   ├── cf_matrix.py
│   ├── line_rules.py
│   ├── diagnostics.py
│   ├── data_contract.py
│   ├── assumptions.py
│   ├── export_data_json.py
│   ├── validate_data_json.py
│   ├── validate_model_outputs.py
│   ├── plan_loader.py
│   ├── frontend_payload.py   # canonical → frontend HTTP shape
│   ├── server.py             # FastAPI /health, /plan, /plan/recompute
│   └── backtest.py
├── linewise/                # React + Vite + Tailwind app (see linewise/README.md)
│   ├── src/                 # App.jsx, components/, hooks/, lib/, api/
│   ├── data/plan.json       # Vite fake-API seed (regenerated by scripts/sync_frontend_plan.sh)
│   ├── package.json
│   └── vite.config.js
├── data/
│   ├── raw/          # Excel inputs (gitignored)
│   ├── processed/    # intermediate artifacts (gitignored)
│   └── output/       # data.json (gitignored)
├── docs/
│   ├── DATA_CONTRACT.md
│   ├── API_CONTRACT.md
│   ├── ASSUMPTIONS.md
│   ├── MODEL_CARD.md
│   └── HANDOFF.md
├── scripts/
│   ├── run_export.sh           # batch export → also syncs linewise/data/plan.json
│   ├── sync_frontend_plan.sh   # just the sync step
│   ├── run_server.sh           # FastAPI server
│   └── run_checks.sh           # export + validators + backtest + pytest
├── tests/
│   ├── test_contract.py
│   ├── test_line_rules.py
│   ├── test_data_quality.py
│   ├── test_frontend_payload.py
│   ├── test_server.py
│   └── golden/data_json_sample.json
├── requirements.txt
└── README.md
```
