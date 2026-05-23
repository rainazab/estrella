# LineWise — Frontend / Backend API Contract

This is the shape the frontend currently consumes. Today it is served by
the Vite dev middleware in `vite.config.js` out of `data/plan.json`. The
frontend reads it through `src/api/client.js`, which prefixes every path
with `VITE_API_BASE` (default `/api`). Match these endpoints and payloads
and the frontend swaps to the real backend with a single env var.

---

## Conventions

- **Base URL**: configurable per environment via `VITE_API_BASE`. Paths
  below are relative to that base.
- **Transport**: HTTPS, `Content-Type: application/json`.
- **Caching**: `Cache-Control: no-store` on `/plan` while plans are
  recomputed on each load. If the backend caches, expose an ETag.
- **Errors**: non-2xx responses should return JSON
  `{ "error": "<code>", "detail": "<human-readable>" }`. The frontend
  surfaces `detail` to the operator.
- **IDs / keys**:
  - Line keys are stringified line numbers: `"14"`, `"17"`, `"19"`.
  - `of` is the order code (string, e.g. `"ED13LTNN"`).
  - Time fields `start` and `w` are **hours from the start of the
    planning window** (floats, one decimal is fine).
  - OEE is a fraction in `[0, 1]` (e.g. `0.54` = 54%).

---

## Endpoints

### `GET /health`
Liveness probe.

**200**
```json
{ "ok": true }
```
Anything else is treated as down. Extra fields are ignored.

---

### `GET /plan`
Returns the full planning payload the UI renders from. **One call, one
object** — the frontend does not stitch multiple endpoints today.

**200** — body shape documented in *Plan payload* below.

If you need to split this later (e.g. `/plan/recommendations`,
`/plan/history`) we can; for now keep it bundled.

---

## Plan payload

Top-level keys (all required unless noted):

| Key | Type | Purpose |
|---|---|---|
| `urgentOrders` | `Order[]` | Inbox of incoming urgent OFs |
| `lineBaseline` | `{ [lineId]: number }` | Baseline OEE per line (0–1) |
| `yearCompare` | `YearCompare` | YoY week strip on top bar |
| `executedHistory` | `{ [lineId]: Band[] }` | What already ran (left of "now") |
| `basePlan` | `{ [lineId]: Band[] }` | Current committed plan (right of "now") |
| `lineCentre` | `{ [lineId]: string }` | Production centre label per line |
| `recommendations` | `{ [lineId]: Recommendation }` | One rec card per line option |
| `objectives` | `Objectives` | Ranked options by OEE / Time / Disruption |
| `manualSlots` | `{ [slotKey]: ManualSlot }` | UI hint cards for hand-placed slots |

### `Order`
```ts
{
  of: string;            // e.g. "ED13LTNN"
  status: "urgent" | "queued";
  sku: string;           // human label, e.g. "Estrella Damm · lata 33cl"
  units: number;         // physical units
  hl: number;            // hectolitres
  due: string;           // free-text date label, e.g. "21 May"
}
```

### `YearCompare`
```ts
{
  weekLabel: string;     // "Week 21 · 18–24 May"
  lines: {
    [lineId]: {
      oeeNow: number; oeeLast: number;       // 0–1
      volNow: number; volLast: number;       // units
      changesNow: number; changesLast: number;
    }
  }
}
```

### `Band` (executedHistory / basePlan entries)
A band is **either** a production run **or** a non-production block.
Discriminate on the presence of `kind`:

Production run:
```ts
{
  of: string;            // order code
  sku?: string;          // present in history/basePlan, optional in recs
  vol?: number;          // produced/planned units
  start: number;         // hours
  w: number;             // width in hours
  oee: number;           // 0–1
}
```

Non-production block:
```ts
{
  kind: "clean" | "maint";
  start: number;
  w: number;
}
```

### `Recommendation`
One per candidate line. The `plan` field is the **full three-line plan
if this recommendation were applied** — the UI diffs it against
`basePlan` to draw insertions and shifts.

```ts
{
  line: string;                 // "Line 17"
  position: string;             // "after AM05LTST" | "end of queue"
  oeeDelta: string;             // signed string, e.g. "+6.2" / "−0.4"
  oeeGood: boolean;             // true if delta is a net win
  deadline: "on time" | "+1 day" | string;
  ordersMoved: number;

  naiveBand: { line: string; start: number; w: number } | null;

  plan: { [lineId]: RecBand[] };       // see below
  ghosts: { [lineId]: RecBand[] };     // optional; original positions
                                       // of moved bands, drawn faded

  recovery: {
    line: string;                      // line id ("17") or label
    start: number;                     // hours
    w: number;                         // hours
    hours: number;                     // recovery duration label
    note: string;                      // operator-facing explanation
  };

  moves: Array<{
    of: string;
    line: string;
    shift: string;                     // "+6h" etc.
    why: string;
  }>;

  evidence: {
    reason: string;                    // HTML allowed (bold tags)
    breakdown: Array<{
      name: string;                    // "Envase change", "Brand change", ...
      pct: number;                     // 0–100
      band: "lo" | "hi";
      val: string;                     // "−1.4 OEE" | "none"
    }>;
    analogues: Array<{
      of: string;                      // historic OF
      date: string;                    // "14 Mar 2025"
      line: string;
      type: "same-envase" | "brand" | "familia" | string;
      oee: string;                     // string, e.g. "0.61"
    }>;
    n: number;                         // sample size
    analogueMean: string;              // "0.57"
    naiveMean: string;                 // "0.51"
    gain: string;                      // "+6.2"
  };
}
```

`RecBand` is the same as `Band` (production-run variant), plus optional
diff tags used by the UI to colour the change:

```ts
{
  of: string;
  start: number;
  w: number;
  oee: number;
  kind?: "ins" | "shift";   // "ins" = newly inserted, "shift" = moved
}
```

### `Objectives`
Three ranked views over the same recommendations. `order` is the list
of `lineId`s sorted best→worst on that axis.

```ts
{
  oee:  { label: "OEE";        icon: string; order: string[]; notes: { [lineId]: string } };
  time: { label: "Time";       icon: string; order: string[]; notes: { [lineId]: string } };
  dis:  { label: "Disruption"; icon: string; order: string[]; notes: { [lineId]: string } };
}
```

### `ManualSlot`
Keyed by an opaque slot id (see `data/plan.json` for examples like
`"17-after-AM05LTST"`, `"14-end"`).

```ts
{
  recKey: string;                          // lineId of the matching rec
  verdict: "match" | "ok" | "worse";
  label: string;                           // "Line 17 · after AM05LTST"
  banner: string;                          // operator-facing sentence
}
```

---

## Open questions for backend

1. **Pagination / size**: payload today is ~5 KB. If real planning
   horizons grow this past ~200 KB, we should consider splitting
   recommendations into their own endpoint.
2. **Mutation**: there is no write endpoint yet. When the operator
   accepts a recommendation, do we `POST /plan/accept` with the rec
   key, or push the resulting plan back wholesale? Flag preferred.
3. **Recompute trigger**: is `/plan` recomputed on every request, or
   does the backend cache and require a `POST /plan/recompute`?
4. **Time origin**: `start` is "hours from start of planning window".
   Confirm the window anchor (Monday 00:00 local? shift start?).
5. **HTML in `evidence.reason`**: the field today contains `<b>` tags
   rendered by the UI. If backend prefers structured text we can move
   the bolding into the frontend.

---

## Reference: live example

See `data/plan.json` in this repo — that file is the canonical example
payload and is what the dev server returns verbatim.
