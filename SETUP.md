# LineWise Setup

How to run LineWise locally. Two pieces:

- **Backend** — `app/` Python package. Ingests Excel exports, produces
  `data/output/data.json`, optionally serves it over HTTP.
- **Frontend** — `linewise/` React + Vite app. Consumes either the
  static `plan.json` (offline) or the live `/plan` HTTP endpoint.

This doc covers both. Backend sections are for you; frontend sections are
for whoever runs the UI locally.

## TL;DR — full stack in one shell window each

```bash
# terminal 1 — backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
./scripts/run_export.sh          # regenerate data + sync frontend seed
./scripts/run_server.sh --reload # serve /plan on :8000

# terminal 2 — frontend
cd linewise
npm install
npm run dev                      # http://localhost:5173
```

For the offline demo, skip the server step — the Vite middleware serves
the static `linewise/data/plan.json` directly.

---

# Backend

The `app/` Python package. Turns ten Damm 2025 Excel exports into a
single `data/output/data.json` payload matching `docs/DATA_CONTRACT.md`,
and optionally serves it over HTTP.

What the backend does **not** do: no LLM calls, no €/cost figures, no
mutation of executed history, no online retraining.

## 1. What it does

Pipeline (each step is one module in `app/`):

```
data/raw/*.xlsx
   ↓  data_loader        → per-line, per-block master table keyed by OF
   ↓  block_classifier   → production / cleaning / maintenance (OEE capped at 1.0)
   ↓  changeover_typing  → transition_type + principal_label (from Cambios)
   ↓  sequence_builder   → per-line sequence + production-only transitions
   ↓  cf_matrix          → CF Prat theoretical baseline (with historical fallback)
   ↓  export_data_json   → analogue search + recommendation + data.json
```

## 2. Environment setup

Python 3.11+. From the repo root:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Dependencies (`requirements.txt`): pandas, numpy, openpyxl, fastapi,
uvicorn, httpx, pytest, python-dotenv, unidecode.

Shell scripts auto-pick `.venv/bin/python`, otherwise fall back to
system `python3`. Override with `PYTHON_BIN=...`.

## 3. Raw inputs

Place these files in `data/raw/` with the exact filenames:

| File | Purpose |
|---|---|
| `OEE 14_17_19_ 2025.xlsx` | Per-OF OEE rows |
| `Tiempo 14_17_19_ 2025.xlsx` | Per-OF time decomposition (PNP, changeover, …) |
| `Cambios 14_17_19_ 2025.xlsx` | Changeover decomposition / principal labels |
| `Mantenimiento 14_17_19_ 2025.xlsx` | Maintenance blocks |
| `Volumen 14_17_19_ 2025.xlsx` | Production volume per OF |
| `Tabla CF Prat 2026_14_17_19.xlsx` | CF Prat theoretical changeover matrix |
| `Planificado - producciones 14 - 17 - 19.XLSX` | Forward plan |
| `Produccion_L14,17,19_18-22.xlsx` | Multi-year production reference |
| `data - 2026-05-18T181640.542.xlsx` | OF master |
| `Diario Hl_Planif.xlsx` | Daily HL planning reference |

Filenames are matched verbatim. `data/raw/` is gitignored — never commit
the Excel files.

## 4. Daily workflow

### Regenerate `data.json`

```bash
./scripts/run_export.sh
```

Runs `python -m app.export_data_json` and, if `linewise/` exists, syncs
`linewise/data/plan.json` so the frontend picks up the new payload on
the next browser reload. Skip the sync with
`SKIP_FRONTEND_SYNC=1 ./scripts/run_export.sh`.

Prints a summary: OEE rows, block counts, capping count, WOID→OF match
rate, transitions reconstructed, analogue counts per recommendation,
output path.

### Validate

```bash
./scripts/run_checks.sh
```

Runs export → `validate_data_json` → `validate_model_outputs` → backtest
→ pytest. Fails fast. Use before handoff.

- **`validate_data_json`** — contract shape: required keys, evidence
  fields, line rules, weekly locked stops, segment validity, slot-search
  counters, anchor OF present in `basePlan`.
