import { useState, useEffect, useRef } from 'react';
import { AnimatePresence } from 'framer-motion';
import { usePlan } from './hooks/usePlan.js';
import TopBar from './components/TopBar.jsx';
import KPIStrip from './components/KPIStrip.jsx';
import Inbox from './components/Inbox.jsx';
import Fab from './components/Fab.jsx';
import Timeline from './components/Timeline.jsx';
import RecommendationPanel from './components/RecommendationPanel.jsx';
import ImpactSummary from './components/ImpactSummary.jsx';
import LiveStatus from './components/LiveStatus.jsx';
import RunDetailModal from './components/RunDetailModal.jsx';
import MoveBanner from './components/MoveBanner.jsx';
import MoveCalculating from './components/MoveCalculating.jsx';
import MoveImpactPanel from './components/MoveImpactPanel.jsx';
import DraftPlanPanel from './components/DraftPlanPanel.jsx';
import { computeMovePreview, isLineCompatible } from './lib/movePlan.js';
import { deriveFormat } from './components/TimelineCard.jsx';

/* App state mirrors the prototype's `state` object 1:1.
   view : 'queue' (landing planner) | 'calculating' | 'recs'
   objective : 'oee' | 'time' | 'dis'
   selectedLine : key into data.recommendations
   manualSlot   : key into data.manualSlots
   showNaive    : toggles the naive-slot band on the timeline
   zoom         : 'week' | 'month' | 'quarter'                           */
function App() {
  const { data, loading, error, reload } = usePlan();

  if (loading) return <BootShell><LoadingState /></BootShell>;
  if (error)   return <BootShell><ErrorState error={error} onRetry={reload} /></BootShell>;
  return <Workspace data={data} />;
}

/* Workspace — only mounts once data has arrived, so every child can
   safely assume `data` is the full plan contract. */
