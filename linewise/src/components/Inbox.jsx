import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { deriveFormat, formatVol } from './TimelineCard.jsx';
import ProvenanceModal from './ProvenanceModal.jsx';
import { signalToCitation, worldSignals } from '../lib/cala-mock.js';
import { CalaVerticalIcon, getCalaVertical } from '../lib/calaVerticals.js';

/* Inbox overlay — slides in from the right.
   AnimatePresence is owned by the parent so onClose can unmount cleanly.

   Cards keep the timeline's design language (left-edge band, format chip,
   tabular numerics) but in a compact two-row layout: the top row leads
   with order name + due date, the bottom row carries volume + status. */

const SECTIONS = [
  { key: 'urgent', title: 'New requests', match: (s) => s === 'urgent' },
  { key: 'queued', title: 'Queued',       match: (s) => s === 'queued' || s === 'scheduled' },
  { key: 'done',   title: 'Done',         match: (s) => s === 'done' },
];

const STATUS_BAND = {
  urgent: 'bad',
  queued: 'mid',
  done:   'good',
};

const FORMAT_TONE = {
  '33cl': 'tercio',
  '50cl': 'medio',
  '44cl': 'cuarenta',
};

const BRAND_OPTIONS = ['Estrella Damm', 'Voll-Damm', 'Free Damm', 'AmiBock'];
const FORMAT_OPTIONS = ['33cl', '50cl', '44cl'];
const FAKE_NOW_LABEL = '06:00 · 24 May';

