import { motion } from 'framer-motion';
import { deriveFormat, formatVol } from './TimelineCard.jsx';

/* DraftPlanPanel — right-side overlay listing the current draft plan,
   grouped by line. Mirrors the Inbox panel's slide-in pattern so the
   user gets a consistent "drawer" experience from the TopBar menu. */

const FORMAT_TONE = {
  '33cl': 'tercio',
  '50cl': 'medio',
  '44cl': 'cuarenta',
};

const LINE_LABEL = {
  '14': 'L14 · CF PRAT',
  '17': 'L17 · CF PRAT',
  '19': 'L19 · CF PRAT',
};

export default function DraftPlanPanel({ plan, onClose }) {
  const lanes = Object.entries(plan ?? {});
  const totalRuns = lanes.reduce((sum, [, lane]) => sum + lane.length, 0);
  const totalUnits = lanes.reduce(
    (sum, [, lane]) => sum + lane.reduce((s, r) => s + (r.vol ?? 0), 0),
    0,
  );
  const totalWeeks = lanes.reduce(
    (sum, [, lane]) => sum + lane.reduce((s, r) => s + (r.w ?? 0), 0),
    0,
  );

  return (
    <motion.div
      className="inbox-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        className="inbox-panel"
        initial={{ x: 20, opacity: 0.6 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 20, opacity: 0 }}
        transition={{ duration: 0.16, ease: 'easeOut' }}
      >
        <div className="inbox-head">
          <div>
            <div className="eyebrow">Draft Plan</div>
            <div className="panel-title">Plan summary</div>
          </div>
          <span className="inbox-x" onClick={onClose}>✕</span>
        </div>
        <div className="panel-desc">
          {totalRuns} runs · {formatVol(totalUnits)} un · {totalWeeks.toFixed(1)}w scheduled
        </div>

        <div className="inbox-sections">
          {lanes.map(([lineKey, lane]) => (
            <section key={lineKey} className="inbox-section">
              <div className="section-head">
                <span className="section-title">{LINE_LABEL[lineKey] ?? `L${lineKey}`}</span>
                <span className="section-count">{lane.length}</span>
              </div>
              {lane.length === 0 ? (
                <div className="section-empty">No runs scheduled.</div>
              ) : (
                <div className="inbox-cards">
                  {lane.map((run, idx) => (
                    <DraftCard key={`${lineKey}-${run.of}-${idx}`} run={run} />
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>

        <div className="panel-foot bordered">
          Working copy of the plan — drafts auto-save and can be promoted to
          the live schedule from the planner view.
        </div>
      </motion.div>
    </motion.div>
  );
}

function DraftCard({ run }) {
  const fmt = deriveFormat({ sku: run.sku, material: run.of });
  const brand = (run.sku ?? '').split(' · ')[0];
  return (
    <div className="tc tc-inbox tc-mid">
      <div className="tc-row tc-row-top">
        <span className="tc-mat">{run.of}</span>
        {fmt && <span className={`tc-fmt tc-fmt-${FORMAT_TONE[fmt] ?? 'other'}`}>{fmt}</span>}
        <span className="tc-grow" />
        <span className="tc-due">
          <span className="tc-due-l">OEE</span>
          <span className="tc-due-v">{(run.oee ?? 0).toFixed(2)}</span>
        </span>
      </div>
      <div className="tc-row tc-row-bot">
        <span className="tc-sku" title={run.sku}>{brand}</span>
        <span className="tc-sep">·</span>
        <span className="tc-vol">{formatVol(run.vol ?? 0)}<span className="tc-vol-u">un</span></span>
        <span className="tc-grow" />
        <span className="tc-due">
          <span className="tc-due-l">dur</span>
          <span className="tc-due-v">{(run.w ?? 0).toFixed(1)}w</span>
        </span>
      </div>
    </div>
  );
}