- **`validate_model_outputs`** — model invariants: OEE baselines exclude
  cleaning/maintenance, every analogue OF is real, `gain == analogueMean
  − naiveMean`, weak-scope recs mention *limited*/*fallback*, same-format
  zero CF must not claim "no changeover", infeasible lines can't top a
  ranking, OEE-objective winner has the highest `adjustedOeeGain`.

### Run the HTTP server

```bash
./scripts/run_server.sh                 # 127.0.0.1:8000
./scripts/run_server.sh --reload        # auto-reload during dev
LINEWISE_HOST=0.0.0.0 LINEWISE_PORT=9000 ./scripts/run_server.sh
```

Reads `data/output/data.json` on every `/plan` request — the batch
exporter is still source of truth. Missing file → 503 with
`{ "error", "detail" }`.

Endpoints (defined in `app/server.py`, contract in
`docs/API_CONTRACT.md`):

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/health` | Liveness — `{ "ok": true }` |
| `GET`  | `/plan`   | Frontend-shape payload (ETag + `Cache-Control: no-store`) |
| `POST` | `/plan/recompute` | Re-run the exporter from `data/raw/` |
| `GET`  | `/signals` | External context signals + citations (Cala) |
| `POST` | `/signals/refresh` | Re-fetch from Cala |
| `POST` | `/issues` | Log a line-side issue |
| `POST` | `/stoppages` | Log a line stoppage (one active per line) |
| `POST` | `/stoppages/{id}/resume` | Clear an active stoppage |
| `POST` | `/plan/stoppage-replan` | Shift downstream runs by stoppage duration |
| `POST` | `/plan/move/preview` | Dry-run a manual move (ripple + collisions) |
| `POST` | `/plan/move` | Commit a manual move |
| `POST` | `/plan/resequence` | Global re-sequence to minimise changeover |

Issues, stoppages, and manually-moved plans are held in-process — no DB.
Restarting the server clears them.

### Backtest

```bash
python -m app.backtest \
  --raw data/raw \
  --processed data/processed \
  --out data/processed/backtest_report.json \
  --cases 50 --seed 42
```

Active-case win/loss rate is the signal — see `docs/MODEL_CARD.md`.

## 5. Module map (`app/`)

| Module | Responsibility |
|---|---|
| `data_loader.py` | Read the Excel exports, normalise columns, join on OF |
| `block_classifier.py` | Tag each block production / cleaning / maintenance; cap OEE |
| `changeover_typing.py` | Derive transition type + principal label from `Cambios` |
| `sequence_builder.py` | Reconstruct per-line sequence ordered by `Fecha Fin` |
| `cf_matrix.py` | CF Prat theoretical baseline (with historical fallback) |
| `line_rules.py` | Locked line/format rules + weekly stops |
| `assumptions.py` | Centralised tunables (OEE cap, scope penalties, …) |
| `data_contract.py` | Contract field names / dataclasses |
| `diagnostics.py` | Validation report writer (`data/processed/`) |
| `plan_loader.py` | Load forward plan + map anchors |
| `export_data_json.py` | End-to-end exporter (entry point) |
| `validate_data_json.py` | Shape validator |
| `validate_model_outputs.py` | Invariant validator |
| `backtest.py` | Plausibility backtest |
| `frontend_payload.py` | Canonical → frontend HTTP shape (also writes `linewise/data/plan.json`) |
| `server.py` | FastAPI app |
| `signals.py` | Cala signals + citations |
| `production_projector.py` | Forward production projection |
| `resequencer.py` | Re-sequence logic for `/plan/resequence` |

Outputs go to `data/processed/` (intermediate, gitignored) and
`data/output/data.json` (final, gitignored).

## 6. Tests

```bash
python -m pytest tests -q
```

Or via `./scripts/run_checks.sh`. Suites: `test_contract.py`,
`test_line_rules.py`, `test_data_quality.py`, `test_frontend_payload.py`,
`test_server.py`, `test_production_projector.py`, plus the golden sample
at `tests/golden/data_json_sample.json`.

---

# Frontend

The `linewise/` React + Vite + Tailwind app. Lives in its own subdir
with its own `package.json` and `node_modules`.

## 1. One-time setup

```bash
cd linewise
npm install
```

Node 18+ recommended (matches Vite 8). Stack: React 19, Vite 8,
Tailwind 3, framer-motion, lucide-react.

## 2. Run the dev server

```bash
cd linewise
npm run dev
```

Vite serves at `http://localhost:5173` with HMR. By default it uses a
fake-API middleware that serves `linewise/data/plan.json` at `/api/plan`
— no backend server needed for the offline demo.

A browser reload picks up changes to `linewise/data/plan.json` — no Vite
restart needed.

## 3. Point at the live backend

To hit the real Python backend instead of the static file, create
`linewise/.env.local`:

```
VITE_API_BASE=http://localhost:8000
```

Then start the backend (`./scripts/run_server.sh --reload`) in another
terminal. The frontend now fetches from `http://localhost:8000/plan`.

Unset `VITE_API_BASE` (or delete `.env.local`) to fall back to the
static file.

## 4. Other npm scripts

```bash
npm run build      # production build → linewise/dist/
npm run preview    # serve the built bundle locally
npm run lint       # ESLint
```

## 5. Where the frontend reads data from

Pick one of two sources at any time:

| Mode | What the frontend hits | When to use |
|---|---|---|
| Offline (default) | `linewise/data/plan.json` via Vite middleware | Quick demo, no Python running |
| Live HTTP | `GET ${VITE_API_BASE}/plan` | Real backend, writes (issues, stoppages, moves) |

The shape of both is described in `docs/API_CONTRACT.md` (trimmed) and
`docs/DATA_CONTRACT.md` (richer canonical). The live `/plan` response
adds ETag + `Cache-Control: no-store`.

---

# Frontend ↔ Backend handoff

Two ways to feed the frontend, pick one:

### A. Static file (offline demo)

```bash
./scripts/run_export.sh
```

Refreshes `linewise/data/plan.json`. Browser reload picks it up.

### B. Real HTTP backend

```bash
./scripts/run_server.sh --reload
```

In `linewise/.env.local`:

```
VITE_API_BASE=http://localhost:8000
```

### Contract docs

- `docs/DATA_CONTRACT.md` — full shape of `data.json` (richer, canonical).
- `docs/API_CONTRACT.md` — trimmed shape returned by `GET /plan`.
- `docs/ASSUMPTIONS.md` — modelling assumptions.
- `docs/MODEL_CARD.md` — scoring details, backtest interpretation.
- `docs/HANDOFF.md` — handoff checklist.

If you change any field shape, update both the relevant doc and the
golden sample (`tests/golden/data_json_sample.json`) in the same commit.

### Pre-handoff checklist

- [ ] `data/raw/` contains all ten Excel files.
- [ ] `./scripts/run_checks.sh` exits 0.
- [ ] `data/output/data.json` exists and is non-empty.
- [ ] `data/processed/validation_report.txt` looks sane (join coverage, block counts).
- [ ] `linewise/data/plan.json` is in sync (re-run `./scripts/run_export.sh` if unsure).
- [ ] `git status` is clean — no `*.xlsx` or `data/raw/*` tracked.

---

# Troubleshooting

| Symptom | Likely cause |
|---|---|
| `raw directory not found` | `data/raw/` missing or empty — drop the Excel files in |
| Pipeline aborts at "loading master" | One of the required exports is missing or renamed — check the Raw inputs table |
| `using_fallback_data: true` in metadata | Real parsing yielded too few rows; exporter fell back to synthetic. Inspect `data/processed/validation_report.txt` |
| `validate_model_outputs` complains about non-matching OEE | A recommendation references an OF not in production runs — re-run the export |
| Frontend renders blanks for a line | That line is in `infeasibleByLine` for the urgent format. Expected for Line 17 with 1/2 cans |
| Server returns 503 on `/plan` | `data/output/data.json` is missing — run `./scripts/run_export.sh` |
| Frontend doesn't see new data | Browser reload triggers a re-fetch; if still stale, re-run `./scripts/sync_frontend_plan.sh` |
| `npm run dev` fails with module errors | Delete `linewise/node_modules` and re-run `npm install` |
| Frontend fetches old data after setting `VITE_API_BASE` | Vite reads `.env.local` at startup — restart `npm run dev` |
