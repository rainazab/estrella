import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import YearCompare from './YearCompare.jsx';

/* KPIStrip - daily OEE opportunities plus compact operating KPIs.
   `stoppedLines` is an array of line keys ('14' | '17' | '19') currently
   logged as stopped; passed in from App state so the "Lines running"
   tile and its tone update live as the planner logs stoppages. */
export default function KPIStrip({
  data,
  stoppedLines = [],
  urgentOrders = data?.urgentOrders ?? [],
  onSelectUrgent,
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const lines = data?.lineCentre ? Object.keys(data.lineCentre).length : 3;
  const stoppedCount = stoppedLines.length;
  const running = Math.max(0, lines - stoppedCount);
  const urgentCount = urgentOrders.filter((o) => o.status === 'urgent').length;
  const queuedCount = urgentOrders.filter((o) => o.status === 'queued' || o.status === 'scheduled').length;
  const urgentExample = urgentOrders.find((o) => o.status === 'urgent');

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
    delta: '+6.2',
    title: 'Reduce changeover loss',
    description: 'Group format and brand transitions.',
    tone: 'good',
  });

  if (!urgentExample) {
    scenarios.push({
      key: 'runtime',
      label: 'Runtime loss',
      delta: '+2.9',
      title: 'Recover runtime loss',
      description: 'Cut short stops and restart delays.',
      tone: 'neutral',
    });
  }

  const cards = [
    {
      key: 'oee',
      label: 'OEE today',
      value: '0.58',
      delta: '+2.1',
      deltaKind: 'good',
      foot: 'vs. 7-day avg',
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
      value: '12.4',
      unit: 'k hl',
      foot: 'paced for 14.0k',
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
