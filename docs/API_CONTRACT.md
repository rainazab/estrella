# LineWise HTTP API

This is what the backend serves to the frontend at runtime. The shape is
designed for the React/Vite client; the canonical Python payload in
`data/output/data.json` is richer and is transformed at request time by
`app/frontend_payload.py`.

`CONTRACT_VERSION` is **2.3**. Adding or removing a top-level key is a
contract change — bump the version and notify the frontend team.

## Conventions

- **Base URL**: the frontend prefixes every request with `VITE_API_BASE`
  (default `/api`). Paths in this doc are relative to that base.
- **Transport**: HTTPS, `Content-Type: application/json` on responses.
- **Caching**: `GET /plan` returns `Cache-Control: no-store` and an
  `ETag`. Clients that send `If-None-Match` get a `304 Not Modified` when
  the canonical file *and* in-process write state are unchanged.
- **Errors**: non-2xx responses are JSON
  `{ "error": "<code>", "detail": "<human-readable>" }`. The frontend
  surfaces `detail` to the operator.
- **IDs**: line keys are stringified line numbers (`"14"`, `"17"`,
  `"19"`). `of` is the order code (string). Server-assigned ids use
  `iss-<hex>` for issues and `stp-<hex>` for stoppages.
- **Time**: `start` and `w` are **hours from the start of the planning
  window**. One decimal is fine; the backend rounds to two. Per-record
  client/server timestamps (`ts`, `startedAt`) are **epoch milliseconds**.
- **OEE**: fraction in `[0, 1]`.

## Endpoints

### `GET /health`
Liveness probe. **200**:

```json
{ "ok": true }
```

### `GET /plan`
Returns the full planning payload. One call, one object. Includes any
in-process mutations applied via the write endpoints below.

| Status | Meaning |
|---|---|
| `200` | Body as documented under *Plan payload* below. `ETag` + `Cache-Control: no-store` headers. |
| `304` | Body empty. The client's `If-None-Match` matches the server's current `ETag`. |
| `500` | `{ "error": "data_corrupt", "detail": "<json error>" }` — data.json failed to parse. |
| `503` | `{ "error": "data_unavailable", "detail": "<path> does not exist…" }` — no data.json on disk. |

### `POST /plan/recompute`
Regenerates `data/output/data.json` by re-invoking
`python -m app.export_data_json` as a subprocess. Also clears any
in-process `plan_override` left behind by `/plan/move`, so the next
`/plan` reflects the freshly exported canonical state.

| Status | Meaning |
|---|---|
| `200` | `{ "ok": true, "message": "data.json regenerated.", "output": "<path>" }` |
| `412` | `{ "error": "raw_missing", ... }` — `data/raw/` is empty/missing. |
| `500` | `{ "error": "recompute_failed", "detail": "<tail of exporter stderr>" }` |
| `504` | `{ "error": "recompute_timeout", "detail": "export_data_json exceeded 180s" }` |

### `POST /issues`
Log a line-side issue. Does not mutate the plan.

**Request body**
```ts
{
  line: "14"|"17"|"19";
  category: "mech"|"elec"|"quality"|"material";
  severity: "warn"|"critical";
  note: string;          // may be ""
  ts: number;            // epoch ms (client clock)
}
```

**200**
```ts
{ issue: Issue }         // server-assigned id, server ts
```

**400** on unknown category/severity/line.

### `POST /stoppages`
Log an active line stoppage. Server enforces **one active per line**: a
new entry on the same `line` supersedes the previous one. Does **not**
replan on its own — see `POST /plan/stoppage-replan`.

**Request body**
```ts
{
  line: "14"|"17"|"19";
  reason: "breakdown"|"no-material"|"no-operator"|"quality-hold"|"other";
  startedAt: number;     // epoch ms
  startAgoMin: 0|5|10|15;
  duration: "15m"|"30m"|"1h"|"2h+"|"unknown";
  ts: number;            // epoch ms (client clock)
}
```

