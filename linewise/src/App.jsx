import { useState, useEffect, useRef } from 'react';
import { AnimatePresence } from 'framer-motion';
import { usePlan } from './hooks/usePlan.js';
import {
  postIssue,
  postStoppage,
  resumeStoppage as apiResumeStoppage,
  postStoppageReplan,
  postResequence,
} from './api/client.js';
import { useTimelineMoveFlow } from './hooks/useTimelineMoveFlow.js';
import TopBar from './components/TopBar.jsx';
import KPIStrip from './components/KPIStrip.jsx';
import Inbox from './components/Inbox.jsx';
import Fab from './components/Fab.jsx';
import Timeline from './components/Timeline.jsx';
import RecommendationPanel from './components/RecommendationPanel.jsx';
import PlanLab from './preview/PlanLab.jsx';
import ImpactSummary from './components/ImpactSummary.jsx';
import LiveStatus from './components/LiveStatus.jsx';
import DraftPlanPanel from './components/DraftPlanPanel.jsx';
import IssueModal from './components/IssueModal.jsx';
import StoppageModal from './components/StoppageModal.jsx';
import ReplanBanner from './components/ReplanBanner.jsx';
import LogToast from './components/LogToast.jsx';
import SettingsDrawer from './components/SettingsDrawer.jsx';
import YearCompare from './components/YearCompare.jsx';
import WorldSignals from './components/WorldSignals.jsx';
import SignalAlert from './components/SignalAlert.jsx';
import { useSettings } from './hooks/useSettings.js';
import { useSignals } from './hooks/useSignals.js';
import { computeStoppageReplan } from './lib/stoppagePlan.js';
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
  return <Workspace data={data} reload={reload} />;
}

/* Workspace — only mounts once data has arrived, so every child can
   safely assume `data` is the full plan contract. */
