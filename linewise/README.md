# LineWise

> **A production-planning cockpit for Damm's El Prat canning lines 14, 17 and 19.**
> Blue Yonder creates a theoretical plan. LineWise checks whether that plan is
> likely to execute well — by comparing every transition against what
> *actually* happened on those lines in 2025.

LineWise is not a dashboard. It is a single Gantt-style planning screen with
three modes:

| Mode | Question it answers |
|---|---|
| **Plan Review** *(default)* | Where is the future plan about to repeat a 2025 mistake? |
| **Rush Order** | An urgent OF came in — where can we insert it with the least operational damage? |
| **Evidence** | Why should I trust any of this? Which 2025 orders back this recommendation? |

The cockpit reads the entire UI payload from **one static file**:
`frontend/public/data.json`. No backend dependency at runtime.

---

## Run

```bash
# 1. Build the snapshot from the Excel sources
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m app.export_data_json
# → writes ../frontend/public/data.json (~67 KB)

# 2. Boot the cockpit
cd ../frontend
npm install
npm run dev
# http://localhost:3000
```

Once `data.json` exists, the cockpit needs nothing else.

---

## Architecture in one diagram

```
Excel files
   ↓        data_loader.build_master_dataset()
master table  (one row per line-time block, keyed by OF)
   ↓        block_classifier.classify_blocks()
master + block_type ∈ {production, clean, maint, other}, OEE capped at 1.0
   ↓        changeover_typing.annotate_master()
master + transition_type + principal_label
   ↓        sequence_builder.build_sequence()
line_blocks (incl. clean/maint) + production-only transition table
   ↓        diagnostics + analogues + recommendations + plan-review overlay
LineWiseData payload  →  frontend/public/data.json
   ↓        lib/contract.loadData()
Cockpit UI (modes: Plan Review / Rush Order / Evidence)
```

---

## Acceptance run

```
→ Step 1: verifying OF/WOID join
   OEE=2274 · Tiempo=2278 · shared=2274 · OEE-only=0 · Tiempo-only=4
   coverage=100.0% · rename WOID→OF: True
→ Step 2: loading master + classifying blocks
   blocks: total=2273 · production=2109 · clean=132 · maint=32 · other=0 · oee_capped=1
→ Step 4+5: building sequence + transition table (production-only)
   transitions: 2106
→ Step 9: building recommendations
   recommendations: ['14', '17', '19'] · infeasible: none
→ plan review risk overlay
   plan_health=80.0 · risky=12 · cleaning_heavy=2
→ Step 12: validating contract
   ✔ contract OK

✔ wrote frontend/public/data.json  (66.3 KB)
  urgentOrders=2 · recommendations=3 · analogues=[L14:n=6, L17:n=6, L19:n=6]
  prod=2109 · clean=132 · maint=32 · oee_capped=1 · tx=2106
```

---

## Backend validation

Run the backend confidence check whenever `data.json` is regenerated:

```bash
cd backend
./check.sh
```

It rebuilds `frontend/public/data.json`, validates the frontend contract, and
then checks model/data invariants:

```text
✅ data.json contract valid
✅ OEE baselines valid
✅ cleaning rows excluded from OEE stats
✅ analogues are real OFs
✅ line eligibility rules enforced
✅ timeline segments valid
✅ recommendations valid
```

Each export also writes a judge-friendly ingestion report to
`backend/data/processed/validation_report.txt`.

Backend validation performed:
- Verified WOID -> OF join between Tiempo and OEE.
- Classified line-time blocks into production / cleaning / maintenance.
- Excluded cleaning and maintenance from OEE baselines.
- Capped OEE values > 1.0 as registration artifacts.
- Reconstructed executed sequence by sorting production runs by line and Fecha Fin.
- Typed changeovers using Cambios decomposition.
- Used real 2025 OFs as analogues.
- Enforced line-format rules for lines 14, 17, and 19.
- Generated frontend data contract as `data.json`.

---

## The cockpit

### Top of the screen

- **TopBar** — brand + "grounded in N executed blocks · lines 14/17/19 · 2025"
- **Title + sub** — *Execution Intelligence for Production Planning*
- **Mode toggle** — Plan Review / Rush Order / Evidence

### Hero strip (always visible)

Four headline cards whose content adapts to the mode:

| Plan Review | Rush Order | Evidence |
|---|---|---|
| Plan Health 0–100 | OEE vs Historical Benchmark | Master rows |
| Risky transitions count | Capacity Protected | Transitions analysed |
| Best line (history) | Recovery hours (modelled) | OEE values capped |
| Worst line (history) | Decision badge | Months of evidence |

