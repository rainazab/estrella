import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { deriveFormat, formatVol } from './TimelineCard.jsx';

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

export default function Inbox({ orders, onClose, onSelectUrgent, onCreateOrder }) {
  const [creating, setCreating] = useState(false);
  const grouped = SECTIONS.map((sec) => ({
    ...sec,
    items: orders.filter((o) => sec.match(o.status)),
  }));

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
            <div className="eyebrow">Inbox</div>
            <div className="panel-title">Orders</div>
          </div>
          <span className="inbox-x" onClick={onClose}>✕</span>
        </div>
        <div className="panel-desc">Requests routed from the operations manager.</div>

        <button className="btn btn-ghost inbox-create" onClick={() => setCreating(true)}>
          <span>+</span> Create order manually
        </button>

        <div className="inbox-sections">
          {grouped.map((sec) => (
            <section key={sec.key} className="inbox-section">
              <div className="section-head">
                <span className="section-title">{sec.title}</span>
                <span className="section-count">{sec.items.length}</span>
              </div>
              {sec.items.length === 0 ? (
                <div className="section-empty">No {sec.title.toLowerCase()}.</div>
              ) : (
                <div className="inbox-cards">
                  {sec.items.map((o) => (
                    <InboxCard
                      key={o.of}
                      order={o}
                      onClick={o.status === 'urgent' ? () => onSelectUrgent(o) : undefined}
                    />
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>

        <div className="panel-foot bordered">
          Pick an urgent order — LineWise ranks every line and insertion point
          against 2025's executed changeover history.
        </div>
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

function InboxCard({ order, onClick }) {
  const band = STATUS_BAND[order.status] ?? 'mid';
  const fmt = deriveFormat({ sku: order.sku, material: order.of });
  const brand = order.sku.split(' · ')[0];

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
        <span className="tc-mat">{order.of}</span>
        {fmt && <span className={`tc-fmt tc-fmt-${FORMAT_TONE[fmt] ?? 'other'}`}>{fmt}</span>}
        <span className="tc-grow" />
        <span className="tc-due">
          <span className="tc-due-l">{order.status === 'done' ? 'closed' : 'due'}</span>
          <span className="tc-due-v">{order.due}</span>
        </span>
      </div>

      <div className="tc-row tc-row-bot">
        <span className="tc-sku" title={order.sku}>{brand}</span>
        <span className="tc-sep">·</span>
        <span className="tc-vol">{formatVol(order.units)}<span className="tc-vol-u">un</span></span>
        <span className="tc-grow" />
        <span className={`tc-status-pill tc-status-${order.status}`}>{order.status}</span>
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
