import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { usePlan } from '../hooks/usePlan.js';
import { useTimelineMoveFlow } from '../hooks/useTimelineMoveFlow.js';
import { buildAnalogueIndex, evidenceVerdict } from '../lib/analogues.js';
import AnalogueModal from '../components/AnalogueModal.jsx';
import InfoPopover from '../components/InfoPopover.jsx';
import ProvenanceModal from '../components/ProvenanceModal.jsx';
import Timeline from '../components/Timeline.jsx';
import { buildOptimizationContext } from '../lib/optimizationContext.js';
import { signalToCitation, worldSignals } from '../lib/cala-mock.js';
import { getCalaVertical } from '../lib/calaVerticals.js';
import { deriveFormat } from '../components/TimelineCard.jsx';
import './plan-lab.css';

/* PlanLab — /?lab=plan
   Reshaped "Proposed plan" view: small strategy cards on the left, the
   headline impact panel up top with the "Why this recommendation" content
   folded into an inline accordion (no right-side drawer), and a simple
   before/after timeline below. Built as a lab so we can compare against
   the current narrow-column RecommendationPanel without touching App.jsx. */
export default function PlanLab({
  data: dataProp,
  order: orderProp,
  initialMovePreview,
  autoOpenOrderOf,
  onBack,
  onSaveDraft,
  onApplyPlan,
  onSendReport,
  reportUrl = '/reports/planning-report-one-pager.pdf',
} = {}) {
  /* Standalone (?lab=plan) fetches its own data; when embedded in App
     we receive data/order as props and skip the fetch. */
  const plan = usePlan();
  const data = dataProp ?? plan.data;
  const loading = !dataProp && plan.loading;
  const error = !dataProp ? plan.error : null;

  const [activeId, setActiveId] = useState('oee');
  const [whyOpen, setWhyOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [manualSlot, setManualSlot] = useState(null); // null | manualSlot key
  const [manualPreview, setManualPreview] = useState(initialMovePreview ?? null);
  const [mode, setMode] = useState(initialMovePreview ? 'manual' : 'auto'); // 'auto' | 'manual'
  const [zoom, setZoom] = useState('month');
  const [timelineExpanded, setTimelineExpanded] = useState(false);
  const [actionDialog, setActionDialog] = useState(null); // null | 'cancel' | 'draft' | 'report' | 'apply'
  const [footerStatus, setFooterStatus] = useState('Live · synced 7m ago');
  const [timelineFocus, setTimelineFocus] = useState(null);
  const [calaOpen, setCalaOpen] = useState(false);
  const pendingManualSlotRef = useRef(null);
  const autoOpenedRef = useRef(null);

  /* Derive the base plan (rec.plan) before guards so the shared
     useTimelineMoveFlow hook can be called unconditionally. It tolerates an
     undefined basePlan during the loading window. */
  const options = data ? buildOptions(data) : [];
  const active = data ? (options.find((o) => o.id === activeId) || options[0]) : null;
  const manualEntry = data && manualSlot && !manualPreview ? data.manualSlots[manualSlot] : null;
  const activeRecKey = manualEntry?.recKey || active?.recKey;
  const order = orderProp ?? data?.urgentOrders?.[0];
  const rawRec = data ? data.recommendations[activeRecKey] : null;
  const rec = rawRec ? retargetInsertedOrder(rawRec, order, data?.urgentOrders?.[0]) : null;

  /* Homepage Timeline interactions — click → modal, modal "Move" → moving,
     drop on lane → calc flash → pending preview → confirm/discard. Mirrors
     App.jsx's flow exactly so the planner view behaves identically. */
  const { timelineProps, overlays, beginMove, setRunDetail } = useTimelineMoveFlow({
    data,
    basePlan: rec?.plan,
    initialCommittedPlan: initialMovePreview?.plan,
    optimizationContext: data && active ? buildOptimizationContext(data, active.id, activeRecKey) : null,
    onMovePreviewReady: (preview) => {
      setMode('manual');
      setManualPreview(preview);
      setManualSlot(pendingManualSlotRef.current);
      setWhyOpen(false);
      pendingManualSlotRef.current = null;
    },
    onMovePreviewDiscard: () => {
      setManualPreview(null);
      setManualSlot(null);
      pendingManualSlotRef.current = null;
    },
  });

  useEffect(() => {
    if (!timelineExpanded) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKeyDown(event) {
      if (event.key === 'Escape') setTimelineExpanded(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [timelineExpanded]);

  useEffect(() => {
    if (!autoOpenOrderOf || !timelineProps.effectivePlan || !data) return;
    const target = findRunInPlan(timelineProps.effectivePlan, autoOpenOrderOf);
    if (!target) return;

    const openKey = String(autoOpenOrderOf);
    if (autoOpenedRef.current === openKey) return;
    autoOpenedRef.current = openKey;

    const focus = {
      of: autoOpenOrderOf,
      lineKey: target.lineKey,
      index: target.index,
      token: Date.now(),
    };
    setTimelineExpanded(false);
    setWhyOpen(false);
    setZoom('week');
    setTimelineFocus(focus);

    const detail = runDetailFromPlanTarget({
      target,
      plan: timelineProps.effectivePlan,
      data,
    });
    setRunDetail(detail);

    const reopenIfRenderInterrupted = () => {
      if (!document.querySelector('.rd-overlay')) setRunDetail(detail);
    };
    const raf = window.requestAnimationFrame(reopenIfRenderInterrupted);
    const retry = window.setTimeout(reopenIfRenderInterrupted, 350);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(retry);
    };
  }, [activeRecKey, autoOpenOrderOf, data, setRunDetail, timelineProps.effectivePlan]);

  if (loading) return <div className="pl-loading">Loading…</div>;
  if (error)   return <div className="pl-loading">Error: {String(error.message || error)}</div>;
  if (!data)   return <div className="pl-loading">Loading…</div>;

  const rows = buildAnalogueIndex(activeRecKey, rec.evidence);
  const verdict = evidenceVerdict(rec, rows);
  const recommendedId = 'oee';

  const verdictTone = verdict.tone === 'bad' ? 'bad' : verdict.tone === 'warn' ? 'mid' : 'good';
  const recoveryHours = rec.recovery?.hours ? `${rec.recovery.hours}h` : '—';
  const friendlySku = formatSku(order.sku);
  const isMoveReview = !!initialMovePreview;
  const orderTone = isMoveReview
    ? 'moved'
    : order.status === 'queued' || order.status === 'scheduled' ? 'queued' : 'urgent';
  const orderStatusLabel = isMoveReview
    ? 'MOVED ORDER'
    : orderTone === 'queued' ? 'QUEUED' : 'URGENT';
  const pros = derivePros(rec);
  const cons = deriveCons(rec, active);
  const rationale = stripHtml(rec.evidence.reason);
  const manualMoveSource = findUrgentMoveSource(timelineProps.effectivePlan, order);
  const manualRipple = mode === 'manual' ? manualPreview?.ripple : null;
  const planTitle = manualRipple
    ? `Manual placement for ${manualRipple.runId}`
    : mode === 'manual' && manualEntry
      ? manualEntry.label
      : active.title;
  const actionMetrics = manualRipple
    ? [
        { label: 'Run OEE', value: `${fmtOee(manualRipple.oeeOld)} → ${fmtOee(manualRipple.oeeNew)}`, tone: toneFromPts(ptsFromOee(manualRipple.oeeNew, manualRipple.oeeOld)) },
        { label: 'Week OEE', value: `${fmtOee(manualRipple.weekOeeOld)} → ${fmtOee(manualRipple.weekOeeNew)}`, tone: toneFromPts(ptsFromOee(manualRipple.weekOeeNew, manualRipple.weekOeeOld)) },
        { label: 'Ripple', value: manualRipple.pushedCount > 0 ? `${manualRipple.pushedCount} pushed` : 'none', tone: manualRipple.pushedCount > 0 ? 'mid' : 'good' },
        { label: 'Service', value: (manualRipple.collisions?.length ?? 0) > 0 ? `${manualRipple.collisions.length} affected` : 'clear', tone: (manualRipple.collisions?.length ?? 0) > 0 ? 'bad' : 'good' },
      ]
    : [
        { label: 'OEE', value: rec.oeeDelta, tone: rec.oeeGood ? 'good' : 'bad' },
        { label: 'Due date', value: rec.deadline, tone: rec.deadline === 'on time' ? 'good' : 'mid' },
        { label: 'Orders moved', value: rec.ordersMoved, tone: rec.ordersMoved === 0 ? 'good' : 'mid' },
        { label: 'Recovery', value: recoveryHours, tone: 'quiet' },
      ];
  const impactTone = manualRipple
    ? toneForManualRipple(manualRipple)
    : mode === 'manual' && !manualEntry
      ? 'quiet'
      : manualEntry ? 'mid' : active.tone;
  const moveReview = manualRipple ? buildMoveReview(manualRipple) : null;
  const calaFactors = buildPlanCalaFactors({
    data,
    order,
    plan: timelineProps.effectivePlan,
  });

  function returnHome() {
    if (typeof onBack === 'function') {
      onBack();
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.delete('lab');
    url.searchParams.delete('deck');
    window.location.assign(`${url.pathname}${url.search}${url.hash}`);
  }

  function closeActionDialog() {
    setActionDialog(null);
  }

  function confirmActionDialog() {
    const payload = {
      title: planTitle,
      metrics: actionMetrics,
      plan: timelineProps.effectivePlan,
      order,
      mode,
    };
    if (actionDialog === 'cancel') {
      closeActionDialog();
      returnHome();
      return;
    }
    if (actionDialog === 'draft') {
      onSaveDraft?.(payload);
      setFooterStatus('Draft saved just now');
      closeActionDialog();
      return;
    }
    if (actionDialog === 'report') {
      onSendReport?.(payload);
      downloadReport(reportUrl);
      setFooterStatus('Report PDF downloaded just now');
      closeActionDialog();
      return;
    }
    if (actionDialog === 'apply') {
      setFooterStatus('Plan applied just now');
      closeActionDialog();
      onApplyPlan?.(payload);
    }
  }

  function startManualOrderDrag(e) {
    if (!manualMoveSource) {
      e.preventDefault();
      return;
    }
    const started = beginManualOrderMove();
    if (!started) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData('text/plain', `move:${order.of}`);
    e.dataTransfer.effectAllowed = 'move';
  }

  function beginManualOrderMove() {
    if (!manualMoveSource) return false;
    return beginMove({
      lineKey: manualMoveSource.lineKey,
      fromIndex: manualMoveSource.index,
      run: manualMoveSource.run,
      format: deriveFormat({
        sku: order.sku || manualMoveSource.run.sku,
        material: order.of || manualMoveSource.run.of,
      }),
    });
  }

  function handlePlannerMoveDrop(drop) {
    const slotKey = manualSlotKeyForDrop({
      data,
      plan: timelineProps.effectivePlan,
      moving: timelineProps.moving,
      drop,
    });
    pendingManualSlotRef.current = slotKey;
    setMode('manual');
    setManualSlot(null);
    setManualPreview(null);
    setWhyOpen(false);
    timelineProps.onMoveDrop?.(drop);
  }

  return (
    <div className="pl-root">
      {/* Order banner — normal page keeps the original decision target. */}
      <header className={`pl-order pl-order-${orderTone}`}>
        <span className={`pl-order-tag pl-order-tag-${orderTone}`}>{orderStatusLabel}</span>
        <div className="pl-order-main">
          <b>{order.of}</b>
          <span>{friendlySku} · {order.units.toLocaleString()} un · {order.hl} hl</span>
        </div>
        <div className="pl-order-meta">
          {isMoveReview && moveReview ? (
            <MoveOrderMeta review={moveReview} />
          ) : (
            <>
              <span>Due <b>{order.due}</b></span>
              <span>Decision by <b>17:00 today</b></span>
            </>
          )}
        </div>
      </header>

      <div className={`pl-grid${isMoveReview ? ' pl-grid-move' : ''}`}>
        {isMoveReview && moveReview ? (
          <MoveReviewRail review={moveReview} />
        ) : (
          <aside className="pl-rail" aria-label="Strategies">
            <div className="pl-rail-list">
              {options.map((opt) => {
                const r = data.recommendations[opt.recKey];
                const selected = !manualEntry && active.id === opt.id;
                const recoveryStr = r.recovery?.hours ? `${r.recovery.hours}h` : '—';
                return (
                  <motion.button
                    key={opt.id}
                    layout
                    transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                    type="button"
                    className={`pl-card${selected ? ' on' : ''}`}
                    onClick={() => {
                      setActiveId(opt.id);
                      setManualSlot(null);
                      setManualPreview(null);
                      pendingManualSlotRef.current = null;
                      setWhyOpen(false);
                    }}
                    aria-pressed={selected}
                  >
                    {selected && (
                      <motion.span
                        layoutId="pl-card-indicator"
                        className="pl-card-indicator"
                        aria-hidden="true"
                        transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                      />
                    )}
                    <div className="pl-card-top">
                      <span className="pl-card-name">{opt.title}</span>
                      {opt.id === recommendedId && <span className="pl-card-star" title="Stride recommends">★</span>}
                    </div>
                    <span className="pl-card-desc">{opt.description}</span>
                    <div className="pl-card-kpis" role="group" aria-label={`${opt.title} key metrics`}>
                      <div className="pl-card-kpi">
                        <span>OEE</span>
                        <b>{r.oeeDelta}</b>
                      </div>
                      <div className="pl-card-kpi">
                        <span>Due</span>
                        <b>{r.deadline}</b>
                      </div>
                      <div className="pl-card-kpi">
                        <span>Moves</span>
                        <b>{r.ordersMoved}</b>
                      </div>
                      <div className="pl-card-kpi">
                        <span>Recovery</span>
                        <b>{recoveryStr}</b>
                      </div>
                    </div>
                  </motion.button>
                );
              })}
            </div>
          </aside>
        )}

        <main className="pl-main">
          <motion.section
            className={`pl-impact tone-${impactTone}${isMoveReview ? ' pl-impact-move' : ''}`}
            layout
          >
            <div className="pl-impact-h">
              <div className="pl-impact-title">
                <div className="pl-kicker-row">
                  <span className="pl-kicker">
                    {isMoveReview
                      ? 'Move review'
                      : manualRipple
                      ? 'Calculated impact'
                      : mode === 'manual'
                      ? (manualEntry ? 'Manual override' : 'Manual mode')
                      : 'Impact preview'}
                  </span>
                </div>
                <h2>
                  {isMoveReview && moveReview
                    ? <><code className="pl-h-code">{moveReview.runId}</code>: {moveReview.headline}</>
                    : manualRipple
                    ? <>Impact of <code className="pl-h-code">{manualRipple.runId}</code> on L{manualRipple.toLine}</>
                    : mode === 'manual' && !manualEntry
                    ? <>Place <code className="pl-h-code">{order.of}</code> yourself</>
                    : manualEntry ? manualEntry.label : active.title}
                  {mode === 'auto' && !manualEntry && active.id === recommendedId && <span className="pl-star" title="Stride recommends">★</span>}
                </h2>
                {isMoveReview && moveReview ? (
                  <span className="pl-impact-sub">{moveReview.slotText}</span>
                ) : manualRipple ? (
                  <span className="pl-impact-sub">Recalculated after manual placement · Strategy on hold: {active.title}</span>
                ) : mode === 'manual' && manualEntry && (
                  <span className="pl-impact-sub">Strategy on hold: {active.title}</span>
                )}
              </div>

              {!isMoveReview && (
                <div className="pl-mode-toggle" role="tablist" aria-label="Planning mode">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mode === 'auto'}
                    className={mode === 'auto' ? 'on' : ''}
                    onClick={() => { setMode('auto'); setManualSlot(null); setManualPreview(null); pendingManualSlotRef.current = null; }}
                  >
                    Auto
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mode === 'manual'}
                    className={mode === 'manual' ? 'on' : ''}
                    onClick={() => setMode('manual')}
                  >
                    Manual
                  </button>
                </div>
              )}
            </div>

            {mode === 'manual' && !manualEntry && !manualRipple ? (
              <div className="pl-manual-body">
                <div className="pl-manual-prompt">
                  <b>Place the order on a line below.</b>
                  <span>Stride will compute the impact for whichever slot you choose.</span>
                </div>
                <button
                  type="button"
                  className={`pl-chip pl-chip-lg${manualMoveSource ? '' : ' is-disabled'}`}
                  disabled={!manualMoveSource}
                  draggable={!!manualMoveSource}
                  onClick={beginManualOrderMove}
                  onDragStart={startManualOrderDrag}
                  aria-label={`Place ${order.of}`}
                  title={`${order.of} · ${friendlySku}`}
                >
                  <span className="pl-chip-of">{order.of}</span>
                  <span className="pl-chip-sku">{friendlySku}</span>
                </button>
              </div>
            ) : manualRipple ? (
              <ManualImpactBody
                ripple={manualRipple}
                active={active}
                moveReview={isMoveReview ? moveReview : null}
                onClear={() => {
                  setManualPreview(null);
                  setManualSlot(null);
                  pendingManualSlotRef.current = null;
                }}
              />
            ) : (
              <div className="pl-impact-body">
                <div className="pl-impact-main">
                  <p className="pl-rationale">{rationale}</p>
                  {calaFactors.signals.length > 0 && (
                    <>
                      <button
                        type="button"
                        className="pl-cala-used"
                        onClick={() => setCalaOpen(true)}
                      >
                        <span className="pl-cala-used-k">via Cala AI</span>
                        <b>{calaFactors.signals.length} external {calaFactors.signals.length === 1 ? 'factor' : 'factors'} considered</b>
                        <span>{formatPlanCalaUnits(calaFactors.totalUnits)} exposed</span>
                      </button>
                      <ProvenanceModal
                        open={calaOpen}
                        citations={calaFactors.signals.map((signal) => signalToCitation(signal))}
                        title="Cala factors used"
                        showPreviewActions={false}
                        onClose={() => setCalaOpen(false)}
                      >
                        <PlanCalaModalSummary factors={calaFactors} />
                      </ProvenanceModal>
                    </>
                  )}
                  <div className="pl-kpi-row" role="group" aria-label="Key impact">
                    <KpiCard
                      label="OEE"
                      value={rec.oeeDelta}
                      tone={rec.oeeGood ? 'good' : 'bad'}
                      description="Points vs. the naive slot estimate."
                      info="Predicted change in Overall Equipment Effectiveness vs. the naive slot — based on historical analogue runs on the chosen line."
                    />
                    <KpiCard
                      label="Due date"
                      value={rec.deadline}
                      tone={rec.deadline === 'on time' ? 'good' : 'mid'}
                      description="Impact on the promised delivery."
                      info="How this strategy affects the urgent order's promised delivery date. 'On time' means it ships by the due date; '+1 day' means it slips by a day."
                    />
                    <KpiCard
                      label="Orders moved"
                      value={rec.ordersMoved}
                      tone={rec.ordersMoved === 0 ? 'good' : 'mid'}
                      description="Existing runs re-sequenced."
                      info="Number of already-scheduled orders that would need to be re-sequenced to accommodate this insertion. Zero means no disruption to the existing plan."
                    />
                    <KpiCard
                      label="Recovery"
                      value={recoveryHours}
                      tone="quiet"
                      description="Time to return to baseline OEE."
                      info="Estimated time to return the line to its baseline OEE after the insertion — derived from how long the analogue runs took to stabilise."
                    />
                  </div>

                  {mode === 'manual' && manualEntry && (
                    <button
                      className="pl-manual-clear"
                      type="button"
                      onClick={() => setManualSlot(null)}
                    >
                      Clear this slot · drop somewhere else ×
                    </button>
                  )}
                </div>

                <aside className="pl-impact-side" aria-label="Why and tradeoffs">
                  <div className={`pl-verdict v-${verdictTone}`}>
                    <span className="pl-verdict-kicker">Why this recommendation</span>
                    <span className="pl-verdict-line">
                      {verdict.headline || `${rec.evidence.n} analogues`}
                    </span>
                    <ul className="pl-bullets">
                      {pros.map((p, i) => (
                        <li key={i}>{p}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="pl-verdict pl-tradeoff-callout">
                    <span className="pl-verdict-kicker">Tradeoffs</span>
                    <span className="pl-verdict-line">{active.tradeoff}</span>
                    <ul className="pl-bullets">
                      {cons.map((c, i) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  </div>

                  <button
                    className="pl-open-evidence pl-open-evidence-side"
                    type="button"
                    onClick={() => setWhyOpen(true)}
                    aria-haspopup="dialog"
                  >
                    See full evidence <span aria-hidden="true">→</span>
                  </button>
                </aside>
              </div>
            )}

          </motion.section>

          {/* Timeline — homepage component (axis, lane scroll, drop zones) */}
          <AnimatePresence>
            {timelineExpanded && (
              <motion.button
                className="pl-fullscreen-scrim"
                type="button"
                aria-label="Exit timeline fullscreen"
                onClick={() => setTimelineExpanded(false)}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              />
            )}
          </AnimatePresence>
          <motion.section
            layout
            className={`pl-timeline pl-timeline-full${timelineExpanded ? ' is-fullscreen' : ''}`}
            transition={{ type: 'spring', stiffness: 280, damping: 30 }}
          >
            <div className="pl-timeline-h">
              <span>
                Timeline
                {isMoveReview ? <em className="pl-manual-tag"> · before / after review</em> : manualEntry && <em className="pl-manual-tag">· manual override</em>}
              </span>
              <div className="pl-timeline-actions">
                <div className="zoom-ctl" role="tablist" aria-label="Timeline zoom">
                  {['week', 'month', 'quarter'].map((z) => (
                    <button
                      key={z}
                      type="button"
                      role="tab"
                      aria-selected={zoom === z}
                      className={zoom === z ? 'on' : ''}
                      onClick={() => setZoom(z)}
                    >
                      {z[0].toUpperCase() + z.slice(1)}
                    </button>
                  ))}
                </div>
                <button
                  className="pl-fullscreen-btn"
                  type="button"
                  aria-pressed={timelineExpanded}
                  onClick={() => setTimelineExpanded((expanded) => !expanded)}
                  title={timelineExpanded ? 'Exit fullscreen' : 'Open timeline fullscreen'}
                >
                  <span className="pl-fullscreen-ic" aria-hidden="true" />
                  {timelineExpanded ? 'Exit' : 'Fullscreen'}
                </button>
              </div>
            </div>

            {timelineExpanded && (
              <div className="pl-fullscreen-context">
                <header className={`pl-order pl-order-mini pl-order-${orderTone}`}>
                  <span className={`pl-order-tag pl-order-tag-${orderTone}`}>{orderStatusLabel}</span>
                  <div className="pl-order-main">
                    <b>{order.of}</b>
                    <span>{friendlySku} · {order.units.toLocaleString()} un · {order.hl} hl</span>
                  </div>
                  <div className="pl-order-meta">
                    {isMoveReview && moveReview ? (
                      <MoveOrderMeta review={moveReview} />
                    ) : (
                      <>
                        <span>Due <b>{order.due}</b></span>
                        <span>Decision by <b>17:00 today</b></span>
                      </>
                    )}
                  </div>
                </header>

                {isMoveReview && moveReview ? (
                  <MoveChoiceSummary review={moveReview} ripple={manualRipple} />
                ) : (
                  <ChoiceSummary
                    active={active}
                    rec={rec}
                    manualEntry={manualEntry}
                    mode={mode}
                    recommended={mode === 'auto' && !manualEntry && active.id === recommendedId}
                    recoveryHours={recoveryHours}
                  />
                )}
              </div>
            )}

            <Timeline
              data={data}
              mode="default"
              zoom={zoom}
              focusRun={timelineFocus}
              {...timelineProps}
              onMoveDrop={handlePlannerMoveDrop}
            />
          </motion.section>
        </main>
      </div>

      <footer className="pl-foot">
        <button className="pl-btn-ghost" type="button" onClick={() => setActionDialog('cancel')}>Cancel</button>
        <span className="pl-live">● {footerStatus}</span>
        <div className="pl-foot-actions">
          <button className="pl-btn-secondary" type="button" onClick={() => setActionDialog('draft')}>Save draft</button>
          <button className="pl-btn-secondary" type="button" onClick={() => setActionDialog('report')}>Download report</button>
          <button className="pl-btn-primary" type="button" onClick={() => setActionDialog('apply')}>Apply this plan</button>
        </div>
      </footer>

      <AnimatePresence>
        {actionDialog && (
          <PlanActionDialog
            key={actionDialog}
            type={actionDialog}
            title={planTitle}
            metrics={actionMetrics}
            onCancel={closeActionDialog}
            onConfirm={confirmActionDialog}
          />
        )}
      </AnimatePresence>

      <WhyDrawer
        open={whyOpen}
        rec={rec}
        verdict={verdict}
        verdictTone={verdictTone}
        title={manualEntry?.label || active.title}
        subtitle={manualEntry ? 'Manual override' : `${rec.line} · ${rec.position}`}
        recoveryHours={recoveryHours}
        tradeoff={active.tradeoff}
        onClose={() => setWhyOpen(false)}
        onOpenAnalogues={() => { setWhyOpen(false); setModalOpen(true); }}
      />

      <AnimatePresence>
        {modalOpen && (
          <AnalogueModal
            key="pl-modal"
            recKey={activeRecKey}
            rec={rec}
            order={order}
            onClose={() => setModalOpen(false)}
          />
        )}
      </AnimatePresence>

      {overlays}
    </div>
  );
}

function PlanCalaModalSummary({ factors }) {
  const meta = getCalaVertical(factors.signals[0]?.vertical);
  return (
    <section className={`news-modal-impact ${meta.accentClass}`} aria-label="Cala planning impact">
      <div className="news-modal-metric">
        <span>Total exposed volume</span>
        <b>{formatPlanCalaUnits(factors.totalUnits)}</b>
      </div>
      <div className="news-modal-metric">
        <span>Impacted OFs</span>
        <b>{factors.orderCount}</b>
      </div>
      <div className="news-modal-list">
        {factors.orders.slice(0, 8).map((order) => (
          <span key={order.of}>
            <b>{order.of}</b>
            <em>{formatPlanCalaUnits(order.units)}</em>
            {order.line && <small>L{order.line}</small>}
          </span>
        ))}
      </div>
    </section>
  );
}

function PlanActionDialog({ type, title, metrics, onCancel, onConfirm }) {
  const copy = {
    cancel: {
      eyebrow: 'Leave planning',
      heading: 'Discard this planning session?',
      body: 'Your current preview will be closed and you will return to the homepage.',
      confirm: 'Leave planner',
      tone: 'mid',
    },
    draft: {
      eyebrow: 'Save draft',
      heading: 'Save this plan as a draft?',
      body: 'The proposal stays available for review without changing the live schedule.',
      confirm: 'Save draft',
      tone: 'good',
    },
    report: {
      eyebrow: 'Download report',
      heading: 'Download this planning report?',
      body: 'Create a one-page PDF with the selected plan, key KPIs, risk checks, and tradeoffs. The live schedule stays unchanged.',
      confirm: 'Download PDF',
      tone: 'good',
    },
    apply: {
      eyebrow: 'Apply plan',
      heading: 'Apply this plan to the live schedule?',
      body: 'Review the key KPIs before committing this plan back to the homepage timeline.',
      confirm: 'Apply plan',
      tone: 'brand',
    },
  }[type];

  return (
    <motion.div
      className="pl-action-scrim"
      role="presentation"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <motion.section
        className={`pl-action-dialog tone-${copy.tone}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="pl-action-title"
        aria-describedby="pl-action-body"
        initial={{ y: 12, opacity: 0, scale: 0.98 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 8, opacity: 0, scale: 0.98 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
      >
        <header className="pl-action-head">
          <div>
            <span className="pl-kicker">{copy.eyebrow}</span>
            <h2 id="pl-action-title">{copy.heading}</h2>
            <p id="pl-action-body">{copy.body}</p>
          </div>
          <button className="pl-action-close" type="button" onClick={onCancel} aria-label="Close">×</button>
        </header>

        <section className="pl-action-choice" aria-label="Selected plan">
          <span>Selected plan</span>
          <b>{title}</b>
        </section>

        {(type === 'draft' || type === 'report' || type === 'apply') && (
          <div className="pl-action-kpis" aria-label="Key KPIs">
            {metrics.map((metric) => (
              <div key={metric.label} className={`pl-action-kpi t-${metric.tone}`}>
                <span>{metric.label}</span>
                <b>{metric.value}</b>
              </div>
            ))}
          </div>
        )}

        <footer className="pl-action-foot">
          <button className="rd-btn rd-btn-ghost" type="button" onClick={onCancel}>Cancel</button>
          <button className="rd-btn rd-btn-primary" type="button" onClick={onConfirm}>{copy.confirm}</button>
        </footer>
      </motion.section>
    </motion.div>
  );
}

function downloadReport(reportUrl) {
  if (!reportUrl || typeof document === 'undefined') return;
  const link = document.createElement('a');
  link.href = reportUrl;
  link.download = 'Stride-planning-report.pdf';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function ChoiceSummary({ active, rec, manualEntry, mode, recommended, recoveryHours }) {
  const title = mode === 'manual'
    ? (manualEntry ? manualEntry.label : 'Manual placement')
    : active.title;
  return (
    <section className={`pl-choice-summary tone-${manualEntry ? 'mid' : active.tone}`} aria-label="Chosen optimisation">
      <div className="pl-choice-head">
        <span>Chosen optimisation</span>
        {recommended && <b>Stride pick</b>}
      </div>
      <div className="pl-choice-title">
        {title}
        {recommended && <span aria-hidden="true">★</span>}
      </div>
      <div className="pl-choice-metrics" aria-label={`${title} metrics`}>
        <span><b>{rec.oeeDelta}</b> OEE</span>
        <span><b>{rec.deadline}</b> due</span>
        <span><b>{rec.ordersMoved}</b> moved</span>
        <span><b>{recoveryHours}</b> recovery</span>
      </div>
    </section>
  );
}

function MoveReviewRail({ review }) {
  const sameLine = review.beforeLine === review.afterLine;

  return (
    <aside className="pl-move-rail" aria-label="Move before and after">
      <div className="pl-move-map">
        <div className="pl-move-map-head">
          <span>Move path</span>
          {sameLine && <b>Same line</b>}
        </div>
        <div className="pl-move-step">
          <span className="pl-move-dot" aria-hidden="true" />
          <div className="pl-move-copy">
            <span className="pl-move-kicker">Before</span>
            <b>{review.beforeLine}</b>
            <small>{review.beforeText}</small>
          </div>
        </div>
        <div className="pl-move-connector" aria-hidden="true">
          <span />
        </div>
        <div className="pl-move-step is-after">
          <span className="pl-move-dot" aria-hidden="true" />
          <div className="pl-move-copy">
            <span className="pl-move-kicker">After</span>
            <b>{review.afterLine}</b>
            <small>{review.afterText}</small>
          </div>
        </div>
      </div>
    </aside>
  );
}

function MoveChoiceSummary({ review, ripple }) {
  return (
    <section className="pl-choice-summary tone-mid" aria-label="Move summary">
      <div className="pl-choice-head">
        <span>Move review</span>
        <b>{review.headline}</b>
      </div>
      <div className="pl-choice-title">{review.runId}</div>
      <div className="pl-choice-metrics" aria-label={`${review.runId} move metrics`}>
        <span><b>{ripple?.pushedCount ?? 0}</b> pushed</span>
        <span><b>{fmtHours(ripple?.sourceFreedHours)}</b> freed</span>
        <span><b>{ripple?.collisions?.length ?? 0}</b> risks</span>
      </div>
    </section>
  );
}

function MoveOrderMeta({ review }) {
  return (
    <>
      <span className="pl-order-meta-item">
        <span className="pl-order-meta-label">Before</span>
        <b>{review.beforeLine}</b>
        <small>{review.beforeText}</small>
      </span>
      <span className="pl-order-meta-item">
        <span className="pl-order-meta-label">After</span>
        <b>{review.afterLine}</b>
        <small>{review.afterText.replace(/\.$/, '')}</small>
      </span>
    </>
  );
}

function ManualImpactBody({ ripple, active, moveReview, onClear }) {
  const runDelta = ptsFromOee(ripple.oeeNew, ripple.oeeOld);
  const weekDelta = ptsFromOee(ripple.weekOeeNew, ripple.weekOeeOld);
  const switchDelta = (ripple.formatSwitchesNew ?? 0) - (ripple.formatSwitchesOld ?? 0);
  const collisions = ripple.collisions ?? [];
  const deliverySafe = collisions.length === 0;
  const isMoveReview = !!moveReview;

  return (
    <div className="pl-impact-body pl-impact-body-manual">
      <div className="pl-impact-main">
        <p className="pl-rationale">
          {isMoveReview ? (
            <>
              The order moved from {moveReview.beforeLine} to {moveReview.afterLine}.
              {' '}{moveReview.slotText}
            </>
          ) : (
            <>
              Manual placement recalculated against the new predecessor on L{ripple.toLine}.
              {ripple.destPrev ? <> Inserted after {ripple.destPrev}{ripple.destNext ? ` before ${ripple.destNext}` : ' at the end of the lane'}.</> : ' Inserted at the start of the lane.'}
            </>
          )}
        </p>
        <div className="pl-kpi-row" role="group" aria-label="Calculated manual impact">
          <KpiCard
            label="Run OEE"
            value={`${fmtOee(ripple.oeeOld)} → ${fmtOee(ripple.oeeNew)}`}
            tone={toneFromPts(runDelta)}
            description={fmtSignedPts(runDelta)}
            info="The moved run's OEE estimate after recalculating its new line, predecessor and baseline."
          />
          <KpiCard
            label="Week OEE"
            value={`${fmtOee(ripple.weekOeeOld)} → ${fmtOee(ripple.weekOeeNew)}`}
            tone={toneFromPts(weekDelta)}
            description={`${fmtSignedPts(weekDelta)} across the plan`}
            info="Weighted OEE across the forward plan after this manual move."
          />
          <KpiCard
            label="Switches"
            value={`${ripple.formatSwitchesOld ?? 0} → ${ripple.formatSwitchesNew ?? 0}`}
            tone={switchDelta < 0 ? 'good' : switchDelta > 0 ? 'bad' : 'quiet'}
            description={fmtSwitchDelta(switchDelta)}
            info="Format changes on the affected lanes. Fewer switches generally means fewer CIPs."
          />
          <KpiCard
            label="Ripple"
            value={ripple.pushedCount > 0 ? `${ripple.pushedCount} pushed` : 'none'}
            tone={ripple.pushedCount > 0 ? 'mid' : 'good'}
            description={ripple.pushedCount > 0 ? `${fmtHours(ripple.pushedHours)} downstream` : 'No downstream shift'}
            info="How many later runs move forward because of the inserted run's duration."
          />
        </div>

        {!isMoveReview && (
          <button
            className="pl-manual-clear"
            type="button"
            onClick={onClear}
          >
            Clear this impact · drop somewhere else ×
          </button>
        )}
      </div>

      <aside className={`pl-impact-side${isMoveReview ? ' pl-impact-side-move' : ''}`} aria-label="Calculated move impact">
        <div className={`pl-verdict v-${deliverySafe ? 'good' : 'bad'}`}>
          <span className="pl-verdict-kicker">{isMoveReview ? 'Move impact' : 'Manual impact'}</span>
          <span className="pl-verdict-line">
            {deliverySafe ? 'Safe to commit' : `${collisions.length} service ${collisions.length === 1 ? 'window' : 'windows'} affected`}
          </span>
          <ul className="pl-bullets">
            <li>{manualOeeSummary(runDelta, weekDelta)}</li>
            {ripple.fromLine !== ripple.toLine && (
              <li>L{ripple.fromLine} frees {fmtHours(ripple.sourceFreedHours)} of slack.</li>
            )}
            {deliverySafe ? (
              <li>No pushed run overruns a scheduled cleaning or maintenance block.</li>
            ) : (
              collisions.slice(0, 2).map((c, i) => (
                <li key={`${c.of}-${i}`}>{c.of} moves past {c.kind} by {fmtHours(c.byHours)}.</li>
              ))
            )}
          </ul>
        </div>

        {isMoveReview ? (
          <div className="pl-verdict pl-move-note">
            <span className="pl-verdict-kicker">Review focus</span>
            <span className="pl-verdict-line">Before / after consequence check</span>
            <ul className="pl-bullets">
              <li>The timeline below reflects this moved-order plan.</li>
              <li>Apply this plan to keep the new line assignment.</li>
            </ul>
          </div>
        ) : (
          <div className="pl-verdict pl-tradeoff-callout">
            <span className="pl-verdict-kicker">Strategy on hold</span>
            <span className="pl-verdict-line">{active.title}</span>
            <ul className="pl-bullets">
              <li>The timeline below reflects this calculated manual placement.</li>
              <li>Apply this plan to keep it, or clear the impact to choose another slot.</li>
            </ul>
          </div>
        )}
      </aside>
    </div>
  );
}

function WhyDrawer({ open, rec, verdict, verdictTone, title, subtitle, recoveryHours, tradeoff, onClose, onOpenAnalogues }) {
  return (
    <>
      <button
        className={`pl-drawer-scrim${open ? ' on' : ''}`}
        type="button"
        aria-label="Close explanation"
        onClick={onClose}
        tabIndex={open ? 0 : -1}
        aria-hidden={!open}
      />
      <aside
        className={`pl-drawer tone-${verdictTone}${open ? ' on' : ''}`}
        role="dialog"
        aria-label="Why this recommendation"
        aria-hidden={!open}
      >
        <header className="pl-drawer-h">
          <div>
            <span className="pl-kicker">Why this recommendation</span>
            <h2>{title}</h2>
            <span className="pl-drawer-sub">{subtitle}</span>
          </div>
          <button className="pl-drawer-close" type="button" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className={`pl-drawer-verdict v-${verdictTone}`}>
          {verdict.headline || `${rec.evidence.n} analogues`}
        </div>

        <div className="pl-drawer-chips">
          <span>◷ {rec.deadline}</span>
          <span>↩ {recoveryHours} recovery</span>
          <span>▦ {rec.evidence.n} analogues</span>
        </div>

        <p className="pl-drawer-reason" dangerouslySetInnerHTML={{ __html: rec.evidence.reason }} />

        <div className="pl-drawer-section">
          <div className="pl-why-h">Estimate breakdown</div>
          <div className="pl-why-grid">
            <Metric label="analogue mean OEE" value={rec.evidence.analogueMean} tone="good" />
            <Metric label="naive-slot mean OEE" value={rec.evidence.naiveMean} tone="bad" />
            <Metric label="predicted gain" value={rec.evidence.gain} tone="brand" />
          </div>
        </div>

        <div className="pl-drawer-section">
          <div className="pl-why-h">Top analogues</div>
          <ul className="pl-analogues">
            {rec.evidence.analogues.slice(0, 3).map((a) => (
              <li key={`${a.of}-${a.date}`}>
                <span className="pl-an-date">{a.date}</span>
                <span className="pl-an-of">{a.of}</span>
                <span className="pl-an-line">L{a.line}</span>
                <span className="pl-an-type">{a.type.replace('-', ' ')}</span>
                <span className="pl-an-oee">OEE {a.oee}</span>
              </li>
            ))}
          </ul>
          <button className="pl-see-all" type="button" onClick={onOpenAnalogues}>
            See all {rec.evidence.n} analogues →
          </button>
        </div>

        <div className="pl-drawer-section">
          <div className="pl-why-h">Tradeoff</div>
          <p className="pl-drawer-tradeoff">⚠ {tradeoff}</p>
        </div>

        <div className="pl-drawer-section">
          <div className="pl-why-h">What this estimate cannot see</div>
          <p className="pl-drawer-blind">
            Crew experience, shift staffing and downstream micro-stoppages aren't in the data.
            The figure is a historical average — a single run can land outside it.
          </p>
        </div>
      </aside>
    </>
  );
}

function KpiCard({ label, value, tone, info, description }) {
  return (
    <div className={`pl-kpi-card t-${tone}`}>
      <div className="pl-kpi-card-head">
        <span className="pl-kpi-card-label">{label}</span>
        {info && (
          <span className="pl-kpi-card-info">
            <InfoPopover title={label}>
              {typeof info === 'string' ? <p>{info}</p> : info}
            </InfoPopover>
          </span>
        )}
      </div>
      <b className="pl-kpi-card-value">{value}</b>
      {description && <span className="pl-kpi-card-desc">{description}</span>}
    </div>
  );
}

function Metric({ label, value, tone }) {
  return (
    <div className={`pl-metric t-${tone}`}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function fmtOee(value) {
  return value == null ? '—' : Number(value).toFixed(2);
}

function ptsFromOee(next, prev) {
  if (next == null || prev == null) return null;
  return Math.round((next - prev) * 100);
}

function fmtSignedPts(value) {
  if (value == null) return '—';
  return `${value > 0 ? '+' : ''}${value} pts`;
}

function toneFromPts(value) {
  if (value == null) return 'quiet';
  if (value > 1) return 'good';
  if (value < -1) return 'bad';
  return 'quiet';
}

function fmtSwitchDelta(value) {
  if (value === 0) return 'no change';
  if (value < 0) return `${value} fewer CIPs`;
  return `+${value} more CIPs`;
}

function fmtHours(hours) {
  if (hours == null) return '—';
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 10) return `${hours.toFixed(1)}h`;
  return `${Math.round(hours)}h`;
}

function toneForManualRipple(ripple) {
  if ((ripple.collisions?.length ?? 0) > 0) return 'bad';
  const weekTone = toneFromPts(ptsFromOee(ripple.weekOeeNew, ripple.weekOeeOld));
  if (weekTone !== 'quiet') return weekTone;
  return toneFromPts(ptsFromOee(ripple.oeeNew, ripple.oeeOld)) === 'bad' ? 'mid' : 'good';
}

function manualOeeSummary(runDelta, weekDelta) {
  if (weekDelta != null && Math.abs(weekDelta) > 1) {
    return `Whole-plan OEE shifts ${fmtSignedPts(weekDelta)}.`;
  }
  if (runDelta != null && Math.abs(runDelta) > 1) {
    return `Moved-run OEE shifts ${fmtSignedPts(runDelta)}.`;
  }
  return 'OEE impact is essentially flat after recalculation.';
}

function buildMoveReview(ripple) {
  const beforeLine = `L${ripple.fromLine}`;
  const afterLine = `L${ripple.toLine}`;
  const sameLine = ripple.fromLine === ripple.toLine;
  const slotText = ripple.destPrev
    ? `New slot: after ${ripple.destPrev}${ripple.destNext ? `, before ${ripple.destNext}` : ', at end of line'}.`
    : `New slot: start of ${afterLine}.`;

  return {
    runId: ripple.runId,
    beforeLine,
    afterLine,
    headline: sameLine ? `${beforeLine} slot change` : `${beforeLine} -> ${afterLine}`,
    beforeText: sameLine ? 'Original slot on line' : 'Original schedule position',
    afterText: slotText.replace(/^New slot: /, ''),
    slotText,
  };
}

function buildPlanCalaFactors({ data, order, plan }) {
  if (!data || !plan) {
    return { signals: [], factors: [], orders: [], orderCount: 0, totalUnits: 0 };
  }

  const factors = worldSignals
    .filter((signal) => signal.severity === 'high' || signal.severity === 'medium')
    .map((signal) => ({
      signal,
      impact: impactedPlanVolumeForSignal(signal, data, plan, order),
    }))
    .filter((item) => item.impact.orderCount > 0)
    .sort((a, b) => priorityRank(a.signal) - priorityRank(b.signal))
    .slice(0, 3);

  const ordersByOf = new Map();
  for (const factor of factors) {
    for (const impactedOrder of factor.impact.orders) {
      upsertPlanCalaOrder(ordersByOf, impactedOrder);
    }
  }

  const orders = [...ordersByOf.values()].sort((a, b) => b.units - a.units);
  return {
    signals: factors.map((factor) => factor.signal),
    factors,
    orders,
    orderCount: orders.length,
    totalUnits: orders.reduce((sum, impactedOrder) => sum + impactedOrder.units, 0),
  };
}

function impactedPlanVolumeForSignal(signal, data, plan, focusedOrder) {
  const affectedOfs = new Set(signal.affects?.ofs ?? []);
  const affectedLines = new Set((signal.affects?.lines ?? []).map(String));
  const impactedOrders = new Map();

  const urgentOrders = focusedOrder
    ? [focusedOrder, ...(data?.urgentOrders ?? []).filter((order) => order.of !== focusedOrder.of)]
    : data?.urgentOrders ?? [];

  for (const urgentOrder of urgentOrders) {
    if (affectedOfs.has(urgentOrder.of)) {
      upsertPlanCalaOrder(impactedOrders, {
        of: urgentOrder.of,
        units: Number(urgentOrder.units) || 0,
        status: urgentOrder.status,
      });
    }
  }

  for (const [lineKey, lane] of Object.entries(plan ?? {})) {
    for (const run of lane ?? []) {
      if (!run?.of || run.kind === 'clean' || run.kind === 'maint') continue;
      if (!affectedOfs.has(run.of) && !affectedLines.has(String(lineKey))) continue;
      upsertPlanCalaOrder(impactedOrders, {
        of: run.of,
        units: Math.round((Number(run.vol) || 0) * 1000),
        line: String(lineKey),
      });
    }
  }

  const orders = [...impactedOrders.values()].sort((a, b) => b.units - a.units);
  return {
    orderCount: orders.length,
    totalUnits: orders.reduce((sum, impactedOrder) => sum + impactedOrder.units, 0),
    orders,
  };
}

function upsertPlanCalaOrder(orders, next) {
  const current = orders.get(next.of);
  orders.set(next.of, {
    ...current,
    ...next,
    units: (current?.units ?? 0) + (next.units ?? 0),
    line: current?.line ?? next.line,
  });
}

function priorityRank(signal) {
  const severity = { high: 0, medium: 1, low: 2 }[signal.severity] ?? 3;
  const time = new Date(signal.fetchedAt).getTime();
  return severity * 1e13 - (Number.isFinite(time) ? time : 0);
}

function formatPlanCalaUnits(units) {
  if (!units) return '0 un';
  if (units >= 1000000) {
    const m = units / 1000000;
    return `${m.toFixed(m >= 10 ? 1 : 2)}M un`;
  }
  if (units >= 1000) {
    const k = units / 1000;
    return `${k.toFixed(k >= 100 ? 0 : 1)}k un`;
  }
  return `${units.toLocaleString()} un`;
}

function retargetInsertedOrder(rec, order, sourceOrder) {
  if (!rec?.plan || !order?.of || !sourceOrder?.of || order.of === sourceOrder.of) return rec;

  let touched = false;
  const replaceRun = (seg) => {
    if (!seg || seg.kind !== 'ins') return seg;
    touched = true;
    return {
      ...seg,
      of: order.of,
      sku: order.sku ?? seg.sku,
      vol: order.units ?? seg.vol,
      format: deriveFormat({ sku: order.sku ?? seg.sku, material: order.of }),
    };
  };

  const plan = Object.fromEntries(
    Object.entries(rec.plan).map(([lineKey, lane]) => [
      lineKey,
      (lane ?? []).map(replaceRun),
    ]),
  );

  if (!touched) return rec;

  return {
    ...rec,
    plan,
    moves: (rec.moves ?? []).map((move) => (
      move?.of === sourceOrder.of ? { ...move, of: order.of } : move
    )),
  };
}

function findRunInPlan(plan, of) {
  if (!plan || !of) return null;
  for (const [lineKey, lane] of Object.entries(plan)) {
    for (let index = 0; index < (lane ?? []).length; index += 1) {
      const run = lane[index];
      if (run?.of === of) return { lineKey, index, run };
    }
  }
  return null;
}

function runDetailFromPlanTarget({ target, plan, data }) {
  const lineKey = target.lineKey;
  const lane = plan?.[lineKey] ?? [];
  const seg = lane[target.index];
  const timeUnit = data?.timeline?.timeUnit === 'days' ? 'days' : 'hours';

  return {
    seg: normalizePlanRun(seg, timeUnit),
    prev: normalizePlanRun(target.index > 0 ? lane[target.index - 1] : null, timeUnit),
    next: normalizePlanRun(target.index < lane.length - 1 ? lane[target.index + 1] : null, timeUnit),
    lineKey,
    index: target.index,
    baseline: data?.lineBaseline?.[lineKey],
    state: 'planned',
  };
}

function normalizePlanRun(seg, timeUnit) {
  if (!seg) return null;
  if (seg.kind === 'clean' || seg.kind === 'maint') {
    return { kind: seg.kind, durationHours: planUnitsToHours(seg.w ?? 1, timeUnit) };
  }
  return {
    material: seg.of,
    sku: seg.sku,
    volume: seg.vol,
    oee: seg.oee,
    durationHours: planUnitsToHours(seg.w ?? 1, timeUnit),
    format: seg.format || deriveFormat({ sku: seg.sku, material: seg.of }),
    kind: seg.kind,
    shiftFromHours: seg.shiftFromHours,
  };
}

function planUnitsToHours(value, timeUnit) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return timeUnit === 'days' ? n * 24 : n;
}

function buildOptions(data) {
  const oeeKey = data.objectives.oee.order[0];
  const timeKey = data.objectives.time.order[0];
  const disKey = data.objectives.dis.order[0];
  return [
    {
      id: 'oee',
      title: 'Maximise OEE',
      recKey: oeeKey,
      tone: 'good',
      tradeoff: 'misses due date',
      description: 'Highest OEE recovery, with a delivery-date tradeoff.',
      pros: [
        'Same-envase changeover — lowest historical loss',
        'Best 33cl analogue match (8 prior runs)',
        '14h faster recovery vs naive plan',
      ],
      cons: [
        'Misses due date by 1 day',
        'Shifts FDT13LT back ~6h',
        'Customer may push back on delay',
      ],
    },
    {
      id: 'time',
      title: 'Protect due date',
      recKey: timeKey,
      tone: 'mid',
      tradeoff: 'lower OEE',
      description: 'Keeps the customer promise with a smaller OEE gain.',
      pros: [
        'On-time delivery for Carrefour',
        'Modest +2.1 OEE recovery',
        'No customer SLA risk',
      ],
      cons: [
        'Lower than peak OEE',
        'Brand+clean changeover required',
        'Weaker analogue match',
      ],
    },
    {
      id: 'dis',
      title: 'Minimise disruption',
      recKey: disKey,
      tone: 'quiet',
      tradeoff: 'OEE loss',
      description: 'Leaves the schedule stable and avoids extra moves.',
      pros: [
        'Zero orders moved',
        'Plan stays unchanged',
        'Predictable execution',
      ],
      cons: [
        '−0.4 OEE loss vs naive',
        'Familia change adds cost',
        'Still misses due date',
      ],
    },
    {
      id: 'bal',
      title: 'Balanced plan',
      recKey: oeeKey,
      tone: 'brand',
      tradeoff: 'compromise',
      description: 'Balanced recovery and serviceability for the team.',
      pros: [
        'On-time delivery',
        '+6.2 OEE recovery',
        'Compromise both planners accept',
      ],
      cons: [
        '2 orders moved',
        'Not max on either axis',
        'More complex execution',
      ],
    },
  ];
}

function findUrgentMoveSource(plan, order) {
  if (!plan || !order?.of) return null;
  const candidates = [];
  for (const [lineKey, lane] of Object.entries(plan)) {
    for (let index = 0; index < (lane ?? []).length; index += 1) {
      const run = lane[index];
      if (run?.of === order.of) candidates.push({ lineKey, index, run });
    }
  }
  return candidates.find((candidate) => candidate.run.kind === 'ins')
    ?? candidates[0]
    ?? null;
}

function manualSlotKeyForDrop({ data, plan, moving, drop }) {
  if (!data?.manualSlots || !plan || !moving || !drop?.lineKey) return null;
  const lineKey = String(drop.lineKey);
  const sourceLine = String(moving.fromLine);
  const originalLane = [...(plan[lineKey] ?? [])];
  let lane = originalLane;
  let slotIndex = drop.slotIndex ?? 0;

  if (sourceLine === lineKey) {
    lane = originalLane.filter((_, index) => index !== moving.fromIndex);
    if (slotIndex > moving.fromIndex) slotIndex -= 1;
  }

  const endKey = `${lineKey}-end`;
  if (slotIndex >= lane.length && data.manualSlots[endKey]) return endKey;
  if (slotIndex <= 0) return null;

  const anchor = lane[slotIndex - 1]?.of;
  const afterKey = anchor ? `${lineKey}-after-${anchor}` : null;
  return afterKey && data.manualSlots[afterKey] ? afterKey : null;
}

function stripHtml(s) {
  return String(s || '').replace(/<[^>]+>/g, '');
}

/* Friendly SKU display. Handles two shapes:
   - "Brand · format" (already friendly) — returned as-is
   - Verbose codes like "BEER MOLEN 4,8°NA 33CL L B24SH P …" — first 2
     title-cased words + extracted format. Falls back to first 24 chars. */
function formatSku(sku) {
  if (!sku) return '';
  if (sku.includes(' · ')) return sku;
  const fmtMatch = sku.match(/(\d{2,3})\s*cl/i);
  const fmt = fmtMatch ? `${fmtMatch[1]}cl` : null;
  const titleCase = (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  const words = sku.split(/\s+/).filter(Boolean).slice(0, 2).map(titleCase).join(' ');
  return fmt ? `${words} · ${fmt}` : (words || sku.slice(0, 24));
}

/* Derive 3 pros from the recommendation's real evidence. Falls back to
   sensible defaults if a field is missing. */
function derivePros(rec) {
  const out = [];
  if (rec.evidence?.n != null) {
    out.push(`${rec.evidence.n} historical analogue${rec.evidence.n === 1 ? '' : 's'} support this slot`);
  }
  if (rec.evidence?.gain != null) {
    out.push(`Predicted ${rec.evidence.gain} OEE pts vs. naive plan`);
  }
  if (rec.recovery?.hours != null) {
    out.push(`Line recovers in ~${rec.recovery.hours}h`);
  }
  return out.length ? out : ['Predicted improvement vs. naive plan'];
}

/* Derive 3 cons from real recommendation data. */
function deriveCons(rec, active) {
  const out = [];
  if (rec.deadline && rec.deadline !== 'on time') {
    out.push(`Due date slips ${rec.deadline}`);
  }
  if (rec.ordersMoved > 0) {
    out.push(`${rec.ordersMoved} order${rec.ordersMoved > 1 ? 's' : ''} moved on the plan`);
  }
  const move = rec.moves?.[0];
  if (move) {
    out.push(`${move.of} ${move.why || `shifts ${move.shift}`}`);
  }
  if (!out.length) out.push(`Tradeoff: ${active.tradeoff}`);
  return out.slice(0, 3);
}
