# Backend task — close the remaining FE placeholder gaps

## Context (read first — I got this wrong on the first pass)
The real backend already exists at **[app/server.py](../app/server.py)** (FastAPI). The "Dev loop in 60 seconds" in [README.md](../README.md) explains how to run it: `./scripts/run_server.sh` then point the FE at it via `VITE_API_BASE=http://localhost:8000`. The pipeline at [app/data_loader.py](../app/data_loader.py) → [block_classifier](../app/block_classifier.py) → [changeover_typing](../app/changeover_typing.py) → [export_data_json](../app/export_data_json.py) turns Damm's 2025 Excel exports into [data/output/data.json](../data/output/), which is the source of truth for `GET /plan`.

**[linewise/data/plan.json](data/plan.json) is NOT fake** — it's the synced offline copy of `data/output/data.json` (synced via [scripts/sync_frontend_plan.sh](../scripts/sync_frontend_plan.sh)) so the FE works without the backend running.

So the FE is already largely wired to the real backend. This task is only about the gaps that remain.

## Currently shipped backend endpoints (no action needed)
- `GET /health`, `GET /plan`, `POST /plan/recompute`
- `POST /issues`
- `POST /stoppages`, `POST /stoppages/{id}/resume`
- `POST /plan/stoppage-replan`
- `POST /plan/move/preview`, `POST /plan/move`

## Gap 1 — Signals endpoints (FE still hits a hardcoded module)
- **FE source of truth today:** [linewise/src/lib/cala-mock.js](src/lib/cala-mock.js) — `worldSignals` array and `citationsByKey` map, imported directly by `App.jsx`, `Inbox.jsx`, `PlanLab.jsx`. No `fetch` call.
- **Contract:** [API_CONTRACT.md](API_CONTRACT.md) §`/signals` (v2.4) — `GET /signals` returns `{ signals, citations, generatedAt, source, stale, error }`; `POST /signals/refresh` triggers re-fetch via Cala. Seed fallback when Cala is unconfigured.
- **Acceptance:** endpoint always 200s (seed fallback with `source: "seed"`, `stale: true` when Cala is down). Wire format matches contract exactly. After this lands, `cala-mock.js` deletion is a one-line import swap in three files.

## Gap 2 — Plan drafts / apply (planner WIP-save)
- **FE source today:** drafts live in component state + sessionStorage; never sent anywhere.
- **Contract:** [API_CONTRACT.md](API_CONTRACT.md) §`POST /plan/drafts` and §`POST /plan/apply` (v2.4 planned).
- **Acceptance:** drafts persist server-side keyed by user/session, apply commits the chosen draft into the canonical plan and bumps the ETag returned by `/plan`.

## Gap 3 — Change ledger (audit log)
- **FE source today:** [linewise/src/hooks/useChangeLedger.js](src/hooks/useChangeLedger.js) — `sessionStorage` only ("Best-effort demo persistence" comment, line 53).
- **Contract:** [API_CONTRACT.md](API_CONTRACT.md) §`POST /changes` and §`GET /changes` (v2.4 planned).
- **Acceptance:** every `appendChange(...)` event in App.jsx persists; `GET /changes?since=...` returns the lineage. Idempotency key from FE honored.

## Gap 4 — Shift handoff
- **FE source today:** ShiftCloseModal writes to local state only; no GET on session start.
- **Contract:** [API_CONTRACT.md](API_CONTRACT.md) §`POST /shifts/handoff` and §`GET /shifts/handoff/latest` (v2.4 planned).
- **Acceptance:** handoff posts on shift-close confirm, `GET /shifts/handoff/latest` returns it for the next session's banner.

## Gap 5 — Synthesised analogue rows
- **FE source today:** [linewise/src/lib/analogues.js](src/lib/analogues.js) expands the 3 sample analogues in `/plan` into a fuller deterministic list at render time (comment line 1–8).
- **Backend action:** populate `evidence.analogues` on each `Recommendation` in the `/plan` payload with the **full N rows** the analogue search produced, not 3 samples. Shape stays identical; just stop truncating. Once live, the FE-side synthesiser can be deleted.

## Gap 6 — Frozen demo clock
Three spots hardcode "now" for stable screenshots:
- [src/components/Inbox.jsx:35](src/components/Inbox.jsx) — `FAKE_NOW_LABEL = '06:00 · 24 May'`
- [src/components/Timeline.jsx:26](src/components/Timeline.jsx) — hardcoded `TODAY`
- [src/lib/cala-mock.js:1](src/lib/cala-mock.js) — `const now = '2026-05-24T09:40:00+02:00'`

**Backend action:** ensure `timelineMeta.now` (ISO 8601) is present on every `/plan` response and `generatedAt` on every `/signals` response (already in contract). FE will switch to those in a follow-up — your job is just to make the fields authoritative.

## Gap 7 — Plan-review insertion / shift surface
The `/plan-review` page ([frontend/app/plan-review/page.tsx](frontend/app/plan-review/page.tsx)) renders a new **InsertionShiftPanel** ("URGENT INSERT" + paired "SHIFTED +Xh TO MAKE ROOM" cards) when the response carries `insertion_moves[]`. The legacy Vite planner already gets this data — the rec stage reads `seg.kind === "ins" | "shift"` from `Recommendation.plan` and `Recommendation.moves[]` from `/plan` (see [src/components/Timeline.jsx:503](src/components/Timeline.jsx) and the contract at [API_CONTRACT.md §Recommendation](API_CONTRACT.md)). The Stride plan-review endpoint just needs to surface the same information in the flatter shape the page consumes.

