# LineWise

> **One urgent canning-line order. Three real options. The cockpit shows you
> the historical evidence behind each one and the cost of getting it wrong.**

LineWise is a planner cockpit for Damm's canning lines 14, 17 and 19. It is
not a live simulation server — the demo is the **backend → `data.json` →
frontend** pipeline:

```
Excel files
   ↓        data_loader.build_master_dataset()
master table  (one row per line-time block, keyed by OF)
   ↓        block_classifier.classify_blocks()
master + block_type (production / clean / maint / other), OEE capped at 1.0
   ↓        changeover_typing.annotate_master()
master + transition_type + principal_label
   ↓        sequence_builder.build_sequence()
line_blocks (incl. clean/maint) + production-only transition table
   ↓        diagnostics + analogue search + recommendation
LineWiseData payload  →  frontend/public/data.json
   ↓        loadData()
cockpit UI
```

The frontend boots from `/data.json` with **no runtime backend dependency**.
The legacy FastAPI endpoints still work for the secondary diagnostic /
plan-review / learning pages but the cockpit (`/`) does not need them.

---

## Run it

```bash
# 1. Build the data snapshot (Excel → data.json)
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m app.export_data_json
# writes ../frontend/public/data.json

# 2. Boot the cockpit
cd ../frontend
npm install
npm run dev
# http://localhost:3000
```

The full demo never touches the backend after step 1.

---

## Acceptance run (the contract handoff)

```
→ Step 1: verifying OF/WOID join
   OEE=2274 · Tiempo=2278 · shared=2274 · OEE-only=0 · Tiempo-only=4
   coverage=100.0% · rename WOID→OF: True
→ Step 2: loading master + classifying blocks
   blocks: total=2273 · production=2109 · clean=132 · maint=32 · other=0 · oee_capped=1
→ Step 4+5: building sequence + transition table (production-only)
   transitions: 2106
→ Step 6: loading CF matrix     (CF loaded: True)
→ Step 7: line baseline + transition-type stats
→ Step 9: building recommendations
   recommendations: ['14', '17', '19'] · infeasible: none
→ Step 12: validating contract
   ✔ contract OK

✔ wrote frontend/public/data.json  (57.1 KB)
  urgentOrders=2 · recommendations=3 · analogues=[L14:n=6, L17:n=6, L19:n=6]
  prod=2109 · clean=132 · maint=32 · oee_capped=1 · tx=2106
```

---

## Data assumptions (and what we *don't* assume)

| Assumption | Why |
|---|---|
| **Per-OF / per-line-time-block granularity.** Each row of the master table is one line-time block keyed by `OF`. *Not* every row is a production order. | Some OFs (`PRT99…M`) are cleaning windows or maintenance blocks, not production. |
| **`block_type` classifies every row** as `production` / `clean` / `maint` / `other` (`block_classifier.py`). Cleaning + maintenance blocks render on the timeline but **never enter OEE baselines, analogue means, or transition statistics**. | Mixing them was a bug — it dragged baselines toward 0. |
| **`OEE > 1.0` is capped** at 1.0 and the original value preserved in `oee_raw`. `metadata.oee_capped` counts how many rows were clipped. | One row in the source has `OEE = 1.573` — a data-entry artefact. |
| **WOID → OF rename** is safe: 100% of `OEE.OF` is present in `Tiempo.WOID`, only 4 extra in Tiempo. The pipeline renames Tiempo's `WOID` to `OF` internally. | Verified at the top of every export run. |
| **Executed sequence is immutable.** History is the spine of every analogue lookup. The simulator never re-shuffles past blocks. | A planner can only trust forward-looking placements. |
| **Recovery hours are a *modelled estimate*.** Every recommendation's `recovery.note` calls this out: "Modelled estimate: hours for the line to return to baseline OEE after the urgent insertion." | We don't have a measured "back to baseline" signal in the data. |
| **No euro / cost figures.** Damm hasn't given LineWise cost data. We report OEE points, HL, capacity hours, orders moved — that's it. | Inventing money numbers is dishonest. |
| **No OpenAI dependency on the export path.** Explanations are deterministic and built from the same facts the contract carries. | The demo must work offline. |
| **All analogues are real 2025 OFs** with real recorded OEE. No fakes. | Validated by `data_contract.py`. |

