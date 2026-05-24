import { motion } from 'framer-motion';

/* MoveCalculating — the "Recalculating impact..." moment between drop
   and the impact panel. Borrows the scanning-lines visual language from
   the urgent-order calculate stage so the move feels like the same kind
   of action: a constraint that Stride re-evaluates the plan against,
   not a sticker the user pasted on. */
export default function MoveCalculating({ moving, dest }) {
  return (
    <motion.div
      className="move-calc"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
    >
      <div className="move-calc-card">
        <div className="mc-head">
          <span className="mc-tag">RECALCULATING</span>
          <div className="mc-title">
            Impact of moving <b>{moving.run.of}</b> → <b>L{dest.lineKey}</b>
          </div>
        </div>
        <div className="mc-scanbox">
          <div className="mc-scanline">
            <span>Reshuffling downstream runs on L{dest.lineKey}</span>
            <span className="mc-done">✓</span>
          </div>
          <div className="mc-scanline">
            <span>Recomputing OEE estimate for the new predecessor</span>
            <span className="mc-done">✓</span>
          </div>
          <div className="mc-scanline">
            <span>Re-checking weekly throughput &amp; format switches</span>
            <span className="mc-pend">…</span>
          </div>
          <div className="mc-progress"><div className="mc-progress-fill" /></div>
        </div>
        <div className="mc-foot">
          Re-running the plan against your manual override
        </div>
      </div>
    </motion.div>
  );
}
