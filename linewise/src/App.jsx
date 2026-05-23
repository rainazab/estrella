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

/* App state mirrors the prototype's `state` object 1:1.
   view : 'queue' (landing planner) | 'calculating' | 'recs'
   objective : 'oee' | 'time' | 'dis'
   selectedLine : key into data.recommendations
   manualSlot   : key into data.manualSlots
   showNaive    : toggles the naive-slot band on the timeline
   zoom         : 'day' | 'week' | 'month'                              */
function App() {
  const { data, loading, error, reload } = usePlan();

  if (loading) return <BootShell><LoadingState /></BootShell>;
  if (error)   return <BootShell><ErrorState error={error} onRetry={reload} /></BootShell>;
  return <Workspace data={data} />;
}

/* Workspace — only mounts once data has arrived, so every child can
   safely assume `data` is the full plan contract. */
function Workspace({ data }) {
  const [view, setView] = useState('queue');
  const [objective, setObjective] = useState('oee');
  const [selectedLine, setSelectedLine] = useState(null);
  const [manualSlot, setManualSlot] = useState(null);
  const [showNaive, setShowNaive] = useState(false);
  const [zoom, setZoom] = useState('day');
  const [inboxOpen, setInboxOpen] = useState(false);
  const lastSyncRef = useRef(Date.now());

  /* surface the urgent-orders inbox once on boot */
  useEffect(() => { setInboxOpen(true); }, []);

  const inRecs = view === 'recs' || view === 'calculating';

  function selectUrgent() {
    setInboxOpen(false);
    setView('calculating');
    setTimeout(() => {
      setObjective('oee');
      setSelectedLine(data.objectives.oee.order[0]);
      setShowNaive(false);
      setView('recs');
    }, 1300);
  }

  function backToQueue() {
    setSelectedLine(null);
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

  const urgentCount = data.urgentOrders.filter((o) => o.status === 'urgent').length;

  return (
    <div className="app">
      <div className="main">
        <TopBar
          urgentCount={urgentCount}
          inboxOpen={inboxOpen}
          onBellClick={() => setInboxOpen((o) => !o)}
          onSettings={() => { /* TODO: open settings */ }}
          onLogout={() => { /* TODO: wire to auth */ }}
        />

        <div className={`shell${inRecs ? ' recs' : ''}`}>
          <div className="panel">
            {view === 'calculating' && (
              <PanelCalculating order={data.urgentOrders[0]} />
            )}
            {view === 'recs' && (
              <RecommendationPanel
                data={data}
                order={data.urgentOrders[0]}
                objective={objective}
                selectedLine={selectedLine}
                manualSlot={manualSlot}
                onObjectiveChange={(k) => {
                  setObjective(k);
                  setSelectedLine(data.objectives[k].order[0]);
                  setShowNaive(false);
                }}
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
                <DefaultStage data={data} zoom={zoom} onZoom={setZoom} />
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
              orders={data.urgentOrders}
              onClose={() => setInboxOpen(false)}
              onSelectUrgent={selectUrgent}
            />
          )}
        </AnimatePresence>

        {view === 'queue' && !inboxOpen && (
          <Fab onClick={() => setInboxOpen(true)} />
        )}

        {/* Live status pill — fixed at bottom-left of the canvas so the
            planner always knows whether the data on screen is current. */}
        <div className="live-anchor">
          <LiveStatus data={data} lastSync={lastSyncRef.current} />
        </div>
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

function DefaultStage({ data, zoom, onZoom }) {
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
      <Timeline data={data} mode="default" zoom={zoom} />
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
      {Object.entries({ day: 'Day', week: 'Week', month: 'Month' }).map(([k, label]) => (
        <button key={k} className={zoom === k ? 'on' : ''} onClick={() => onZoom(k)}>{label}</button>
      ))}
    </div>
  );
}

export default App;