function Workspace({ data }) {
  const demo = new URLSearchParams(location.search).get('demo');
  const demoRecs = demo === 'recs' || demo === 'simulate' || demo === 'recommend';
  const demoCalc = demo === 'calculating';
  const [view, setView] = useState(demoCalc ? 'calculating' : demoRecs ? 'recs' : 'queue');
  const [objective, setObjective] = useState('oee');
  const [selectedImpact, setSelectedImpact] = useState(demoRecs ? 'oee' : null);
  const [selectedLine, setSelectedLine] = useState(demoRecs ? data.objectives.oee.order[0] : null);
  const [manualSlot, setManualSlot] = useState(null);
  const [showNaive, setShowNaive] = useState(demo === 'simulate');
  const [zoom, setZoom] = useState('week');
  const [inboxOpen, setInboxOpen] = useState(demo === 'inbox');
  const [draftOpen, setDraftOpen] = useState(false);
  const [orders, setOrders] = useState(data.urgentOrders);
  const [activeOrder, setActiveOrder] = useState(data.urgentOrders[0]);
  const [runDetail, setRunDetail] = useState(null);
  /* Move flow state:
     - `moving` = the run currently being moved (set when Maria clicks
       "Move to another line" in the run detail modal). Closes the modal,
       puts the timeline into moving-mode with compatibility overlays and
       drop zones.
     - `moveCalculating` → `movePending` → confirm/discard: see below. */
  const [moving, setMoving] = useState(null);
  /* moveCalculating = transient state shown while the "Recalculating
     impact..." overlay is up. Holds the preview + destination so the
     overlay can name what's being recalculated. ~1.3s, mirroring the
     urgent-order calculate flow's pacing. */
  const [moveCalculating, setMoveCalculating] = useState(null);
  /* movePending = preview waiting on Maria's Confirm/Discard. The
     plan is already committed visually (so she can see the new shape
     in the timeline below); Discard reverts. */
  const [movePending, setMovePending] = useState(null);
  /* committedPlan = base plan after any confirmed moves. When null we
     fall back to data.basePlan; once a move commits we snapshot the
     preview here so it persists. */
  const [committedPlan, setCommittedPlan] = useState(null);
  const lastSyncRef = useRef(Date.now());

  /* surface the urgent-orders inbox once on boot */
  useEffect(() => {
    if (!demo) setInboxOpen(true);
  }, [demo]);

  /* Esc cancels moving mode. Listening here (not in the timeline) so the
     handler survives across re-renders of the lane components. */
  useEffect(() => {
    if (!moving) return;
    const onKey = (e) => { if (e.key === 'Escape') setMoving(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moving]);

  /* Effective plan — folds any committed move into data.basePlan. The
     timeline reads from this rather than data.basePlan directly so a
     confirmed move sticks across renders. */
  const effectivePlan = committedPlan ?? data.basePlan;

  /* Drop handler — fires the calculate flash and then routes into the
     impact-review panel. We deliberately don't commit the plan until
     after the flash so the "recalculating" moment feels honest (the
     timeline behind the overlay still shows the pre-move plan). */
  function handleMoveDrop({ lineKey, slotIndex }) {
    if (!moving) return;
    const format = moving.format;
    if (!isLineCompatible(lineKey, format)) return;
    const preview = computeMovePreview({
      basePlan: effectivePlan,
      lineBaseline: data.lineBaseline,
      moving: { fromLine: moving.fromLine, fromIndex: moving.fromIndex },
      dest: { lineKey, slotIndex },
    });
    if (!preview) return;
    const priorPlan = effectivePlan;
    setMoveCalculating({
      moving,
      dest: { lineKey, slotIndex },
      preview,
      priorPlan,
    });
    setMoving(null);
    /* 1.3s matches the urgent-order calculate flash (selectUrgent) so
       both interactions feel like the same product moment. */
    setTimeout(() => {
      setMoveCalculating(null);
      setMovePending({ ...preview, priorPlan });
      setCommittedPlan(preview.plan);
    }, 1300);
  }

  function confirmMove() {
    /* Plan is already committed; just dismiss the review panel. */
    setMovePending(null);
  }

  function discardMove() {
    if (!movePending) return;
    setCommittedPlan(
      movePending.priorPlan === data.basePlan ? null : movePending.priorPlan,
    );
    setMovePending(null);
  }

  const inRecs = view === 'recs' || view === 'calculating';

  function selectUrgent(order = orders[0]) {
    if (order) setActiveOrder(order);
    setInboxOpen(false);
    setView('calculating');
    setTimeout(() => {
      setObjective('oee');
      setSelectedImpact('oee');
      setSelectedLine(data.objectives.oee.order[0]);
      setShowNaive(false);
      setView('recs');
    }, 1300);
  }

  function createManualOrder(order) {
    setOrders((current) => [
      order,
      ...current.filter((item) => item.of !== order.of),
    ]);
  }

  function backToQueue() {
    setSelectedLine(null);
    setSelectedImpact(null);
    setManualSlot(null);
    setView('queue');
  }

  function dropOnLine(line) {
    const LINE_DROP_SLOT = { '14': '14-end', '17': '17-after-AM05LTST', '19': '19-end' };
    const key = LINE_DROP_SLOT[line];
    if (!key) return;
    setManualSlot(key);
    setView('calculating');
    setTimeout(() => {
      setShowNaive(false);
      setView('recs');
    }, 900);
  }

  const stageLine = manualSlot
    ? data.manualSlots[manualSlot].recKey
    : selectedLine || data.objectives[objective].order[0];

  const urgentCount = orders.filter((o) => o.status === 'urgent').length;

  return (
    <div className="app">
      <div className={`main${inRecs ? ' main-recs' : ''}`}>
        <TopBar
          urgentCount={urgentCount}
          inboxOpen={inboxOpen}
          onBellClick={() => setInboxOpen((o) => !o)}
          onDraftPlan={() => { setInboxOpen(false); setDraftOpen(true); }}
          onSettings={() => { /* TODO: open settings */ }}
          onLogout={() => { /* TODO: wire to auth */ }}
        />

        <div className={`shell${inRecs ? ' recs' : ''}`}>
          <div className="panel">
            {view === 'calculating' && (
              <PanelCalculating order={activeOrder} />
            )}
            {view === 'recs' && (
              <RecommendationPanel
                data={data}
                order={activeOrder}
                objective={objective}
                selectedImpact={selectedImpact}
                selectedLine={selectedLine}
                manualSlot={manualSlot}
                onObjectiveChange={(k) => {
                  setObjective(k);
                  setSelectedImpact(k);
                  setSelectedLine(data.objectives[k].order[0]);
                  setShowNaive(false);
                }}
                onSelectImpact={setSelectedImpact}
                onSelectCard={(line) => {
                  setSelectedLine(line);
                  setShowNaive(false);
                }}
                onClearManual={() => setManualSlot(null)}
                onBack={backToQueue}
              />
            )}
          </div>

          <div className="stage">
            <div className="stage-pad">
              {view === 'queue' && (
                <DefaultStage
                  data={data}
                  effectivePlan={effectivePlan}
                  zoom={zoom}
                  onZoom={setZoom}
                  onRunClick={setRunDetail}
                  moving={moving}
                  onMoveDrop={handleMoveDrop}
                />
              )}
              {view === 'calculating' && <CalculatingStage />}
              {view === 'recs' && (
                <RecommendationStage
                  data={data}
                  line={stageLine}
                  zoom={zoom}
                  onZoom={setZoom}
                  showNaive={showNaive}
                  onToggleNaive={setShowNaive}
                  onDropOnLine={dropOnLine}
                />
              )}
            </div>
          </div>
        </div>

        <AnimatePresence>
          {inboxOpen && (
            <Inbox
              key="inbox"
              orders={orders}
              onClose={() => setInboxOpen(false)}
              onSelectUrgent={selectUrgent}
              onCreateOrder={createManualOrder}
            />
          )}
          {draftOpen && (
            <DraftPlanPanel
              key="draft"
              plan={effectivePlan}
              onClose={() => setDraftOpen(false)}
            />
          )}
        </AnimatePresence>

        {view === 'queue' && !inboxOpen && (
          <Fab
            onAction={(key) => {
              if (key === 'order')    setInboxOpen(true);
              if (key === 'issue')    console.log('[fab] report issue — TODO');
              if (key === 'stoppage') console.log('[fab] log stoppage — TODO');
            }}
          />
        )}

        {/* Live status pill — fixed at bottom-left of the canvas so the
            planner always knows whether the data on screen is current. */}
        <div className="live-anchor">
          <LiveStatus data={data} lastSync={lastSyncRef.current} />
        </div>

        <RunDetailModal
          open={!!runDetail}
          run={runDetail?.seg}
          prev={runDetail?.prev}
          next={runDetail?.next}
          lineKey={runDetail?.lineKey}
          lineBaseline={runDetail?.baseline}
          state={runDetail?.state}
          onClose={() => setRunDetail(null)}
          onMove={() => {
            /* Entering moving mode requires the run's source index in
               its lane — derive from the effective plan since that's
               what the timeline is rendering. */
            const seg = runDetail?.seg;
            const lineKey = runDetail?.lineKey;
            if (!seg || !lineKey) return;
            const lane = effectivePlan?.[lineKey] ?? [];
            const fromIndex = lane.findIndex((s) => s.of === seg.material);
            if (fromIndex < 0) return;
            setMoving({
              run: lane[fromIndex],
              fromLine: lineKey,
              fromIndex,
              format: seg.format || deriveFormat({ sku: seg.sku, material: seg.material }),
            });
            setRunDetail(null);
          }}
        />

        {moving && (
          <MoveBanner
            moving={moving}
            onCancel={() => setMoving(null)}
          />
        )}

        {moveCalculating && (
          <MoveCalculating
            moving={moveCalculating.moving}
            dest={moveCalculating.dest}
          />
        )}

        {movePending && (
          <MoveImpactPanel
            preview={movePending}
            onConfirm={confirmMove}
            onDiscard={discardMove}
          />
        )}
      </div>
    </div>
  );
}

/* ---------- boot states ---------- */

function BootShell({ children }) {
  return (
    <div className="app">
      <div className="main">
        <TopBar urgentCount={0} inboxOpen={false} onBellClick={() => {}} />
        <div className="shell">
          <div className="stage"><div className="stage-pad">{children}</div></div>
        </div>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="center-state">
      <span className="spinner" />
      <div className="small">Loading plan…</div>
    </div>
  );
}

function ErrorState({ error, onRetry }) {
  return (
    <div className="center-state">
      <div className="big" style={{ color: 'var(--bad)' }}>Couldn't load plan</div>
      <div className="small" style={{ maxWidth: 480, textAlign: 'center' }}>{String(error.message || error)}</div>
      <button className="btn" onClick={onRetry}>Retry</button>
    </div>
  );
}

/* ---------- inline subcomponents kept here while the structure stabilises.
   They'll move into /components/ files in the next pass.        ---------- */

function PanelCalculating({ order }) {
  return (
    <div className="panel-pad">
      <div className="eyebrow">Selected</div>
      <div className="panel-title">{order.of}</div>
      <div className="panel-desc">{order.sku}</div>
      <div className="summary">
        <div className="summary-grid">
          <div><b>{order.units.toLocaleString()}</b>units</div>
          <div><b>{order.hl}</b>hl</div>
          <div><b>{order.due}</b>due date</div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--ink-3)', fontSize: 12 }}>
        <span className="spinner" /> Ranking line and sequence options…
      </div>
    </div>
  );
}

function DefaultStage({ data, effectivePlan, zoom, onZoom, onRunClick, moving, onMoveDrop }) {
  return (
    <>
      <KPIStrip data={data} />
      <div className="stage-head">
        <div>
          <div className="stage-title">Production schedule</div>
          <div className="stage-sub">Executed history left of today · forward plan right</div>
        </div>
        <div className="stage-head-right">
          <ZoomCtl zoom={zoom} onZoom={onZoom} />
        </div>
      </div>
      <Timeline
        data={data}
        effectivePlan={effectivePlan}
        mode="default"
        zoom={zoom}
        onRunClick={onRunClick}
        moving={moving}
        onMoveDrop={onMoveDrop}
      />
    </>
  );
}

function CalculatingStage() {
  return (
    <>
      <div className="stage-head">
        <div>
          <div className="stage-title">Evaluating insertion options</div>
          <div className="stage-sub">Matching the urgent order against executed history</div>
        </div>
        <span className="stage-tag">working…</span>
      </div>
      <div className="center-state">
        <div className="scanbox">
          <div className="scanline"><span>Line 14 — changeover analogues</span><span className="done">✓</span></div>
          <div className="scanline"><span>Line 17 — changeover analogues</span><span className="done">✓</span></div>
          <div className="scanline"><span>Line 19 — changeover analogues</span><span className="pend">…</span></div>
          <div className="scanline"><span>Netting out cleaning &amp; downtime</span><span className="pend">…</span></div>
          <div className="progress"><div className="fill" style={{ width: '60%' }} /></div>
        </div>
        <div className="small">Scanning historical changeovers across three lines</div>
      </div>
    </>
  );
}

function RecommendationStage({ data, line, zoom, onZoom, showNaive, onToggleNaive, onDropOnLine }) {
  const rec = data.recommendations[line];
  const order = data.urgentOrders[0];
  return (
    <>
      <div className="stage-head">
        <div>
          <div className="stage-title">Proposed plan · {rec.line}</div>
          <div className="stage-sub">Urgent order {order.of} inserted {rec.position}</div>
        </div>
        <div className="stage-head-right">
          <ZoomCtl zoom={zoom} onZoom={onZoom} />
          <span className="stage-tag">proposed</span>
        </div>
      </div>
      <ImpactSummary rec={rec} order={order} />
      <label className="naive-toggle">
        <input
          type="checkbox"
          checked={showNaive}
          onChange={(e) => onToggleNaive(e.target.checked)}
          disabled={!rec.naiveBand}
        />
        Show the naive slot (what you'd do without LineWise)
        {!rec.naiveBand && <span style={{ color: 'var(--ink-3)', fontStyle: 'italic' }}>— n/a for this option</span>}
      </label>
      <div className="drag-tray">
        <span className="tray-label">Prefer your own slot? Drag <b>{order.of}</b> onto a line:</span>
        <div
          className="drag-token"
          draggable
          onDragStart={(e) => { e.dataTransfer.setData('text/plain', 'urgent'); e.dataTransfer.effectAllowed = 'move'; }}
        >
          <span className="dt-of">{order.of}</span>
          <span className="dt-sub">{order.sku}</span>
        </div>
        <span className="dt-grip">⠿ drop on a track to test it</span>
      </div>
      <Timeline
        data={data}
        mode="rec"
        zoom={zoom}
        rec={rec}
        showNaive={showNaive}
        onDropOnLine={onDropOnLine}
      />
    </>
  );
}

function ZoomCtl({ zoom, onZoom }) {
  return (
    <div className="zoom-ctl">
      {Object.entries({ week: 'Week', month: 'Month', quarter: 'Quarter' }).map(([k, label]) => (
        <button key={k} className={zoom === k ? 'on' : ''} onClick={() => onZoom(k)}>{label}</button>
      ))}
    </div>
  );
}

export default App;
