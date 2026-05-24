# LineWise — Frontend / Backend API Contract

`CONTRACT_VERSION` is **2.4**. v2.4 adds (a) an expanded `Order.status`
taxonomy, (b) the shipped `GET /signals` + `POST /signals/refresh`
endpoints with `Signal` and `Citation` types (backend served via Cala
with a hand-curated seed fallback), and (c) the planned audit-log,
shift-handoff and plan-draft/apply write endpoints that currently
mutate `localStorage` only.

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

### `GET /signals`
Returns the external-context payload (supplier risk, regulatory,
competitor, commodity) — see `Signal` & `Citation` below.

**200**
```ts
{
  signals: Signal[];
  citations: { [citationId: string]: Citation };
  generatedAt: number;                       // epoch ms; 0 when seed only
  source: "cala" | "seed";
  stale: boolean;                            // true = not refreshed since startup
  error: string | null;                      // reason for last refresh failure, if any
}
```

ETag + `Cache-Control: no-store`. Always answers — when the live Cala
client is unconfigured or the cache is empty, the seed file at
`data/output/signals.json` is returned with `source: "seed"`.

### `POST /signals/refresh`
Re-runs the Cala calls and overwrites the cache. Free-tier-friendly —
never called from the request path; trigger manually or on a cron.

**200**
```ts
{
  ok: boolean;                               // true if Cala succeeded
  signals: Signal[];
  citations: { [citationId: string]: Citation };
  source: "cala" | "seed";
  generatedAt: number;
  stale: boolean;
  error: string | null;                      // present when ok=false
}
```

On `HTTP 429`/`401`/`403` from Cala the refresh halts; the seed stays
in place and `error` carries the upstream code.

---

## Plan payload

Top-level keys (all required unless noted):

| Key | Type | Purpose |
|---|---|---|
| `urgentOrders` | `Order[]` | Inbox of incoming urgent OFs |
| `lineBaseline` | `{ [lineId]: number }` | Baseline OEE per line (0–1) |
| `timeline` | `TimelineMeta` | Backend-owned date anchor, time unit and view windows |
| `lineRules` | `{ [lineId]: LineRule }` | Locked format capabilities per line |
| `weeklyStops` | `{ [lineId]: Stop[] }` | Locked weekly cleaning/maintenance markers from Tabla CF |
| `yearCompare` | `YearCompare` | YoY week strip on top bar |
| `executedHistory` | `{ [lineId]: Band[] }` | What already ran (left of "now") |
| `basePlan` | `{ [lineId]: Band[] }` | Current committed plan (right of "now") |
| `lineCentre` | `{ [lineId]: string }` | Production centre label per line |
| `recommendations` | `{ [lineId]: Recommendation }` | One rec card per line option |
| `objectives` | `Objectives` | Ranked options by OEE / Time / Disruption |
| `manualSlots` | `{ [slotKey]: ManualSlot }` | UI hint cards for hand-placed slots |
| `lineFormats` | `{ [lineId]: string[] }` | Can formats each line supports — see `LineFormats` below |
| `issues` | `Issue[]` | Active line-issue log surfaced on lane badges — see `Issue` below |
| `stoppages` | `Stoppage[]` | Currently active line stoppages — see `Stoppage` below |

> **Signals note:** `signals` is **not** a top-level key on `/plan`. It
> is served by the sibling `GET /signals` endpoint documented above —
> backend cache + Cala refresh, returning `Signal` + `Citation` records.
> This branch ships a parallel client-side mock at `src/lib/cala-mock.js`
> with a different shape (`vertical`, `headline`/`value`/`delta`) used
> by the homepage news strip and Plan Lab provenance card today. The
> mock retires once the frontend points its components at the
> `/signals` endpoint.

### `Order`
```ts
{
  of: string;            // e.g. "ED13LTNN"
  status:
    | "urgent"           // unscheduled, needs planner action (drives KPI badge)
    | "queued"           // in the inbox queue, not yet on the timeline
    | "scheduled"        // committed on the timeline, not yet executed
    | "planned"          // synthesised by the FE for a moved/draft preview
    | "done";            // executed and closed out
  sku: string;           // human label, e.g. "Estrella Damm · lata 33cl"
  units: number;         // physical units
  hl: number;            // hectolitres
  due: string;           // free-text date label, e.g. "21 May"
}
```

