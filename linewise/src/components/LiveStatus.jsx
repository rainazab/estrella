import { useEffect, useRef, useState } from 'react';

/* LiveStatus — pulsing green dot + "Live · synced Xs ago" pill.
   Click the (i) to open a popover with the model's provenance — the
   information that used to be in the prototype's topbar one-liner
   ("grounded in 2,274 executed orders") lives here, derived from the
   data instead of a marketing string. */
export default function LiveStatus({ data, lastSync }) {
  const [now, setNow] = useState(Date.now());
  const [openInfo, setOpenInfo] = useState(false);
  const rootRef = useRef(null);

  /* tick once a second so the freshness label stays current */
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  /* click-outside dismiss for the popover */
  useEffect(() => {
    if (!openInfo) return;
    function onDown(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpenInfo(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [openInfo]);

  const secs = Math.max(0, Math.floor((now - lastSync) / 1000));
  const fresh = secs < 60
    ? `${secs}s ago`
    : secs < 3600 ? `${Math.floor(secs / 60)}m ago` : `${Math.floor(secs / 3600)}h ago`;

  /* derive provenance from the data itself — honest counts, not hardcoded */
  const lines = data?.lineCentre ? Object.keys(data.lineCentre) : [];
  const executedCount = data?.executedHistory
    ? Object.values(data.executedHistory).reduce(
        (n, segs) => n + segs.filter((s) => !s.kind || (s.kind !== 'clean' && s.kind !== 'maint')).length, 0,
      )
    : 0;
  const analogueCount = data?.recommendations
    ? Object.values(data.recommendations).reduce((n, r) => n + (r.evidence?.n || 0), 0)
    : 0;

  return (
    <div className="live-status" ref={rootRef}>
      <span className="dot" />
      <span className="lbl">Live</span>
      <span className="freshness">· synced {fresh}</span>
      <button
        type="button"
        className="info-btn"
        onClick={() => setOpenInfo((o) => !o)}
        aria-label="Data source"
      >ⓘ</button>
      {openInfo && (
        <div className="popover" style={{ top: 'calc(100% + 6px)', right: 0 }}>
          <div className="popover-h">Data source</div>
          <div className="popover-row"><span className="k">Plant</span><span className="v">El Prat</span></div>
          <div className="popover-row"><span className="k">Lines</span><span className="v">{lines.join(' · ')}</span></div>
          <div className="popover-row"><span className="k">Executed orders in window</span><span className="v">{executedCount.toLocaleString()}</span></div>
          <div className="popover-row"><span className="k">Historical analogues</span><span className="v">{analogueCount.toLocaleString()}</span></div>
          <div className="popover-row"><span className="k">Last synced</span><span className="v">{fresh}</span></div>
          <div className="popover-foot">Recommendations are grounded in your executed changeover history.</div>
        </div>
      )}
    </div>
  );
}
