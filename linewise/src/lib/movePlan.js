/* movePlan — pure functions for the "Move to another line" flow.
   No React, no DOM; everything operates on the plan's data shapes
   (segments shaped like `{ of, sku, vol, start, w, oee }` and service
   blocks shaped like `{ kind: 'clean'|'maint', start, w }`).

   Two responsibilities:
     1. Compatibility: which lines can run a given format, derived from
        the line→formats matrix.
     2. Preview computation: given a source (line, index) and a
        destination (line, slotIndex), return the modified plan plus a
        ripple summary the UI can render in the post-move pill. */

import { deriveFormat } from '../components/TimelineCard.jsx';

/* Production rules — which trenes can run which can format.
   Mirrors the matrix from the previous RunDetailModal compatible-lines
   section, lifted here so the move flow doesn't depend on the modal. */
export const LINE_FORMATS = {
  '14': new Set(['50cl', '33cl']),
  '17': new Set(['33cl']),
  '19': new Set(['50cl', '33cl', '44cl']),
};

export function isLineCompatible(lineKey, format) {
  if (!format) return true;
  return LINE_FORMATS[lineKey]?.has(format) ?? false;
}

export function incompatibleReason(lineKey, format) {
  const allowed = LINE_FORMATS[lineKey];
  if (!allowed) return null;
  const fmts = [...allowed].join(' / ');
  return `${fmts} only — can't run ${format}`;
}

/* computeMovePreview — given the current plan, the run being moved, and a
   target (lineKey + slotIndex), return:
     - plan: the previewed { lineKey: segment[] }
     - ripple: a summary the UI can render in the post-move pill

   Rules:
     - The source lane keeps its gap (no auto-compaction).
     - The destination lane shifts everything at slotIndex... forward by
       the moved run's duration.
     - The moved run gets a fresh OEE estimate based on its new
       predecessor + destination lane baseline.
     - Service blocks (clean/maint) on the destination ARE pushed too.
       This is a hackathon simplification — in reality those are
       time-locked. Good enough for the demo; we surface push counts so
       the cost is visible. */
export function computeMovePreview({ basePlan, lineBaseline, moving, dest }) {
  const fromLine = moving.fromLine;
  const fromIndex = moving.fromIndex;
  const toLine = dest.lineKey;
  const toIndex = clampSlotIndex(dest.slotIndex, basePlan[toLine]?.length ?? 0);

  // SOURCE — drop the moved run, leave the gap behind.
  const sourceLane = [...(basePlan[fromLine] ?? [])];
  const removedRun = sourceLane[fromIndex];
  if (!removedRun) return null;
  sourceLane.splice(fromIndex, 1);
  const sourceFreedHours = (removedRun.w ?? 0) * 24;

  // DEST — insert at toIndex, push downstream segments forward by run.w.
  // If we're inserting back into the SAME lane, adjust toIndex for the
  // splice we already did so the visual landing matches Maria's intent.
  let destLane = [...(basePlan[toLine] ?? [])];
  let adjustedToIndex = toIndex;
  if (fromLine === toLine) {
    destLane = sourceLane; // sourceLane already has the run removed
    if (toIndex > fromIndex) adjustedToIndex = toIndex - 1;
  }

  const prev = adjustedToIndex > 0 ? destLane[adjustedToIndex - 1] : null;
  const insertedStart = prev ? (prev.start ?? 0) + (prev.w ?? 0) : 0;

  // Shift downstream segments forward.
  const pushAmount = removedRun.w ?? 0;
  let pushedCount = 0;
  for (let i = adjustedToIndex; i < destLane.length; i++) {
    destLane[i] = { ...destLane[i], start: (destLane[i].start ?? 0) + pushAmount };
    pushedCount += 1;
  }

  // Fresh OEE estimate for the moved run on its new lane.
  const newOee = estimateOEE({
    run: removedRun,
    prev,
    baseline: lineBaseline?.[toLine],
  });
  const insertedRun = { ...removedRun, start: insertedStart, oee: newOee };

  destLane.splice(adjustedToIndex, 0, insertedRun);

  // Build the new plan object. For a same-lane move the destLane already
  // started from sourceLane (with the run removed); for cross-lane moves
  // both lanes change independently.
  const plan = fromLine === toLine
    ? { ...basePlan, [toLine]: destLane }
    : { ...basePlan, [fromLine]: sourceLane, [toLine]: destLane };

  const destNext = destLane[adjustedToIndex + 1];

  return {
    plan,
    ripple: {
      runId: removedRun.of,
      fromLine,
      toLine,
      pushedCount,
      pushedHours: pushAmount * 24,
      sourceFreedHours,
      oeeOld: removedRun.oee,
      oeeNew: newOee,
      oeeDelta: newOee - (removedRun.oee ?? newOee),
      destPrev: prev ? (prev.of ?? prev.kind) : null,
      destNext: destNext ? (destNext.of ?? destNext.kind) : null,
      /* Weekly OEE deltas — sum-of-products across the previewed week
         vs the original. Gives Maria a single "is the whole week better
         or worse" number that the per-run estimate alone can't tell her. */
      weekOeeOld: weightedWeekOee(basePlan),
      weekOeeNew: weightedWeekOee(plan),
      /* Format switches on each lane that changed — moves can break a
         same-format run and inject a CIP, or vice versa. */
      formatSwitchesOld: countFormatSwitches(basePlan, fromLine) + (fromLine !== toLine ? countFormatSwitches(basePlan, toLine) : 0),
      formatSwitchesNew: countFormatSwitches(plan, fromLine) + (fromLine !== toLine ? countFormatSwitches(plan, toLine) : 0),
    },
  };
}

