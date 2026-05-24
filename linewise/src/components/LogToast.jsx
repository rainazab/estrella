import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/* LogToast — small confirmation pill at bottom-centre. Same lifecycle as
   MovePill: auto-dismiss after a few seconds, paused on hover. Used to
   confirm an issue or stoppage was logged. */
const AUTO_DISMISS_MS = 5000;

export default function LogToast({ toast, onDismiss }) {
  return (
    <AnimatePresence>
      {toast && <Pill key={toast.id} toast={toast} onDismiss={onDismiss} />}
    </AnimatePresence>
  );
}

function Pill({ toast, onDismiss }) {
  const [paused, setPaused] = useState(false);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (paused) return;
    const t = setTimeout(() => dismissRef.current?.(), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [paused, toast]);

  return (
    <motion.div
      className={`log-toast log-toast-${toast.tone || 'neutral'}`}
      initial={{ y: 24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 16, opacity: 0 }}
      transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      role="status"
    >
      <span className={`lt-dot lt-dot-${toast.tone || 'neutral'}`} />
      <span className="lt-text">
        <b>{toast.title}</b>
        {toast.detail && <span className="lt-detail"> · {toast.detail}</span>}
      </span>
      <button className="lt-x" onClick={onDismiss} aria-label="Dismiss">×</button>
    </motion.div>
  );
}
