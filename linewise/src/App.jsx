import { useState, useEffect, useRef } from 'react';
import { AnimatePresence } from 'framer-motion';
import { usePlan } from './hooks/usePlan.js';
import { useTimelineMoveFlow } from './hooks/useTimelineMoveFlow.js';
import { useChangeLedger } from './hooks/useChangeLedger.js';
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
import ShiftCloseModal, { LAST_HANDOFF_STORAGE_KEY } from './components/ShiftCloseModal.jsx';
import ReplanBanner from './components/ReplanBanner.jsx';
import LogToast from './components/LogToast.jsx';
import SettingsDrawer from './components/SettingsDrawer.jsx';
import ProvenanceModal from './components/ProvenanceModal.jsx';
import YearCompare from './components/YearCompare.jsx';
import { useSettings } from './hooks/useSettings.js';
import {
  postIssue,
  postStoppage,
  resumeStoppage as apiResumeStoppage,
  postStoppageReplan,
  postResequence,
} from './api/client.js';
import { computeStoppageReplan } from './lib/stoppagePlan.js';
import { buildOptimizationContext } from './lib/optimizationContext.js';
import { deriveFormat } from './components/TimelineCard.jsx';
import { signalToCitation, worldSignals } from './lib/cala-mock.js';
import { CalaVerticalIcon, getCalaVertical } from './lib/calaVerticals.js';
import BrewLoader from './components/BrewLoader.jsx';

/* App state mirrors the prototype's `state` object 1:1.
   view : 'queue' (landing planner) | 'calculating' | 'recs'
   objective : 'oee' | 'time' | 'dis'
   selectedLine : key into data.recommendations
   manualSlot   : key into data.manualSlots
   showNaive    : toggles the naive-slot band on the timeline
   zoom         : 'week' | 'month' | 'quarter'                           */
