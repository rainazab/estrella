# Handoff to the frontend teammate

This repo is the backend / data layer. It emits one artifact:

> `data/output/data.json`

The frontend in your repo loads it as `public/data.json` and renders the
cockpit from it.

## TL;DR — HTTP path

```bash
# 1. Generate the canonical data:
./scripts/run_export.sh

# 2. Start the HTTP API:
./scripts/run_server.sh

# 3. Point your frontend at it:
#    VITE_API_BASE=http://localhost:8000
```

`GET /health` should return `{ "ok": true }`. `GET /plan` returns the
frontend-shape payload described in [`API_CONTRACT.md`](API_CONTRACT.md).

### Alternative: file drop

If you prefer a static file (the old workflow), just copy the canonical
output:

```bash
cp data/output/data.json /path/to/frontend/public/data.json
```

That file is richer than `/plan` (it includes `metadata`,
`infeasibleByLine`, `planReview`, and additive scoring fields). The
frontend can read it directly without a server.

## What the file contains

Eight required top-level keys:

- `urgentOrders`        — list of urgent SKUs
- `lineBaseline`        — per-line OEE / changeover stats from 2025
- `lineCentre`          — which CF centre owns each line
- `yearCompare`         — monthly OEE per line / per year
- `executedHistory`     — past timeline segments per line
- `basePlan`            — forward plan per line
- `recommendations`     — one recommendation per feasible line
- `objectives`          — rankings under OEE / Time / Disruption

Plus additive: `metadata`, `infeasibleByLine`, `planReview`.

Full shape: see [`DATA_CONTRACT.md`](DATA_CONTRACT.md).

## When you receive an updated `data.json`

1. Drop it at `frontend/public/data.json`.
2. Hard-refresh the dashboard.
3. The contract version is in `metadata.contract_version`. If it changed,
   read the contract doc — the backend will have flagged the change.

## If validation fails

The backend ships two validators. Run them in this repo before sending
`data.json` over:

```bash
python -m app.validate_data_json     data/output/data.json
python -m app.validate_model_outputs data/output/data.json
```

Both must exit 0. If they don't:

| Error | Action |
|---|---|
| `missing top-level key` | Backend bug — flag immediately, do NOT ship. |
| `recommendations.X missing field` | Backend bug — same. |
| `analogue references fake OF` | Backend recomputed sequences are stale; re-run the export from a clean `data/processed/`. |
| `Line 17 must not win for urgent format 1/2` | Backend chose an infeasible line; line eligibility rules need to be re-checked. |
| `golden objectives.oee.order changed` | Either real source data changed (expected) or the model logic moved. Investigate before shipping. |

## Things the frontend does NOT need to do

- Compute OEE baselines — they're in `lineBaseline`.
- Re-derive analogues — they're in `evidence.analogues`.
- Convert OEE to euros — never. There is no cost data.
- Treat `recovery.hours` as measured — it's a modelled estimate. Render with
  the caveat in `recovery.note`.

## Contact

If a contract field is missing or behaves unexpectedly, ping the backend
owner with:

- The recommendation key (e.g. `recommendations.14`) and the field name.
- The contents of `data/processed/validation_report.txt` from the same run.
- The full `metadata` block from `data.json`.

That's enough to diagnose 90% of issues without re-running the pipeline.