- **FE source today:** the panel is gated on `data.insertion_moves`. Until the field ships, the panel is hidden — no errors, no fallback fixture.
- **Contract:** add to `PlanReviewResponse`:
  ```ts
  insertion_moves: Array<{
    line: string;                 // "14"
    line_avg_oee: number;         // 30-day rolling baseline (0..1)
    inserted: {
      of: string;                 // "ED13LTNN"
      sku_code: string;           // "ED13LTNN"  (shown big in the card)
      sku_name: string | null;    // "Estrella Damm · lata 33cl"
      format: string;             // "33cl"
      units: number;
      duration_minutes: number;
      oee: number;                // 0..1
      oee_delta_vs_line_avg: number;
    };
    shifted: Array<{
      // same fields as `inserted`, plus:
      shift_hours: number;        // positive = pushed later
      reason: string;             // "pushed back to make room for ED13LTNN"
    }>;
  }>;
  ```
- **Derivation (no new model work needed):** for each `Recommendation` accepted into the plan, group `plan[line]` segments where `kind === "ins"` with the consecutive `kind === "shift"` segments on the same line; join each shifted run with the matching entry in `moves[]` (key on `of` + `line`) for `shift_hours` and `reason`; carry `line_avg_oee` from `lineBaseline[line]`; compute `oee_delta_vs_line_avg = oee - line_avg_oee` per run.
- **Acceptance:** when a rec is accepted for an urgent insertion, `/plan-review` returns at least one entry in `insertion_moves` with the inserted run plus every downstream shifted run on the same lane. FE keeps the field optional during rollout so the panel hides cleanly when empty.
- **Type spec mirror:** see the inline `PlanReviewInsertion` definition at the top of [frontend/app/plan-review/page.tsx](frontend/app/plan-review/page.tsx) — keep it in sync with this section until `lib/types.ts` is materialised.

## Gap 8 — Stoppage replan review surface
Clicking **Replan** on the stoppage banner now opens
[src/preview/StoppageReviewLab.jsx](src/preview/StoppageReviewLab.jsx)
(routed through `view='recs'` in `App.jsx`) instead of dropping back on
the queue with a toast. The review surface lists every pushed
production run as a "Shifted +Xh" card and shows the new lane order on
the embedded timeline. The legacy aggregate toast still fires.

- **FE source today:** the shifted run list is computed locally by
  `computeStoppageReplan` in [src/lib/stoppagePlan.js](src/lib/stoppagePlan.js)
  and threaded through `App.jsx`'s `plannerStoppagePreview` state. The
  same shape is now returned by the live backend (Gap 8 backend work
  below), so once the FE swaps `computeStoppageReplan` for the
  `POST /plan/stoppage-replan` response, no shape change is needed.
- **Contract:** `POST /plan/stoppage-replan` adds `shiftedRuns` to the
  response. Full shape lives at
  [API_CONTRACT.md §POST /plan/stoppage-replan](API_CONTRACT.md). One
  entry per pushed production run with `of`, `sku`, `vol`, `oee`,
  `fromStart`, `toStart`, `shiftHours`, `durationDays`, `kind`. Service
  blocks are excluded from `shiftedRuns` but still counted in
  `shiftedCount`.
- **Derivation (no new model work needed):** the new helper
  [`build_stoppage_replan_response`](../app/frontend_payload.py) is the
  single source of truth. The endpoint at
  [app/server.py](../app/server.py) `/plan/stoppage-replan` now
  delegates to it.
- **Acceptance:** posting to `/plan/stoppage-replan` returns a
  `shiftedRuns` array with one entry per non-service segment on the
  stopped lane, each carrying its before/after start and shift hours.
  Existing `plan`, `shiftedCount`, `shiftedHours` fields are
  unchanged. FE keeps the field optional during rollout so the rail
  hides cleanly when empty.

## Out of scope
- Vertical metadata at [linewise/src/lib/calaVerticals.js](src/lib/calaVerticals.js) and `FALLBACK_LINE_RULES` at [linewise/src/lib/lineRules.js](src/lib/lineRules.js) — these are UI-side presentation/fallback config, not server data. Leave alone.
- `?demo=...` URL flags in [src/App.jsx:41-72](src/App.jsx) — deck/screenshot helpers.
- `onLogout` TODO at [src/App.jsx:421](src/App.jsx) — auth is a separate workstream.
- `GET /plan` schema itself — already shipped and matches the contract.

## Acceptance criteria (overall)
1. With `VITE_API_BASE=http://localhost:8000` and the Vite middleware bypassed, the FE runs the full demo flow (urgent order → planner → confirm; stoppage → replan; shift close → handoff; signals in Inbox) without hitting any hardcoded JS data and without console errors.
2. New endpoints validate against the schemas in [API_CONTRACT.md](API_CONTRACT.md). Bump `CONTRACT_VERSION` only if a shape changes.
3. `timelineMeta.now` is populated and current on every `/plan` response so the FE can drop the three hardcoded clocks in a follow-up PR.

## Non-goals
- No frontend changes in this task. FE deletions of `cala-mock.js`, `analogues.js` synthesiser, sessionStorage ledger, and clock constants happen in a follow-up FE PR once endpoints are green.
- No new endpoints beyond the contract. If a gap is found, update [API_CONTRACT.md](API_CONTRACT.md) first.