**200**
```ts
{ stoppage: Stoppage; stoppages: Stoppage[] }   // full active set after insert
```

### `POST /stoppages/{id}/resume`
Mark a stopped line resumed. Removes the stoppage from the active set;
any committed replan stays in place.

**200** → `{ stoppages: Stoppage[] }`
**404** when no active stoppage matches `{id}`.

### `POST /plan/stoppage-replan`
Commit the "shift downstream runs forward by the expected stoppage
duration" plan change. The shift amount is derived from `durationKey`
(see *Stoppage*); service blocks on the affected line shift with
production runs.

**Request body**
```ts
{
  stoppageId: string;
  line: "14"|"17"|"19";
  durationKey: "15m"|"30m"|"1h"|"2h+"|"unknown";
}
```

**200**
```ts
{
  plan: Plan;            // recomputed full payload
  shiftedCount: number;  // # bands shifted (including service blocks)
  shiftedHours: number;  // hours each band was pushed
}
```

### `POST /plan/move/preview`
Dry-run a manual move. Returns the hypothetical plan plus the ripple
summary the impact panel renders. Does **not** persist.

**Request body**
```ts
{ runId: string; fromLine: string; toLine: string; slotIndex: number }
```

**200**
```ts
{ plan: Plan; ripple: MovePreview["ripple"] }
```

**404** when `runId` is not present on `fromLine`.

### `POST /plan/move`
Same shape as `/plan/move/preview` but commits. The next `GET /plan`
returns the new layout; the canonical `data.json` is *not* rewritten
(re-running the exporter via `/plan/recompute` resets the override).

**200** → `{ plan: Plan; ripple: MovePreview["ripple"] }`

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
| `timeline` | `TimelineMeta` | Backend-owned date anchor, time unit and view windows |
| `lineRules` | `{ [lineId]: LineRule }` | Locked format capabilities per line |
| `lineFormats` | `{ [lineId]: string[] }` | Format labels per line; drives move-flow compatibility |
| `weeklyStops` | `{ [lineId]: Stop[] }` | Locked weekly cleaning/maintenance markers from Tabla CF |
| `yearCompare` | `YearCompare` | YoY week strip on the top bar |
| `executedHistory` | `{ [lineId]: Band[] }` | What already ran (left of "now") |
| `basePlan` | `{ [lineId]: Band[] }` | Current committed plan (right of "now"), including forward service blocks |
| `lineCentre` | `{ [lineId]: string }` | Production centre label per line |
| `recommendations` | `{ [lineId]: Recommendation }` | One rec card per line option |
| `objectives` | `Objectives` | Ranked options by OEE / Time / Disruption |
| `manualSlots` | `{ [slotKey]: ManualSlot }` | UI hint cards for hand-placed slots |
| `issues` | `Issue[]` | Active issue log surfaced on lane badges |
| `stoppages` | `Stoppage[]` | Active line stoppages |

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

### `TimelineMeta`
```ts
{
  anchorDate: string;     // ISO date represented by start=0
  anchorLabel: string;    // usually "Today"
  timeUnit: "hours"|"days";
  views: {
    week:    { daysBack: number; daysAhead: number };
    month:   { daysBack: number; daysAhead: number };
    quarter: { daysBack: number; daysAhead: number };
  };
}
```

The Week / Month / Quarter controls use the same `basePlan` and
`executedHistory` arrays; they only change the rendered window/scale. The
window sizes come from `timeline.views`, while card geometry remains a
frontend concern.

### `LineRule`
```ts
{
  line: string;
  formats: Array<{ key: "1/2"|"1/3"|"2/5"; label: "50cl"|"33cl"|"44cl"; name: string }>;
  summary: string;
  locked: boolean;
  source: string;
}
```

### `LineFormats`

Projection of `lineRules[*].formats[*].label` keyed by line. Replaces the
`LINE_FORMATS` hardcode previously sitting in
`linewise/src/lib/movePlan.js`. Server-derived from `lineRules` unless
the canonical payload supplies it explicitly.