> The `urgent` / `queued` enum was the v2.3 contract. v2.4 widens the
> taxonomy because the Inbox and KPI strip now distinguish between
> "scheduled" (on the timeline) and "done" (closed shift). `planned` is
> emitted only by the frontend's optimistic preview path; backends do
> not need to return it.

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

### `TimelineMeta`
```ts
{
  anchorDate: string;     // ISO date represented by start=0
  anchorLabel: string;    // usually "Today"
  timeUnit: "hours" | "days";
  views: {
    week:    { daysBack: number; daysAhead: number };
    month:   { daysBack: number; daysAhead: number };
    quarter: { daysBack: number; daysAhead: number };
  };
}
```

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

### `Stop`
```ts
{
  id: string;
  line: string;
  kind: "clean" | "maint";
  label: string;
  start: number;
  w: number;
  durationHours: number;
  day: "L" | "M" | "X" | "J" | "V" | "S" | "D";
  cadence: string;
  shiftPattern: string;
  locked: true;
  source: string;
}
```

Week / Month / Quarter use the same `basePlan` and `executedHistory`
arrays. The toggle changes the rendered window/scale; it does not fetch
separate datasets.

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
  due?: string;          // ISO8601 committed delivery time. Optional but
                         // strongly recommended for forward runs — the
                         // move-to-another-line flow uses this to flag
                         // per-run delivery risk after a manual override.
                         // Without it we fall back to a service-block
                         // collision check (see below).
}
```

Non-production block:
```ts
{
  kind: "clean" | "maint";
  start: number;
  w: number;
  locked?: boolean;      // true = externally committed (contractor visit,
                         // CIP cycle locked by quality, etc.). Pushing a
                         // locked block surfaces a stronger warning in
                         // the move-impact panel ("contractor-locked CIP
                         // on Fri 29 cannot be rescheduled"). Default false
                         // means "internal, soft-locked" — still warned
                         // about, but with milder copy.
  lockReason?: string;   // human-readable explanation surfaced in the
                         // warning copy. Free text.
}
```

> **Important for `basePlan`**: service blocks (`kind: clean | maint`)
> must appear in the forward `basePlan` lane arrays, not only in
> `executedHistory`. The move flow's delivery-risk check fires when a
> manual move pushes a forward service block — if these blocks aren't
> in the contract output, the warning has nothing to fire against.

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

### `LineFormats` (new)

The set of can formats each line is capable of running. Drives the
move-to-another-line flow's compatibility overlay (incompatible lanes
get the red-striped "33cl only — can't run 50cl" treatment) and would
also let the recommendation engine prune impossible insertions before
ranking.

Today this is **hardcoded in the frontend** at [`src/lib/movePlan.js`](src/lib/movePlan.js):
```js
LINE_FORMATS = { "14": ["50cl","33cl"], "17": ["33cl"], "19": ["50cl","33cl","44cl"] }
```

Server-side shape we want:
```ts
{
  lineFormats: { [lineKey: string]: string[] };  // e.g. {"14":["50cl","33cl"]}
}
```

Add this to the `/plan` payload and we delete the hardcode in one PR.
Putting it on the server also means format rules can change (new line
tooling, certification update) without a frontend deploy.

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

### `Issue` (new)

Append-only audit log of line-side issues Maria reports from the floor
FAB (mechanical fault, quality hold, etc.). Issues do **not** change
the plan — they're context that explains later OEE dips. Surfaced as
the small `!` badge in the lane head ([`IssueBadge.jsx`](src/components/IssueBadge.jsx))
and submitted via [`IssueModal.jsx`](src/components/IssueModal.jsx).

```ts
{
  id: string;                              // server-assigned (e.g. "iss-1716...")
  line: "14" | "17" | "19";                // line key
  category: "mech" | "elec" | "quality" | "material";
  severity: "warn" | "critical";
  note: string;                            // free text, may be empty
  ts: number;                              // epoch ms when reported
}
```

The frontend renders the six most recent per line in a popover, with
older issues collapsed under a `+N older` footer. No deletion flow yet
— if you add one, expose it as `DELETE /issues/{id}`.

### `Stoppage` (new)

Currently-active line stoppage. Drives:

- The `KPIStrip` "Lines running" tile (`running/total` plus a `bad`
  tone when any line is stopped — see [`KPIStrip.jsx`](src/components/KPIStrip.jsx)).
- The red lane badge in the [`Timeline`](src/components/Timeline.jsx)
  with a `Resume` action.
- The `ReplanBanner` decision prompt right after logging.

Submitted via [`StoppageModal.jsx`](src/components/StoppageModal.jsx).
Today the frontend keeps at most one active entry per line (a new
report for the same line replaces the prior one); the backend should
enforce the same invariant.

```ts
{
  id: string;                              // server-assigned
  line: "14" | "17" | "19";
  reason: "breakdown" | "no-material" | "no-operator" | "quality-hold" | "other";
  startedAt: number;                       // epoch ms of stoppage start
  startAgoMin: 0 | 5 | 10 | 15;            // chip selection retained for audit
  duration: "15m" | "30m" | "1h" | "2h+" | "unknown";
                                           // expected, not actual — drives the
                                           // replan shift amount (see
                                           // src/lib/stoppagePlan.js)
  ts: number;                              // epoch ms when reported
}
```

Resume clears the entry server-side (see `POST /stoppages/{id}/resume`
below). Any plan changes already committed via a replan stay in place
— resuming a line does **not** revert the schedule.

### `Signal` & `Citation` (new in v2.4 — shipped)

Returned by `GET /signals`. Powers the World Signals strip / homepage
news cards and the citation chips on AI suggestions.

```ts
// Signal — one row in the panel
{
  id: string;                              // "sig-<hex>" or "sig-seed-..."
  category: "supplier" | "regulatory" | "competitor" | "commodity" | "other";
  severity: "info" | "warn" | "critical";
  title: string;                           // panel section title
  body: string;                            // operator-facing sentence
  citationIds: string[];                   // references citations[id]
  linesAffected: string[];                 // line keys ("14"/"17"/"19")
  actionHint: "replan" | "watch" | null;   // proactive-banner trigger
  ts: number;                              // epoch ms
}

