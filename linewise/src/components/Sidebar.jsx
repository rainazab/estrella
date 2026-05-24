import LiveStatus from './LiveStatus.jsx';

/* Sidebar — full-height left rail.
   Top: large brand block (logo mark + "LineWise" + "El Prat" subtitle).
   Middle: nav items (planner / history / settings — placeholders for now).
   Bottom: Live status pill anchored bottom-left, above a thin border. */
export default function Sidebar({ data, lastSync, activeView = 'planner' }) {
  return (
    <aside className="sidebar">
      <div className="sb-brand">
        <img
          src="/brand/logo-damm.png"
          alt="Damm"
          className="sb-damm-mark"
        />
        <div className="sb-brand-text">
          <div className="sb-brand-name">LineWise</div>
          <div className="sb-brand-plant">El Prat planning</div>
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
