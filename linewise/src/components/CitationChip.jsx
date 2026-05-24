/* CitationChip — Perplexity-style tiny pill that surfaces the
   provenance of one AI-emitted claim. Click → CitationModal with the
   structured fact + clickable source URL.

   Usage:
     <CitationChip citation={citations[id]} />
     <CitationChip.Row citationIds={signal.citationIds} citations={citations} />

   `citation` is a full record `{ id, claim, source: { name, url, date } }`.
   `Row` is a convenience that maps a list of ids → chips with sensible
   spacing, dropping any unknown ids silently. */
import { useEffect, useRef, useState } from 'react';

const HOST_RE = /^https?:\/\/(?:www\.)?([^/]+)/i;

export function shortPublisher(citation) {
  if (!citation) return '';
  const name = citation.source?.name?.trim();
  if (name) return name;
  const m = HOST_RE.exec(citation.source?.url || '');
  return m ? m[1] : 'source';
}

export default function CitationChip({ citation, index, compact = false }) {
  const [open, setOpen] = useState(false);
  if (!citation) return null;
  const label = compact && index != null ? String(index) : shortPublisher(citation);
  return (
    <>
      <button
        type="button"
        className={`citation-chip${compact ? ' citation-chip-compact' : ''}`}
        onClick={() => setOpen(true)}
        aria-label={`Source: ${shortPublisher(citation)}`}
      >
        <span className="citation-chip-mark" aria-hidden="true">↗</span>
        <span className="citation-chip-label">{label}</span>
      </button>
      {open && <CitationModal citation={citation} onClose={() => setOpen(false)} />}
    </>
  );
}

function CitationModal({ citation, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose?.(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="citation-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="citation-modal" role="dialog" aria-modal="true" ref={ref}>
        <div className="citation-modal-head">
          <div>
            <div className="eyebrow">Provenance</div>
            <div className="citation-modal-publisher">{shortPublisher(citation)}</div>
          </div>
          <button type="button" className="citation-modal-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className="citation-modal-claim">{citation.claim}</p>
        <div className="citation-modal-meta">
          {citation.source?.date && (
            <span className="citation-modal-date">{citation.source.date}</span>
          )}
          {citation.source?.url && (
            <a
              className="citation-modal-link"
              href={citation.source.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open source ↗
            </a>
          )}
        </div>
        <div className="citation-modal-foot">via Cala.</div>
      </div>
    </div>
  );
}

function CitationRow({ citationIds = [], citations = {}, compact = false }) {
  if (!citationIds.length) return null;
  return (
    <span className="citation-row">
      {citationIds.map((id, i) => {
        const citation = citations[id];
        if (!citation) return null;
        return <CitationChip key={id} citation={citation} index={i + 1} compact={compact} />;
      })}
    </span>
  );
}

CitationChip.Row = CitationRow;