function Workspace({ data, reload }) {
  const demo = new URLSearchParams(location.search).get('demo');
  const demoRecs = demo === 'recs' || demo === 'simulate' || demo === 'recommend';
  const demoCalc = demo === 'calculating';
  const [view, setView] = useState(demoCalc ? 'calculating' : demoRecs ? 'recs' : 'queue');
  const [objective, setObjective] = useState('oee');
  const [selectedImpact, setSelectedImpact] = useState(demoRecs ? 'oee' : null);
  const [selectedLine, setSelectedLine] = useState(demoRecs ? data.objectives.oee.order[0] : null);
  const [manualSlot, setManualSlot] = useState(null);
  const [showNaive, setShowNaive] = useState(demo === 'simulate');
  const [zoom, setZoom] = useState('month');
  const [inboxOpen, setInboxOpen] = useState(demo === 'inbox');
  const [draftOpen, setDraftOpen] = useState(false);
  const [orders, setOrders] = useState(data.urgentOrders);
  const [activeOrder, setActiveOrder] = useState(data.urgentOrders[0]);
  /* Quick-action flow state:
     - `issueModalOpen` / `stoppageModalOpen` — which Fab-launched modal
       is on screen (only one at a time).
     - `issues` — append-only audit log of reported issues (in-memory
       for the prototype). Each entry: { id, line, category, severity,
       note, ts }. Later surfaces as a marker on the executed run.
     - `stoppages` — currently-active line stoppages. Each entry:
       { id, line, reason, duration, startAgoMin, startedAt, ts }.
       Drives KPI "Lines running", the lane STOPPED badge, and the
       replan banner.
     - `replanPrompt` — payload for the ReplanBanner. Set on stoppage
       submit; cleared by Dismiss/Replan.
     - `toast` — single transient confirmation pill. { id, title,
       detail, tone }. */
  const [issueModalOpen, setIssueModalOpen] = useState(false);
  const [stoppageModalOpen, setStoppageModalOpen] = useState(false);
  const [issues, setIssues] = useState([]);
  const [stoppages, setStoppages] = useState([]);
  const [replanPrompt, setReplanPrompt] = useState(null);
  const [toast, setToast] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useSettings();
  const { data: signalsData, refresh: refreshSignalsApi } = useSignals();
  const [dismissedSignals, setDismissedSignals] = useState(() => SignalAlert.loadDismissed());
  const worldSignalsRef = useRef(null);
  const lastSyncRef = useRef(Date.now());

  function dismissSignal(id) {
    setDismissedSignals((prev) => {
      const next = new Set(prev);
      next.add(id);
      SignalAlert.persistDismissed(next);
      return next;
    });
  }

  function reviewSignal() {
    worldSignalsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function resequenceWeek() {
    /* Fire the global re-sequencer. The endpoint persists the new
       basePlan as a plan_override; we surface the savings as a toast
       and pull the new schedule via reload(). Falls back to a "no
       backend" toast if the API isn't reachable. */
    postResequence()
      .then((resp) => {
        const s = resp?.summary ?? {};
        const delta = Number(s.totalCostDelta ?? 0);
        const reordered = Number(s.totalReordered ?? 0);
        setToast({
          id: `rsq-${Date.now()}`,
          title: reordered > 0 ? 'Week resequenced' : 'Already optimal',
          detail: reordered > 0
            ? `Saved ${delta.toFixed(2)} changeover cost · ${reordered} runs moved`
            : 'No moves improved the total — schedule kept as-is',
          tone: reordered > 0 ? 'good' : 'neutral',
        });
        reload?.();
      })
      .catch((err) => {
        if (import.meta.env.DEV) console.warn('[resequence] failed', err);
        setToast({
          id: `rsq-err-${Date.now()}`,
          title: 'Resequence unavailable',
          detail: 'Backend not reachable — start ./scripts/run_server.sh',
          tone: 'warn',
        });
      });
  }

  /* surface the urgent-orders inbox once on boot */
  useEffect(() => {
    if (!demo) setInboxOpen(true);
  }, [demo]);

  /* Move-flow orchestration is shared with PlanLab — see
     useTimelineMoveFlow. App-specific extensions:
       - Inbox draft-panel and previewDraftRun both call setRunDetail
         directly (exposed below) to open the modal from outside the
         timeline.
       - The `getOnPreviewInPlanner` opt-in injects the "Recalculate &
         preview in planner" action onto runs flagged `fromDraft`. */
  const { timelineProps, overlays, setRunDetail, setCommittedPlan } = useTimelineMoveFlow({
    data,
    basePlan: data.basePlan,
    getOnPreviewInPlanner: ({ runDetail }) => runDetail?.fromDraft
      ? () => previewDraftRun(runDetail.rawRun)
      : undefined,
  });

  const effectivePlan = timelineProps.effectivePlan;

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

  /* previewDraftRun — fired from the RunDetailModal's "Recalculate &
     preview in planner" action. Mirrors selectUrgent's pacing so the
     calculating flash feels like the same product moment, but lands on
     the recs view focused on the run's own line. The synthesized order
     gives the recommendation panel its header context — the run becomes
     the "order under review" for that planner session. */
  function previewDraftRun(run) {
    if (!run) return;
    /* Close the modal first, then defer the heavier state transitions to
       the next tick. Doing it all in one batch left framer-motion's
       AnimatePresence exit animation half-played on the rd-overlay,
       because the calculating view mounts concurrent motion targets. */
    setRunDetail(null);
    setDraftOpen(false);
    setTimeout(() => {
      setActiveOrder({
        of: run.of,
        status: 'planned',
        sku: run.sku,
        units: Math.round((run.vol ?? 0) * 1000),
        hl: 0,
        due: 'scheduled',
      });
      setView('calculating');
      setTimeout(() => {
        setObjective('oee');
        setSelectedImpact('oee');
        setSelectedLine(run.lineKey || data.objectives.oee.order[0]);
        setShowNaive(false);
        setView('recs');
      }, 1300);
    }, 160);
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

  function logIssue(payload) {
    /* Optimistic update with a client-generated id, then reconcile with
       the server's view (server-assigned id + ts). If the backend isn't
       reachable we keep the optimistic entry — the demo stays interactive
       offline. */
    const optimistic = { id: `iss-local-${Date.now()}`, ts: Date.now(), ...payload };
    setIssues((prev) => [optimistic, ...prev]);
    setIssueModalOpen(false);
    setToast({
      id: optimistic.id,
      title: `Issue logged on L${optimistic.line}`,
      detail: `${labelCategory(optimistic.category)} · ${labelSeverity(optimistic.severity)}`,
      tone: optimistic.severity === 'critical' ? 'warn' : 'neutral',
    });
    postIssue({ ...payload, ts: optimistic.ts })
      .then(({ issue }) => {
        setIssues((prev) => prev.map((i) => (i.id === optimistic.id ? issue : i)));
      })
      .catch((err) => {
        if (import.meta.env.DEV) console.warn('[issues] backend unavailable, keeping local entry', err);
      });
  }

  function logStoppage(payload) {
    /* One active stoppage per line — replace any prior. Optimistic local
       update mirrors the server's invariant; reconcile from the response
       so the id/ts match what the server stored. */
    const optimistic = { id: `stp-local-${Date.now()}`, ts: Date.now(), ...payload };
    setStoppages((prev) => [
      optimistic,
      ...prev.filter((s) => s.line !== optimistic.line),
    ]);
    setStoppageModalOpen(false);
    setReplanPrompt(optimistic);
    setToast({
      id: optimistic.id,
      title: `L${optimistic.line} stopped`,
      detail: `${labelReason(optimistic.reason)} · est. ${labelDuration(optimistic.duration)}`,
      tone: 'bad',
    });
    postStoppage({ ...payload, ts: optimistic.ts })
      .then(({ stoppages: serverList, stoppage }) => {
        setStoppages(serverList ?? []);
        if (stoppage) {
          setReplanPrompt((prev) => (prev?.id === optimistic.id ? stoppage : prev));
        }
      })
      .catch((err) => {
        if (import.meta.env.DEV) console.warn('[stoppages] backend unavailable, keeping local entry', err);
      });
  }

  function startReplan() {
    if (!replanPrompt) return;
    /* Real replan: shift every planned segment on the stopped lane
       forward by the stoppage duration and commit the new plan. We try
       the backend first; if it answers we use the server's new plan
       (which also covers service blocks), otherwise we fall back to the
       client-side shift in stoppagePlan.js so the demo still moves. */
    const prompt = replanPrompt;
    const line = prompt.line;
    setReplanPrompt(null);
    setView('calculating');

    const finish = (shiftedCount, shiftedHours, nextPlan) => {
      if (nextPlan) setCommittedPlan(nextPlan);
      setView('queue');
      setToast({
        id: `rpl-${Date.now()}`,
        title: `L${line} replanned`,
        detail: `Shifted ${shiftedCount} ${shiftedCount === 1 ? 'run' : 'runs'} by ${fmtShiftHours(shiftedHours)}`,
        tone: 'neutral',
      });
    };

    /* Fire the request in parallel with the calculating flash so the UI
       still feels instant even if the network is slow. */
    const apiCall = postStoppageReplan({
      stoppageId: prompt.id,
      line,
      durationKey: prompt.duration,
    }).catch((err) => {
      if (import.meta.env.DEV) console.warn('[replan] backend unavailable, using client-side shift', err);
      return null;
    });

    Promise.all([apiCall, new Promise((r) => setTimeout(r, 1300))]).then(([resp]) => {
      if (resp?.plan?.basePlan) {
        finish(resp.shiftedCount ?? 0, resp.shiftedHours ?? 0, resp.plan.basePlan);
      } else {
        const replan = computeStoppageReplan({
          basePlan: effectivePlan,
          line,
          durationKey: prompt.duration,
        });
        finish(replan.shiftedCount, replan.shiftedHours, replan.plan);
      }
    });
  }

  function resumeLine(line) {
    /* Mark a line resumed: drop the active stoppage so the KPI strip
       returns to N/N and the lane badge clears. Any plan changes from
       a Replan are intentionally left in place — the planner already
       committed to that new sequence. */
    const active = stoppages.find((s) => s.line === line);
    setStoppages((prev) => prev.filter((s) => s.line !== line));
    /* If a replan banner is still up for the same line (planner hadn't
       acted yet), clear it too. */
    setReplanPrompt((prev) => (prev?.line === line ? null : prev));
    setToast({
      id: `res-${Date.now()}`,
      title: `L${line} resumed`,
      detail: 'Line back in production',
      tone: 'neutral',
    });
    if (active?.id && !active.id.startsWith('stp-local-')) {
      apiResumeStoppage(active.id)
        .then(({ stoppages: serverList }) => {
          if (Array.isArray(serverList)) setStoppages(serverList);
        })
        .catch((err) => {
          if (import.meta.env.DEV) console.warn('[resume] backend unavailable', err);
        });
    }
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
          onSettings={() => setSettingsOpen(true)}
          onLogout={() => { /* TODO: wire to auth */ }}
        />

        {view === 'recs' ? (
          <div className="shell plan-shell">
            <PlanLab data={data} order={activeOrder} onBack={backToQueue} />
          </div>
        ) : (
          <div className={`shell${inRecs ? ' recs' : ''}`}>
            <div className="panel">
              {view === 'calculating' && (
                <PanelCalculating order={activeOrder} />
              )}
            </div>

            <div className="stage">
              <div className="stage-pad">
                {view === 'queue' && (
                  <DefaultStage
                    data={data}
                    timelineProps={timelineProps}
                    zoom={zoom}
                    onZoom={setZoom}
                    stoppages={stoppages}
                    issues={issues}
                    replanPrompt={replanPrompt}
                    onReplan={startReplan}
                    onDismissReplan={() => setReplanPrompt(null)}
                    onResumeLine={resumeLine}
                    signalsData={signalsData}
                    onRefreshSignals={refreshSignalsApi}
                    dismissedSignals={dismissedSignals}
                    onDismissSignal={dismissSignal}
                    onReviewSignal={reviewSignal}
                    worldSignalsRef={worldSignalsRef}
                    onResequence={resequenceWeek}
                  />
                )}
                {view === 'calculating' && <CalculatingStage />}
              </div>
            </div>
          </div>
        )}

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
          {settingsOpen && (
            <SettingsDrawer
              key="settings"
              settings={settings}
              lineRules={data.lineRules}
              onChange={setSettings}
              onClose={() => setSettingsOpen(false)}
            />
          )}
          {draftOpen && (
            <DraftPlanPanel
              key="draft"
              plan={effectivePlan}
              lineBaseline={data.lineBaseline}
              onClose={() => setDraftOpen(false)}
              onRunClick={(run) => {
                const lineKey = run.lineKey;
                const lane = effectivePlan?.[lineKey] ?? [];
                const idx = lane.findIndex((s) => s.of === run.of);
                if (idx < 0) return;
                const seg = lane[idx];
                setRunDetail({
                  seg: {
                    material: seg.of,
                    sku: seg.sku,
                    volume: seg.vol,
                    oee: seg.oee,
                    durationHours: (seg.w ?? 0) * 24,
                    format: deriveFormat({ sku: seg.sku, material: seg.of }),
                  },
                  prev: lane[idx - 1] ? {
                    material: lane[idx - 1].of,
                    sku: lane[idx - 1].sku,
                    volume: lane[idx - 1].vol,
                    oee: lane[idx - 1].oee,
                    durationHours: (lane[idx - 1].w ?? 0) * 24,
                  } : null,
                  next: lane[idx + 1] ? {
                    material: lane[idx + 1].of,
                    sku: lane[idx + 1].sku,
                    volume: lane[idx + 1].vol,
                    oee: lane[idx + 1].oee,
                    durationHours: (lane[idx + 1].w ?? 0) * 24,
                  } : null,
                  lineKey,
                  baseline: data.lineBaseline?.[lineKey],
                  state: 'planned',
                  /* Origin marker: when the modal was opened from the
                     Draft Plan drawer we expose the "Recalculate &
                     preview in planner" action, which lands the planner
                     on this run's line after a calculating flash. */
                  fromDraft: true,
                  rawRun: { ...seg, lineKey },
                });
                setDraftOpen(false);
              }}
            />
          )}
        </AnimatePresence>

        {view === 'queue' && !inboxOpen && !issueModalOpen && !stoppageModalOpen && (
          <Fab
            onAction={(key) => {
              if (key === 'order')    setInboxOpen(true);
              if (key === 'issue')    setIssueModalOpen(true);
              if (key === 'stoppage') setStoppageModalOpen(true);
            }}
          />
        )}

        <IssueModal
          open={issueModalOpen}
          onClose={() => setIssueModalOpen(false)}
          onSubmit={logIssue}
        />
        <StoppageModal
          open={stoppageModalOpen}
          onClose={() => setStoppageModalOpen(false)}
          onSubmit={logStoppage}
        />
        <LogToast toast={toast} onDismiss={() => setToast(null)} />

        {/* Live status pill — fixed at bottom-left of the canvas so the
            planner always knows whether the data on screen is current.
            PlanLab renders its own live indicator in its footer, so hide
            this one when the recs view is active to avoid duplicates. */}
        {view !== 'recs' && (
          <div className="live-anchor">
            <LiveStatus data={data} lastSync={lastSyncRef.current} />
          </div>
        )}

        {overlays}
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

function DefaultStage({
  data, timelineProps, zoom, onZoom,
  stoppages = [], issues = [], replanPrompt = null, onReplan, onDismissReplan, onResumeLine,
  signalsData = null, onRefreshSignals = null,
  dismissedSignals = new Set(), onDismissSignal = () => {}, onReviewSignal = () => {},
  worldSignalsRef = null,
  onResequence = null,
}) {
  const stoppedLines = stoppages.map((s) => s.line);
  return (
    <>
      <SignalAlert
        data={signalsData}
        dismissed={dismissedSignals}
        onDismiss={onDismissSignal}
        onReview={onReviewSignal}
      />
      <KPIStrip data={data} stoppedLines={stoppedLines} />
      <YearCompare data={data} />
      <div ref={worldSignalsRef}>
        <WorldSignals data={signalsData} onRefresh={onRefreshSignals} />
      </div>
      <ReplanBanner
        prompt={replanPrompt}
        onReplan={onReplan}
        onDismiss={onDismissReplan}
      />
      <div className="stage-head">
        <div>
          <div className="stage-title">Production schedule</div>
          <div className="stage-sub">Executed history left of today · forward plan right</div>
        </div>
        <div className="stage-head-right">
          {onResequence && (
            <button
              type="button"
              className="resequence-btn"
              onClick={onResequence}
              title="Reorder the forward queue to minimise total changeover cost"
            >
              ↻ Re-sequence week
            </button>
          )}
          <ZoomCtl zoom={zoom} onZoom={onZoom} />
        </div>
      </div>
      <Timeline
        data={data}
        mode="default"
        zoom={zoom}
        stoppages={stoppages}
        issues={issues}
        onResumeLine={onResumeLine}
        {...timelineProps}
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

/* ---------- quick-action label helpers ---------- */

function labelCategory(k) {
  return { mech: 'Mechanical', elec: 'Electrical', quality: 'Quality', material: 'Material' }[k] || k;
}
function labelSeverity(k) {
  return { warn: 'Warning', critical: 'Critical' }[k] || k;
}
function labelReason(k) {
  return {
    'breakdown': 'Breakdown',
    'no-material': 'No material',
    'no-operator': 'No operator',
    'quality-hold': 'Quality hold',
    'other': 'Other',
  }[k] || k;
}
function labelDuration(k) {
  return { '15m': '15 min', '30m': '30 min', '1h': '1 hour', '2h+': '2 h+', 'unknown': 'unknown' }[k] || k;
}
function fmtShiftHours(h) {
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h === 1) return '1 hour';
  return `${h} hours`;
}

export default App;
