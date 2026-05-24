import { useState } from 'react';
import { motion } from 'framer-motion';
import { useTimelineMoveFlow } from '../hooks/useTimelineMoveFlow.js';
import Timeline from '../components/Timeline.jsx';
import { deriveFormat } from '../components/TimelineCard.jsx';
import './plan-lab.css';

const REASON_LABEL = {
  breakdown: 'Breakdown',
  'no-material': 'No material',
  'no-operator': 'No operator',
  'quality-hold': 'Quality hold',
  other: 'Other',
};

const DURATION_LABEL = {
  '15m': '15 min',
  '30m': '30 min',
  '1h': '1 hour',
  '2h+': '2+ hours',
  unknown: 'Unknown',
};

/* StoppageReviewLab — review surface launched from the ReplanBanner's
   "Replan" button. Reuses PlanLab's outer shell and CSS so the planner
   lands somewhere visually consistent with the urgent-move review, but
   the contents are stoppage-specific: a stoppage banner up top, every
   pushed run as a card on the left rail, and the timeline below
   focused on the stopped line. */
export default function StoppageReviewLab({
  data,
  preview,
  onBack,
  onUndo,
}) {
  const [zoom, setZoom] = useState('month');
  const [timelineExpanded, setTimelineExpanded] = useState(false);
  const [actionDialog, setActionDialog] = useState(null);

  /* The committed plan is already the shifted plan — pass it in so the
     timeline mounts pre-shifted. basePlan is the same so no rec preview
     state is needed. */
  const { timelineProps, overlays } = useTimelineMoveFlow({
    data,
    basePlan: preview.plan,
    initialCommittedPlan: preview.plan,
  });

  const lineKey = String(preview.line);
  const reasonLabel = REASON_LABEL[preview.reason] || preview.reason || 'Stoppage';
  const durationLabel = DURATION_LABEL[preview.durationKey] || preview.durationKey || '—';
  const shiftHoursText = fmtHours(preview.shiftedHours);
  const runCount = preview.shiftedRuns?.length ?? 0;
  const lineAvgOee = data?.lineBaseline?.[lineKey] ?? null;

  function confirmActionDialog() {
    if (actionDialog === 'undo') {
      onUndo?.();
      setActionDialog(null);
      return;
    }
    setActionDialog(null);
    onBack?.();
  }

  return (
    <div className="pl-root">
      <header className="pl-order pl-order-moved">
        <span className="pl-order-tag pl-order-tag-moved">STOPPAGE REPLAN</span>
        <div className="pl-order-main">
          <b>L{lineKey} · {reasonLabel}</b>
          <span>{runCount} {runCount === 1 ? 'run' : 'runs'} pushed · {shiftHoursText} forward</span>
        </div>
        <div className="pl-order-meta">
          <span className="pl-order-meta-item">
            <span className="pl-order-meta-label">Reason</span>
            <b>{reasonLabel}</b>
            <small>est. {durationLabel}</small>
          </span>
          <span className="pl-order-meta-item">
            <span className="pl-order-meta-label">Effect</span>
            <b>L{lineKey}</b>
            <small>{runCount} {runCount === 1 ? 'run' : 'runs'} +{shiftHoursText}</small>
          </span>
        </div>
      </header>

      <div className="pl-grid pl-grid-move">
        <ShiftedRunsRail
          runs={preview.shiftedRuns ?? []}
          lineKey={lineKey}
          lineAvgOee={lineAvgOee}
          shiftHoursText={shiftHoursText}
        />

        <main className="pl-main">
          <motion.section className="pl-impact tone-mid pl-impact-move" layout>
            <div className="pl-impact-h">
              <div className="pl-impact-title">
                <div className="pl-kicker-row">
                  <span className="pl-kicker">Stoppage replan</span>
                </div>
                <h2>
                  L{lineKey} {reasonLabel.toLowerCase()} · {runCount} {runCount === 1 ? 'run' : 'runs'} pushed +{shiftHoursText}
                </h2>
                <span className="pl-impact-sub">
                  The lane is already updated on the schedule below. Review the moved cards on the left, then return to the queue.
                </span>
              </div>
            </div>

            <div className="pl-impact-body pl-impact-body-manual">
              <div className="pl-impact-main">
                <div className="pl-kpi-row" role="group" aria-label="Stoppage replan impact">
                  <Kpi
                    label="Shift"
                    value={`+${shiftHoursText}`}
                    tone="mid"
                    description="Lane pushed forward by this much."
                  />
                  <Kpi
                    label="Runs moved"
                    value={runCount}
                    tone={runCount > 0 ? 'mid' : 'good'}
                    description="Production runs on the lane that now start later."
                  />
                  <Kpi
                    label="Line"
                    value={`L${lineKey}`}
                    tone="quiet"
                    description="The stopped lane being replanned."
                  />
                  <Kpi
                    label="Line avg OEE"
                    value={lineAvgOee != null ? lineAvgOee.toFixed(2) : '—'}
                    tone="quiet"
                    description="30-day rolling baseline for context on each card."
                  />
                </div>
              </div>

              <aside className="pl-impact-side pl-impact-side-move" aria-label="Stoppage context">
                <div className="pl-verdict v-mid">
                  <span className="pl-verdict-kicker">What happened</span>
                  <span className="pl-verdict-line">{reasonLabel} on L{lineKey}</span>
                  <ul className="pl-bullets">
                    <li>Estimated downtime: {durationLabel}.</li>
                    <li>Every planned run on L{lineKey} shifted forward by {shiftHoursText}.</li>
                    <li>Service blocks on the lane shift too — they'll be renegotiated separately.</li>
                  </ul>
                </div>

                <div className="pl-verdict pl-move-note">
                  <span className="pl-verdict-kicker">Review focus</span>
                  <span className="pl-verdict-line">Every pushed run is listed on the left</span>
                  <ul className="pl-bullets">
                    <li>The timeline below reflects the new lane order.</li>
                    <li>Use "Undo replan" if the line restarts sooner than expected.</li>
                  </ul>
                </div>
              </aside>
            </div>
          </motion.section>

          <motion.section
            layout
            className={`pl-timeline pl-timeline-full${timelineExpanded ? ' is-fullscreen' : ''}`}
            transition={{ type: 'spring', stiffness: 280, damping: 30 }}
          >
            <div className="pl-timeline-h">
              <span>
                Timeline
                <em className="pl-manual-tag"> · stoppage replan</em>
              </span>
              <div className="pl-timeline-actions">
                <div className="zoom-ctl" role="tablist" aria-label="Timeline zoom">
                  {['week', 'month', 'quarter'].map((z) => (
                    <button
                      key={z}
                      type="button"
                      role="tab"
                      aria-selected={zoom === z}
                      className={zoom === z ? 'on' : ''}
                      onClick={() => setZoom(z)}
                    >
                      {z[0].toUpperCase() + z.slice(1)}
                    </button>
                  ))}
                </div>
                <button
                  className="pl-fullscreen-btn"
                  type="button"
                  aria-pressed={timelineExpanded}
                  onClick={() => setTimelineExpanded((expanded) => !expanded)}
                  title={timelineExpanded ? 'Exit fullscreen' : 'Open timeline fullscreen'}
                >
                  <span className="pl-fullscreen-ic" aria-hidden="true" />
                  {timelineExpanded ? 'Exit' : 'Fullscreen'}
                </button>
              </div>
            </div>

            <Timeline
              data={data}
              mode="default"
              zoom={zoom}
              {...timelineProps}
            />
          </motion.section>
        </main>
      </div>

      <footer className="pl-foot">
        <button className="pl-btn-ghost" type="button" onClick={() => setActionDialog('undo')}>
          Undo replan
        </button>
        <span className="pl-live">● Stoppage replan committed · L{lineKey} +{shiftHoursText}</span>
        <div className="pl-foot-actions">
          <button className="pl-btn-primary" type="button" onClick={() => onBack?.()}>
            Return to schedule
          </button>
        </div>
      </footer>

      {actionDialog && (
        <StoppageActionDialog
          type={actionDialog}
          lineKey={lineKey}
          shiftHoursText={shiftHoursText}
          onCancel={() => setActionDialog(null)}
          onConfirm={confirmActionDialog}
        />
      )}

      {overlays}
    </div>
  );
}

