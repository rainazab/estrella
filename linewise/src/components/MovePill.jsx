import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';

/* MovePill — shown at the bottom of the canvas after a successful move.
   Format:
     Moved <run> → <line>, between <prev> and <next>
     OEE estimate <old> → <new> (<delta>) · pushed N run by Xh · L<from> freed Yh slack
     [Undo]

   Auto-dismisses after AUTO_DISMISS_MS. Hovering pauses the timer (so
   Maria can read it without it disappearing). Undo restores the prior
   plan and dismisses immediately. */
const AUTO_DISMISS_MS = 9000;

export default function MovePill({ preview, onUndo, onDismiss }) {
  const { ripple } = preview;
  const [paused, setPaused] = useState(false);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (paused) return;
    const t = setTimeout(() => dismissRef.current?.(), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [paused, preview]);

  const oldOee = ripple.oeeOld != null ? ripple.oeeOld.toFixed(2) : '—';
  const newOee = ripple.oeeNew != null ? ripple.oeeNew.toFixed(2) : '—';
  const deltaPts = Math.round((ripple.oeeDelta ?? 0) * 100);
  const deltaTone = deltaPts > 1 ? 'good' : deltaPts < -1 ? 'bad' : 'mid';
  const deltaText = deltaPts === 0
    ? '±0 pts'
    : `${deltaPts > 0 ? '+' : ''}${deltaPts} pts`;

  return (
    <motion.div
      className="move-pill"
      initial={{ y: 24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 16, opacity: 0 }}
      transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="mp-main">
        <div className="mp-line1">
          <span className="mp-tag">MOVED</span>
          <b>{ripple.runId}</b>
          <span className="mp-arrow">→</span>
          <b>L{ripple.toLine}</b>
          {ripple.destPrev && (
            <span className="mp-where">
              between <b>{ripple.destPrev}</b>
              {ripple.destNext ? <> and <b>{ripple.destNext}</b></> : <> and end of plan</>}
            </span>
          )}
        </div>
        <div className="mp-line2">
          <span className="mp-stat">
            OEE estimate <b>{oldOee} → {newOee}</b>
            <span className={`mp-delta mp-delta-${deltaTone}`}>{deltaText}</span>
          </span>
          {ripple.pushedCount > 0 && (
            <span className="mp-sep">·</span>
          )}
          {ripple.pushedCount > 0 && (
            <span className="mp-stat">
              pushed <b>{ripple.pushedCount}</b> {ripple.pushedCount === 1 ? 'run' : 'runs'} by <b>{fmtHours(ripple.pushedHours)}</b>
            </span>
          )}
          {ripple.fromLine !== ripple.toLine && (
            <>
              <span className="mp-sep">·</span>
              <span className="mp-stat">
                L{ripple.fromLine} freed <b>{fmtHours(ripple.sourceFreedHours)}</b> slack
              </span>
            </>
          )}
        </div>
      </div>
      <button className="mp-undo" onClick={onUndo}>Undo</button>
    </motion.div>
  );
}

function fmtHours(h) {
  if (h == null) return '—';
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 10) return `${h.toFixed(1)}h`;
  return `${Math.round(h)}h`;
}
