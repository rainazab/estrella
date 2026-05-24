import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { usePlan } from '../hooks/usePlan.js';
import { useTimelineMoveFlow } from '../hooks/useTimelineMoveFlow.js';
import { buildAnalogueIndex, evidenceVerdict } from '../lib/analogues.js';
import AnalogueModal from '../components/AnalogueModal.jsx';
import InfoPopover from '../components/InfoPopover.jsx';
import Timeline from '../components/Timeline.jsx';
import './plan-lab.css';

/* PlanLab — /?lab=plan
   Reshaped "Proposed plan" view: small strategy cards on the left, the
   headline impact panel up top with the "Why this recommendation" content
   folded into an inline accordion (no right-side drawer), and a simple
   before/after timeline below. Built as a lab so we can compare against
   the current narrow-column RecommendationPanel without touching App.jsx. */
export default function PlanLab({ data: dataProp, order: orderProp } = {}) {
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
  const [mode, setMode] = useState('auto'); // 'auto' | 'manual'
  const [zoom, setZoom] = useState('month');
  const [timelineExpanded, setTimelineExpanded] = useState(false);

  /* Derive the base plan (rec.plan) before guards so the shared
     useTimelineMoveFlow hook can be called unconditionally. It tolerates an
     undefined basePlan during the loading window. */
  const options = data ? buildOptions(data) : [];
  const active = data ? (options.find((o) => o.id === activeId) || options[0]) : null;
  const manualEntry = data && manualSlot ? data.manualSlots[manualSlot] : null;
  const rec = data ? data.recommendations[manualEntry?.recKey || active.recKey] : null;

  /* Homepage Timeline interactions — click → modal, modal "Move" → moving,
     drop on lane → calc flash → pending preview → confirm/discard. Mirrors
     App.jsx's flow exactly so the planner view behaves identically. */
  const { timelineProps, overlays } = useTimelineMoveFlow({
    data,
    basePlan: rec?.plan,
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

  if (loading) return <div className="pl-loading">Loading…</div>;
  if (error)   return <div className="pl-loading">Error: {String(error.message || error)}</div>;
  if (!data)   return <div className="pl-loading">Loading…</div>;

  const order = orderProp ?? data.urgentOrders[0];
  const rows = buildAnalogueIndex(manualEntry?.recKey || active.recKey, rec.evidence);
  const verdict = evidenceVerdict(rec, rows);
  const recommendedId = 'oee';

  const verdictTone = verdict.tone === 'bad' ? 'bad' : verdict.tone === 'warn' ? 'mid' : 'good';
  const recoveryHours = rec.recovery?.hours ? `${rec.recovery.hours}h` : '—';
  const friendlySku = formatSku(order.sku);
  const pros = derivePros(rec);
  const cons = deriveCons(rec, active);
  const rationale = stripHtml(rec.evidence.reason);

  return (
    <div className="pl-root">
      {/* Order banner — normal page keeps the original decision target. */}
      <header className="pl-order">
        <span className="pl-order-tag">URGENT</span>
        <div className="pl-order-main">
          <b>{order.of}</b>
          <span>{friendlySku} · {order.units.toLocaleString()} un · {order.hl} hl</span>
        </div>
        <div className="pl-order-meta">
          <span>Due <b>{order.due}</b></span>
          <span>Decision by <b>17:00 today</b></span>
        </div>
      </header>

      <div className="pl-grid">
        {/* LEFT — strategy picker */}
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
                  onClick={() => { setActiveId(opt.id); setManualSlot(null); setWhyOpen(false); }}
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
                    {opt.id === recommendedId && <span className="pl-card-star" title="LineWise recommends">★</span>}
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

        <main className="pl-main">
          <motion.section
            className={`pl-impact tone-${mode === 'manual' && !manualEntry ? 'quiet' : manualEntry ? 'mid' : active.tone}`}
            layout
          >
            <div className="pl-impact-h">
              <div className="pl-impact-title">
                <div className="pl-kicker-row">
                  <span className="pl-kicker">
                    {mode === 'manual'
                      ? (manualEntry ? 'Manual override' : 'Manual mode')
                      : 'Impact preview'}
                  </span>
                </div>
                <h2>
                  {mode === 'manual' && !manualEntry
                    ? <>Place <code className="pl-h-code">{order.of}</code> yourself</>
                    : manualEntry ? manualEntry.label : active.title}
                  {mode === 'auto' && !manualEntry && active.id === recommendedId && <span className="pl-star" title="LineWise recommends">★</span>}
                </h2>
                {mode === 'manual' && manualEntry && (
                  <span className="pl-impact-sub">Strategy on hold: {active.title}</span>
                )}
              </div>

              <div className="pl-mode-toggle" role="tablist" aria-label="Planning mode">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'auto'}
                  className={mode === 'auto' ? 'on' : ''}
                  onClick={() => { setMode('auto'); setManualSlot(null); }}
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
            </div>

            {mode === 'manual' && !manualEntry ? (
              <div className="pl-manual-body">
                <div className="pl-manual-prompt">
                  <b>Drag the order onto a line below.</b>
                  <span>LineWise will compute the impact for whichever slot you drop into.</span>
                </div>
                <div
                  className="pl-chip pl-chip-lg"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', order.of);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  aria-label={`Drag ${order.of}`}
                  title={`${order.of} · ${friendlySku}`}
                >
                  <span className="pl-chip-of">{order.of}</span>
                  <span className="pl-chip-sku">{friendlySku}</span>
                </div>
              </div>
            ) : (
              <div className="pl-impact-body">
                <div className="pl-impact-main">
                  <p className="pl-rationale">{rationale}</p>

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
              <span>Timeline {manualEntry && <em className="pl-manual-tag">· manual override</em>}</span>
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
                <header className="pl-order pl-order-mini">
                  <span className="pl-order-tag">URGENT</span>
                  <div className="pl-order-main">
                    <b>{order.of}</b>
                    <span>{friendlySku} · {order.units.toLocaleString()} un · {order.hl} hl</span>
                  </div>
                  <div className="pl-order-meta">
                    <span>Due <b>{order.due}</b></span>
                    <span>Decision by <b>17:00 today</b></span>
                  </div>
                </header>

                <ChoiceSummary
                  active={active}
                  rec={rec}
                  manualEntry={manualEntry}
                  mode={mode}
                  recommended={mode === 'auto' && !manualEntry && active.id === recommendedId}
                  recoveryHours={recoveryHours}
                />
              </div>
            )}

            <Timeline
              data={data}
              mode="default"
              zoom={zoom}
              {...timelineProps}
            />
          </motion.section>
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

      {overlays}
    </div>
  );
}

function ChoiceSummary({ active, rec, manualEntry, mode, recommended, recoveryHours }) {
  const title = mode === 'manual'
    ? (manualEntry ? manualEntry.label : 'Manual placement')
    : active.title;
  return (
    <section className={`pl-choice-summary tone-${manualEntry ? 'mid' : active.tone}`} aria-label="Chosen optimisation">
      <div className="pl-choice-head">
        <span>Chosen optimisation</span>
        {recommended && <b>LineWise pick</b>}
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