function App() {
  const { data, loading, error, reload } = usePlan();
  const forceLoading = new URLSearchParams(location.search).get('demo') === 'loading';

  if (loading || forceLoading) return <BootShell><LoadingState /></BootShell>;
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
  const [plannerMovePreview, setPlannerMovePreview] = useState(null);
  const [plannerOpenOrderOf, setPlannerOpenOrderOf] = useState(null);
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
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [lastHandoff, setLastHandoff] = useState(readLastHandoff);
  const [settings, setSettings] = useSettings();
  const { changes: ledgerChanges, appendChange } = useChangeLedger();
  const lastSyncRef = useRef(Date.now());

  /* surface the urgent-orders inbox once on boot */
  useEffect(() => {
    if (!demo) setInboxOpen(true);
  }, [demo]);

  /* Keep the inbox aligned with the latest plan payload. This matters in
     the demo server because plan.json can change while the app is already
     open; preserve manually-created orders, but merge in server examples. */
  useEffect(() => {
    const planOrders = data.urgentOrders ?? [];
    setOrders((current) => mergePlanOrders(current, planOrders));
    setActiveOrder((current) => {
      if (!current) return planOrders[0] ?? null;
      const fresh = planOrders.find((order) => order.of === current.of);
      return fresh ? { ...current, ...fresh } : current;
    });
  }, [data.urgentOrders]);

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
    optimizationContext: buildOptimizationContext(data, selectedImpact || objective),
    onMoveAccepted: (preview) => {
      setActiveOrder(orderFromMovePreview(preview));
      setInboxOpen(false);
      setDraftOpen(false);
      setView('calculating');
      return 'planner';
    },
    onMovePreviewReady: (preview) => {
      setPlannerMovePreview(preview);
      setObjective('oee');
      setSelectedImpact('oee');
      setSelectedLine(preview.ripple.toLine || data.objectives.oee.order[0]);
      setShowNaive(false);
      appendChange({
        action: 'moveToPlanner',
        type: 'manual_move_confirmed',
        summary: `${preview.ripple.runId} moved from L${preview.ripple.fromLine} to L${preview.ripple.toLine}`,
        rationale: 'line-change',
        runId: preview.ripple.runId,
        fromLine: preview.ripple.fromLine,
        toLine: preview.ripple.toLine,
        ripple: preview.ripple,
      });
      setView('recs');
    },
    onLedgerEvent: appendChange,
    getOnPreviewInPlanner: ({ runDetail }) => runDetail?.fromDraft
      ? () => previewDraftRun(runDetail.rawRun)
      : undefined,
  });

  const effectivePlan = timelineProps.effectivePlan;

  const inRecs = view === 'recs' || view === 'calculating';

  function selectUrgent(order = orders[0]) {
    if (order) setActiveOrder(order);
    setPlannerMovePreview(null);
    setPlannerOpenOrderOf(
      order?.status === 'queued' || order?.status === 'scheduled'
        ? order.of
        : null,
    );
    if (order) {
      const queued = order.status === 'queued' || order.status === 'scheduled';
      appendChange({
        action: queued ? 'selectQueued' : 'selectUrgent',
        type: queued ? 'queued_order_selected' : 'urgent_order_selected',
        summary: `Selected ${queued ? 'queued' : 'urgent'} order ${order.of}`,
        order: {
          of: order.of,
          sku: order.sku,
          units: order.units,
          hl: order.hl,
          due: order.due,
          status: order.status,
        },
      });
    }
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

  function replanAllUrgents(urgentOrders = orders.filter((o) => o.status === 'urgent')) {
    selectUrgent(urgentOrders[0]);
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
    setPlannerMovePreview(null);
    setPlannerOpenOrderOf(null);
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
    setPlannerMovePreview(null);
    setPlannerOpenOrderOf(null);
    setView('queue');
  }

  function logIssue(payload) {
    /* Optimistic local update first (so the chip + ledger feel instant),
       then reconcile from the server's view if /issues is reachable.
       Backend offline = local-only behaviour; the demo keeps working. */
    const entry = { id: `iss-local-${Date.now()}`, ts: Date.now(), ...payload };
    setIssues((prev) => [entry, ...prev]);
    appendChange({
      action: 'logIssue',
      type: 'issue_logged',
      summary: `Issue logged on L${entry.line}`,
      issueId: entry.id,
      line: entry.line,
      category: entry.category,
      severity: entry.severity,
      note: entry.note,
      reportedAt: entry.ts,
    });
    setIssueModalOpen(false);
    setToast({
      id: entry.id,
      title: `Issue logged on L${entry.line}`,
      detail: `${labelCategory(entry.category)} · ${labelSeverity(entry.severity)}`,
      tone: entry.severity === 'critical' ? 'warn' : 'neutral',
    });
    postIssue({ ...payload, ts: entry.ts })
      .then(({ issue }) => {
        setIssues((prev) => prev.map((i) => (i.id === entry.id ? issue : i)));
      })
      .catch((err) => {
        if (import.meta.env.DEV) console.warn('[issues] backend unavailable, keeping local entry', err);
      });
  }

  function logStoppage(payload) {
    /* One active stoppage per line — replace any prior. Optimistic
       local update mirrors the server's invariant; reconcile from the
       response so id/ts match what the server stored when available. */
    const entry = { id: `stp-local-${Date.now()}`, ts: Date.now(), ...payload };
    setStoppages((prev) => [
      entry,
      ...prev.filter((s) => s.line !== entry.line),
    ]);
    appendChange({
      action: 'logStoppage',
      type: 'stoppage_logged',
      summary: `L${entry.line} stopped`,
      stoppageId: entry.id,
      line: entry.line,
      reason: entry.reason,
      duration: entry.duration,
      startedAt: entry.startedAt,
      startAgoMin: entry.startAgoMin,
      reportedAt: entry.ts,
    });
    setStoppageModalOpen(false);
    setReplanPrompt({ ...entry, source: 'internal' });
    setToast({
      id: entry.id,
      title: `L${entry.line} stopped`,
      detail: `${labelReason(entry.reason)} · est. ${labelDuration(entry.duration)}`,
      tone: 'bad',
    });
    postStoppage({ ...payload, ts: entry.ts })
      .then(({ stoppages: serverList, stoppage }) => {
        if (Array.isArray(serverList)) setStoppages(serverList);
        if (stoppage) {
          setReplanPrompt((prev) => (prev?.id === entry.id ? { ...stoppage, source: 'internal' } : prev));
        }
      })
      .catch((err) => {
        if (import.meta.env.DEV) console.warn('[stoppages] backend unavailable, keeping local entry', err);
      });
  }

  function startReplan() {
    if (!replanPrompt) return;
    /* Real replan: shift every planned segment on the stopped lane
       forward by the stoppage duration and commit the new plan. The
       short calculating flash mirrors the urgent-order flow so it
       feels like the same product moment, but here we end up back
       on the schedule (not the recs view) with a visibly updated
       timeline. */
    const prompt = replanPrompt;
    const line = prompt.line;
    setReplanPrompt(null);
    setView('calculating');

    const finish = (shiftedCount, shiftedHours, nextPlan) => {
      if (nextPlan) setCommittedPlan(nextPlan);
      appendChange({
        action: 'startReplan',
        type: 'stoppage_replan_committed',
        summary: `L${line} replanned after stoppage`,
        line,
        stoppageId: prompt.id,
        reason: prompt.reason,
        duration: prompt.duration,
        shiftedCount,
        shiftedHours,
      });
      setView('queue');
      setToast({
        id: `rpl-${Date.now()}`,
        title: `L${line} replanned`,
        detail: `Shifted ${shiftedCount} ${shiftedCount === 1 ? 'run' : 'runs'} by ${fmtShiftHours(shiftedHours)}`,
        tone: 'neutral',
      });
    };

    /* Try the backend first; the calculating flash plays in parallel so
       the UI feels instant either way. If /plan/stoppage-replan answers
       we use the server's recomputed plan, otherwise we fall back to
       the client-side shift in stoppagePlan.js. */
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

  function resequenceWeek() {
    /* Global re-sequencer trigger. Backend persists the new basePlan
       as a plan_override; we surface savings as a toast and reload to
       pick up the new schedule. Graceful "backend offline" toast when
       the API isn't reachable so the demo doesn't dead-end. */
    postResequence()
      .then((resp) => {
        const s = resp?.summary ?? {};
        const delta = Number(s.totalCostDelta ?? 0);
        const reordered = Number(s.totalReordered ?? 0);
        setToast({
          id: `rsq-${Date.now()}`,
          title: reordered > 0 ? 'Week re-sequenced' : 'Already optimal',
          detail: reordered > 0
            ? `Saved ${delta.toFixed(2)} changeover cost · ${reordered} runs moved`
            : 'No moves improved the total — schedule kept as-is',
          tone: reordered > 0 ? 'good' : 'neutral',
        });
        appendChange({
          action: 'resequenceWeek',
          type: 'plan_applied',
          summary: reordered > 0
            ? `Week re-sequenced (Δ ${delta.toFixed(2)} cost, ${reordered} runs moved)`
            : 'Re-sequence ran — no improvement, plan untouched',
        });
        reload?.();
      })
      .catch((err) => {
        if (import.meta.env.DEV) console.warn('[resequence] failed', err);
        setToast({
          id: `rsq-err-${Date.now()}`,
          title: 'Re-sequence unavailable',
          detail: 'Backend not reachable — start ./scripts/run_server.sh',
          tone: 'warn',
        });
      });
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
          onHandoff={() => setHandoffOpen(true)}
          onSettings={() => setSettingsOpen(true)}
          onLogout={() => { /* TODO: wire to auth */ }}
        />

        {view === 'recs' ? (
          <div className="shell plan-shell">
            <PlanLab
              key={plannerMovePreview
                ? `move-${plannerMovePreview.ripple.runId}-${plannerMovePreview.ripple.toLine}`
                : `plan-${activeOrder?.of ?? 'none'}`}
              data={data}
              order={activeOrder}
              initialMovePreview={plannerMovePreview}
              autoOpenOrderOf={plannerOpenOrderOf}
              onBack={backToQueue}
              onSaveDraft={({ title, metrics }) => {
                appendChange({
                  action: 'saveDraftPlan',
                  type: 'draft_plan_saved',
                  summary: `Draft saved: ${title}`,
                  title,
                  metrics,
                });
                setToast({
                  id: `draft-${Date.now()}`,
                  title: 'Draft saved',
                  detail: title,
                  tone: 'neutral',
                });
              }}
              onSendReport={({ title, metrics }) => {
                appendChange({
                  action: 'sendPlanReport',
                  type: 'plan_report_sent',
                  summary: `Report sent: ${title}`,
                  title,
                  metrics,
                });
                setToast({
                  id: `report-${Date.now()}`,
                  title: 'Report sent',
                  detail: title,
                  tone: 'neutral',
                });
              }}
              onApplyPlan={({ plan, title, metrics }) => {
                setCommittedPlan(plan);
                appendChange({
                  action: 'applyPlan',
                  type: 'plan_applied',
                  summary: `Applied plan: ${title}`,
                  title,
                  metrics,
                });
                setToast({
                  id: `apply-${Date.now()}`,
                  title: 'Plan applied',
                  detail: title,
                  tone: 'neutral',
                });
                backToQueue();
              }}
            />
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
                    orders={orders}
                    timelineProps={timelineProps}
                    zoom={zoom}
                    onZoom={setZoom}
                    stoppages={stoppages}
                    issues={issues}
                    changes={ledgerChanges}
                    replanPrompt={replanPrompt}
                    onReplan={startReplan}
                    onSelectUrgent={selectUrgent}
                    onDismissReplan={() => setReplanPrompt(null)}
                    onResumeLine={resumeLine}
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
              data={data}
              effectivePlan={effectivePlan}
              mode="briefing"
              ledgerChanges={ledgerChanges}
              lastHandoff={lastHandoff}
              onClose={() => setInboxOpen(false)}
              onSelectUrgent={selectUrgent}
              onReplanAll={replanAllUrgents}
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
        <ShiftCloseModal
          open={handoffOpen}
          changes={ledgerChanges}
          issues={issues}
          stoppages={stoppages}
          onClose={() => setHandoffOpen(false)}
          onSent={(payload) => {
            setLastHandoff(payload);
            setToast({
              id: payload.id,
              title: 'Handoff sent',
              detail: `${payload.changes.length} recent ${payload.changes.length === 1 ? 'change' : 'changes'} included`,
              tone: 'neutral',
            });
          }}
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
    <div className="center-state" style={{ background: '#fff', minHeight: '70vh', borderRadius: 12 }}>
      <BrewLoader />
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
  data, orders = data?.urgentOrders ?? [], timelineProps, zoom, onZoom,
  stoppages = [], issues = [], changes = [], replanPrompt = null, onReplan, onSelectUrgent, onDismissReplan, onResumeLine,
  onResequence = null,
}) {
  const stoppedLines = stoppages.map((s) => s.line);
  return (
    <>
      <KPIStrip
        data={data}
        stoppedLines={stoppedLines}
        urgentOrders={orders}
        onSelectUrgent={onSelectUrgent}
      />
      <YearCompare data={data} />
      <ReplanBanner
        prompt={replanPrompt}
        onReplan={onReplan}
        onDismiss={onDismissReplan}
      />
      <div className="stage-head">
        <div className="stage-head-title">
          <div className="stage-title">Production schedule</div>
          <div className="stage-sub">Executed history left of today · forward plan right</div>
        </div>
        <HomepageNewsStrip data={data} plan={timelineProps.effectivePlan} changes={changes} />
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

function HomepageNewsStrip({ data, plan, changes = [] }) {
  const [activeItem, setActiveItem] = useState(null);
  const signals = worldSignals
    .filter((signal) => signal.severity === 'high' || signal.severity === 'medium')
    .map((signal) => ({
      signal,
      impact: impactedVolumeForSignal(signal, data, plan),
    }))
    .filter((item) => item.impact.orderCount > 0)
    .sort((a, b) => priorityRank(a.signal) - priorityRank(b.signal))
    .slice(0, 2);

  if (!signals.length) return <RecentChangesRail changes={changes} />;

  return (
    <section className="news-strip" aria-label="External signals and impacted orders">
      <div className="news-strip-label">
        <span>Cala priorities</span>
        <small>Impacted volume</small>
      </div>
      <div className="news-strip-items">
        {signals.map(({ signal, impact }, index) => (
          <NewsStripCard
            signal={signal}
            impact={impact}
            priority={index + 1}
            key={signal.id}
            onClick={() => setActiveItem({ signal, impact, priority: index + 1 })}
          />
        ))}
      </div>
      <ProvenanceModal
        open={!!activeItem}
        citations={activeItem ? [signalToCitation(activeItem.signal)] : []}
        title={activeItem?.signal?.headline ?? 'Cala priority'}
        onClose={() => setActiveItem(null)}
      >
        {activeItem && <NewsImpactSummary item={activeItem} />}
      </ProvenanceModal>
    </section>
  );
}

function NewsStripCard({ signal, impact, priority, onClick }) {
  const meta = getCalaVertical(signal.vertical);
  const priorityLabel = `P${priority}`;

  return (
    <button
      type="button"
      className={`news-card ${meta.accentClass}`}
      onClick={onClick}
      aria-label={`${priorityLabel} ${meta.name}: ${signal.headline}. ${formatNewsUnits(impact.totalUnits)} impacted`}
      title={`${priorityLabel} · ${signal.headline} · ${formatNewsUnits(impact.totalUnits)} impacted`}
    >
      <span className="news-icon">
        <CalaVerticalIcon vertical={signal.vertical} size={15} />
      </span>
      <span className="news-priority">{priorityLabel}</span>
      <span className="news-main">
        <span className="news-topline">
          {meta.shortLabel}
          <b>{signal.delta}</b>
        </span>
        <span className="news-headline">{signal.headline}</span>
      </span>
      <span className="news-impacts" aria-label={`Impacted volume for ${signal.headline}`}>
        <b>{formatNewsUnits(impact.totalUnits)}</b>
        <small>{impact.orderCount} OFs</small>
      </span>
      <time className="news-time" dateTime={signal.fetchedAt}>{fmtSignalTime(signal.fetchedAt)}</time>
    </button>
  );
}

function NewsImpactSummary({ item }) {
  const meta = getCalaVertical(item.signal.vertical);
  return (
    <section className={`news-modal-impact ${meta.accentClass}`} aria-label="Impacted volume">
      <div className="news-modal-metric">
        <span>Total impacted volume</span>
        <b>{formatNewsUnits(item.impact.totalUnits)}</b>
      </div>
      <div className="news-modal-metric">
        <span>Impacted OFs</span>
        <b>{item.impact.orderCount}</b>
      </div>
      <div className="news-modal-list">
        {item.impact.orders.slice(0, 8).map((order) => (
          <span key={order.of}>
            <b>{order.of}</b>
            <em>{formatNewsUnits(order.units)}</em>
            {order.line && <small>L{order.line}</small>}
          </span>
        ))}
      </div>
    </section>
  );
}

function impactedVolumeForSignal(signal, data, plan) {
  const affectedOfs = new Set(signal.affects?.ofs ?? []);
  const affectedLines = new Set((signal.affects?.lines ?? []).map(String));
  const orders = new Map();

  for (const order of data?.urgentOrders ?? []) {
    if (affectedOfs.has(order.of)) {
      upsertImpactedOrder(orders, {
        of: order.of,
        units: Number(order.units) || 0,
        status: order.status,
      });
    }
  }

  for (const [lineKey, lane] of Object.entries(plan ?? {})) {
    for (const run of lane ?? []) {
      if (!run?.of || run.kind === 'clean' || run.kind === 'maint') continue;
      if (!affectedOfs.has(run.of) && !affectedLines.has(String(lineKey))) continue;
      upsertImpactedOrder(orders, {
        of: run.of,
        units: Math.round((Number(run.vol) || 0) * 1000),
        line: String(lineKey),
      });
    }
  }

  const orderList = [...orders.values()].sort((a, b) => b.units - a.units);
  return {
    orderCount: orderList.length,
    totalUnits: orderList.reduce((sum, order) => sum + order.units, 0),
    orders: orderList,
  };
}

function upsertImpactedOrder(orders, next) {
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

function formatNewsUnits(units) {
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

function fmtSignalTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'now';
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function RecentChangesRail({ changes = [] }) {
  const recent = changes.slice(-5);
  if (!recent.length) return null;
  return (
    <div className="change-rail" aria-label="Recent changes">
      <span className="change-rail-label">Recent changes</span>
      <div className="change-rail-items">
        {recent.map((change) => (
          <button
            key={change.id}
            type="button"
            className="change-pill"
            title={detailForLedgerChange(change)}
          >
            <span>{fmtLedgerTime(change.ts)}</span>
            <span className="change-pill-main">
              <b>{change.summary ?? change.type}</b>
              <small>{whyForLedgerChange(change)}</small>
            </span>
          </button>
        ))}
      </div>
    </div>
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
function orderFromMovePreview(preview) {
  const ripple = preview?.ripple ?? {};
  const run = (preview?.plan?.[ripple.toLine] ?? []).find((seg) => seg?.of === ripple.runId)
    ?? preview?.moving?.run
    ?? {};
  return {
    of: ripple.runId ?? run.of ?? 'Manual move',
    status: 'planned',
    sku: run.sku ?? 'Moved order',
    units: Math.round((Number(run.vol) || 0) * 1000),
    hl: 0,
    due: 'scheduled',
  };
}
function mergePlanOrders(current = [], planOrders = []) {
  if (!planOrders.length) return current;
  const planIds = new Set(planOrders.map((order) => order.of));
  const currentById = new Map(current.map((order) => [order.of, order]));
  const manualOrders = current.filter((order) => !planIds.has(order.of));
  const merged = [
    ...manualOrders,
    ...planOrders.map((order) => ({ ...(currentById.get(order.of) ?? {}), ...order })),
  ];
  if (merged.length !== current.length) return merged;
  const changed = merged.some((order, index) => {
    const prior = current[index];
    return !prior
      || prior.of !== order.of
      || prior.status !== order.status
      || prior.sku !== order.sku
      || prior.units !== order.units
      || prior.hl !== order.hl
      || prior.due !== order.due;
  });
  return changed ? merged : current;
}
function readLastHandoff() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LAST_HANDOFF_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function fmtLedgerTime(ts) {
  if (!ts) return '--:--';
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(ts));
}
function detailForLedgerChange(change) {
  if (change.type === 'manual_move_confirmed') return `Why: ${change.rationale ?? 'manual'} · L${change.fromLine} to L${change.toLine}`;
  if (change.type === 'stoppage_replan_committed') return `Why: ${labelReason(change.reason)} · ${change.shiftedCount ?? 0} runs shifted by ${fmtShiftHours(change.shiftedHours ?? 0)}`;
  if (change.type === 'stoppage_logged') return `Why: ${labelReason(change.reason)} · ${labelDuration(change.duration)}`;
  if (change.type === 'issue_logged') return `Why: ${labelCategory(change.category)} · ${labelSeverity(change.severity)}`;
  return change.summary ?? 'Planner change';
}
function whyForLedgerChange(change) {
  if (change.type === 'manual_move_confirmed') return `Why: ${change.rationale ?? 'manual'}`;
  if (change.type === 'stoppage_replan_committed') return `Why: ${labelReason(change.reason)}`;
  if (change.type === 'stoppage_logged') return `Why: ${labelReason(change.reason)}`;
  if (change.type === 'issue_logged') return `Why: ${labelCategory(change.category)}`;
  if (change.type === 'urgent_order_selected') return 'Why: urgent order';
  return 'Why: planner action';
}

export default App;
