import { useEffect, useRef, useState } from 'react';

/* TopBar — full-width header.
   Left: LineWise brand + plant subtitle.
   Centre: empty (room for future page-title / breadcrumb).
   Right: green bell (urgent orders), user avatar + caret menu.
   (Live status lives in the sidebar footer — bottom-left of the app.) */
export default function TopBar({
  urgentCount,
  inboxOpen,
  onBellClick,
  onSettings,
  onLogout,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  return (
    <header className="topbar">
      <div className="topbar-brand">
        <svg viewBox="0 0 40 40" width="32" height="32" aria-hidden="true">
          <rect x="2" y="2" width="36" height="36" rx="9" fill="#1b3a2e" />
          <path d="M11 28 L11 12 L15 12 L15 24 L24 24 L24 28 Z" fill="#d97a3f" />
          <circle cx="29" cy="14" r="3" fill="#d97a3f" />
        </svg>
        <div className="topbar-brand-text">
          <div className="topbar-brand-name">LineWise</div>
          <div className="topbar-brand-plant">El Prat · Damm</div>
        </div>
      </div>

      <div className="topbar-spacer" />

      <div className="topbar-actions">
        <button
          type="button"
          className={`bell-btn${inboxOpen ? ' on' : ''}`}
          onClick={onBellClick}
          aria-label={`Urgent orders${urgentCount ? ` · ${urgentCount} pending` : ''}`}
          title={urgentCount ? `${urgentCount} urgent order${urgentCount > 1 ? 's' : ''}` : 'No urgent orders'}
        >
          <span className="bell-ic">🔔</span>
          <span className={`badge${!urgentCount ? ' zero' : ''}`}>{urgentCount}</span>
        </button>

        <div className="user-wrap" ref={menuRef}>
          <button
            type="button"
            className="user-btn"
            onClick={() => setMenuOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            {imgFailed ? (
              <span className="avatar-img avatar-fallback">MR</span>
            ) : (
              <img
                className="avatar-img"
                src="https://i.pravatar.cc/80?img=47"
                alt="Maria Rovira"
                onError={() => setImgFailed(true)}
              />
            )}
            <span className="user-who">
              <b>Maria Rovira</b>
              <span>Planner · El Prat</span>
            </span>
            <span className="caret">▾</span>
          </button>
          {menuOpen && (
            <div className="user-menu" role="menu">
              <div className="user-menu-h">
                <b>Maria Rovira</b>
                <span>maria.rovira@damm.com</span>
              </div>
              <button
                className="user-menu-item"
                role="menuitem"
                onClick={() => { setMenuOpen(false); onSettings?.(); }}
              >
                <span className="ic">⚙</span> Settings
              </button>
              <button
                className="user-menu-item danger"
                role="menuitem"
                onClick={() => { setMenuOpen(false); onLogout?.(); }}
              >
                <span className="ic">⎋</span> Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
