import { motion } from 'framer-motion';
import { deriveFormat, formatVol, formatDuration, fmtDelta, oeeBand } from './TimelineCard.jsx';

/* DraftPlanPanel — right-side overlay listing the next few runs from the
   draft plan as a chronological card list across all lines.

   Scope:
     - Shows the next THREE upcoming (non-expired) runs, sorted by start.
       The full plan stays accessible from the timeline; this drawer is a
       quick "what's next?" preview.
     - Defensive "expired" branding: any run whose end has slipped into
       the past is dimmed and excluded from the active count. */

const TODAY = new Date(2026, 4, 23);
const WK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const FORMAT_TONE = {
  '33cl': 'tercio',
  '50cl': 'medio',
  '44cl': 'cuarenta',
};

const MAX_RUNS = 3;

function addDays(base, days) {
  const d = new Date(base);
  d.setDate(d.getDate() + Math.round(days));
  return d;
}

function fmtDay(d) {
  return `${WK[d.getDay()]} ${d.getDate()}`;
}

/* Args in HOURS per the v2.3+ contract (start, w). Convert internally
   so the daily-tick math stays in days. */
function fmtRange(startHours, durHours) {
  const a = addDays(TODAY, startHours / 24);
  const b = addDays(TODAY, (startHours + durHours) / 24);
  if (a.toDateString() === b.toDateString()) return fmtDay(a);
  return `${fmtDay(a)} → ${fmtDay(b)}`;
}

function startsIn(hours) {
  if (hours <= 0) return 'now';
  if (hours < 24) return 'today';
  const days = hours / 24;
  if (days < 2) return 'tomorrow';
  if (days < 7) return `in ${Math.round(days)}d`;
  const weeks = days / 7;
  if (weeks < 8) return `in ${weeks.toFixed(weeks < 2 ? 1 : 0)}w`;
  return `in ${Math.round(weeks / 4.3)}mo`;
}

export default function DraftPlanPanel({ plan, lineBaseline = {}, onClose, onRunClick }) {
  const runs = [];
  for (const [lineKey, lane] of Object.entries(plan ?? {})) {
    lane.forEach((r, idx) => {
      runs.push({ ...r, lineKey, idx });
    });
  }
  runs.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));

  const active = runs.filter((r) => (r.start ?? 0) + (r.w ?? 0) >= 0);
  const upcoming = active.slice(0, MAX_RUNS);

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
            <div className="panel-title">Next up</div>
          </div>
          <span className="inbox-x" onClick={onClose}>✕</span>
        </div>
        <div className="panel-desc">
          Showing next {upcoming.length} of {active.length} planned runs · click a card for details.
        </div>

        <div className="draft-cards">
          {upcoming.length === 0 ? (
            <div className="section-empty">No upcoming runs.</div>
          ) : (
            upcoming.map((run) => (
              <DraftCard
                key={`${run.lineKey}-${run.idx}-${run.of}`}
                run={run}
                baseline={lineBaseline?.[run.lineKey]}
                onClick={onRunClick ? () => onRunClick(run) : undefined}
              />
            ))
          )}
        </div>

        <div className="panel-foot bordered">
          Working copy of the plan — drafts auto-save and can be promoted to
          the live schedule from the planner view.
        </div>
      </motion.div>
    </motion.div>
  );
}

function DraftCard({ run, baseline, onClick }) {
  const fmt = deriveFormat({ sku: run.sku, material: run.of });
  const brand = (run.sku ?? '').split(' · ')[0];
  const start = run.start ?? 0;
  const dur = run.w ?? 0;
  const expired = start + dur < 0;
  const oee = Number.isFinite(run.oee) ? run.oee : null;
  const delta = oee != null && baseline != null ? oee - baseline : null;
  const band = delta != null ? oeeBand(delta) : null;

  const cls = [
    'draft-card',
    expired ? 'draft-card-expired' : '',
    onClick && !expired ? 'draft-card-clickable' : '',
  ].filter(Boolean).join(' ');

  function handleKeyDown(e) {
    if (expired || !onClick) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    onClick();
  }

  return (
    <div
      role={expired || !onClick ? undefined : 'button'}
      tabIndex={expired || !onClick ? undefined : 0}
      className={cls}
      onClick={expired ? undefined : onClick}
      onKeyDown={handleKeyDown}
      aria-label={`${run.of} on L${run.lineKey}, ${fmtRange(start, dur)}`}
    >
      <div className="draft-card-top">
        <span className="draft-card-of">{run.of}</span>
        {fmt && <span className={`tc-fmt tc-fmt-${FORMAT_TONE[fmt] ?? 'other'}`}>{fmt}</span>}
        <span className="draft-card-line">L{run.lineKey}</span>
        <span className="tc-grow" />
        {expired ? (
          <span className="tc-status-pill tc-status-done">expired</span>
        ) : (
          <span className="draft-card-eta">{startsIn(start)}</span>
        )}
      </div>

      <div className="draft-card-sku" title={run.sku}>{brand}</div>

      <div className="draft-card-meta">
        <div className="draft-meta-cell">
          <span className="draft-meta-l">When</span>
          <span className="draft-meta-v">{fmtRange(start, dur)}</span>
        </div>
        <div className="draft-meta-cell">
          <span className="draft-meta-l">Duration</span>
          <span className="draft-meta-v">{formatDuration(dur)}</span>
        </div>
        <div className="draft-meta-cell">
          <span className="draft-meta-l">Volume</span>
          <span className="draft-meta-v">{formatVol(run.vol ?? 0)}<span className="tc-vol-u">un</span></span>
        </div>
        <div className="draft-meta-cell">
          <span className="draft-meta-l">OEE</span>
          <span className="draft-meta-v">
            {oee != null ? oee.toFixed(2) : '—'}
            {delta != null && (
              <span className={`draft-meta-delta draft-delta-${band}`}>
                {' '}{fmtDelta(delta)}
              </span>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