```ts
{ [lineId]: string[] }    // e.g. { "14": ["50cl","33cl"], "17": ["33cl"] }
```

### `Stop`
```ts
{
  id: string;
  line: string;
  kind: "clean"|"maint";
  label: string;
  start: number;        // in timeline.timeUnit, currently hours
  w: number;            // in timeline.timeUnit, currently hours
  durationHours: number;
  day: "L"|"M"|"X"|"J"|"V"|"S"|"D";
  cadence: string;
  shiftPattern: string;
  locked: true;
  source: string;
}
```

### `Band`
Discriminated by the presence of `kind`.

Production:
```ts
{ of: string; sku?: string; vol?: number;
  start: number;     // in timeline.timeUnit, currently hours
  w: number;         // in timeline.timeUnit, currently hours
  oee: number;       // 0–1
  due?: string }     // ISO8601 committed delivery time (optional).
                     // Emitted when canonical data has it; absent means
                     // the move flow falls back to the service-block
                     // collision check.
```

Non-production:
```ts
{ kind: "clean"|"maint"; start: number; w: number;
  locked?: boolean;        // default false ("internal, soft-locked")
  lockReason?: string }    // human-readable explanation, free text
```

The transformer strips OEE/vol from clean/maint bands and rounds
start/w to 2 decimals. `basePlan` includes forward clean/maint blocks
(not only `executedHistory`) — see Q7 below.

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

### `Issue`

Append-only audit-log entry from `IssueModal`. Issues do not change the
plan — they're context that explains later OEE dips.

```ts
{
  id: string;                              // "iss-<hex>"
  line: "14"|"17"|"19";
  category: "mech"|"elec"|"quality"|"material";
  severity: "warn"|"critical";
  note: string;                            // free text, may be ""
  ts: number;                              // epoch ms (server-assigned)
}
```

The frontend renders the six most recent per line in a popover, with
older issues collapsed. No deletion flow yet.

### `Stoppage`

Currently-active line stoppage. Drives the "Lines running" KPI tile, the
lane STOPPED badge, and the post-stoppage replan prompt. One active per
line; a new entry on the same line supersedes the prior one.

```ts
{
  id: string;                              // "stp-<hex>"
  line: "14"|"17"|"19";
  reason: "breakdown"|"no-material"|"no-operator"|"quality-hold"|"other";
  startedAt: number;                       // epoch ms of stoppage start
  startAgoMin: 0|5|10|15;                  // chip selection retained for audit
  duration: "15m"|"30m"|"1h"|"2h+"|"unknown";
                                           // expected, not actual — drives
                                           // the replan shift amount
  ts: number;                              // epoch ms (server-assigned)
}
```

### `MovePreview`

Returned by `/plan/move/preview` and `/plan/move`.

```ts
{
  plan: Plan;                              // hypothetical (preview) or new committed (move)
  ripple: {
    runId: string;                         // moved order code
    fromLine: string;
    toLine: string;
    destPrev: string | null;               // neighbour OF / kind, or null
    destNext: string | null;
    pushedCount: number;                   // forward bands shifted on destination
    formatSwitchesOld: number;
    formatSwitchesNew: number;
    collisions: Collision[];               // see below
  };
}

// Collision — one entry per service window the move pushes.
// Empty array means the move is safe to commit.
{
  of: string;                              // "Scheduled cleaning" / "Scheduled maintenance"
  kind: "clean"|"maint";
  byHours: number;                         // how far the service block was pushed
}
```

## Frontend ↔ canonical mapping

