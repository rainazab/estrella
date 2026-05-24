import { motion } from 'framer-motion';

/* MoveBanner — pinned at top of the workspace while Maria is moving a
   run. Renders the run identity, a drag-source chip (HTML5 drag api,
   mirrors the urgent-order drag tray pattern), and a Cancel control.

   The chip is the drag handle. When dragging starts, the Timeline picks
   up the dragover/drop events on compatible lanes. We don't try to
   represent the chip with the original card visuals — a compact pill is
   clearer about "what's in flight" and survives the chip moving outside
   the lane bounds. */
export default function MoveBanner({ moving, onCancel }) {
  const run = moving.run;
  return (
    <motion.div
      className="move-banner"
      initial={{ y: -32, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: -32, opacity: 0 }}
      transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <span className="mb-tag">MOVING</span>
      <div className="mb-main">
        <span className="mb-of">{run.of}</span>
        <span className="mb-sku">{run.sku}</span>
      </div>
      <div
        className="mb-chip"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', 'move:' + run.of);
          e.dataTransfer.effectAllowed = 'move';
        }}
        aria-label={`Drag ${run.of} to a compatible line`}
      >
        <span className="mb-chip-grip">⠿</span>
        <span className="mb-chip-of">{run.of}</span>
        <span className="mb-chip-fmt">{moving.format}</span>
      </div>
      <span className="mb-hint">Drag to a compatible line · Esc to cancel</span>
      <button className="mb-cancel" onClick={onCancel} aria-label="Cancel move">
        Cancel
      </button>
    </motion.div>
  );
}
