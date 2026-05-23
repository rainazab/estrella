# LineWise HTTP API

This is what the backend serves to the frontend at runtime. The shape is
designed for the React/Vite client; the canonical Python payload in
`data/output/data.json` is richer and is transformed at request time by
`app/frontend_payload.py`.

`CONTRACT_VERSION` is **2.0**. Adding or removing a top-level key is a
contract change — bump the version and notify the frontend team.

## Conventions

- **Base URL**: the frontend prefixes every request with `VITE_API_BASE`
  (default `/api`). Paths in this doc are relative to that base.
- **Transport**: HTTPS, `Content-Type: application/json` on responses.
- **Caching**: `GET /plan` returns `Cache-Control: no-store` and an
  `ETag`. Clients that send `If-None-Match` get a `304 Not Modified` when
  the canonical file is unchanged.
- **Errors**: non-2xx responses are JSON
  `{ "error": "<code>", "detail": "<human-readable>" }`. The frontend
  surfaces `detail` to the operator.
- **IDs**: line keys are stringified line numbers (`"14"`, `"17"`,
  `"19"`). `of` is the order code (string).
- **Time**: `start` and `w` are **hours from the start of the planning
  window**. One decimal is fine; the backend rounds to two.
- **OEE**: fraction in `[0, 1]`.

## Endpoints

### `GET /health`
Liveness probe. **200**:

```json
{ "ok": true }
```

### `GET /plan`
Returns the full planning payload. One call, one object.

| Status | Meaning |
|---|---|
| `200` | Body as documented under *Plan payload* below. `ETag` + `Cache-Control: no-store` headers. |
| `304` | Body empty. The client's `If-None-Match` matches the server's current `ETag`. |
| `500` | `{ "error": "data_corrupt", "detail": "<json error>" }` — data.json failed to parse. |
| `503` | `{ "error": "data_unavailable", "detail": "<path> does not exist…" }` — no data.json on disk. |

### `POST /plan/recompute`
Regenerates `data/output/data.json` by re-invoking
`python -m app.export_data_json` as a subprocess. Useful for dev: after
swapping a raw Excel file you can curl this endpoint instead of
restarting the server.

| Status | Meaning |
|---|---|
| `200` | `{ "ok": true, "message": "data.json regenerated.", "output": "<path>" }` |
| `412` | `{ "error": "raw_missing", ... }` — `data/raw/` is empty/missing. |
| `500` | `{ "error": "recompute_failed", "detail": "<tail of exporter stderr>" }` |
| `504` | `{ "error": "recompute_timeout", "detail": "export_data_json exceeded 180s" }` |

## Running the server

```bash
./scripts/run_server.sh                 # 127.0.0.1:8000
./scripts/run_server.sh --reload        # auto-reload during dev
LINEWISE_HOST=0.0.0.0 LINEWISE_PORT=9000 ./scripts/run_server.sh
```

The frontend's `.env`:

```
VITE_API_BASE=http://localhost:8000
```

## Plan payload

Top-level keys (all required):

| Key | Type | Purpose |
|---|---|---|
| `urgentOrders` | `Order[]` | Inbox of incoming urgent OFs |
| `lineBaseline` | `{ [lineId]: number }` | Baseline OEE per line, 0–1 |
| `yearCompare` | `YearCompare` | YoY week strip on the top bar |
| `executedHistory` | `{ [lineId]: Band[] }` | What already ran (left of "now") |
| `basePlan` | `{ [lineId]: Band[] }` | Current committed plan (right of "now") |
| `lineCentre` | `{ [lineId]: string }` | Production centre label per line |
| `recommendations` | `{ [lineId]: Recommendation }` | One rec card per line option |
| `objectives` | `Objectives` | Ranked options by OEE / Time / Disruption |
| `manualSlots` | `{ [slotKey]: ManualSlot }` | UI hint cards for hand-placed slots |

### `Order`
```ts
{ of: string; status: "urgent"|"queued"; sku: string;
  units: number; hl: number; due: string }
```

### `YearCompare`
```ts
{
  weekLabel: string;   // "Week 21 · 18–24 May"
  lines: { [lineId]: {
    oeeNow: number; oeeLast: number;   // 0–1
    volNow: number; volLast: number;   // HL totals
    changesNow: number; changesLast: number;  // changeover count
  }}
}
```

`Now` is the most recent ISO week with data; `Last` is the same ISO week
of the previous calendar year.

### `Band`
Discriminated by the presence of `kind`.

