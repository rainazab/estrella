import { motion, useMotionValue, useTransform, animate } from 'framer-motion';
import { useEffect } from 'react';

/* ImpactSummary — STUB with the OEE count-up animation already wired,
   since the user called out animating that number on selection.
   Will be expanded with the four ic-cells and the impact-foot copy. */
export default function ImpactSummary({ rec, order }) {
  const targetDelta = parseFloat(rec.oeeDelta.replace('−', '-').replace('+', ''));
  const count = useMotionValue(0);
  const rounded = useTransform(count, (v) => {
    const sign = v >= 0 ? '+' : '−';
    return sign + Math.abs(v).toFixed(1);
  });

  useEffect(() => {
    const controls = animate(count, targetDelta, { duration: 0.6, ease: 'easeOut' });
    return controls.stop;
  }, [targetDelta, count]);

  return (
    <div className={`impact ${rec.oeeGood ? 'pos' : 'neg'}`}>
      <div className="impact-lead">
        <span className="impact-eyebrow">Impact of this choice</span>
        <div className="impact-headline">
          <span className="impact-delta">
            <motion.span>{rounded}</motion.span><span className="iu"> OEE</span>
          </span>
          <span className="impact-vs">vs. the naive plan</span>
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 8 }}>
        ImpactSummary placeholder — recovery: {rec.recovery.hours}h · {order.hl} hl placed
      </div>
    </div>
  );
}
