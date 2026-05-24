import { motion } from 'framer-motion';

/* MoveImpactPanel — replaces the throwaway pill with a substantial,
   non-dismissive review surface. Anchored at the top of the canvas so
   it sits in Maria's natural eye path while she scans the new plan
   below. Explicit Confirm / Discard; no auto-commit timer.

   The panel surfaces metrics the per-run OEE estimate can't:
     - Week OEE delta — whole-plan throughput effect of the move
     - Format switches — implies new/avoided CIPs
     - Pushed runs + freed slack — the ripple shape

   Pending design hooks (noted, not yet wired):
     - Due-date risk per pushed run (needs per-run `due` in plan data)
     - Re-rank of Inbox urgent-order suggestions against post-move plan */
export default function MoveImpactPanel({ preview, onConfirm, onDiscard }) {
  const { ripple } = preview;

  const oldOee = num(ripple.oeeOld);
  const newOee = num(ripple.oeeNew);
  const runDelta = pts(ripple.oeeNew, ripple.oeeOld);
  const runTone = toneFromPts(runDelta);

  const weekDelta = pts(ripple.weekOeeNew, ripple.weekOeeOld);
  const weekTone = toneFromPts(weekDelta);

  const switchDelta = (ripple.formatSwitchesNew ?? 0) - (ripple.formatSwitchesOld ?? 0);
  const switchTone = switchDelta < 0 ? 'good' : switchDelta > 0 ? 'bad' : 'mid';

  /* Collisions = pushed runs that overrun a downstream scheduled
     cleaning/maintenance. We don't hard-block the planner — Maria can
     still commit if she has a real reason — but the Confirm button
     turns destructive and a warning bar explains the consequence. */
  const collisions = ripple.collisions ?? [];
  const hasCollisions = collisions.length > 0;

  return (
    <motion.div
      className="move-impact"
      initial={{ y: -16, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: -16, opacity: 0 }}
      transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <div className="mi-head">
        <span className="mi-tag">MOVE PREVIEW</span>
        <div className="mi-title">
          <b>{ripple.runId}</b>
          <span className="mi-arrow">→</span>
          <b>L{ripple.toLine}</b>
          {ripple.destPrev && (
            <span className="mi-where">
              {whereText(ripple.runId, ripple.destPrev, ripple.destNext)}
            </span>
          )}
        </div>
        <div className="mi-actions">
          <button className="mi-btn mi-btn-ghost" onClick={onDiscard}>Discard</button>
          <button
            className={`mi-btn ${hasCollisions ? 'mi-btn-danger' : 'mi-btn-primary'}`}
            onClick={onConfirm}
          >
            {hasCollisions ? 'Override & confirm' : 'Confirm move'}
          </button>
        </div>
      </div>

      {hasCollisions && (
        <div className="mi-warning">
          <span className="mi-warning-icon" aria-hidden="true">⚠</span>
          <div className="mi-warning-text">
            <b>This move breaks {collisions.length} scheduled {collisions.length === 1 ? 'service window' : 'service windows'}.</b>
            {' '}
            {collisions.slice(0, 3).map((c, i) => (
              <span key={c.of + i}>
                {i > 0 && '; '}
                <b>{c.of}</b> would overrun the next {c.kind} by {fmtHours(c.byHours)}
              </span>
            ))}
            {collisions.length > 3 && <> ; +{collisions.length - 3} more</>}.
            {' '}Maintenance won't run on time — confirm only if you've coordinated with the line.
          </div>
        </div>
      )}

      <div className="mi-metrics">
        <Metric
          label="Run OEE estimate"
          value={`${oldOee} → ${newOee}`}
          delta={runDelta}
          tone={runTone}
          help="Recomputed against the new predecessor and destination-line baseline."
        />
        <Metric
          label="Week OEE"
          value={`${num(ripple.weekOeeOld)} → ${num(ripple.weekOeeNew)}`}
          delta={weekDelta}
          tone={weekTone}
          help="Weighted across all forward runs. The whole-plan number."
        />
        <Metric
          label="Format switches"
          value={`${ripple.formatSwitchesOld ?? 0} → ${ripple.formatSwitchesNew ?? 0}`}
          delta={switchDelta}
          deltaFormat={(d) => `${d > 0 ? '+' : ''}${d}`}
          deltaSuffix={switchDelta === 0 ? '' : switchDelta < 0 ? ' (fewer CIPs)' : ' (more CIPs)'}
          tone={switchTone}
          help="Adjacent runs of different formats on the affected lanes. Each switch implies a CIP."
        />
        <Metric
          label="Delivery risk"
          value={(ripple.collisions?.length ?? 0) === 0
            ? 'safe'
            : `${ripple.collisions.length} ${ripple.collisions.length === 1 ? 'run' : 'runs'} collide with ${collidesWithLabel(ripple.collisions)}`}
          tone={(ripple.collisions?.length ?? 0) === 0 ? 'good' : 'bad'}
          help={(ripple.collisions?.length ?? 0) === 0
            ? 'No pushed run overruns a downstream cleaning or maintenance block.'
            : ripple.collisions.map((c) => `${c.of} would overrun the next ${c.kind} by ${fmtHours(c.byHours)}`).join('\n')}
        />
        <Metric
          label="Ripple"
          value={ripple.pushedCount > 0
            ? `${ripple.pushedCount} ${ripple.pushedCount === 1 ? 'run' : 'runs'} pushed ${fmtHours(ripple.pushedHours)}`
            : 'no downstream impact'}
          tone="mid"
          help="Runs after the drop point shift forward by the moved run's duration."
        />
        {ripple.fromLine !== ripple.toLine && (
          <Metric
            label={`L${ripple.fromLine} slack`}
            value={`+${fmtHours(ripple.sourceFreedHours)} freed`}
            tone="good"
            help="The source lane now has this gap available for a future urgent order."
          />
        )}
      </div>
    </motion.div>
  );
}