Production:
```ts
{ of: string; sku?: string; vol?: number;
  start: number;     // hours
  w: number;         // hours
  oee: number }      // 0–1
```

Non-production:
```ts
{ kind: "clean"|"maint"; start: number; w: number }
```

The transformer strips OEE/vol from clean/maint bands and rounds
start/w to 2 decimals.

### `Recommendation`
```ts
{
  line: string;                 // "Line 17"
  position: string;             // "after AM05LTST"
  oeeDelta: string;             // "+6.2" / "−0.4"
  oeeGood: boolean;
  deadline: "on time"|"+1 day"|string;
  ordersMoved: number;
  naiveBand: { line: string; start: number; w: number } | null;
  plan:   { [lineId]: RecBand[] };
  ghosts: { [lineId]: GhostBand[] };
  recovery: { line: string; start: number; w: number; hours: number; note: string };
  moves:  Array<{ of: string; line: string; shift: string; why: string }>;
  evidence: {
    reason: string;             // HTML allowed (<b> tags rendered by UI)
    breakdown: Array<{ name: string; pct: number; band: "lo"|"hi"; val: string }>;
    analogues: Array<{ of: string; date: string; line: string;
                       type: string; oee: string }>;
    n: number;
    analogueMean: string;
    naiveMean: string;
    gain: string;
  };
}
```

`RecBand` is the same as a production `Band` plus optional
`kind: "ins" | "shift"`. `GhostBand` is `{ of, start, w }`.

### `Objectives`
```ts
{
  oee:  { label: "OEE";        icon: string; order: string[]; notes: { [lineId]: string } };
  time: { label: "Time";       icon: string; order: string[]; notes: { [lineId]: string } };
  dis:  { label: "Disruption"; icon: string; order: string[]; notes: { [lineId]: string } };
}
```

### `ManualSlot`
```ts
{ recKey: string; verdict: "match"|"ok"|"worse";
  label: string; banner: string }
```

Slot keys follow the convention `"{line}-after-{anchor_of}"` for
production-anchor slots and `"{line}-end"` for end-of-queue. The
recommended slot for each line is the `"match"` verdict; other slots on
the same line are `"ok"`; infeasible lines surface a single
`"{line}-after"` entry with `"worse"`.

## Frontend ↔ canonical mapping

| Frontend field | Source in `data/output/data.json` | Transform |
|---|---|---|
| `urgentOrders[]` | `urgentOrders[]` | Trim to `{of, status, sku, units, hl, due}` |
| `lineBaseline[line]` | `lineBaseline[line].avg_oee` | Flatten the rich object to a number |
| `yearCompare` | `yearCompare` | Already in the new weekly shape |
| `executedHistory[line]` | `executedHistory[line]` | Hours unchanged; clean/maint stripped to `{kind, start, w}` |
| `basePlan[line]` | `basePlan[line]` | Same as above |
| `lineCentre` | `lineCentre` | Passthrough |
| `recommendations[line]` | `recommendations[line]` | Trim to contract fields; drop `candidateSlotsEvaluated`, `adjustedOeeGain`, `transitionType`, etc. |
| `recommendations[line].evidence` | `recommendations[line].evidence` | Trim to `{reason, breakdown, analogues, n, analogueMean, naiveMean, gain}`. Each analogue is `{of, date, line, type, oee:string}`. |
| `objectives` | `objectives` | Trim to `{label, icon, order, notes}` per axis |
| `manualSlots` | `manualSlots` | Trim each value to `{recKey, verdict, label, banner}` |

The canonical payload's additive metadata (`metadata.*`,
`infeasibleByLine`, `planReview`, per-recommendation scoring fields) is
not exposed on `/plan` — it stays in `data.json` for backend tooling and
the `validate_model_outputs` validator.

## Open questions (carried forward from the frontend brief)

| # | Question | Current answer |
|---|---|---|
| 1 | Pagination / size | Payload is ~80 KB. No pagination needed yet. |
| 2 | Mutation | No `POST /plan/accept` yet. `POST /plan/recompute` regenerates the canonical file from raw data. |
| 3 | Recompute trigger | `/plan` re-reads the file on every request (cheap); ETag short-circuits. `/plan/recompute` re-runs the exporter. |
| 4 | Time origin | `t = 0` is the leftmost block on each line. Executed and basePlan share the line axis: executed grows right from `t = 0`, basePlan grows right from its own `t = 0`. Frontend renders the divider. |
| 5 | HTML in `evidence.reason` | We emit `<b>...</b>` tags. If the frontend wants structured tokens instead we can move the bolding client-side. |
