import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/* ReplanBanner — blocks the planner with a decision prompt when a stoppage is
   logged. Replan commits the downstream shift; Dismiss leaves the schedule
   untouched. */
export default function ReplanBanner({ prompt, onReplan, onDismiss }) {
  useEffect(() => {
    if (!prompt) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onDismiss?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [prompt, onDismiss]);

  return (
    <AnimatePresence initial={false}>
      {prompt && (
        <motion.div
          className="rd-overlay replan-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
        >
          <motion.div
            className="rd-modal replan-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="replan-dialog-title"
            aria-describedby="replan-dialog-desc"
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <header className="replan-head">
              <span className="rb-icon" aria-hidden="true">■</span>
              <div className="replan-head-main">
                <div className="replan-kicker">Line stoppage</div>
                <h2 className="rd-mat" id="replan-dialog-title">
                  L{prompt.line} stopped — replan downstream runs?
                </h2>
                <div className="rd-sku" id="replan-dialog-desc">
                  {reasonLabel(prompt.reason)} · estimated {durationLabel(prompt.duration)}
                </div>
              </div>
            </header>

            <section className="replan-body">
              <p>
                This stoppage can push the planned sequence on L{prompt.line} out of sync.
                Replanning shifts downstream runs by the expected downtime so the schedule
                reflects the current production state.
              </p>
              <div className="replan-impact" aria-label="Stoppage summary">
                <div>
                  <span>Line</span>
                  <strong>L{prompt.line}</strong>
                </div>
                <div>
                  <span>Cause</span>
                  <strong>{reasonLabel(prompt.reason)}</strong>
                </div>
                <div>
                  <span>Downtime</span>
                  <strong>{durationLabel(prompt.duration)}</strong>
                </div>
              </div>
            </section>

            <footer className="rd-foot replan-foot">
              <button className="rd-btn rd-btn-ghost" onClick={onDismiss}>Dismiss</button>
              <button className="rd-btn rd-btn-primary replan-primary" onClick={onReplan}>Replan</button>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function reasonLabel(key) {
  return {
    'breakdown': 'Breakdown',
    'no-material': 'No material',
    'no-operator': 'No operator',
    'quality-hold': 'Quality hold',
    'other': 'Other',
  }[key] || 'Stoppage';
}

function durationLabel(key) {
  return {
    '15m': '15 min', '30m': '30 min', '1h': '1 hour', '2h+': '2 h+', 'unknown': 'unknown',
  }[key] || '—';
}
