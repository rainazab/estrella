import { useEffect, useRef, useState } from 'react';

/* IssueBadge — small "!" pill sitting in a lane head, showing how many
   issues have been reported on that line. Click to open a popover listing
   the most recent ones; this is the surface that lets Maria connect a
   later OEE dip back to context she logged earlier. */
const CATEGORY_LABEL = {
  mech: 'Mechanical', elec: 'Electrical', quality: 'Quality', material: 'Material',
};

export default function IssueBadge({ issues, lineKey }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!issues || issues.length === 0) return null;

  const hasCritical = issues.some((i) => i.severity === 'critical');

  return (
    <div className="issue-badge-wrap" ref={rootRef}>
      <button
        type="button"
        className={`issue-badge${hasCritical ? ' is-critical' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-label={`${issues.length} ${issues.length === 1 ? 'issue' : 'issues'} reported on L${lineKey}`}
        aria-expanded={open}
      >
        <span className="ib-icon" aria-hidden="true">!</span>
        <span className="ib-label">Issue</span>
        <span className="ib-count">{issues.length}</span>
      </button>
      {open && (
        <div className="issue-pop" role="dialog">
          <div className="ip-h">
            <span>Logged issues</span>
            <span className="ip-h-line">L{lineKey}</span>
          </div>
          <ul className="ip-list">
            {issues.slice(0, 6).map((iss) => (
              <li key={iss.id} className={`ip-item ip-sev-${iss.severity}`}>
                <div className="ip-item-head">
                  <span className={`ip-sev-dot ip-sev-dot-${iss.severity}`} />
                  <span className="ip-cat">{CATEGORY_LABEL[iss.category] || iss.category}</span>
                  <span className="ip-when">{relTime(iss.ts)}</span>
                </div>
                {iss.note && <div className="ip-note">{iss.note}</div>}
              </li>
            ))}
          </ul>
          {issues.length > 6 && (
            <div className="ip-foot">+{issues.length - 6} older</div>
          )}
        </div>
      )}
    </div>
  );
}

function relTime(ts) {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60)   return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