| Frontend field | Source in `data/output/data.json` | Transform |
|---|---|---|
| `urgentOrders[]` | `urgentOrders[]` | Trim to `{of, status, sku, units, hl, due}` |
| `lineBaseline[line]` | `lineBaseline[line].avg_oee` | Flatten the rich object to a number |
| `timeline` | `timeline` | Trim to `{anchorDate, anchorLabel, timeUnit, views}` |
| `lineRules` | `lineRules` | Trim to `{line, formats, summary, locked, source}` |
| `lineFormats` | `lineFormats` (else derived from `lineRules`) | `{[line]: [fmt.label, ...]}` |
| `weeklyStops` | `weeklyStops` | Trim to locked clean/maint marker fields |
| `yearCompare` | `yearCompare` | Already in the new weekly shape |
| `executedHistory[line]` | `executedHistory[line]` | Hours unchanged; clean/maint stripped to `{kind, start, w, locked?, lockReason?}` |
| `basePlan[line]` | `basePlan[line]` (+ in-process `plan_override` from `/plan/move`) | Same as above; forward clean/maint blocks included |
| `lineCentre` | `lineCentre` | Passthrough |
| `recommendations[line]` | `recommendations[line]` | Trim to contract fields; drop `candidateSlotsEvaluated`, `adjustedOeeGain`, `transitionType`, etc. |
| `recommendations[line].evidence` | `recommendations[line].evidence` | Trim to `{reason, breakdown, analogues, n, analogueMean, naiveMean, gain}`. Each analogue is `{of, date, line, type, oee:string}`. |
| `objectives` | `objectives` | Trim to `{label, icon, order, notes}` per axis |
| `manualSlots` | `manualSlots` | Trim each value to `{recKey, verdict, label, banner}` |
| `issues` | in-process store (`POST /issues`) | Empty until written; not persisted across server restart |
| `stoppages` | in-process store (`POST /stoppages`) | Empty until written; not persisted across server restart |

The canonical payload's additive metadata (`metadata.*`,
`infeasibleByLine`, `planReview`, per-recommendation scoring fields) is
not exposed on `/plan` — it stays in `data.json` for backend tooling and
the `validate_model_outputs` validator.

## Open questions (resolved)

| # | Question | Answer |
|---|---|---|
| 1 | Pagination / size | Payload is ~80 KB today, ~5 KB on the seed dataset. No pagination needed yet. If we cross ~200 KB we'll split recommendations into `/plan/recommendations`. |
| 2 | Mutation | `POST /plan/move` and `POST /plan/stoppage-replan` mutate the plan in-process. There is no `POST /plan/accept` for recommendations yet — accepting a rec card today is frontend-state-only. When we add it, we'll match `/plan/move`'s shape: send the rec key, get the recomputed `Plan` back. |
| 3 | Recompute trigger | `/plan` re-reads the file on every request (cheap); ETag short-circuits. `/plan/recompute` re-runs the exporter and clears any in-process override. |
| 4 | Time origin | `t = 0` is the leftmost block on each line. Executed and basePlan share the line axis: executed grows right from `t = 0`, basePlan grows right from its own `t = 0`. The window's wall-clock anchor lives in `timeline.anchorDate` (ISO date for `start = 0`); shift boundaries are not modelled — the planner is shift-agnostic. The frontend renders the divider. |
| 5 | HTML in `evidence.reason` | We emit `<b>...</b>` tags. The frontend renders them. Switching to structured tokens would be a contract change; if you want it, raise a follow-up and we'll move the bolding client-side. |
| 6 | Move-to-another-line writes | Both endpoints exist: `POST /plan/move/preview` returns the same `MovePreview` shape the frontend's `computeMovePreview` produces, so the impact panel renders unchanged when the env var flips on. `POST /plan/move` commits and returns the new `Plan` so the UI re-renders against server truth. Use preview on drop; commit on Confirm. |
| 7 | Forward service blocks | `basePlan[line]` includes `{kind: "clean"\|"maint", start, w, locked?, lockReason?}` entries with their forward `start`. `weeklyStops` is the source-of-truth catalogue; forward instances are projected into `basePlan` so the move-flow delivery-risk check has something to fire against. Pushing a `locked: true` block is the strong warning; default `false` is the soft-locked warning. |