/* weightedWeekOee — total productive units / total productive hours,
   approximated as Σ(oee × w) / Σ(w) across all non-service runs in the
   plan. Single scalar that compresses the whole forward plan into one
   "how well will we run this week" number. */
function weightedWeekOee(plan) {
  let weighted = 0;
  let total = 0;
  for (const lane of Object.values(plan ?? {})) {
    for (const seg of lane ?? []) {
      if (seg.kind === 'clean' || seg.kind === 'maint') continue;
      const w = seg.w ?? 0;
      const oee = seg.oee ?? 0;
      weighted += oee * w;
      total += w;
    }
  }
  return total > 0 ? weighted / total : 0;
}

/* countFormatSwitches — how many adjacent run pairs on a lane differ in
   format. Each switch implies a CIP. */
function countFormatSwitches(plan, lineKey) {
  const lane = plan?.[lineKey] ?? [];
  let count = 0;
  let prevFmt = null;
  for (const seg of lane) {
    if (seg.kind === 'clean' || seg.kind === 'maint') { prevFmt = null; continue; }
    const fmt = deriveFormat({ sku: seg.sku, material: seg.of });
    if (prevFmt && fmt && prevFmt !== fmt) count += 1;
    prevFmt = fmt;
  }
  return count;
}

function clampSlotIndex(index, length) {
  if (index == null || index < 0) return 0;
  if (index > length) return length;
  return index;
}

/* estimateOEE — bracketed model that mirrors the modal's whyProse logic.
   Not the real planner's model; designed to produce defensible deltas
   for the demo (same-envase-same-brand > brand-change > format-change >
   post-service). Inputs match what the planner shows in tooltips. */
function estimateOEE({ run, prev, baseline }) {
  if (baseline == null) return run.oee ?? 0.5;
  if (!prev) return baseline; // first run on lane — sits on baseline
  if (prev.kind === 'clean' || prev.kind === 'maint') return baseline - 0.02;

  const prevFmt = deriveFormat({ sku: prev.sku, material: prev.of });
  const runFmt = deriveFormat({ sku: run.sku, material: run.of });
  const sameFmt = prevFmt && runFmt && prevFmt === runFmt;
  const sameBrand = !!prev.of && !!run.of && prev.of.slice(0, 2) === run.of.slice(0, 2);

  if (sameFmt && sameBrand) return baseline + 0.02;
  if (sameFmt) return baseline - 0.01;
  return baseline - 0.04;
}
