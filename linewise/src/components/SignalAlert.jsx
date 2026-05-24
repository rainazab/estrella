/* SignalAlert — proactive banner triggered by an inbound Cala signal.
   Surfaces above the KPI strip when a critical signal with
   actionHint: 'replan' has landed and the planner hasn't dismissed it
   in this session. Two actions:

     - Review  → scrolls the World Signals strip into view
     - Dismiss → suppresses this signal id for the rest of the session

   We intentionally don't auto-fire a replan: the structured fact
   informs the planner; the planner decides. That matches the
   "augmented planner" tone of the rest of the UI. */
import { useMemo } from 'react';
import CitationChip from './CitationChip.jsx';

const STORAGE_KEY = 'linewise.signals.dismissed.v1';

function loadDismissed() {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

function persistDismissed(set) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    /* preference, not critical */
  }
}

/* Pick the highest-impact signal worth proactively banner-ing. We treat
   the list as already-sorted by the panel, but apply our own filter so
   the banner only triggers on the strongest claim. */
function pickProactiveSignal(signals, dismissed) {
  if (!Array.isArray(signals)) return null;
  return signals.find((s) =>
    s
    && s.severity === 'critical'
    && s.actionHint === 'replan'
    && !dismissed.has(s.id),
  ) ?? null;
}

export default function SignalAlert({ data, dismissed, onDismiss, onReview }) {
  const signal = useMemo(() => pickProactiveSignal(data?.signals, dismissed), [data, dismissed]);
  if (!signal) return null;
  const citations = data?.citations ?? {};

  return (
    <div className="signal-alert" role="alert">
      <div className="signal-alert-l">
        <span className="signal-alert-dot" aria-hidden="true" />
        <div>
          <div className="signal-alert-kicker">
            World signal · {signal.linesAffected?.length ? signal.linesAffected.map((l) => `L${l}`).join(' · ') : 'plant-wide'}
          </div>
          <p className="signal-alert-body">{signal.body}</p>
          <CitationChip.Row citationIds={signal.citationIds ?? []} citations={citations} compact />
        </div>
      </div>
      <div className="signal-alert-r">
        {onReview && (
          <button type="button" className="signal-alert-review" onClick={() => onReview(signal)}>
            Review
          </button>
        )}
        <button type="button" className="signal-alert-dismiss" onClick={() => onDismiss(signal.id)} aria-label="Dismiss alert">
          Dismiss
        </button>
      </div>
    </div>
  );
}

SignalAlert.loadDismissed = loadDismissed;
SignalAlert.persistDismissed = persistDismissed;