### Main grid — Gantt + Details

The **timeline** is the centerpiece. Three swimlanes, one per line:

```
14 (CF Prat · 1/2 · 1/3)   [past hatched] | today | [planned segments]
17 (CF Prat · 1/3)         [past hatched] | today | [planned segments]
19 (CF Prat · 1/2 · 1/3 · 2/5)            | today | [planned segments]
```

Each line shows a **format chip** under its label so the operational
constraints are visible at all times.

Block kinds:
- **production** — coloured by OEE band (good / mid / weak)
- **clean** — hatched blue, italic role label
- **maint** — hatched grey
- **ins** — bright green with `NEW` flag (rush-order insertion)
- **shift** — dashed border with `MOVED` flag
- **ghost** — empty dashed outline showing where a shifted order was originally

On every timeline, a **today divider** (vertical brand-coloured line)
separates the immutable past from the planning future.

### Right-side details panel

The right column is **always visible**. Its content is driven by the active
selection:

- **No selection** — mode default (line baselines, urgent inbox, monthly OEE chart)
- **Click a risk marker (Plan Review)** — full historical evidence behind that risky transition: damage points vs line baseline, transition type stats, cleaning/changeover burden
- **Click a production block** — that OF's stats vs its line baseline
- **Click a clean/maint block** — explains why it doesn't enter OEE statistics
- **Drop the urgent OF on a line (Rush Order)** — the recommendation: predicted OEE vs benchmark, real 2025 analogues table, what moves, modelled recovery hours

### Bottom strip (Rush Order only)

Three **scenario cards** — one per candidate line — letting the planner
compare every option at a glance. The strongest is starred. Click any card
to switch the proposed plan + details panel.

---

## Hard line-format rules (enforced everywhere)

| Line | Supports |
|---|---|
| 14 | 1/2 (50cl) · 1/3 (33cl) |
| 17 | 1/3 (33cl) **only** |
| 19 | 1/2 · 1/3 · 2/5 (44cl) |

In Rush Order mode, dragging the urgent OF onto an ineligible line:
- the line's track is hatched red
- the drop hint reads e.g. *"Line 17 only produces 1/3 — Cannot run Medio · 50cl cans."*
- the drop is blocked

Eligible lines show a green drop hint and accept the drop.

---

## Data assumptions (and what we don't assume)

| Assumption | Why |
|---|---|
| **Per-OF / per-line-time-block granularity.** Each row of the master table is one line-time block keyed by `OF`. *Not* every row is a production order. | Some OFs (`PRT99…M`) are cleaning windows or maintenance blocks. |
| **`block_type` classifies every row** (`block_classifier.py`). Cleaning + maintenance blocks render on the timeline but **never enter OEE baselines, analogue means, or transition statistics**. | Mixing them was a bug — it dragged baselines toward 0. |
| **`OEE > 1.0` is capped** at 1.0; the original value is preserved in `oee_raw`. `metadata.oee_capped` counts how many were clipped. | One row has `OEE = 1.573` — a data-entry artefact. |
| **WOID → OF rename** is safe: 100% of `OEE.OF` is present in `Tiempo.WOID`. Verified at the top of every export. |  |
| **Executed sequence is immutable.** History is the spine of every analogue lookup. | A planner can only trust forward-looking placements. |
| **Recovery hours are a *modelled estimate*.** Every `recommendation.recovery.note` calls it out. | We don't have a measured "back to baseline" signal. |
| **No euro / cost figures.** | Damm hasn't given us cost data. |
| **No OpenAI dependency on the export path.** Explanations are deterministic. | The demo must work offline. |
| **All analogues are real 2025 OFs** with real recorded OEE. No fakes. | Validated by `data_contract.py`. |

---

## Repo layout

