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

export default function Inbox({ orders, onClose, onSelectUrgent }) {
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

        <button className="btn btn-ghost inbox-create" onClick={onSelectUrgent}>
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
                      onClick={o.status === 'urgent' ? onSelectUrgent : undefined}
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
