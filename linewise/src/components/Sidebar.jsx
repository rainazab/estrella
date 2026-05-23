import LiveStatus from './LiveStatus.jsx';

/* Sidebar — full-height left rail.
   Top: large brand block (logo mark + "LineWise" + "El Prat" subtitle).
   Middle: nav items (planner / history / settings — placeholders for now).
   Bottom: Live status pill anchored bottom-left, above a thin border. */
export default function Sidebar({ data, lastSync, activeView = 'planner' }) {
  return (
    <aside className="sidebar">
      <div className="sb-brand">
        <div className="sb-logo">
          <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">
            <rect x="2" y="2" width="36" height="36" rx="9" fill="#1b3a2e" />
            <path d="M11 28 L11 12 L15 12 L15 24 L24 24 L24 28 Z" fill="#d97a3f" />
            <circle cx="29" cy="14" r="3" fill="#d97a3f" />
          </svg>
        </div>
        <div className="sb-brand-text">
          <div className="sb-brand-name">LineWise</div>
          <div className="sb-brand-plant">El Prat · Damm</div>
        </div>
      </div>

      <nav className="sb-nav">
        <div className="sb-nav-section">Workspace</div>
        <SbItem icon="▦" label="Planner" active={activeView === 'planner'} />
        <SbItem icon="⌕" label="Orders" />
        <SbItem icon="⊟" label="History" />
        <SbItem icon="◷" label="Lines &amp; shifts" />

        <div className="sb-nav-section">Analytics</div>
        <SbItem icon="↑" label="OEE trends" />
        <SbItem icon="≣" label="Changeover atlas" />
        <SbItem icon="✎" label="Reports" />
      </nav>

      <div className="sb-spacer" />

      <div className="sb-foot">
        <LiveStatus data={data} lastSync={lastSync} />
      </div>
    </aside>
  );
}

function SbItem({ icon, label, active }) {
  return (
    <button type="button" className={`sb-item${active ? ' on' : ''}`}>
      <span className="sb-ic" aria-hidden="true">{icon}</span>
      <span className="sb-lbl" dangerouslySetInnerHTML={{ __html: label }} />
    </button>
  );
}
