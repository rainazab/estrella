import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export const LAST_HANDOFF_STORAGE_KEY = 'linewise.lastHandoff.v1';

export default function ShiftCloseModal({
  open,
  changes = [],
  issues = [],
  stoppages = [],
  onClose,
  onSent,
}) {
  const recent = useMemo(() => changes.slice(-6).reverse(), [changes]);
  const autoSummary = useMemo(
    () => summarizeShift({ changes, issues, stoppages }),
    [changes, issues, stoppages],
  );
  const [noteDraft, setNoteDraft] = useState(null);
  const notes = noteDraft ?? autoSummary;

  const close = useCallback(() => {
    setNoteDraft(null);
    onClose?.();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  function send() {
    const payload = {
      id: `handoff-${Date.now()}`,
      sentAt: Date.now(),
      notes: notes.trim(),
      changes: recent,
      openRisks: buildOpenRisks({ issues, stoppages, changes }),
    };
    try {
      window.localStorage.setItem(LAST_HANDOFF_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      /* Demo handoff persistence is best-effort. */
    }
    onSent?.(payload);
    close();
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
          onClick={close}
        >
          <motion.div
            className="rd-modal handoff-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Close shift handoff"
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, y: 8, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.99 }}
            transition={{ duration: 0.14, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <header className="rd-head">
              <div className="rd-head-main">
                <div className="rd-head-row1">
                  <h2 className="rd-mat">Close shift</h2>
                  <span className="rd-kind rd-kind-shift">Handoff</span>
                </div>
                <div className="rd-sku">Auto-filled from planner changes and open line state.</div>
              </div>
              <button className="rd-close" onClick={close} aria-label="Close">×</button>
            </header>

            <section className="rd-section handoff-section">
              <div className="rd-section-h">Summary</div>
              <textarea
                className="handoff-notes"
                rows={4}
                value={notes}
                onChange={(e) => setNoteDraft(e.target.value)}
              />
            </section>

            <section className="rd-section handoff-section">
              <div className="rd-section-h">Changes made</div>
              {recent.length ? (
                <div className="handoff-list">
                  {recent.map((change) => (
                    <div key={change.id} className="handoff-row">
                      <span>{fmtTime(change.ts)}</span>
                      <b>{change.summary ?? change.type}</b>
                      <small>{detailForChange(change)}</small>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="handoff-empty">No changes logged this session.</div>
              )}
            </section>

            <section className="rd-section handoff-section">
              <div className="rd-section-h">Open risks</div>
              <div className="handoff-risks">
                {buildOpenRisks({ issues, stoppages, changes }).map((risk) => (
                  <span key={risk}>{risk}</span>
                ))}
              </div>
            </section>

            <footer className="rd-foot">
              <button className="rd-btn rd-btn-ghost" onClick={close}>Cancel</button>
              <button className="rd-btn rd-btn-primary" onClick={send}>Send</button>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function summarizeShift({ changes, issues, stoppages }) {
  const parts = [];
  const replans = changes.filter((change) => change.type === 'stoppage_replan_committed');
  const moves = changes.filter((change) => change.type === 'manual_move_confirmed');
  if (stoppages.length) parts.push(`${stoppages.length} line stoppage${stoppages.length === 1 ? '' : 's'} still active.`);
  if (replans.length) parts.push(`${replans.length} replan${replans.length === 1 ? '' : 's'} committed.`);
  if (moves.length) parts.push(`${moves.length} manual move${moves.length === 1 ? '' : 's'} confirmed.`);
  if (issues.length) parts.push(`${issues.length} issue${issues.length === 1 ? '' : 's'} logged for context.`);
  return parts.length ? parts.join(' ') : 'Shift closed with no logged changes.';
}

function buildOpenRisks({ issues, stoppages, changes }) {
  const risks = [];
  for (const stoppage of stoppages) risks.push(`L${stoppage.line} stopped: ${stoppage.reason}`);
  for (const issue of issues.filter((item) => item.severity === 'critical')) risks.push(`Critical issue on L${issue.line}`);
  const collisionMove = changes.find((change) => (change.ripple?.collisions?.length ?? 0) > 0);
  if (collisionMove) risks.push(`${collisionMove.runId} move hits service window`);
  if (!risks.length) risks.push('No open risks captured');
  return risks.slice(0, 4);
}

function detailForChange(change) {
  if (change.type === 'manual_move_confirmed') return `Why: ${change.rationale ?? 'manual'}`;
  if (change.type === 'stoppage_replan_committed') return `Why: ${change.reason ?? 'stoppage'} · ${change.shiftedCount ?? 0} runs shifted`;
  if (change.type === 'stoppage_logged') return `Why: ${change.reason ?? 'stoppage'} · ${change.duration ?? 'unknown'}`;
  if (change.type === 'issue_logged') return `Why: ${change.category ?? 'issue'} · ${change.severity ?? 'warning'}`;
  if (change.type === 'urgent_order_selected') return 'Why: urgent order';
  return '';
}

function fmtTime(ts) {
  if (!ts) return '--:--';
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(ts));
}