```
backend/
  main.py                          Legacy FastAPI app (secondary pages only)
  app/
    config.py
    data_loader.py                 Excel ingest, column normalization, joins
    block_classifier.py            block_type + OEE cap + OF/WOID verifier
    changeover_typing.py           Cambios decomposition → transition_type
    sequence_builder.py            per-line blocks + production-only transitions
    cf_matrix.py                   Tabla CF Prat parser + documented fallback
    line_rules.py                  Hard format rules (14: 1/2,1/3 · 17: 1/3 · 19: all)
    data_contract.py               data.json validator + summary printer
    export_data_json.py            ⭐ THE handoff — Excel → contract → /data.json
    transition_memory.py, diagnostics.py, optimizer.py, model.py, business_impact.py
                                   (legacy — used only by FastAPI endpoints)
  data/raw/                        Place data.zip contents here
  data/processed/

frontend/
  public/data.json                 The contract handoff (regenerated by exporter)
  app/
    globals.css                    Cream / dark-green / copper paper theme
    layout.tsx                     TopBar + cockpit shell
    page.tsx                       ⭐ Unified cockpit (3 modes)
    diagnostics/, plan-review/, learning/, about-model/   Legacy drilldowns
  lib/
    contract.ts                    LineWiseData + PlanReview types + loadData()
  components/
    TopBar
    ModeToggle              ⭐    Plan Review / Rush Order / Evidence
    HeroStrip               ⭐    Four mode-aware headline cards
    Timeline                       Gantt with risk markers + eligibility hints
    DetailsPanel            ⭐    Right column, content driven by selection
    UrgentOrderTray         ⭐    Drag source for rush orders
    ScenarioStrip           ⭐    Bottom comparison cards (Rush Order)
    Legend, ZoomControl
```

---

## The contract

The cockpit consumes exactly this object from `/data.json`:

```jsonc
{
  "urgentOrders":      [ UrgentOrder ],
  "lineBaseline":      { "14": LineBaseline, "17": …, "19": … },
  "lineCentre":        { "14": "CF Prat", … },
  "yearCompare":       { "2025": { "01": { "14": 0.55, … } } },
  "executedHistory":   { "14": [ Seg ], … },
  "basePlan":          { "14": [ Seg ], … },
  "recommendations":   { "14": Recommendation, … },
  "objectives":        { "oee": Objective, "time": …, "dis": … },

  /* additive — not strictly part of the contract */
  "planReview": {
    "plan_health_score": 80.0,
    "total_risky": 12, "total_cleaning_heavy": 2,
    "risky_by_line": { "14": [ RiskItem ], … }
  },
  "infeasibleByLine":  { "17": "Line 17 cannot run Medio · 50cl cans — ..." },
  "metadata":          { contract_version, exported_at, master_rows, … }
}
```

`data_contract.py::validate()` enforces the required keys and rejects any
recommendation missing `evidence.{reason, breakdown, analogues, n,
analogueMean, naiveMean, gain}`.

If `/data.json` is missing, the cockpit falls back to `FALLBACK_DATA`
embedded in `lib/contract.ts`.

---

## Demo story to tell

1. **Open LineWise.** The future plan is on a clean Gantt.
2. **Plan Review mode (default).** Yellow / amber / red ⚠ markers sit on top of risky transitions. Hero strip shows Plan Health 80/100, 12 risky transitions, best line Line 17 (0.53), worst line Line 14 (0.42).
3. **Click a red ⚠ marker.** The details panel shows: *"This transition type historically loses 8.5 OEE pts vs the line baseline."* + the CF theoretical vs actual changeover times + n cases.
4. **Switch to Rush Order mode.** The urgent OF appears in the tray. Three line tracks are highlighted.
5. **Drag the OF onto Line 17.** It accepts. The hero strip flips to *OEE vs Benchmark*. The timeline shows the insertion with NEW + MOVED segments, ghosts, recovery zone, and a back-to-baseline mark. The details panel shows real 2025 analogues (e.g. `PRT9900016759-M @ 29 Nov 2025 → 0.53 OEE`).
6. **Try dragging the 50cl OF onto Line 17.** The drop hint goes red: *"Line 17 only produces 1/3 — Cannot run Medio · 50cl cans."* The drop is blocked.
7. **Bottom strip** compares all three candidate lines side-by-side. Click any to switch the proposed plan.
8. **Switch to Evidence mode.** Monthly OEE per line for 2025, click any block to see its line baseline.

End-state: planner sees that LineWise's recommendation is not abstractly "good" — it is good because **38 / 6 / however-many real 2025 orders** ran the same transition and averaged a higher OEE than the naive slot. Volume is still produced; the cockpit shows which line + slot makes it with the least hidden execution cost.

---

## Limitations we document, not hide

- Crew experience and shift staffing are not in the data.
- Downstream micro-stoppages may not be fully captured in PNP.
- Recovery hours are a modelled estimate, not a measurement.
- No cost / euro metrics — there is no cost data.
- Single-urgent-order insertion only. No multi-week re-optimization.
- Drag-drop accepts only feasibility checks today — it does not yet enforce
  deadline / earliest-start constraints.
