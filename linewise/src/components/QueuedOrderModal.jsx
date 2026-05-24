import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { deriveFormat, formatVol } from './TimelineCard.jsx';

/* QueuedOrderModal — opens when a queued/scheduled inbox card is clicked.
   Lightweight read-only popup: surfaces order metadata without dropping
   the planner into the urgent-replan flow. */

const FORMAT_TONE = {
  '33cl': 'tercio',
  '50cl': 'medio',
  '44cl': 'cuarenta',
};

export default function QueuedOrderModal({ order, onClose, onOpenInPlanner }) {
  useEffect(() => {
    if (!order) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [order, onClose]);

  return (
    <AnimatePresence>
      {order && (
        <motion.div
          key="queued-order-scrim"
          className="order-modal-scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
          onClick={onClose}
        >
          <motion.div
            className="order-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="queued-order-title"
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.99 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
          >
            <Body order={order} onClose={onClose} onOpenInPlanner={onOpenInPlanner} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Body({ order, onClose, onOpenInPlanner }) {
  const fmt = deriveFormat({ sku: order.sku, material: order.of });
  const brand = (order.sku || '').split(' · ')[0] || order.sku || '—';
  const statusLabel = order.status === 'scheduled' ? 'Scheduled' : 'Queued';

  return (
    <>
      <header className="order-modal-head">
        <div>
          <div className="eyebrow">{statusLabel} order</div>
          <h2 id="queued-order-title">{order.of}</h2>
        </div>
        <button type="button" className="rd-close" onClick={onClose} aria-label="Close">×</button>
      </header>

      <div className="order-preview">
        {fmt && <span className={`tc-fmt tc-fmt-${FORMAT_TONE[fmt] ?? 'other'}`}>{fmt}</span>}
        <b>{order.of}</b>
        <span>{order.sku}</span>
      </div>

      <div className="order-form-grid">
        <ReadOnlyField label="Brand" value={brand} wide />
        <ReadOnlyField label="Format" value={fmt || '—'} />
        <ReadOnlyField label="Status" value={statusLabel} />
        <ReadOnlyField label="Units" value={`${formatVol(order.units)} un`} />
        <ReadOnlyField label="hl" value={order.hl != null ? String(order.hl) : '—'} />
        <ReadOnlyField label="Due" value={order.due || '—'} wide />
      </div>

      <footer className="order-modal-foot">
        <button type="button" className="rd-btn rd-btn-ghost" onClick={onClose}>Close</button>
        {onOpenInPlanner && (
          <button
            type="button"
            className="rd-btn rd-btn-primary"
            onClick={() => onOpenInPlanner(order)}
          >
            Open in planner
          </button>
        )}
      </footer>
    </>
  );
}

function ReadOnlyField({ label, value, wide = false }) {
  return (
    <label className={`order-field${wide ? ' order-field-wide' : ''}`}>
      <span>{label}</span>
      <input value={value} readOnly tabIndex={-1} />
    </label>
  );
}
