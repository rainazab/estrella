import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/* IssueModal — quick capture for a line-side issue. Doesn't change the
   plan; logged so later OEE dips have explanatory context. */
const LINES = ['14', '17', '19'];
const CATEGORIES = [
  { key: 'mech',     label: 'Mechanical' },
  { key: 'elec',     label: 'Electrical' },
  { key: 'quality',  label: 'Quality'    },
  { key: 'material', label: 'Material'   },
];
const SEVERITIES = [
  { key: 'warn',     label: 'Warning'  },
  { key: 'critical', label: 'Critical' },
];

export default function IssueModal({ open, defaultLine, onClose, onSubmit }) {
  const [line, setLine]         = useState(defaultLine ?? '14');
  const [category, setCategory] = useState('mech');
  const [severity, setSeverity] = useState('warn');
  const [note, setNote]         = useState('');

  /* Reset form whenever the modal re-opens so a previous draft doesn't bleed
     into a fresh report. */
  useEffect(() => {
    if (open) {
      setLine(defaultLine ?? '14');
      setCategory('mech');
      setSeverity('warn');
      setNote('');
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
      category,
      severity,
      note: note.trim(),
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
            aria-label="Report a line issue"
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, y: 6, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.99 }}
            transition={{ duration: 0.14, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <header className="rd-head">
              <div className="rd-head-main">
                <div className="rd-head-row1">
                  <h2 className="rd-mat">Report line issue</h2>
                  <span className="rd-kind rd-kind-shift" style={{ background: '#c97a1f' }}>Logged</span>
                </div>
                <div className="rd-sku">Captured for context — does not pause the run.</div>
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
              <div className="rd-section-h">Category</div>
              <div className="qf-chips">
                {CATEGORIES.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    className={`qf-chip${category === c.key ? ' on' : ''}`}
                    onClick={() => setCategory(c.key)}
                  >{c.label}</button>
                ))}
              </div>
            </section>

            <section className="rd-section qf-section">
              <div className="rd-section-h">Severity</div>
              <div className="qf-chips">
                {SEVERITIES.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    className={`qf-chip qf-chip-sev qf-sev-${s.key}${severity === s.key ? ' on' : ''}`}
                    onClick={() => setSeverity(s.key)}
                  >{s.label}</button>
                ))}
              </div>
            </section>

            <section className="rd-section qf-section">
              <div className="rd-section-h">Note</div>
              <textarea
                className="qf-textarea"
                rows={2}
                placeholder="What happened? (one line is fine)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </section>

            <footer className="rd-foot">
              <button className="rd-btn rd-btn-ghost" onClick={onClose}>Cancel</button>
              <button className="rd-btn rd-btn-primary" onClick={submit}>Log issue</button>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
