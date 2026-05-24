# LineWise data contract (canonical)

`data/output/data.json` is the canonical payload — the rich, file-on-disk
form that the validators, the backtest and any future tooling read. The
LineWise frontend consumes a **trimmed HTTP-shape** version of this
payload via `GET /plan`; see [`API_CONTRACT.md`](API_CONTRACT.md) for that
contract.

The two are kept in lockstep by `app/frontend_payload.py`, which is the
only legal seam between the canonical shape and the HTTP shape.

Current `CONTRACT_VERSION`: **2.2**.

## Top-level shape (canonical)

```jsonc
{
  "urgentOrders":     [ ... ],
  "lineBaseline":     { "14": {avg_oee:..., ...}, "17": {...}, "19": {...} },
  "lineCentre":       { "14": "CF Prat", "17": "CF Prat", "19": "CF Prat" },
  "timeline":         { "anchorDate": "2026-05-24", "timeUnit": "hours", "views": { ... } },
  "lineRules":        { "14": LineRule, "17": LineRule, "19": LineRule },
  "weeklyStops":      { "14": [Stop, ...], "17": [...], "19": [...] },
  "yearCompare":      { "weekLabel": "Week 21 · 18–24 May", "lines": { ... } },
  "executedHistory":  { "14": [seg, ...], "17": [...], "19": [...] },
  "basePlan":         { "14": [seg, ...], "17": [...], "19": [...] },
  "recommendations":  { "14": rec, "17": rec, "19": rec },
  "objectives":       { "oee": objective, "time": objective, "dis": objective },
  "manualSlots":      { "17-after-XYZ": ManualSlot, "14-end": ManualSlot, ... },

  // additive — present in canonical but stripped from the /plan HTTP response:
  "metadata":         { ... },
  "infeasibleByLine": { "17": "Line 17 cannot run 1/2 ..." },
  "planReview":       { ... }
}
```

Segment `start` and `w` values are in **hours** (matching `timeline.timeUnit`).
The contract validator (`validate_data_json.py`) enforces the required keys
listed in `REQUIRED_TOP_LEVEL`; everything else is additive and
may evolve without a version bump.

## 1. `urgentOrders`

```jsonc
[
  {
    "of": "ED13LTNN",
    "status": "urgent",          // "urgent" | "queued"
    "sku": "BEER MOLEN 4,8°NA 33CL ...",
    "productSku": "3BVMLLB0",
    "units": 18000,
    "hl": 594,
    "due": "28 May",             // free text — display label
    "volume_hl": 594,
    "format_key": "1/3"          // "1/3" | "1/2" | "2/5"
  }
]
```

The first entry is the active urgent order driving the recommendations.

## 2. `lineBaseline`

Per-line baseline computed from **production rows only** (cleaning and
maintenance excluded).

```jsonc
"14": {
  "avg_oee": 0.628,
  "avg_changeover_minutes": 64.2,
  "avg_limpieza_minutes": 73.5,
  "avg_pnp_minutes": 142.0,
  "production_orders": 312,
  "supports_formats": ["1/2", "1/3"]
}
```

## 3. `timeline`

Timeline metadata makes the calendar axis backend-authoritative.

```jsonc
{
  "anchorDate": "2026-05-24",   // date represented by start=0
  "anchorLabel": "Today",
  "timeUnit": "hours",          // segment start/w unit
  "views": {
    "week":    { "daysBack": 7,  "daysAhead": 14 },
    "month":   { "daysBack": 14, "daysAhead": 35 },
    "quarter": { "daysBack": 30, "daysAhead": 90 }
  },
  "source": "exported_at",
  "sourcePlanStartDate": "2026-05-18"
}
```

The frontend still owns pixels/card geometry, but it must use this anchor
and unit conversion for labels and visible date windows.

## 4. `yearCompare`

Same ISO week comparison against the prior year, production blocks only:

```jsonc
"weekLabel": "Week 1 · 29 Dec–4 Jan",
"lines": {
  "14": {
    "oeeNow": 0.258,
    "oeeLast": 0.190,
    "volNow": 1407.6,
    "volLast": 1410.7,
    "changesNow": 3,
    "changesLast": 2
  }
}
```

## 5. `lineRules`

Locked factory constraints for can formats per line. These are not learned
from OEE and cannot be overridden in the demo planner.

```jsonc
"17": {
  "line": "17",
  "formats": [{ "key": "1/3", "label": "33cl", "name": "tercio" }],
  "summary": "L17 only runs 33cl",
  "locked": true,
  "source": "Damm operations line-format rules"
}
```

Expected capabilities:

- L14: `50cl`, `33cl`
- L17: `33cl`
- L19: `50cl`, `33cl`, `44cl`

## 6. `weeklyStops`

Locked cleaning/maintenance markers derived from
`Tabla CF Prat 2026_14_17_19.xlsx`, sheet `Tiempos adicionales`.
They are visible on the planner timeline but are not production runs and
must not enter OEE baselines or analogue means.

```jsonc
"19": [{
  "kind": "clean",
  "label": "Weekly cleaning",
  "start": 24,
  "w": 8,
  "day": "L",
  "cadence": "semanal",
  "shiftPattern": "3 turnos",
  "locked": true
}]
```