---

## Architecture

```
backend/
  main.py                        Legacy FastAPI app (secondary pages only)
  app/
    config.py
    data_loader.py               Excel ingest, column normalization, joins
    block_classifier.py     ⭐   block_type + OEE cap + OF/WOID join verifier
    changeover_typing.py    ⭐   Cambios decomposition → transition_type
    sequence_builder.py     ⭐   per-line block sequence + production-only transitions
    cf_matrix.py                 Tabla CF Prat parser + documented fallback
    line_rules.py                Hard format rules (14: 1/2,1/3 · 17: 1/3 · 19: all)
    transition_memory.py         (legacy — only used by FastAPI endpoints now)
    diagnostics.py               Transition-type ranking (legacy endpoint)
    optimizer.py                 (legacy — only used by FastAPI endpoints now)
    model.py                     GradientBoostingRegressor (unused on export path)
    business_impact.py           (legacy — euro figures removed from export)
    data_contract.py        ⭐   data.json validator + summary printer
    export_data_json.py     ⭐   THE handoff — Excel → contract → /data.json
  data/raw/                      Place data.zip contents here
  data/processed/                learning_log.json lives here

frontend/
  public/data.json               The contract handoff. Regenerated by the export script.
  app/
    globals.css                  Cream / dark-green / copper paper theme
    layout.tsx                   TopBar + secondary nav
    page.tsx                     Cockpit (queue → calculating → recs)
    diagnostics/, plan-review/, learning/, about-model/   Secondary pages
  lib/
    contract.ts                  LineWiseData types + loadData() + FALLBACK_DATA
  components/
    TopBar, QueuePanel, CalculatingPanel, CalculatingStage
    RecsPanel, RecCard, RecoveryPanel, ImpactSummary, InfeasiblePanel
    Timeline, ZoomControl, Legend
```

⭐ = added or substantially rewritten as part of the contract-freeze
migration.

---

## The contract

The cockpit consumes exactly this object from `/data.json`:

```jsonc
{
  "urgentOrders": [ { of, status, sku, productSku, units, hl, due, volume_hl, format_key } ],
  "lineBaseline": {
    "14": { avg_oee, avg_changeover_minutes, avg_limpieza_minutes,
            avg_pnp_minutes, production_orders, supports_formats }
  },
  "lineCentre":   { "14": "CF Prat", "17": "CF Prat", "19": "CF Prat" },
  "yearCompare":  { "2025": { "01": { "14": 0.55, "17": 0.59, ... } } },
  "executedHistory": {
    "14": [
      { of, sku, vol, start, w, oee },         // production
      { of, kind: "clean", start, w },          // cleaning window
      { of, kind: "maint", start, w }           // maintenance
    ]
  },
  "basePlan":    { /* same shape, segments live to the right of "today" */ },
  "recommendations": {
    "14": {
      line, position, oeeDelta, oeeGood, deadline, ordersMoved,
      naiveBand:  { line, start, w } | null,
      plan:       { "14": [ Seg ], "17": [ Seg ], "19": [ Seg ] },
      ghosts:     { "14": [ { of, start, w } ] },
      recovery:   { line, start, w, hours, note },
      moves:      [ { of, line, shift, why } ],
      decision:   "ACCEPT" | "ACCEPT_WITH_MOVE" | "ESCALATE",
      predictedOee, naivePredictedOee,
      transitionType,
      evidence: {
        reason, scope, breakdown,
        analogues:    [ { of, line, date, type, oee, actual_changeover_minutes } ],
        n, analogueMean, naiveMean, gain,
        transitionTypeStats, transitionComponents,
        cfTheoreticalMinutes, lineBaselineOee, limitations
      }
    }
  },
  "objectives": {
    "oee":  { label, icon, order: [ "17", "14", "19" ], notes: { "14": "..." } },
    "time": { ... },
    "dis":  { ... }
  },
  /* additive — not strictly part of the contract */
  "metadata": { contract_version, exported_at, master_rows, production_runs,
                clean_blocks, maint_blocks, oee_capped, transitions, ... },
  "infeasibleByLine": { "17": "Line 17 cannot run Medio · 50cl cans — ..." }
}
```

