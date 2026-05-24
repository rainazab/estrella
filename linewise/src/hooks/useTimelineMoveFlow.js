import { useEffect, useState } from 'react';
import { createElement, Fragment } from 'react';
import RunDetailModal from '../components/RunDetailModal.jsx';
import MoveBanner from '../components/MoveBanner.jsx';
import MoveCalculating from '../components/MoveCalculating.jsx';
import MoveImpactPanel from '../components/MoveImpactPanel.jsx';
import { computeMovePreview, isLineCompatible } from '../lib/movePlan.js';
import { deriveFormat } from '../components/TimelineCard.jsx';

/* useTimelineMoveFlow — shared orchestration for the Timeline + RunDetailModal
   + move-flow behaviour used by both the homepage (App.jsx → Workspace) and
   PlanLab (?lab=plan). Owns:
     - runDetail / moving / moveCalculating / movePending / committedPlan
       state and the derived `effectivePlan = committedPlan ?? basePlan`.
     - The Escape-to-cancel-moving keydown listener.
     - handleMoveDrop with its 1.3s calc flash, pending-preview commit, and
       Confirm/Discard handlers.
     - The RunDetailModal `onMove` handler that snapshots the run into the
       moving state via deriveFormat.

   Returns props split into three buckets so callers can stay terse:
     - `timelineProps` — spread onto <Timeline> (effectivePlan, onRunClick,
       moving, onMoveDrop).
     - `setRunDetail` / `runDetail` — exposed for external callers that need
       to open the modal directly (Inbox draft-panel click, planner's
       "Recalculate & preview" action).
     - `overlays` — ready-to-render JSX fragment with the four modals/banners
       (RunDetailModal, MoveBanner, MoveCalculating, MoveImpactPanel).

   `getOnPreviewInPlanner({ runDetail }) → fn | undefined` is the opt-in App
   uses to inject the planner-preview action onto runs flagged `fromDraft`. */