function Metric({ label, value, delta, deltaFormat, deltaSuffix = '', tone = 'mid', help }) {
  const formatted = delta != null
    ? (deltaFormat ? deltaFormat(delta) : `${delta > 0 ? '+' : ''}${delta} pts`)
    : null;
  return (
    <div className={`mi-metric mi-metric-${tone}`} title={help}>
      <div className="mi-metric-l">{label}</div>
      <div className="mi-metric-row">
        <div className="mi-metric-v">{value}</div>
        {formatted != null && (
          <span className={`mi-metric-d mi-metric-d-${tone}`}>
            {formatted}{deltaSuffix}
          </span>
        )}
      </div>
    </div>
  );
}

function num(n) {
  return n != null ? Number(n).toFixed(2) : '—';
}
function pts(a, b) {
  if (a == null || b == null) return null;
  return Math.round((a - b) * 100);
}
function toneFromPts(pts) {
  if (pts == null) return 'mid';
  if (pts > 1) return 'good';
  if (pts < -1) return 'bad';
  return 'mid';
}
function fmtHours(h) {
  if (h == null) return '—';
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 10) return `${h.toFixed(1)}h`;
  return `${Math.round(h)}h`;
}

/* whereText — landing position copy. Disambiguates the awkward
   "between X and X" case (when both neighbours share a material code,
   which happens often with repeated AmiBock/Estrella runs). */
function whereText(runId, prev, next) {
  if (!prev) return ' · at start of plan';
  if (!next) return <> · after <b>{prev}</b>, at end of plan</>;
  if (prev === next) return <> · between two <b>{prev}</b> runs</>;
  if (prev === runId || next === runId) {
    /* Adjacent neighbour shares the moved run's identity — rare but
       happens on same-lane reshuffles. Don't say "between AM05LTST and
       AM05LTST" when AM05LTST is the thing being moved. */
    const other = prev === runId ? next : prev;
    return <> · next to another <b>{other}</b></>;
  }
  return <> · between <b>{prev}</b> and <b>{next}</b></>;
}

/* collidesWithLabel — terse summary of what the pushed runs hit.
   "the next cleaning" if all collisions are with cleanings; mixed
   wording otherwise. */
function collidesWithLabel(collisions) {
  if (!collisions?.length) return '';
  const kinds = new Set(collisions.map((c) => c.kind));
  if (kinds.size === 1) {
    const k = collisions[0].kind;
    return k === 'clean' ? 'scheduled cleaning' : 'scheduled maintenance';
  }
  return 'scheduled service';
}