`data_contract.py::validate()` enforces the required keys and rejects any
recommendation that lacks `evidence.{analogues, n, analogueMean, naiveMean, gain}`.

When `/data.json` is missing the frontend falls back to `FALLBACK_DATA` in
`lib/contract.ts` so the queue view still boots.

---

## Cockpit demo flow

1. **Queue view** — two urgent orders show in the left panel. Click the
   active one.
2. **Calculating view** — short scanning animation (purely UI; no API call).
3. **Recs view (the cockpit)** — the left panel shows:
   - Selected-order summary
   - Objective pills: **OEE / Time / Disruption** — re-rank the three cards
   - Three rec cards (one per feasible line, infeasible lines surface in
     the "Not feasible" panel)
   - Each rec card opens an inline evidence drawer with:
     - The deterministic reasoning paragraph (no LLM)
     - A bar-chart breakdown of CF theoretical vs. analogue OEE vs. line baseline
     - The top 6 real historical analogues (table of real OFs, dates, types, OEE)
     - Analogue mean / naive mean / predicted gain stat row
     - "What this estimate cannot see" caveat
   - Recovery panel — lines ranked by fastest hours-to-baseline
4. **Stage** — the right panel shows the proposed plan timeline:
   - **Impact summary** card at the top (the headline insight)
   - Toggle to overlay the **naive slot**
   - Drag-token to test your own slot (manual placement)
   - Timeline: executed history (left of today, hatched), today divider,
     proposed plan (right of today) with NEW / MOVED segments, ghosts,
     cleaning + maintenance blocks rendered in a distinct visual style,
     and a "back to baseline" mark at the end of the recovery zone
   - Day / Week / Month zoom
5. **Secondary pages** (kept around as live FastAPI views, accessible via
   the small top-bar nav):
   - `/diagnostics` — transition-type ranking + drilldown + order evidence
   - `/plan-review` — plan-health score, value at risk *omitted*, risky transitions
   - `/learning` — accept / override / actuals loop
   - `/about-model` — pipeline explainer

---

## Re-running the export

Whenever the Excel sources change:

```bash
cd backend && source .venv/bin/activate
python -m app.export_data_json
```

The script:
1. Verifies the OF/WOID join and prints coverage.
2. Loads + classifies blocks (caps OEE > 1.0, counts caps).
3. Builds the production-only transition table via `sequence_builder`.
4. Loads the CF matrix (with documented fallback) and computes per-line
   baselines + transition-type stats.
5. Picks one urgent order from real product metadata.
6. For each feasible line: finds **real** analogues (line+transition →
   transition-only → line-only backoff), computes the recommendation, and
   writes a deterministic explanation paragraph.
7. Validates the payload through `data_contract.py`.
8. Writes `frontend/public/data.json` and prints the summary line.

---

## Limitations we document, not hide

- Crew experience and shift staffing are not in the data.
- Downstream micro-stoppages may not be fully captured in PNP.
- Recovery hours are a modelled estimate, not a measurement.
- No cost / euro metrics — there is no cost data.
- Single-urgent-order insertion only. No multi-week re-optimization.
- The fallback dataset (when Excel parsing fails) is synthetic and tagged
  in `metadata.using_fallback_data`.
