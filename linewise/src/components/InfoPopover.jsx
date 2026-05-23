import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/* InfoPopover — click an ⓘ icon, get a styled popover with proper content.
   Replaces the native `title` tooltip pattern (small, system-styled, slow
   to appear) with a real card we control. Renders the popover via portal
   to document.body so it escapes any parent's overflow:hidden clipping.
   Closes on click-outside or Esc. */
export default function InfoPopover({ title, children }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e) {
      if (btnRef.current?.contains(e.target)) return;
      if (popRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  /* Compute popover position from icon rect — sit above the icon by
     default, flip to below if too close to viewport top. Center on the
     icon horizontally, clamp to viewport edges. */
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const update = () => {
      const r = btnRef.current.getBoundingClientRect();
      const POP_W = 280, POP_H = 170, GAP = 8;
      const flipBelow = r.top < POP_H + GAP + 12;
      const top = flipBelow ? r.bottom + GAP : r.top - POP_H - GAP;
      let left = r.left + r.width / 2 - POP_W / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - POP_W - 8));
      setPos({ top, left, side: flipBelow ? 'bottom' : 'top' });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open]);

  return (
    <span className="tc-info-wrap">
      <button
        ref={btnRef}
        type="button"
        className="tc-info"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        onMouseDown={(e) => e.stopPropagation()}
        aria-label="More info"
        aria-expanded={open}
      >ⓘ</button>
      {open && pos && createPortal(
        <div
          ref={popRef}
          className={`tc-info-pop tc-info-pop-${pos.side}`}
          role="dialog"
          style={{ top: pos.top, left: pos.left }}
          onClick={(e) => e.stopPropagation()}
        >
          {title && <div className="tc-info-pop-h">{title}</div>}
          <div className="tc-info-pop-body">{children}</div>
        </div>,
        document.body,
      )}
    </span>
  );
}
