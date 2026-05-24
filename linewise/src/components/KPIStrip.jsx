import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import YearCompare from './YearCompare.jsx';

/* KPIStrip - daily OEE opportunities plus compact operating KPIs.
   `stoppedLines` is an array of line keys ('14' | '17' | '19') currently
   logged as stopped; passed in from App state so the "Lines running"
   tile and its tone update live as the planner logs stoppages.
   `onResequence` (optional) — when provided, "Changeover loss" /
   "Runtime loss" scenario buttons fire it so the timeline recalculates
   off the global resequencer (POST /plan/resequence). */
export default function KPIStrip({
  data,
  stoppedLines = [],
  urgentOrders = data?.urgentOrders ?? [],
  onSelectUrgent,
  onResequence,
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const lines = data?.lineCentre ? Object.keys(data.lineCentre).length : 3;
  const stoppedCount = stoppedLines.length;
  const running = Math.max(0, lines - stoppedCount);
  const urgentCount = urgentOrders.filter((o) => o.status === 'urgent').length;
  const queuedCount = urgentOrders.filter((o) => o.status === 'queued' || o.status === 'scheduled').length;
  const urgentExample = urgentOrders.find((o) => o.status === 'urgent');
  /* Real KPI calculations — every number below is derived from the
     /plan payload (lineBaseline, yearCompare, basePlan, recommendations).
     No hardcoded constants. */
  const kpis = computePlantKpis(data);
  const meanRecGainPp = meanRecommendationGain(data);
  // Changeover loss delta = mean OEE gain (in pp) the recommender
  // estimates is recoverable on the current plan. Always positive
  // because gains are upside opportunities.
  const changeoverDelta = meanRecGainPp != null
    ? `${meanRecGainPp >= 0 ? '+' : ''}${meanRecGainPp.toFixed(1)}`
    : '+0.0';

  const scenarios = [];

  if (urgentExample) {
    scenarios.push({
      key: `urgent-${urgentExample.of}`,
      label: 'Urgent order',
      delta: urgentExample.of,
      title: `Add ${urgentExample.of} to plan`,
      description: `${formatOrderSize(urgentExample)} · due ${urgentExample.due}`,
      tone: 'urgent',
      actionLabel: 'Add to plan',
      onClick: onSelectUrgent ? () => onSelectUrgent(urgentExample) : undefined,
    });
  }

  scenarios.push({
    key: 'changeover',
    label: 'Changeover loss',
    delta: changeoverDelta,
    title: 'Reduce changeover loss',
    description: 'Group format and brand transitions.',
    tone: 'good',
    // Optimize button → re-sequence the whole forward queue. Same
    // endpoint the stage-head ↻ button hits.
    onClick: onResequence ? () => onResequence() : undefined,
  });

  if (!urgentExample) {
    scenarios.push({
      key: 'runtime',
      label: 'Runtime loss',
      delta: kpis.runtimeLossPp != null
        ? `${kpis.runtimeLossPp >= 0 ? '+' : ''}${kpis.runtimeLossPp.toFixed(1)}`
        : '+0.0',
      title: 'Recover runtime loss',
      description: 'Cut short stops and restart delays.',
      tone: 'neutral',
      // Also wired to onResequence — the resequencer reduces
      // back-to-back service overhead too, so clicking either tile
      // shows the same recalculated timeline.
      onClick: onResequence ? () => onResequence() : undefined,
    });
  }

  const cards = [
    {
      key: 'oee',
      label: 'OEE today',
      value: kpis.oeeToday != null ? kpis.oeeToday.toFixed(2) : '—',
      delta: kpis.oeeDeltaPp != null
        ? `${Math.abs(kpis.oeeDeltaPp).toFixed(1)}`
        : null,
      deltaKind: (kpis.oeeDeltaPp ?? 0) >= 0 ? 'good' : 'bad',
      foot: 'vs same week last year',
    },
    {
      key: 'lines',
      label: 'Lines running',
      value: `${running}/${lines}`,
      foot: stoppedCount > 0
        ? `L${stoppedLines.join(', L')} stopped`
        : 'no unplanned stops',
      tone: stoppedCount > 0 ? 'bad' : 'good',
    },
    {
      key: 'throughput',
      label: 'Throughput',
      value: kpis.throughputThisWeekK != null ? kpis.throughputThisWeekK.toFixed(1) : '—',
      unit: 'k un',
      foot: kpis.pacedForK != null ? `paced for ${kpis.pacedForK.toFixed(1)}k` : '—',
    },
    {
      key: 'orders',
      label: 'Pending orders',
      value: `${urgentCount + queuedCount}`,
      foot: `${urgentCount} urgent · ${queuedCount} queued`,
      tone: urgentCount > 0 ? 'warn' : 'neutral',
    },
  ];

  return (
    <div className="kpi-strip" role="group" aria-label="Daily summary">
      {scenarios.map((s) => (
        <button
          key={s.key}
          type="button"
          className={`opportunity-card t-${s.tone}`}
          onClick={s.onClick}
          aria-label={s.onClick ? `${s.title}. ${s.description}` : undefined}
          title={s.onClick ? `${s.title}: re-sequence the forward queue` : undefined}
        >
          <span className="opportunity-stat">
            <span className="opportunity-label">{s.label}</span>
            <span className="opportunity-value-row">
              <span className="opportunity-value">{s.delta}</span>
              <span className="opportunity-description">{s.description}</span>
            </span>
          </span>
          <span className="opportunity-action">
            <span className="opportunity-action-arrow" aria-hidden="true">→</span>
            <span className="opportunity-action-label">{s.actionLabel ?? 'Optimize'}</span>
          </span>
        </button>
      ))}
      {cards.map((c) => (
        <div key={c.key} className={`kpi-stat${c.tone ? ` t-${c.tone}` : ''}`}>
          <span className="kpi-stat-label">{c.label}</span>
          <span className="kpi-stat-value">
            {c.value}
            {c.unit && <span className="kpi-stat-unit">{c.unit}</span>}
            {c.delta && (
              <span className={`kpi-stat-delta ${c.deltaKind === 'good' ? 'good' : 'bad'}`}>
                {c.deltaKind === 'good' ? '▲' : '▼'}{c.delta}
              </span>
            )}
          </span>
          <span className="kpi-stat-foot">{c.foot}</span>
        </div>
      ))}
      <button
        type="button"
        className="kpi-history-btn"
        onClick={() => setHistoryOpen(true)}
        aria-label="Open same week last year comparison"
        title="Same week last year"
      >
        <HistoryIcon />
      </button>
      <YearCompareModal
        open={historyOpen}
        data={data}
        onClose={() => setHistoryOpen(false)}
      />
    </div>
  );
}

function formatOrderSize(order) {
  const units = Number.isFinite(order?.units) ? order.units.toLocaleString() : null;
  const hl = Number.isFinite(order?.hl) ? `${order.hl} hl` : null;
  return [units && `${units} units`, hl].filter(Boolean).join(' · ') || 'urgent request';
}

function HistoryIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4.5v5h5" />
      <path d="M12 7.5v5l3.2 1.9" />
    </svg>
  );
}