## 7. `executedHistory` / `basePlan`

Both keyed by line; each value is an ordered list of timeline segments.

```jsonc
{
  "of": "ED12LTW",
  "start": 0.0,        // hours from the left edge of the lane window
  "w": 6.0,            // duration in hours

  // production segments:
  "sku": "BEER ...",
  "vol": 198,
  "oee": 0.61,
  "envase": "LATA 1/3 SR.",
  "tipo_envase": "1/3",
  "format_key": "1/3",
  "marca": "Estrella Damm",
  "familia": "Estrella"

  // OR clean / maint segments — no oee, no vol:
  // "kind": "clean" | "maint"
}
```

Constraints (enforced by validate_data_json.py):

- `start ≥ 0`, `w > 0`.
- Production segments must have `sku` and `vol`.
- `kind: "clean" | "maint"` segments must NOT include `oee` or `vol`.

## 8. `recommendations`

One entry per feasible line. Lines that are infeasible for the urgent
format appear in `infeasibleByLine` instead.

```jsonc
"19": {
  "line": "Line 19",
  "position": "after EDX-001",
  "oeeDelta": "+5.2",                // signed pts vs the naive placement
  "oeeGood": true,
  "deadline": "on time",
  "ordersMoved": 0,
  "naiveBand": null,                 // or {"line": "14", "start": 1.2, "w": 0.4}
  "plan":   { "14": [...], "17": [...], "19": [..., {kind: "ins", ...}, ...] },
  "ghosts": { "19": [...] },
  "recovery": {
    "line": "19",
    "start": 2.8,
    "w": 0.6,
    "hours": 14,
    "note": "Modelled estimate ... not a measurement."
  },
  "moves": [
    { "of": "EDX-002", "line": 19, "shift": "+5h", "why": "pushed back ..." }
  ],
  "evidence": {
    "reason": "On Line 19 after EDX-001, the urgent order matches ...",
    "qualityLabel": "Strong",        // Strong | Medium | Limited | Weak
    "riskNote": null,                // populated for Limited / Weak
    "scope": "line+transition",      // line+transition | transition-only | line-only
    "breakdown": [ {"name": "CF theoretical", "pct": 32, "band": "lo", "val": "192 min"}, ... ],
    "analogues": [ {"of": "EDABC", "line": "19", "oee": 0.71, ...}, ... ],
    "n": 6,
    "analogueMean": "0.682",
    "naiveMean": "0.630",
    "gain": "+5.2",
    "oeeComparison": {
      "metric": "comparative_oee_points",
      "analogueMean": 0.682,
      "naiveMean": 0.630,
      "gainPoints": 5.2,
      "lineHistoricalMean": 0.640
    },
    "lineBaselineOee": 0.640,
    "transitionTypeStats": { ... },
    "transitionComponents": ["brand"],
    "cfTheoreticalMinutes": 192.0,
    "limitations": [ "Crew experience and shift staffing are not in the data.", ... ]
  },
  "decision": "ACCEPT",              // ACCEPT | ESCALATE
  "predictedOee": 0.682,
  "naivePredictedOee": 0.630,
  "evidenceStrengthLabel": "Strong",
  "transitionType": "brand"
}
```

Required fields are listed in `REQUIRED_RECOMMENDATION_FIELDS` and
`REQUIRED_EVIDENCE_FIELDS` inside `app/data_contract.py`.

## 7. `objectives`

```jsonc
{
  "oee":  { "label": "OEE",        "icon": "◉", "order": ["19", "14", "17"], "notes": {...} },
  "time": { "label": "Time",       "icon": "◷", "order": ["14", "19", "17"], "notes": {...} },
  "dis":  { "label": "Disruption", "icon": "⇄", "order": ["14", "17", "19"], "notes": {...} }
}
```

Each `order` is a ranking of the line keys; the first entry is the
recommended choice for that objective. Every line referenced in `order` must
exist in `recommendations` (validator enforces this).

## Invariants the validator checks

- Required top-level keys are present.
- Lines 14, 17, 19 appear in `lineBaseline`, `executedHistory`, `basePlan`.
- Each line has either a recommendation OR an `infeasibleByLine` entry — not
  both.
- Every recommendation has all `REQUIRED_RECOMMENDATION_FIELDS`.
- Every `evidence` block has all `REQUIRED_EVIDENCE_FIELDS`.
- Each plan contains exactly one inserted segment (`kind: "ins"`).
- All ghosts and moves reference OFs that exist in the base plan.
- All `analogues[].oee` are between 0 and 1.
- `evidence.n` matches `len(evidence.analogues)`.
- Clean / maint segments do not include OEE or volume.

The model-output validator (`validate_model_outputs.py`) additionally checks:

- Cleaning / maintenance rows are excluded from OEE baselines.
- Each analogue OF is a real production run with matching OEE.
- `gain == analogueMean - naiveMean` (in OEE points).
- Line rules: Line 17 rejects 1/2 and 2/5, Line 14 rejects 2/5, Line 19
  accepts all three.
- Infeasible lines do not win any objective ranking.
- Golden urgent SKU and `objectives.oee.order` stay stable across exports.