export default function Inbox({
  orders,
  data = null,
  effectivePlan = null,
  mode = 'orders',
  ledgerChanges = [],
  lastHandoff = null,
  onClose,
  onSelectUrgent,
  onSelectQueued,
  onReplanAll,
  onCreateOrder,
}) {
  const [creating, setCreating] = useState(false);
  const [activeFactor, setActiveFactor] = useState(null);
  const briefing = mode === 'briefing'
    ? buildBriefingSummary({ ledgerChanges, lastHandoff, orders })
    : [];
  const grouped = SECTIONS.map((sec) => ({
    ...sec,
    items: orders.filter((o) => sec.match(o.status)),
  }));
  const externalFactors = useMemo(
    () => buildExternalFactors({ data, plan: effectivePlan ?? data?.basePlan }),
    [data, effectivePlan],
  );

  return (
    <motion.div
      className="inbox-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        className="inbox-panel"
        initial={{ x: 20, opacity: 0.6 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 20, opacity: 0 }}
        transition={{ duration: 0.16, ease: 'easeOut' }}
      >
        <div className="inbox-head">
          <div>
            <div className="eyebrow">{mode === 'briefing' ? 'Shift briefing' : 'Inbox'}</div>
            <div className="panel-title">{mode === 'briefing' ? 'Morning plan' : 'Orders'}</div>
          </div>
          <span className="inbox-x" onClick={onClose}>✕</span>
        </div>
        <div className="panel-desc">
          {mode === 'briefing'
            ? `${FAKE_NOW_LABEL} · handoff, drift, and open requests.`
            : 'Requests routed from the operations manager.'}
        </div>

        {mode === 'briefing' && (
          <section className={`briefing-summary briefing-${briefing.tone}`}>
            <div className="briefing-summary-main">
              <span className="briefing-summary-k">Shift summary</span>
              <b>{briefing.headline}</b>
              <span>{briefing.detail}</span>
              {briefing.why && <em>Why: {briefing.why}</em>}
            </div>
            <div className="briefing-summary-metrics" aria-label="Briefing summary metrics">
              {briefing.metrics.map((metric) => (
                <div key={metric.label}>
                  <b>{metric.value}</b>
                  <span>{metric.label}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        <button className="btn btn-ghost inbox-create" onClick={() => setCreating(true)}>
          <span>+</span> Create order manually
        </button>

        <div className="inbox-sections">
          {grouped.map((sec) => {
            const sectionCount = sec.items.length;
            const showReplanAll = sec.key === 'urgent' && sec.items.length > 1;

            return (
              <section key={sec.key} className="inbox-section">
                <div className="section-head">
                  <span className="section-title">{sec.title}</span>
                  <span className="section-meta">
                    {showReplanAll && (
                      <button
                        type="button"
                        className="section-action"
                        onClick={() => (onReplanAll ? onReplanAll(sec.items) : onSelectUrgent(sec.items[0]))}
                      >
                        Re-plan All
                      </button>
                    )}
                    <span className="section-count">{sectionCount}</span>
                  </span>
                </div>
                {sec.items.length === 0 ? (
                  <div className="section-empty">No {sec.title.toLowerCase()}.</div>
                ) : (
                  <div className="inbox-cards">
                    {sec.items.map((o) => {
                      const isQueued = o.status === 'queued' || o.status === 'scheduled';
                      const actionable = o.status === 'urgent' || isQueued;
                      const handleClick = isQueued
                        ? (onSelectQueued ?? onSelectUrgent)
                        : onSelectUrgent;
                      return (
                        <InboxCard
                          key={o.of}
                          order={o}
                          onClick={actionable ? () => handleClick(o) : undefined}
                        />
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
          {externalFactors.length > 0 && (
            <section className="inbox-section">
              <div className="section-head">
                <span className="section-title">External Factors to watch</span>
                <span className="section-meta">
                  <span className="section-count">{externalFactors.length}</span>
                </span>
              </div>
              <div className="inbox-cards external-factor-cards">
                {externalFactors.map((item, index) => (
                  <ExternalFactorCard
                    item={item}
                    key={item.signal.id}
                    priority={index + 1}
                    onClick={() => setActiveFactor({ ...item, priority: index + 1 })}
                  />
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="panel-foot bordered">
          Pick an urgent order — LineWise ranks every line and insertion point
          against 2025's executed changeover history.
        </div>
        <ProvenanceModal
          open={!!activeFactor}
          citations={activeFactor ? [signalToCitation(activeFactor.signal)] : []}
          title={activeFactor?.signal?.headline ?? 'External factor'}
          onClose={() => setActiveFactor(null)}
        >
          {activeFactor && <ExternalFactorImpactSummary item={activeFactor} />}
        </ProvenanceModal>
      </motion.div>

      {creating && (
        <ManualOrderModal
          existingOrders={orders}
          onClose={() => setCreating(false)}
          onSubmit={(order) => {
            onCreateOrder?.(order);
            setCreating(false);
          }}
        />
      )}
    </motion.div>
  );
}

function ExternalFactorCard({ item, priority, onClick }) {
  const { signal, impact } = item;
  const meta = getCalaVertical(signal.vertical);

  return (
    <button
      type="button"
      className={`cala-inbox-card external-factor-card ${meta.accentClass}`}
      onClick={onClick}
      title={`${signal.headline} · ${formatExternalFactorUnits(impact.totalUnits)} impacted`}
    >
      <div className="cala-inbox-top">
        <span className="cala-inbox-icon">
          <CalaVerticalIcon vertical={signal.vertical} size={15} />
        </span>
        <span className="cala-inbox-main">
          <span className="cala-inbox-kicker">P{priority} · {meta.shortLabel} <b>{signal.delta}</b></span>
          <b>{signal.headline}</b>
        </span>
        <span className="external-factor-volume">
          <b>{formatExternalFactorUnits(impact.totalUnits)}</b>
          <em>{impact.orderCount} OFs</em>
        </span>
      </div>
    </button>
  );
}

function ExternalFactorImpactSummary({ item }) {
  const meta = getCalaVertical(item.signal.vertical);
  return (
    <section className={`news-modal-impact ${meta.accentClass}`} aria-label="Impacted volume">
      <div className="news-modal-metric">
        <span>Total impacted volume</span>
        <b>{formatExternalFactorUnits(item.impact.totalUnits)}</b>
      </div>
      <div className="news-modal-metric">
        <span>Impacted OFs</span>
        <b>{item.impact.orderCount}</b>
      </div>
      <div className="news-modal-list">
        {item.impact.orders.slice(0, 8).map((order) => (
          <span key={order.of}>
            <b>{order.of}</b>
            <em>{formatExternalFactorUnits(order.units)}</em>
            {order.line && <small>L{order.line}</small>}
          </span>
        ))}
      </div>
    </section>
  );
}

function InboxCard({ order, onClick }) {
  const band = STATUS_BAND[order.status] ?? 'mid';
  const fmt = deriveFormat({ sku: order.sku, material: order.of });
  const brand = order.sku.split(' · ')[0];
  const showStatusPill = !['urgent', 'queued', 'scheduled'].includes(order.status);

  const cls = [
    'tc', 'tc-inbox',
    `tc-${band}`,
    order.status === 'done' ? 'tc-executed' : '',
    onClick ? 'tc-clickable' : '',
  ].filter(Boolean).join(' ');

  return (
    <motion.button
      type="button"
      layout
      whileHover={onClick ? { y: -1 } : undefined}
      whileTap={onClick ? { y: 0 } : undefined}
      className={cls}
      onClick={onClick}
      aria-label={`${order.of}, due ${order.due}, ${formatVol(order.units)} units, ${order.status}`}
    >
      <div className="tc-row tc-row-top">
        <span className="tc-order-main">
          <span className="tc-mat">{order.of}</span>
          {fmt && <span className={`tc-fmt tc-fmt-${FORMAT_TONE[fmt] ?? 'other'}`}>{fmt}</span>}
        </span>
        <span className="tc-due">
          <span className="tc-due-l">{order.status === 'done' ? 'closed' : 'due'}</span>
          <span className="tc-due-v">{order.due}</span>
        </span>
      </div>

      <div className="tc-row tc-row-bot">
        <span className="tc-order-meta">
          <span className="tc-sku" title={order.sku}>{brand}</span>
          <span className="tc-sep">·</span>
          <span className="tc-vol">{formatVol(order.units)}<span className="tc-vol-u">un</span></span>
        </span>
        <span className="tc-order-actions">
          {showStatusPill && (
            <span className={`tc-status-pill tc-status-${order.status}`}>{order.status}</span>
          )}
        </span>
      </div>
    </motion.button>
  );
}

function ManualOrderModal({ existingOrders, onClose, onSubmit }) {
  const [form, setForm] = useState({
    of: nextOrderCode(existingOrders),
    brand: BRAND_OPTIONS[0],
    format: FORMAT_OPTIONS[0],
    units: '18000',
    hl: '',
    due: '',
  });

  const estimatedHl = useMemo(() => estimateHl(form.units, form.format), [form.units, form.format]);
  const canSubmit = form.of.trim() && Number(form.units) > 0;

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  function update(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function submit(e) {
    e.preventDefault();
    if (!canSubmit) return;

    const units = Math.round(Number(form.units));
    onSubmit({
      of: form.of.trim().toUpperCase(),
      status: 'urgent',
      sku: `${form.brand} · lata ${form.format}`,
      units,
      hl: Number(form.hl) > 0 ? Number(form.hl) : estimatedHl,
      due: formatDueDate(form.due),
    });
  }

  return (
    <motion.div
      className="order-modal-scrim"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.form
        className="order-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="manual-order-title"
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: 10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.99 }}
        transition={{ duration: 0.16, ease: 'easeOut' }}
      >
        <header className="order-modal-head">
          <div>
            <div className="eyebrow">Manual order</div>
            <h2 id="manual-order-title">Create request</h2>
          </div>
          <button type="button" className="rd-close" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="order-form-grid">
          <label className="order-field order-field-wide">
            <span>Order</span>
            <input
              value={form.of}
              onChange={(e) => update('of', e.target.value)}
              placeholder="ED13LTNN"
              autoFocus
            />
          </label>

          <label className="order-field">
            <span>Brand</span>
            <select value={form.brand} onChange={(e) => update('brand', e.target.value)}>
              {BRAND_OPTIONS.map((brand) => <option key={brand}>{brand}</option>)}
            </select>
          </label>

          <label className="order-field">
            <span>Format</span>
            <select value={form.format} onChange={(e) => update('format', e.target.value)}>
              {FORMAT_OPTIONS.map((format) => <option key={format}>{format}</option>)}
            </select>
          </label>

          <label className="order-field">
            <span>Units</span>
            <input
              type="number"
              min="0"
              step="100"
              value={form.units}
              onChange={(e) => update('units', e.target.value)}
            />
          </label>

          <label className="order-field">
            <span>hl</span>
            <input
              type="number"
              min="0"
              step="1"
              value={form.hl}
              onChange={(e) => update('hl', e.target.value)}
              placeholder={String(estimatedHl)}
            />
          </label>

          <label className="order-field order-field-wide">
            <span>Due date</span>
            <input
              type="date"
              value={form.due}
              onChange={(e) => update('due', e.target.value)}
            />
          </label>
        </div>

        <div className="order-preview" aria-live="polite">
          <span className={`tc-fmt tc-fmt-${FORMAT_TONE[form.format] ?? 'other'}`}>{form.format}</span>
          <b>{form.of.trim().toUpperCase() || 'ORDER'}</b>
          <span>{form.brand} · {Number(form.units || 0).toLocaleString()} un</span>
        </div>

        <footer className="order-modal-foot">
          <button type="button" className="rd-btn rd-btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="rd-btn rd-btn-primary" disabled={!canSubmit}>Add to inbox</button>
        </footer>
      </motion.form>
    </motion.div>
  );
}

function buildExternalFactors({ data, plan }) {
  if (!data || !plan) return [];
  return worldSignals
    .filter((signal) => signal.severity === 'high' || signal.severity === 'medium')
    .map((signal) => ({
      signal,
      impact: impactedVolumeForSignal(signal, data, plan),
    }))
    .filter((item) => item.impact.orderCount > 0)
    .sort((a, b) => priorityRank(a.signal) - priorityRank(b.signal))
    .slice(0, 3);
}

function impactedVolumeForSignal(signal, data, plan) {
  const affectedOfs = new Set(signal.affects?.ofs ?? []);
  const affectedLines = new Set((signal.affects?.lines ?? []).map(String));
  const impactedOrders = new Map();

  for (const order of data?.urgentOrders ?? []) {
    if (affectedOfs.has(order.of)) {
      upsertImpactedOrder(impactedOrders, {
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
      upsertImpactedOrder(impactedOrders, {
        of: run.of,
        units: Math.round((Number(run.vol) || 0) * 1000),
        line: String(lineKey),
      });
    }
  }

  const orders = [...impactedOrders.values()].sort((a, b) => b.units - a.units);
  return {
    orderCount: orders.length,
    totalUnits: orders.reduce((sum, order) => sum + order.units, 0),
    orders,
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

function formatExternalFactorUnits(units) {
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

function nextOrderCode(orders) {
  const n = orders.length + 1;
  return `MANUAL-${String(n).padStart(2, '0')}`;
}

function estimateHl(units, format) {
  const cl = Number.parseInt(format, 10) || 33;
  const total = Math.round((Number(units) || 0) * cl / 1000);
  return total || 1;
}

function formatDueDate(value) {
  if (!value) return 'asap';
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(date);
}

function buildBriefingSummary({ ledgerChanges, lastHandoff, orders }) {
  const changesSince = lastHandoff?.sentAt
    ? ledgerChanges.filter((change) => change.ts > lastHandoff.sentAt)
    : ledgerChanges;
  const handoffChanges = lastHandoff?.changes ?? [];
  const sourceChanges = changesSince.length ? changesSince : handoffChanges;
  const latest = sourceChanges[sourceChanges.length - 1];
  const urgentCount = orders.filter((order) => order.status === 'urgent').length;
  const critical = sourceChanges.find((change) => change.severity === 'critical');
  const stoppage = sourceChanges.find((change) => change.type === 'stoppage_logged');
  const replan = sourceChanges.find((change) => change.type === 'stoppage_replan_committed');
  const move = [...sourceChanges].reverse().find((change) => change.type === 'manual_move_confirmed');
  const tone = critical || stoppage ? 'bad' : urgentCount ? 'warn' : 'good';
  const headline = latest
    ? latest.summary ?? labelAction(latest)
    : lastHandoff ? 'No new changes since handoff' : 'No handoff yet';
  const detail = replan
    ? `${replan.shiftedCount ?? 0} runs shifted by ${fmtHours(replan.shiftedHours)}. ${urgentCount} urgent request${urgentCount === 1 ? '' : 's'} open.`
    : latest ? detailForChange(latest) : 'Start from the current queue; the fake clock is pinned at 06:00 for demo.';
  const why = move?.rationale
    ? `${move.runId} moved for ${move.rationale}`
    : latest ? whyForChange(latest) : lastHandoff?.notes;

  return {
    tone,
    headline,
    detail,
    why,
    metrics: [
      { label: 'changes', value: sourceChanges.length },
      { label: 'urgent', value: urgentCount },
      { label: 'risks', value: critical || stoppage ? 1 : 0 },
    ],
  };
}

function detailForChange(change) {
  if (change.type === 'manual_move_confirmed') {
    return `Reason: ${change.rationale ?? 'manual'} · L${change.fromLine} to L${change.toLine}`;
  }
  if (change.type === 'stoppage_logged') {
    return `${change.reason ?? 'stoppage'} · expected ${change.duration ?? 'unknown'}`;
  }
  if (change.type === 'stoppage_replan_committed') {
    return `${change.shiftedCount ?? 0} runs shifted by ${fmtHours(change.shiftedHours)}`;
  }
  if (change.type === 'issue_logged') {
    return `${change.category ?? 'issue'} · ${change.severity ?? 'warning'}${change.note ? ` · ${change.note}` : ''}`;
  }
  return change.summary ?? 'Planner change logged';
}

function labelAction(change) {
  return {
    urgent_order_selected: 'Urgent order selected',
    issue_logged: 'Issue logged',
    stoppage_logged: 'Stoppage logged',
    stoppage_replan_committed: 'Replan committed',
    manual_move_confirmed: 'Move confirmed',
  }[change.type] ?? 'Planner change';
}

function whyForChange(change) {
  if (change.type === 'manual_move_confirmed') return `${change.runId} moved for ${change.rationale ?? 'manual'}`;
  if (change.type === 'stoppage_replan_committed') return `L${change.line} was replanned after ${change.reason ?? 'a stoppage'}`;
  if (change.type === 'stoppage_logged') return `L${change.line} stopped because of ${change.reason ?? 'an issue'}`;
  if (change.type === 'issue_logged') return `Issue logged as ${change.category ?? 'context'}`;
  if (change.type === 'urgent_order_selected') return 'Planner selected this order for optimisation';
  return '';
}

function fmtHours(h) {
  if (h == null) return 'unknown';
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h === 1) return '1 hour';
  return `${h} hours`;
}