function ShiftedRunsRail({ runs, lineKey, lineAvgOee, shiftHoursText }) {
  return (
    <aside className="pl-move-rail" aria-label={`Runs pushed on L${lineKey}`}>
      <div className="pl-move-map">
        <div className="pl-move-map-head">
          <span>Pushed runs · L{lineKey}</span>
          <b>+{shiftHoursText} each</b>
        </div>
        {runs.length === 0 ? (
          <div className="pl-move-step">
            <div className="pl-move-copy">
              <span className="pl-move-kicker">No runs to move</span>
              <small>This lane was empty when the stoppage hit.</small>
            </div>
          </div>
        ) : (
          runs.map((run, i) => (
            <ShiftedRunCard
              key={`${run.of || 'run'}-${i}`}
              run={run}
              lineAvgOee={lineAvgOee}
              shiftHoursText={shiftHoursText}
              index={i}
            />
          ))
        )}
      </div>
    </aside>
  );
}

function ShiftedRunCard({ run, lineAvgOee, shiftHoursText, index }) {
  const format = deriveFormat({ sku: run.sku, material: run.of });
  const oee = typeof run.oee === 'number' ? run.oee : null;
  const oeeDelta = oee != null && lineAvgOee != null ? oee - lineAvgOee : null;
  const units = run.vol != null ? Math.round(Number(run.vol) * 1000) : null;

  return (
    <div className="pl-move-step is-after">
      <span className="pl-move-dot" aria-hidden="true" />
      <div className="pl-move-copy pl-shift-card">
        <span className="pl-move-kicker">Shifted +{shiftHoursText}</span>
        <b className="pl-shift-of">{run.of || `Run ${index + 1}`}</b>
        <small className="pl-shift-meta">
          {format && <span>{format}</span>}
          {units != null && <span> · {fmtUnits(units)} un</span>}
          {oee != null && <span> · OEE {oee.toFixed(2)}</span>}
        </small>
        {oeeDelta != null && (
          <small className={`pl-shift-delta ${oeeDelta > 0.005 ? 'good' : oeeDelta < -0.005 ? 'bad' : 'quiet'}`}>
            {oeeDelta >= 0 ? '+' : '−'}{Math.abs(oeeDelta).toFixed(2)} vs line avg {lineAvgOee?.toFixed(2) ?? '—'}
          </small>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, tone, description }) {
  return (
    <div className={`pl-kpi-card t-${tone}`}>
      <div className="pl-kpi-card-head">
        <span className="pl-kpi-card-label">{label}</span>
      </div>
      <b className="pl-kpi-card-value">{value}</b>
      {description && <span className="pl-kpi-card-desc">{description}</span>}
    </div>
  );
}

function StoppageActionDialog({ type, lineKey, shiftHoursText, onCancel, onConfirm }) {
  const copy = type === 'undo'
    ? {
        eyebrow: 'Undo replan',
        heading: 'Restore the pre-stoppage schedule?',
        body: `This rolls L${lineKey} back to where it was before the +${shiftHoursText} shift. The stoppage stays logged.`,
        confirm: 'Undo replan',
        tone: 'mid',
      }
    : {
        eyebrow: 'Return',
        heading: 'Return to the live schedule?',
        body: 'The stoppage replan is already applied. You can revisit the ledger if you need this view again.',
        confirm: 'Return',
        tone: 'good',
      };

  return (
    <motion.div
      className="pl-action-scrim"
      role="presentation"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      onClick={(event) => { if (event.target === event.currentTarget) onCancel(); }}
    >
      <motion.section
        className={`pl-action-dialog tone-${copy.tone}`}
        role="alertdialog"
        aria-modal="true"
        initial={{ y: 12, opacity: 0, scale: 0.98 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 8, opacity: 0, scale: 0.98 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
      >
        <header className="pl-action-head">
          <div>
            <span className="pl-kicker">{copy.eyebrow}</span>
            <h2>{copy.heading}</h2>
            <p>{copy.body}</p>
          </div>
          <button className="pl-action-close" type="button" onClick={onCancel} aria-label="Close">×</button>
        </header>
        <footer className="pl-action-foot">
          <button className="rd-btn rd-btn-ghost" type="button" onClick={onCancel}>Cancel</button>
          <button className="rd-btn rd-btn-primary" type="button" onClick={onConfirm}>{copy.confirm}</button>
        </footer>
      </motion.section>
    </motion.div>
  );
}

function fmtHours(hours) {
  if (hours == null) return '—';
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 10) return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
  return `${Math.round(hours)}h`;
}

function fmtUnits(n) {
  if (n == null) return '—';
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}
