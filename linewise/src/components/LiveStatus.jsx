import { useEffect, useState } from 'react';

/* LiveStatus — pulsing green dot + "Live · synced Xs ago" pill.
   Kept deliberately tiny at the bottom of the board. */
export default function LiveStatus({ lastSync }) {
  const [now, setNow] = useState(Date.now());

  /* tick once a second so the freshness label stays current */
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const secs = Math.max(0, Math.floor((now - lastSync) / 1000));
  const fresh = secs < 60
    ? `${secs}s ago`
    : secs < 3600 ? `${Math.floor(secs / 60)}m ago` : `${Math.floor(secs / 3600)}h ago`;

  return (
    <div className="live-status">
      <span className="dot" />
      <span className="lbl">Live</span>
      <span className="freshness">· synced {fresh}</span>
    </div>
  );
}
