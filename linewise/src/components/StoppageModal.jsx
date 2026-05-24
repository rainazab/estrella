import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/* StoppageModal — log a line stoppage. Submit pauses the line in the UI
   (KPI strip, lane badge, LiveStatus) and prompts the planner to replan
   downstream runs. */
const LINES = ['14', '17', '19'];
const REASONS = [
  { key: 'breakdown',    label: 'Breakdown'     },
  { key: 'no-material',  label: 'No material'   },
  { key: 'no-operator',  label: 'No operator'   },
  { key: 'quality-hold', label: 'Quality hold'  },
  { key: 'other',        label: 'Other'         },
];
const STARTS = [
  { key: 0,  label: 'Now'        },
  { key: 5,  label: '5 min ago'  },
  { key: 10, label: '10 min ago' },
  { key: 15, label: '15 min ago' },
];
const DURATIONS = [
  { key: '15m',     label: '15 min'   },
  { key: '30m',     label: '30 min'   },
  { key: '1h',      label: '1 hour'   },
  { key: '2h+',     label: '2 h+'     },
  { key: 'unknown', label: 'Unknown'  },
];

export default function StoppageModal({ open, defaultLine, onClose, onSubmit }) {
  const [line, setLine]         = useState(defaultLine ?? '17');
  const [reason, setReason]     = useState('breakdown');
  const [startAgo, setStartAgo] = useState(0);
  const [duration, setDuration] = useState('30m');

  useEffect(() => {
    if (open) {
      setLine(defaultLine ?? '17');
      setReason('breakdown');
      setStartAgo(0);
      setDuration('30m');
    }
  }, [open, defaultLine]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  function submit() {
    onSubmit?.({
      line,
      reason,
      startedAt: Date.now() - startAgo * 60_000,
      startAgoMin: startAgo,
      duration,
      ts: Date.now(),
    });
  }

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
            className="rd-modal qf-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Log line stoppage"
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, y: 6, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.99 }}
            transition={{ duration: 0.14, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <header className="rd-head">
              <div className="rd-head-main">
                <div className="rd-head-row1">
                  <h2 className="rd-mat">Log line stoppage</h2>
                  <span className="rd-kind" style={{ background: '#b3422f', color: '#fff' }}>Live</span>
                </div>
                <div className="rd-sku">Pauses the line in the schedule and prompts a replan.</div>
              </div>
              <button className="rd-close" onClick={onClose} aria-label="Close">×</button>
            </header>

            <section className="rd-section qf-section">
              <div className="rd-section-h">Line</div>
              <div className="qf-chips">
                {LINES.map((l) => (
                  <button
                    key={l}
                    type="button"
                    className={`qf-chip${line === l ? ' on' : ''}`}
                    onClick={() => setLine(l)}
                  >L{l}</button>
                ))}
              </div>
            </section>

            <section className="rd-section qf-section">
              <div className="rd-section-h">Reason</div>
              <div className="qf-chips">
                {REASONS.map((r) => (
                  <button
                    key={r.key}
                    type="button"
                    className={`qf-chip${reason === r.key ? ' on' : ''}`}
                    onClick={() => setReason(r.key)}
                  >{r.label}</button>
                ))}
              </div>
            </section>

            <section className="rd-section qf-section">
              <div className="rd-section-h">Started</div>
              <div className="qf-chips">
                {STARTS.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    className={`qf-chip${startAgo === s.key ? ' on' : ''}`}
                    onClick={() => setStartAgo(s.key)}
                  >{s.label}</button>
                ))}
              </div>
            </section>

            <section className="rd-section qf-section">
              <div className="rd-section-h">Expected duration</div>
              <div className="qf-chips">
                {DURATIONS.map((d) => (
                  <button
                    key={d.key}
                    type="button"
                    className={`qf-chip${duration === d.key ? ' on' : ''}`}
                    onClick={() => setDuration(d.key)}
                  >{d.label}</button>
                ))}
              </div>
            </section>

            <footer className="rd-foot">
              <button className="rd-btn rd-btn-ghost" onClick={onClose}>Cancel</button>
              <button className="rd-btn rd-btn-primary" onClick={submit}>Log stoppage</button>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
