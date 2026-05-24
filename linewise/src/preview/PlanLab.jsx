import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { usePlan } from '../hooks/usePlan.js';
import { buildAnalogueIndex, evidenceVerdict } from '../lib/analogues.js';
import AnalogueModal from '../components/AnalogueModal.jsx';
import InfoPopover from '../components/InfoPopover.jsx';
import './plan-lab.css';

/* PlanLab — /?lab=plan
   Reshaped "Proposed plan" view: small strategy cards on the left, the
   headline impact panel up top with the "Why this recommendation" content
   folded into an inline accordion (no right-side drawer), and a simple
   before/after timeline below. Built as a lab so we can compare against
   the current narrow-column RecommendationPanel without touching App.jsx. */
export default function PlanLab() {
  const { data, loading, error } = usePlan();
  const [activeId, setActiveId] = useState('oee');
  const [whyOpen, setWhyOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [showNaive, setShowNaive] = useState(false);
  const [manualSlot, setManualSlot] = useState(null); // null | manualSlot key
  const [zoom, setZoom] = useState('week');

  if (loading) return <div className="pl-loading">Loading…</div>;
  if (error)   return <div className="pl-loading">Error: {String(error.message || error)}</div>;

  const options = buildOptions(data);
  const active = options.find((o) => o.id === activeId) || options[0];

  // If Maria has dropped the chip somewhere manual, that slot drives the panel.
  // Otherwise we follow the strategy chip she picked.
  const manualEntry = manualSlot ? data.manualSlots[manualSlot] : null;
  const rec = data.recommendations[manualEntry?.recKey || active.recKey];
  const order = data.urgentOrders[0];
  const rows = buildAnalogueIndex(manualEntry?.recKey || active.recKey, rec.evidence);
  const verdict = evidenceVerdict(rec, rows);
  const recommendedId = 'oee';

  const verdictTone = verdict.tone === 'bad' ? 'bad' : verdict.tone === 'warn' ? 'mid' : 'good';
  const recoveryHours = rec.recovery?.hours ? `${rec.recovery.hours}h` : '—';

  const rationale = stripHtml(rec.evidence.reason);

  function copyReport() {
    const text = [
      `${active.title} — ${rec.line} ${rec.position}`,
      `OEE ${rec.oeeDelta} · due date ${rec.deadline} · ${rec.ordersMoved} orders moved · recovery ${recoveryHours}`,
      `Tradeoff: ${active.tradeoff}`,
      rationale,
    ].join('\n');
    navigator.clipboard?.writeText(text);
  }

  return (
    <div className="pl-root">
      {/* Order banner — the decision target gets the loudest pixel */}
      <header className="pl-order">
        <span className="pl-order-tag">URGENT</span>
        <div className="pl-order-main">
          <b>{order.of}</b>
          <span>{order.sku} · {order.units.toLocaleString()} un · {order.hl} hl</span>
        </div>
        <div className="pl-order-meta">
          <span>Due <b>{order.due}</b></span>
          <span>Decision by <b>17:00 today</b></span>
        </div>
      </header>

      <div className="pl-grid">
        {/* LEFT — strategy picker */}
        <aside className="pl-rail" aria-label="Strategies">
          <div className="pl-rail-h">Preview as</div>
          <div className="pl-rail-list">
            {options.map((opt) => {
              const r = data.recommendations[opt.recKey];
              const selected = !manualEntry && active.id === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  className={`pl-card${selected ? ' on' : ''} tone-${opt.tone}`}
                  onClick={() => { setActiveId(opt.id); setManualSlot(null); setWhyOpen(false); }}
                  aria-pressed={selected}
                >
                  <div className="pl-card-top">
                    <span className="pl-card-dot" aria-hidden="true" />
                    <span className="pl-card-name">{opt.title}</span>
                    {opt.id === recommendedId && <span className="pl-card-star" title="LineWise recommends">★</span>}
                  </div>
                  <div className="pl-card-hero">{r.oeeDelta} <small>OEE</small></div>
                  <div className="pl-card-row">
                    <span>{r.deadline}</span>
                    <span>·</span>
                    <span>{r.ordersMoved} mv</span>
                  </div>
                  <div className={`pl-card-tradeoff t-${opt.tone}`}>⚠ {opt.tradeoff}</div>
                </button>
              );
            })}
          </div>
        </aside>

        <main className="pl-main">
          <section className={`pl-impact tone-${manualEntry ? 'mid' : active.tone}`}>
            <div className="pl-impact-h">
              <div className="pl-impact-title">
                <div className="pl-kicker-row">
                  <span className="pl-kicker">{manualEntry ? 'Manual override' : 'Impact preview'}</span>
                </div>
                <h2>
                  {manualEntry ? manualEntry.label : active.title}
                  {!manualEntry && active.id === recommendedId && <span className="pl-star" title="LineWise recommends">★</span>}
                </h2>
                {manualEntry && (
                  <span className="pl-impact-sub">Strategy on hold: {active.title}</span>
                )}
              </div>

              <button
                className="pl-open-evidence pl-open-evidence-top"
                type="button"
                onClick={() => setWhyOpen(true)}
                aria-haspopup="dialog"
              >
                Evidence <span aria-hidden="true">→</span>
              </button>
            </div>

            <p className="pl-rationale">{rationale}</p>

            <div className="pl-verdict-row">
              <div className={`pl-verdict v-${verdictTone}`}>
                <span className="pl-verdict-kicker">Why this recommendation</span>
                <span className="pl-verdict-line">
                  {verdict.headline || `${rec.evidence.n} analogues`}
                </span>
                <ul className="pl-bullets">
                  {(active.pros || []).map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </div>

              <div className="pl-verdict pl-tradeoff-callout">
                <span className="pl-verdict-kicker">Tradeoffs</span>
                <span className="pl-verdict-line">{active.tradeoff}</span>
                <ul className="pl-bullets">
                  {(active.cons || []).map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>

              <div className="pl-kpi-ribbon" role="group" aria-label="Key impact">
                <KpiCell
                  label="OEE"
                  value={rec.oeeDelta}
                  tone={rec.oeeGood ? 'good' : 'bad'}
                  info="Predicted change in Overall Equipment Effectiveness vs. the naive slot — based on historical analogue runs on the chosen line."
                />
                <KpiCell
                  label="Due date"
                  value={rec.deadline}
                  tone={rec.deadline === 'on time' ? 'good' : 'mid'}
                  info="How this strategy affects the urgent order's promised delivery date. 'On time' means it ships by the due date; '+1 day' means it slips by a day."
                />
                <KpiCell
                  label="Orders moved"
                  value={rec.ordersMoved}
                  tone={rec.ordersMoved === 0 ? 'good' : 'mid'}
                  info="Number of already-scheduled orders that would need to be re-sequenced to accommodate this insertion. Zero means no disruption to the existing plan."
                />
                <KpiCell
                  label="Recovery"
                  value={recoveryHours}
                  tone="quiet"
                  info="Estimated time to return the line to its baseline OEE after the insertion — derived from how long the analogue runs took to stabilise."
                />
              </div>
            </div>

          </section>

          {/* Manual override strip (left) + zoom toggle (right) */}
          <section className="pl-manual">
            <div className="pl-manual-left">
              <div className="pl-manual-prompt">
                <b>Prefer your own slot?</b>
                <span>Drag <code>{order.of}</code> onto a line below to test it.</span>
              </div>
              <div
                className="pl-chip"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', order.of);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                aria-label={`Drag ${order.of}`}
                title={`${order.of} · ${order.sku}`}
              >
                <span className="pl-chip-of">{order.of}</span>
                <span className="pl-chip-sku">{order.sku}</span>
              </div>
              {manualSlot && (
                <button
                  className="pl-manual-clear"
                  type="button"
                  onClick={() => setManualSlot(null)}
                >
                  Clear manual slot · back to {active.title} ×
                </button>
              )}
            </div>

            <div className="pl-zoom" role="tablist" aria-label="Timeline zoom">
              {['week', 'month', 'quarter'].map((z) => (
                <button
                  key={z}
                  type="button"
                  role="tab"
                  aria-selected={zoom === z}
                  className={`pl-zoom-btn${zoom === z ? ' on' : ''}`}
                  onClick={() => setZoom(z)}
                >
                  {z[0].toUpperCase() + z.slice(1)}
                </button>
              ))}
            </div>
          </section>

          {/* Timeline — simplified before/after */}
          <section className="pl-timeline">
            <div className="pl-timeline-h">
              <span>Timeline {manualSlot && <em className="pl-manual-tag">· manual override</em>}</span>
            </div>

            {Object.entries(rec.plan).map(([line, runs]) => (
              <TimelineRow
                key={line}
                line={line}
                runs={runs}
                ghosts={showNaive ? (rec.ghosts?.[line] || []) : []}
                isTarget={line === rec.line.replace('Line ', '')}
                manualKey={firstManualSlotForLine(data.manualSlots, line)}
                onManualDrop={(key) => setManualSlot(key)}
                isManualActive={manualSlot && data.manualSlots[manualSlot]?.recKey === line}
              />
            ))}
          </section>
        </main>
      </div>

      <footer className="pl-foot">
        <button className="pl-btn-ghost" type="button">Cancel</button>
        <span className="pl-live">● Live · synced 7m ago</span>
        <div className="pl-foot-actions">
          <button className="pl-btn-secondary" type="button">Save draft</button>
          <button className="pl-btn-primary" type="button">Apply this plan</button>
        </div>
      </footer>

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
            recKey={manualEntry?.recKey || active.recKey}
            rec={rec}
            order={order}
            onClose={() => setModalOpen(false)}
          />
        )}
      </AnimatePresence>
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

function firstManualSlotForLine(slots, line) {
  if (!slots) return null;
  const entry = Object.entries(slots).find(([, v]) => v.recKey === line);
  return entry ? entry[0] : null;
}

function Kpi({ label, value, tone }) {
  return (
    <div className={`pl-kpi t-${tone}`}>
      <span className="pl-kpi-label">{label}</span>
      <b className="pl-kpi-value">{value}</b>
    </div>
  );
}

function KpiCell({ label, value, tone, info }) {
  return (
    <div className={`pl-kpi-cell t-${tone}`}>
      {info && (
        <span className="pl-kpi-cell-info">
          <InfoPopover title={label}>
            {typeof info === 'string' ? <p>{info}</p> : info}
          </InfoPopover>
        </span>
      )}
      <b className="pl-kpi-cell-value">{value}</b>
      <span className="pl-kpi-cell-label">{label}</span>
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

function TimelineRow({ line, runs, ghosts, isTarget, manualKey, onManualDrop, isManualActive }) {
  const [over, setOver] = useState(false);
  const span = Math.max(6, ...runs.map((r) => r.start + r.w), ...ghosts.map((g) => g.start + g.w));
  const droppable = !!manualKey;
  return (
    <div className={`pl-tl-row${isTarget ? ' target' : ''}${isManualActive ? ' manual' : ''}`}>
      <div className="pl-tl-line">L{line}</div>
      <div
        className={`pl-tl-track${droppable ? ' droppable' : ''}${over ? ' over' : ''}`}
        onDragOver={droppable ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(true); } : undefined}
        onDragLeave={droppable ? () => setOver(false) : undefined}
        onDrop={droppable ? (e) => { e.preventDefault(); setOver(false); onManualDrop?.(manualKey); } : undefined}
      >
        {droppable && (
          <div className="pl-tl-drophint" aria-hidden="true">
            {over ? 'Drop to test on this line' : 'Drop here to test'}
          </div>
        )}
        {ghosts.map((g, i) => (
          <div
            key={`g-${i}`}
            className="pl-tl-ghost"
            style={{ left: `${(g.start / span) * 100}%`, width: `${(g.w / span) * 100}%` }}
            title={`naive: ${g.of}`}
          >
            {g.of}
          </div>
        ))}
        {runs.map((run, i) => (
          <div
            key={`r-${i}`}
            className={`pl-tl-run kind-${run.kind || 'base'}`}
            style={{ left: `${(run.start / span) * 100}%`, width: `${(run.w / span) * 100}%` }}
          >
            <b>{run.of}</b>
            <span>OEE {run.oee?.toFixed?.(2) ?? run.oee}</span>
          </div>
        ))}
      </div>
    </div>
  );
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

function stripHtml(s) {
  return String(s || '').replace(/<[^>]+>/g, '');
}