// Citation — the structured fact + provenance behind a claim
{
  id: string;                              // "cit-<hex>" or "cit-seed-..."
  claim: string;                           // the cited sentence
  source: {
    name: string | null;                   // publisher (Reuters, EUR-Lex, …)
    url: string;                           // citable URL
    date: string | null;                   // ISO date or null
  };
}
```

Severity is inferred from the claim text on parse:
- "sanction" / "block" / "ban" / "recall" / "halted" / "shutdown" → `critical`
- "delay" / "shortage" / "investigation" / "warning" / "fine" / "violation" → `warn`
- otherwise → the per-category floor

> **Migration note:** this branch ships a parallel client-side mock at
> [`src/lib/cala-mock.js`](src/lib/cala-mock.js) with a different shape
> (`vertical`, `headline`/`value`/`delta`, `severity: high|medium|low`,
> `affects.{lines,ofs,materials}`). The `HomepageNewsStrip`, Inbox
> briefing impact cards, and Plan Lab provenance modal still consume
> the mock pending a follow-up that rewires them onto `useSignals` /
> the backend shape above.

### `ChangeLedgerEntry` (new in v2.4 — planned, optional)

The frontend already keeps an append-only audit log of planner actions
in `localStorage` via [`useChangeLedger`](src/hooks/useChangeLedger.js).
This drives the homepage "Recent changes" rail (when no signals are
present), the Inbox briefing "what changed since last handoff" line,
and the Close-Shift modal's `Changes made` list. When persistence moves
server-side, expose `GET /changes?sessionId=…` returning entries in
this shape and have writes POST to `/changes` (or piggy-back on the
existing mutating endpoints; see *Write endpoints* below):

```ts
{
  id: string;                              // server-assigned ("chg-<ts>-<n>")
  sessionId: string;                       // browser-session uuid
  ts: number;                              // epoch ms when appended
  type:
    | "urgent_order_selected"
    | "queued_order_selected"
    | "manual_move_confirmed"
    | "stoppage_logged"
    | "stoppage_replan_committed"
    | "issue_logged"
    | "draft_plan_saved"
    | "plan_applied";
  summary: string;                         // short human line shown on the rail
  // The remaining fields depend on `type` — see the discriminated union
  // below. All optional from the type-system's perspective.
  rationale?: string;                      // "manual" | "line-change" | …
  runId?: string;                          // OF moved
  fromLine?: string; toLine?: string;
  line?: string;
  stoppageId?: string;
  issueId?: string;
  reason?: string;
  duration?: string;
  shiftedCount?: number;
  shiftedHours?: number;
  category?: string;                       // issue category
  severity?: string;                       // issue severity
  note?: string;                           // issue note
  title?: string;                          // draft / applied plan title
  metrics?: Array<{ label: string; value: string; tone?: string }>;
  ripple?: MovePreview["ripple"];
}
```

The frontend currently keeps `plan` / `priorPlan` snapshots out of the
ledger (see `compactChange` in `useChangeLedger.js`) — the backend
should do the same to keep entries small.

### `ShiftHandoff` (new in v2.4 — planned, optional)

Payload emitted by [`ShiftCloseModal`](src/components/ShiftCloseModal.jsx)
when the planner clicks **Send**. Today persisted to `localStorage`
under `linewise.lastHandoff.v1`. The Inbox briefing reads the latest
handoff to compute "changes since last handoff" and "open risks".
Server-side: `POST /shifts/handoff` to write, `GET /shifts/handoff/latest`
to read.

```ts
{
  id: string;                              // "handoff-<ts>"
  sentAt: number;                          // epoch ms
  notes: string;                           // free-text summary (auto-filled, planner-editable)
  changes: ChangeLedgerEntry[];            // typically the last six entries at send time
  openRisks: string[];                     // short bullet phrases (max 4) — derived from active
                                           // stoppages, critical issues, and move collisions
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
6. **Move-to-another-line writes**: the planner can manually relocate
   a forward run (drag-drop on a compatible lane → calculating flash
   → impact panel → Confirm/Discard). Today this only mutates frontend
   state. The eventual write endpoint should accept:
   ```ts
   POST /plan/move
   { runId: string, fromLine: string, toLine: string, slotIndex: number }
   ```
   and return the recomputed `Plan` payload so the UI re-renders against
   the server's view (rather than trusting its local preview).
   Open: do we want a separate `POST /plan/move/preview` that returns
   just the ripple summary without committing? It would let us replace
   the frontend's `computeMovePreview` heuristic with the server's
   actual planner — at the cost of one extra round-trip per drop. If we
   build it, return the `MovePreview` shape described below so the
   impact panel can render unchanged.
7. **Forward service blocks**: see the note under `Band` — `basePlan`
   should include `clean` / `maint` entries with their forward `start`,
   not only `executedHistory`. The move flow's delivery-risk check
   depends on this.

---

## Write endpoints (planned)

All three flows below today mutate **frontend state only** — the
backend can ignore them while wiring `/plan`. Once persistence lands,
match these shapes and the frontend swaps over with the same
`VITE_API_BASE` switch as the read path. Each endpoint should return
the new server-truth so the UI can re-render without a follow-up
`GET /plan`.

### `POST /issues`
Log a line-side issue (no plan mutation).

**Request**
```ts
{
  line: "14" | "17" | "19";
  category: "mech" | "elec" | "quality" | "material";
  severity: "warn" | "critical";
  note: string;                            // may be empty string
  ts: number;                              // epoch ms (client clock)
}
```

**200**
```ts
{ issue: Issue }                           // server-assigned id, server ts
```

### `POST /stoppages`
Log a line stoppage. Server enforces one-active-per-line (a new entry
for the same `line` supersedes the prior one). Does **not** replan on
its own — the planner is prompted (ReplanBanner) and explicitly opts
in via `POST /plan/stoppage-replan`.

**Request**
```ts
{
  line: "14" | "17" | "19";
  reason: "breakdown" | "no-material" | "no-operator" | "quality-hold" | "other";
  startedAt: number;                       // epoch ms
  startAgoMin: 0 | 5 | 10 | 15;
  duration: "15m" | "30m" | "1h" | "2h+" | "unknown";
  ts: number;                              // epoch ms (client clock)
}
```

**200**
```ts
{ stoppage: Stoppage; stoppages: Stoppage[] }   // full active set after insert
```

### `POST /stoppages/{id}/resume`
Mark a stopped line resumed. Removes the stoppage from the active set;
leaves any committed replan changes in place.

**200**
```ts
{ stoppages: Stoppage[] }                  // remaining active set
```

### `POST /plan/stoppage-replan`
Commit the "shift downstream runs forward by the expected stoppage
duration" plan change. Today implemented client-side in
[`src/lib/stoppagePlan.js`](src/lib/stoppagePlan.js) — see
`computeStoppageReplan`. Service blocks (`clean`/`maint`) shift along
with production runs in the hackathon implementation; in production
they'd be time-locked and the backend would negotiate around them.

**Request**
```ts
{
  stoppageId: string;
  line: "14" | "17" | "19";
  durationKey: "15m" | "30m" | "1h" | "2h+" | "unknown";
}
```

**200**
```ts
{
  plan: Plan;                              // recomputed full payload
  shiftedCount: number;                    // # runs (+ service blocks) shifted
  shiftedHours: number;                    // amount each was pushed
}
```

### `POST /plan/move` and `POST /plan/move/preview`
See open question (6) above for the move-flow endpoints. The preview
endpoint should return:

```ts
// MovePreview
{
  plan: Plan;                              // hypothetical plan if confirmed
  ripple: {
    runId: string;                         // moved order code
    fromLine: string;
    toLine: string;
    destPrev: string | null;               // neighbour OF or null
    destNext: string | null;
    pushedCount: number;                   // forward runs shifted on destination
    formatSwitchesOld: number;
    formatSwitchesNew: number;
    collisions: Collision[];               // delivery-risk signal — see below
  };
}

// Collision — one entry per service window that the move pushes.
// Drives the warning bar and "Override & confirm" red button in
// MoveImpactPanel.jsx. Empty array means the move is safe to commit.
{
  of: string;                              // human label, e.g. "Scheduled cleaning"
  kind: "clean" | "maint";
  byHours: number;                         // how far the service block is pushed
}
```

The frontend collision computation lives in `computeMovePreview` in
[`src/lib/movePlan.js`](src/lib/movePlan.js) and only flags pushed
service blocks today. If the backend has per-run due dates (see the
optional `Band.due` field), prefer flagging concrete delivery misses
instead and return both — `MoveImpactPanel` will render whichever is
non-empty.

### `POST /plan/drafts` and `POST /plan/apply` (new in v2.4 — planned)

The Plan Lab footer exposes two terminal actions: **Save draft** and
**Apply plan**. Today both are frontend-only (see `onSaveDraft` /
`onApplyPlan` in [`PlanLab.jsx`](src/preview/PlanLab.jsx)), with the
ledger entry standing in for persistence. When the backend takes
ownership:

**Request body (same shape for both)**
```ts
{
  title: string;                           // e.g. "Manual placement for AM05LTST"
  mode: "rec" | "manual";
  order: Order | null;                     // order that drove this Plan Lab session, if any
  metrics: Array<{                         // the KPI tiles shown on the impact summary
    label: string;                         // "OEE" | "Week OEE" | "Ripple" | "Service" | …
    value: string;                         // free text rendered verbatim
    tone?: "good" | "mid" | "bad" | "quiet";
  }>;
  plan: { [lineId]: Band[] };              // full forward plan being saved/applied
}
```

**200 (drafts)** — `{ draft: { id: string; savedAt: number; … } }`
**200 (apply)** — `{ plan: Plan }` (the new server-truth `Plan` payload
so the UI re-renders against committed state).

### `POST /changes` and `GET /changes` (new in v2.4 — planned)

Append-only audit log; entries match `ChangeLedgerEntry` above. Today
written client-side from `useChangeLedger`. The backend may either
accept explicit writes here (one POST per action) or fold them into
the existing mutating endpoints (`/plan/move`, `/plan/stoppage-replan`,
`/issues`, `/stoppages`) and surface them via `GET /changes`. Either
is fine — what matters is that the homepage rail and the Inbox
briefing can read the same substrate the Close-Shift modal writes
against.

Suggested filter parameters on `GET`:

| Param | Type | Default |
|---|---|---|
| `sessionId` | `string` | omitted → all sessions |
| `since` | `number` (epoch ms) | omitted → no lower bound |
| `limit` | `number` | 200 |

### `POST /shifts/handoff` and `GET /shifts/handoff/latest` (new in v2.4 — planned)

Persist and retrieve the most recent `ShiftHandoff` payload (see type
above). The Inbox briefing fetches `…/latest` on boot to compute the
"changes since last handoff" line; the Close-Shift modal POSTs the new
handoff on Send. Returning the persisted entry on POST is fine — the
frontend currently stashes the same payload in `localStorage` and reads
it back on the next session.

---

## Reference: live example

See `data/plan.json` in this repo — that file is the canonical example
payload and is what the dev server returns verbatim.
