/* WorldSignals — strip rendered above the Timeline showing live
   external context affecting the lines right now. Each signal is a
   structured fact pulled via Cala (or the seed file when the live
   client isn't configured) with inline citation chips.

   Layout decisions:
   - Compact horizontal strip on the planner board, mirroring the KPI
     strip's footprint — high-signal, low real-estate.
   - Severity tints the left border: critical = red, warn = amber,
     info = neutral.
   - Each chip click opens the structured source via CitationChip's
     modal, so the chrome stays minimal here. */
import CitationChip from './CitationChip.jsx';

const CATEGORY_LABEL = {
  supplier: 'Supplier',
  regulatory: 'Regulatory',
  competitor: 'Competitor',
  commodity: 'Commodity',
  other: 'Signal',
};

const SEVERITY_RANK = { critical: 0, warn: 1, info: 2 };

function sortSignals(signals) {
  return [...signals].sort((a, b) => {
    const sa = SEVERITY_RANK[a.severity] ?? 99;
    const sb = SEVERITY_RANK[b.severity] ?? 99;
    if (sa !== sb) return sa - sb;
    return (b.ts ?? 0) - (a.ts ?? 0);
  });
}

function formatGenerated(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function WorldSignals({ data, onRefresh = null }) {
  const signals = data?.signals ?? [];
  const citations = data?.citations ?? {};
  if (!signals.length) return null;
  const sorted = sortSignals(signals);
  const generatedAt = formatGenerated(data?.generatedAt);
  const sourceLabel = data?.source === 'cala' ? 'live · Cala' : 'seed';

  return (
    <section className="world-signals" aria-label="External world signals">
      <header className="ws-head">
        <div className="ws-head-l">
          <span className="ws-title">World signals</span>
          <span className="ws-via">via Cala.</span>
        </div>
        <div className="ws-head-r">
          {generatedAt && <span className="ws-stamp">Updated {generatedAt}</span>}
          <span className={`ws-source ws-source-${data?.source ?? 'seed'}`}>{sourceLabel}</span>
          {onRefresh && (
            <button type="button" className="ws-refresh" onClick={onRefresh} aria-label="Refresh signals">
              ↻
            </button>
          )}
        </div>
      </header>
      <ul className="ws-list">
        {sorted.map((sig) => (
          <li key={sig.id} className={`ws-item ws-sev-${sig.severity}`}>
            <div className="ws-item-h">
              <span className={`ws-cat ws-cat-${sig.category}`}>{CATEGORY_LABEL[sig.category] ?? sig.category}</span>
              <span className={`ws-sev-dot ws-sev-dot-${sig.severity}`} aria-hidden="true" />
              {sig.linesAffected?.length > 0 && (
                <span className="ws-lines">
                  {sig.linesAffected.map((l) => (
                    <span key={l} className="ws-line-chip">L{l}</span>
                  ))}
                </span>
              )}
              {sig.actionHint === 'replan' && (
                <span className="ws-action-hint">replan suggested</span>
              )}
            </div>
            <p className="ws-body">{sig.body}</p>
            <CitationChip.Row citationIds={sig.citationIds ?? []} citations={citations} />
          </li>
        ))}
      </ul>
    </section>
  );
}