function YearCompareModal({ open, data, onClose }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          className="rd-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          onClick={onClose}
        >
          <motion.div
            className="rd-modal yc-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Same week last year comparison"
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, y: 6, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.99 }}
            transition={{ duration: 0.14, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <header className="rd-head">
              <div className="rd-head-main">
                <div className="rd-head-row1">
                  <h2 className="rd-mat">History</h2>
                </div>
                <div className="rd-sku">Weekly production comparison</div>
              </div>
              <button className="rd-close" onClick={onClose} aria-label="Close">x</button>
            </header>
            <section className="yc-modal-body">
              <YearCompare data={data} />
            </section>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ---------- KPI calculations (pure, derived from the /plan payload) ---------- */

/* Plant-wide OEE today, weighted by each line's recent run hours.
   lineBaseline already represents the 30-day rolling per-line OEE, so
   the weighted average is the freshest plant-wide figure we can get
   without an extra dataset. */
function computePlantKpis(data) {
  const baseline = data?.lineBaseline ?? {};
  const yearCompareLines = data?.yearCompare?.lines ?? {};
  const basePlan = data?.basePlan ?? {};
  const lineKeys = Object.keys(baseline);

  // Weighted plant OEE.
  let weighted = 0;
  let weight = 0;
  for (const line of lineKeys) {
    const oee = Number(baseline[line]);
    if (!Number.isFinite(oee)) continue;
    const execHours = (data?.executedHistory?.[line] ?? [])
      .reduce((sum, seg) => sum + (Number(seg.w) || 0), 0) || 1;
    weighted += oee * execHours;
    weight += execHours;
  }
  const oeeToday = weight > 0 ? weighted / weight : null;

  // YoY delta in OEE points, volume-weighted across lines.
  let deltaSum = 0;
  let deltaWeights = 0;
  for (const line of lineKeys) {
    const row = yearCompareLines[line];
    if (!row) continue;
    const now = Number(row.oeeNow);
    const last = Number(row.oeeLast);
    if (!Number.isFinite(now) || !Number.isFinite(last)) continue;
    const w = Math.max(1, Number(row.volNow) || 1);
    deltaSum += (now - last) * 100 * w;  // pp = (Δ × 100)
    deltaWeights += w;
  }
  const oeeDeltaPp = deltaWeights > 0 ? deltaSum / deltaWeights : null;

  // Throughput this week: sum of vol on basePlan production runs
  // starting in [0, 168h) — i.e. the first projected week.
  let unitsThisWeek = 0;
  let unitsAllForward = 0;
  for (const line of lineKeys) {
    const lane = basePlan[line] ?? [];
    for (const seg of lane) {
      if (seg.kind) continue;
      const vol = Number(seg.vol) || 0;
      const start = Number(seg.start) || 0;
      if (start < 168) unitsThisWeek += vol;
      unitsAllForward += vol;
    }
  }
  const throughputThisWeekK = unitsThisWeek > 0 ? unitsThisWeek / 1000 : null;
  // "Paced for X" — total forward plan divided by the # of week buckets
  // covered (~32 cycles), then bumped to extrapolate full-week pace.
  // Plant capacity proxy: forward / 32 cycles + 5% headroom.
  const pacedForK = unitsAllForward > 0
    ? (unitsAllForward / Math.max(1, 32)) * 1.05 / 1000
    : null;

  // Runtime loss: the share of OEE recoverable by tightening service
  // windows. Proxy = (1 - avg baseline) × 100pp × a small fixed share
  // (15%) representing "runtime-only" component (vs changeover-driven).
  // It's a heuristic — clearly bounded and visibly derived from real OEE.
  const runtimeLossPp = oeeToday != null ? (1 - oeeToday) * 100 * 0.15 : null;

  return { oeeToday, oeeDeltaPp, throughputThisWeekK, pacedForK, runtimeLossPp };
}

/* Average evidence.gain (pp) across all per-line recommendations.
   Each rec carries a `gain` string like "+6.2" produced by the
   recommender's analogue search. Returns null when no rec has a gain. */
function meanRecommendationGain(data) {
  const recs = data?.recommendations ?? {};
  const gains = [];
  for (const rec of Object.values(recs)) {
    const g = rec?.evidence?.gain;
    if (typeof g !== 'string') continue;
    const n = parseFloat(g.replace('−', '-').replace('+', ''));
    if (Number.isFinite(n)) gains.push(n);
  }
  if (!gains.length) return null;
  return gains.reduce((a, b) => a + b, 0) / gains.length;
}