export function useTimelineMoveFlow({
  data,
  basePlan,
  getOnPreviewInPlanner,
  optimizationContext,
  initialCommittedPlan,
  onMoveAccepted,
  onLedgerEvent,
  onMovePreviewReady,
  onMovePreviewDiscard,
} = {}) {
  const [runDetail, setRunDetail] = useState(null);
  const [moving, setMoving] = useState(null);
  const [moveCalculating, setMoveCalculating] = useState(null);
  const [movePending, setMovePending] = useState(null);
  const [committedPlan, setCommittedPlan] = useState(initialCommittedPlan ?? null);

  /* Esc cancels moving mode. Listening here (not in the timeline) so the
     handler survives across re-renders of the lane components. */
  useEffect(() => {
    if (!moving) return;
    const onKey = (e) => { if (e.key === 'Escape') setMoving(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moving]);

  /* Effective plan — folds any committed move into basePlan. Timeline reads
     from this rather than basePlan directly so a confirmed move sticks
     across renders. */
  const effectivePlan = committedPlan ?? basePlan;

  /* Drop handler — fires the calculate flash and then routes into the
     impact-review panel. We deliberately don't commit the plan until
     after the flash so the "recalculating" moment feels honest. */
  function handleMoveDrop({ lineKey, slotIndex }) {
    if (!moving) return;
    const format = moving.format;
    if (!isLineCompatible(lineKey, format)) return;
    const preview = computeMovePreview({
      basePlan: effectivePlan,
      lineBaseline: data?.lineBaseline,
      moving: { fromLine: moving.fromLine, fromIndex: moving.fromIndex },
      dest: { lineKey, slotIndex },
    });
    if (!preview) return;
    const priorPlan = effectivePlan;
    const movePayload = {
      ...preview,
      priorPlan,
      moving,
      dest: { lineKey, slotIndex },
    };
    const routeToPlanner = onMoveAccepted?.(movePayload) === 'planner';

    setMoveCalculating({
      moving,
      dest: { lineKey, slotIndex },
      preview,
      priorPlan,
      routeToPlanner,
    });
    setMoving(null);
    /* 1.3s matches the urgent-order calculate flash (selectUrgent) so
       both interactions feel like the same product moment. */
    setTimeout(() => {
      setMoveCalculating(null);
      if (!routeToPlanner) setMovePending({ ...preview, priorPlan });
      setCommittedPlan(preview.plan);
      onMovePreviewReady?.(movePayload);
    }, 1300);
  }

  function confirmMove(rationale = 'manual') {
    /* Plan is already committed; just dismiss the review panel. */
    onLedgerEvent?.({
      action: 'confirmMove',
      type: 'manual_move_confirmed',
      summary: `${movePending.ripple.runId} moved from L${movePending.ripple.fromLine} to L${movePending.ripple.toLine}`,
      rationale,
      runId: movePending.ripple.runId,
      fromLine: movePending.ripple.fromLine,
      toLine: movePending.ripple.toLine,
      ripple: movePending.ripple,
    });
    setMovePending(null);
  }

  function discardMove() {
    if (!movePending) return;
    setCommittedPlan(
      movePending.priorPlan === basePlan ? null : movePending.priorPlan,
    );
    setMovePending(null);
    onMovePreviewDiscard?.(movePending);
  }

  function openRunFromTimeline(payload) {
    setRunDetail(payload);
  }

  function beginMove({ lineKey, fromIndex, run, format } = {}) {
    if (!lineKey) return false;
    const lane = effectivePlan?.[lineKey] ?? [];
    const idx = Number.isInteger(fromIndex)
      ? fromIndex
      : lane.findIndex((s) => s.of === run?.of);
    if (idx < 0 || !lane[idx]) return false;
    const sourceRun = run ?? lane[idx];
    setMoving({
      run: sourceRun,
      fromLine: lineKey,
      fromIndex: idx,
      format: format || deriveFormat({ sku: sourceRun.sku, material: sourceRun.of }),
    });
    setRunDetail(null);
    return true;
  }

  function onRunDetailMove() {
    /* Entering moving mode requires the run's source index in its lane.
       Prefer the index captured by the timeline so duplicate OFs don't
       move the first matching run by accident. */
    const seg = runDetail?.seg;
    const lineKey = runDetail?.lineKey;
    if (!seg || !lineKey) return;
    const lane = effectivePlan?.[lineKey] ?? [];
    const fromIndex = Number.isInteger(runDetail?.index)
      ? runDetail.index
      : lane.findIndex((s) => s.of === seg.material);
    if (fromIndex < 0) return;
    beginMove({
      lineKey,
      fromIndex,
      run: lane[fromIndex],
      format: seg.format || deriveFormat({ sku: seg.sku, material: seg.material }),
    });
  }

  const onPreviewInPlanner = typeof getOnPreviewInPlanner === 'function'
    ? getOnPreviewInPlanner({ runDetail })
    : undefined;

  const overlays = createElement(
    Fragment,
    null,
    createElement(RunDetailModal, {
      open: !!runDetail,
      run: runDetail?.seg,
      prev: runDetail?.prev,
      next: runDetail?.next,
      lineKey: runDetail?.lineKey,
      lineBaseline: runDetail?.baseline,
      state: runDetail?.state,
      showMoveAction: !runDetail?.fromDraft,
      optimizationContext: runDetail?.optimizationContext ?? optimizationContext,
      onClose: () => setRunDetail(null),
      onPreviewInPlanner,
      onMove: onRunDetailMove,
    }),
    moving && createElement(MoveBanner, {
      moving,
      onCancel: () => setMoving(null),
    }),
    moveCalculating && !moveCalculating.routeToPlanner && createElement(MoveCalculating, {
      moving: moveCalculating.moving,
      dest: moveCalculating.dest,
    }),
    movePending && createElement(MoveImpactPanel, {
      preview: movePending,
      onConfirm: confirmMove,
      onDiscard: discardMove,
    }),
  );

  return {
    /* Spread onto <Timeline> */
    timelineProps: {
      effectivePlan,
      onRunClick: openRunFromTimeline,
      moving,
      onMoveDrop: handleMoveDrop,
    },
    beginMove,
    /* Useful for callers that need to open the modal from outside the
       timeline (Inbox draft panel, planner preview action). */
    runDetail,
    setRunDetail,
    effectivePlan,
    /* Exposed for callers (App.jsx startReplan) that need to commit a
       new plan from outside the move flow — e.g. the stoppage replan
       which shifts a whole lane forward. */
    setCommittedPlan,
    /* Ready-to-render JSX */
    overlays,
  };
}
