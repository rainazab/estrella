import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/* Floating action button — expands on click into a stacked menu of
   quick actions. The trigger morphs to a "×" while open, and each
   action chip springs up with a short stagger. */
const ACTIONS = [
  { key: 'order',    label: 'New urgent order',  icon: '+',  tone: 'primary' },
  { key: 'issue',    label: 'Report line issue', icon: '!',  tone: 'warn'    },
  { key: 'stoppage', label: 'Log stoppage',      icon: '■',  tone: 'stop'    },
];

export default function Fab({ onAction }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  function pick(key) {
    setOpen(false);
    onAction?.(key);
  }

  return (
    <div className="fab-root" ref={rootRef}>
      <AnimatePresence>
        {open && (
          <motion.div
            className="fab-menu"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
          >
            {ACTIONS.map((a, i) => (
              <motion.button
                key={a.key}
                className={`fab-item tone-${a.tone}`}
                onClick={() => pick(a.key)}
                initial={{ y: 12, opacity: 0, scale: 0.92 }}
                animate={{ y: 0,  opacity: 1, scale: 1 }}
                exit={{    y: 12, opacity: 0, scale: 0.92 }}
                transition={{
                  delay: open ? i * 0.045 : 0,
                  type: 'spring', stiffness: 420, damping: 28,
                }}
              >
                <span className={`fab-item-icon tone-${a.tone}`}>{a.icon}</span>
                <span className="fab-item-label">{a.label}</span>
              </motion.button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        className={`fab${open ? ' is-open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Close quick actions' : 'Open quick actions'}
        aria-expanded={open}
        whileTap={{ scale: 0.94 }}
      >
        <motion.span
          className="fab-plus"
          animate={{ rotate: open ? 45 : 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 22 }}
        >
          +
        </motion.span>
      </motion.button>
    </div>
  );
}
