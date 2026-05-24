import { motion } from 'framer-motion';
import { deriveFormat, formatDuration, formatVol } from './TimelineCard.jsx';
import { allowedFormats } from '../lib/lineRules.js';

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

export default function DraftPlanPanel({
  plan,
  originalPlan = null,
  lineRules = null,
  weeklyStops = null,
  planState = 'optimized',
  onClose,
  onMoveRun = null,
}) {
  const lanes = Object.entries(plan ?? {});
  const totalRuns = lanes.reduce(
    (sum, [, lane]) => sum + lane.filter((run) => run.kind !== 'clean' && run.kind !== 'maint').length,
    0,
  );
  const totalUnits = lanes.reduce(
    (sum, [, lane]) => sum + lane.reduce((s, r) => s + (r.vol ?? 0), 0),
    0,
  );
  const totalHours = lanes.reduce(
    (sum, [, lane]) => sum + lane.reduce((s, r) => s + (r.w ?? 0), 0),
    0,
  );
  const originalRuns = Object.values(originalPlan ?? {}).reduce((sum, lane) => sum + (lane?.length ?? 0), 0);

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
            <div className="plan-state-row">
              <span className={`plan-state-chip plan-${planState}`}>{planState}</span>
              <span>vs original Planificado</span>
            </div>
          </div>
          <span className="inbox-x" onClick={onClose}>✕</span>
        </div>
        <div className="panel-desc">
          {totalRuns} runs · {formatVol(totalUnits)} un · {formatDuration(totalHours)} scheduled
          {originalRuns > 0 && ` · ${Math.abs(totalRuns - originalRuns)} run delta`}
        </div>

        <div className="inbox-sections">
          {lanes.map(([lineKey, lane]) => (
            <section key={lineKey} className="inbox-section draft-line-section">
              <div className="section-head">
                <span className="section-title">{LINE_LABEL[lineKey] ?? `L${lineKey}`}</span>
                <span className="section-count">{lane.length}</span>
              </div>
              <LineRuleRow lineKey={lineKey} lineRules={lineRules} />
              {lane.length === 0 ? (
                <div className="section-empty">No runs scheduled.</div>
              ) : (
                <div className="inbox-cards">
                  {mergeStops(lane, weeklyStops?.[lineKey]).map((run, idx) => (
                    <DraftCard
                      key={`${lineKey}-${run.of ?? run.id ?? run.kind}-${idx}`}
                      run={run}
                      onMove={run.kind === 'clean' || run.kind === 'maint' ? null : (() => onMoveRun?.(lineKey, run._planIndex ?? idx))}
                    />
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>

        <div className="panel-foot bordered">
          Locked cleaning and maintenance rows come from Tabla CF and cannot be moved.
        </div>
      </motion.div>
    </motion.div>
  );
}

function DraftCard({ run, onMove = null }) {
  if (run.kind === 'clean' || run.kind === 'maint') {
    return (
      <div className={`tc tc-inbox tc-service-row tc-${run.kind}`}>
        <div className="tc-row tc-row-top">
          <span className="tc-mat">{run.label || (run.kind === 'clean' ? 'Weekly cleaning' : 'Maintenance')}</span>
          <span className="tc-grow" />
          <span className="locked-pill">locked</span>
        </div>
        <div className="tc-row tc-row-bot">
          <span>{run.cadence || 'scheduled'}</span>
          <span className="tc-sep">·</span>
          <span className="tc-dur">{formatDuration(run.w ?? run.durationHours ?? 8)}</span>
        </div>
      </div>
    );
  }
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
          <span className="tc-due-v">{formatDuration(run.w ?? 0)}</span>
        </span>
      </div>
      {onMove && (
        <button type="button" className="draft-move-btn" onClick={onMove}>
          Test move
        </button>
      )}
    </div>
  );
}

function LineRuleRow({ lineKey, lineRules }) {
  const formats = allowedFormats(lineKey, lineRules);
  return (
    <div className="draft-rule-row">
      {formats.map((fmt) => (
        <span key={fmt.key} className="line-rule-chip">{fmt.label}</span>
      ))}
    </div>
  );
}

function mergeStops(lane, stops = []) {
  const merged = [
    ...(lane ?? []).map((run, idx) => ({ ...run, _planIndex: idx })),
    ...(stops ?? []).map((stop) => ({ ...stop, locked: true })),
  ];
  return merged.sort((a, b) => {
    const byStart = Number(a.start ?? 0) - Number(b.start ?? 0);
    if (byStart !== 0) return byStart;
    if (a.kind && !b.kind) return -1;
    if (!a.kind && b.kind) return 1;
    return 0;
  });
}
