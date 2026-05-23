# LineWise data contract

`data/output/data.json` is the single source of truth between this repo and
the LineWise frontend. The contract is enforced by
`app/data_contract.py` and `app/validate_data_json.py`. Adding or removing a
top-level key is a contract change — bump `CONTRACT_VERSION` and notify the
frontend team.

Current `CONTRACT_VERSION`: **1.0**.

## Top-level shape

```jsonc
{
  "urgentOrders":     [ ... ],            // list — see §1
  "lineBaseline":     { "14": {...}, "17": {...}, "19": {...} },  // §2
  "lineCentre":       { "14": "CF Prat", "17": "CF Prat", "19": "CF Prat" },
  "yearCompare":      { "2025": { "01": { "14": 0.62, ... }, ... } }, // §3
  "executedHistory":  { "14": [seg, ...], "17": [...], "19": [...] }, // §4
  "basePlan":         { "14": [seg, ...], "17": [...], "19": [...] }, // §4
  "recommendations":  { "14": rec, "17": rec, "19": rec },           // §5
  "objectives":       { "oee": objective, "time": objective, "dis": objective }, // §6

  // additive metadata — present but not required by the contract:
  "metadata":         { ... },
  "infeasibleByLine": { "17": "Line 17 cannot run 1/2 ..." },
  "planReview":       { ... }
}
```

The contract validator (`validate_data_json.py`) only enforces the eight keys
listed in `REQUIRED_TOP_LEVEL`; `metadata`, `infeasibleByLine` and
`planReview` are additive and may evolve without a version bump.

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

## 3. `yearCompare`

Monthly average OEE per line, production blocks only:

```jsonc
"2025": {
  "01": { "14": 0.62, "17": 0.58, "19": 0.64 },
  "02": { "14": 0.61, "17": 0.59, "19": 0.66 }
}
```

## 4. `executedHistory` / `basePlan`

Both keyed by line; each value is an ordered list of timeline segments.

```jsonc
{
  "of": "ED12LTW",
  "start": 0.0,        // days from the left edge of the timeline
  "w": 0.42,           // width in days

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

## 5. `recommendations`

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

## 6. `objectives`

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
