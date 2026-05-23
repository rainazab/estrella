import { motion } from 'framer-motion';
import {
  oeeBand, formatVol, formatDuration,
} from './TimelineCard.jsx';
import InfoPopover from './InfoPopover.jsx';

/* AggregateCard — the zoomed-out cousin of TimelineCard.
   - week view: one card = one day (period='day')
   - month view: one card = one week (period='week')

   Same dimensions (220×152), same visual grammar, but different
   content semantics: a date label instead of a material code, a
   summary line instead of a SKU, and aggregated stats (total vol,
   productive hours, avg OEE).                              */
export default function AggregateCard({
  period = 'day',             // 'day' (in week view) | 'week' (in month view)
  label,                       // 'Wed 27 May' or 'Week 21'
  subLabel,                    // '18-24 May' (month only) — secondary date
  dominantMaterial,            // if the period had one dominant run, show its code
  dominantSku,                 // and SKU
  runCount,                    // total run count
  cleanCount = 0,
  maintCount = 0,
  formats = [],                // ['33cl', '50cl']
  totalVolume,
  productiveHours,
  avgOee,
  lineBaseline,
  isToday = false,
  hasUrgentInsert = false,
  isIdle = false,
  widthPx,
  onClick,
  selected = false,
}) {
  const delta = lineBaseline != null && avgOee != null ? avgOee - lineBaseline : null;
  const band = oeeBand(delta);
  const w = widthPx ?? 220;

  const cls = [
    'tc', 'tc-agg', `tc-${band}`,
    isToday ? 'tc-agg-today' : '',
    hasUrgentInsert ? 'tc-agg-ins' : '',
    isIdle ? 'tc-agg-idle' : '',
    selected ? 'tc-selected' : '',
    onClick ? 'tc-clickable' : '',
  ].filter(Boolean).join(' ');

  /* Idle period — no production. Distinct visual (hatched, muted). */
  if (isIdle) {
    return (
      <div className={cls} style={{ width: w }}>
        <div className="tc-row tc-row-top">
          <span className="tc-mat">{label}</span>
          {subLabel && <span className="tc-agg-sublabel">{subLabel}</span>}
          {isToday && <span className="tc-agg-today-pill">today</span>}
        </div>
        <div className="tc-agg-idle-msg">No production scheduled</div>
      </div>
    );
  }

  return (
    <motion.button
      type="button"
      layout
      whileHover={onClick ? { y: -1 } : undefined}
      whileTap={onClick ? { y: 0 } : undefined}
      className={cls}
      style={{ width: w }}
      onClick={onClick}
      aria-label={`${label}, ${formatVol(totalVolume)} units, OEE ${avgOee?.toFixed(2)}`}
    >
      {hasUrgentInsert && (
        <div className="tc-banner tc-banner-ins">
          <span className="tc-banner-dot" aria-hidden="true" />
          Urgent insert here
        </div>
      )}

      {/* Top row — date label + today pill + band dot. Format chips
          and counts live in the subtitle so the date never truncates. */}
      <div className="tc-row tc-row-top">
        <span className="tc-mat tc-agg-label">{label}</span>
        {isToday && <span className="tc-agg-today-pill">today</span>}
        <span className={`tc-dot tc-dot-${band}`} aria-hidden="true" />
      </div>

      {/* Subtitle — format chips inline with material name or count summary */}
      <div className="tc-agg-sub-row">
        <FormatChips formats={formats} />
        <span className="tc-agg-sub" title={dominantSku ?? undefined}>
          {dominantMaterial
            ? (dominantSku ? `${dominantMaterial} · ${dominantSku}` : dominantMaterial)
            : summaryLine({ runCount, cleanCount, maintCount, period, subLabel })}
        </span>
      </div>

      <div className="tc-bar" aria-hidden="true">
        <div className={`tc-bar-fill tc-bar-${band}`} />
      </div>

      {/* Stats row — total volume, productive hours, avg OEE */}
      <div className="tc-row tc-row-bot">
        <span className="tc-vol">{formatVol(totalVolume)}<span className="tc-vol-u">un</span></span>
        <span className="tc-sep">·</span>
        <span className="tc-dur">{formatDuration(productiveHours)}</span>
        <span className="tc-grow" />
        {avgOee != null && (
          <span className="tc-oee">
            <span className="tc-oee-l">OEE</span>
            <span className={`tc-oee-v tc-oee-v-${band}`}>{avgOee.toFixed(2)}</span>
          </span>
        )}
      </div>

      {/* vsline — same explainer as the run card, pinned to the bottom */}
      {delta != null && lineBaseline != null && (
        <div className={`tc-vsline tc-vsline-${band}`}>
          <span className="tc-vsline-arrow">
            {band === 'good' ? '↑' : band === 'bad' ? '↓' : '±'}
          </span>
          <span className="tc-vsline-delta">{Math.abs(delta).toFixed(2)}</span>
          <span className="tc-vsline-label">
            {band === 'good' ? 'above' : band === 'bad' ? 'below' : 'at'} line avg {lineBaseline.toFixed(2)}
          </span>
          <InfoPopover title="Line baseline">
            <p>
              <b>{lineBaseline.toFixed(2)}</b> is the <b>30-day rolling average OEE</b>
              {' '}for this line.
            </p>
            <p>
              <span className="ip-k">Source</span>
              <span className="ip-v">MES pull (Damm El&nbsp;Prat)</span>
            </p>
            <p>
              <span className="ip-k">Refresh</span>
              <span className="ip-v">Daily at 06:00 CET</span>
            </p>
            <p className="ip-foot">
              Runs above the baseline are favourable; below it are flagged for review.
            </p>
          </InfoPopover>
        </div>
      )}
    </motion.button>
  );
}

function FormatChips({ formats }) {
  if (!formats?.length) return null;
  return (
    <span className="tc-agg-fmts">
      {formats.map((f) => (
        <span
          key={f}
          className={`tc-fmt tc-fmt-${formatTone(f)}`}
        >{f}</span>
      ))}
    </span>
  );
}

function formatTone(fmt) {
  if (fmt === '33cl') return 'tercio';
  if (fmt === '50cl') return 'medio';
  if (fmt === '44cl') return 'cuarenta';
  return 'other';
}

function summaryLine({ runCount, cleanCount, maintCount, period, subLabel }) {
  const parts = [];
  if (runCount) parts.push(`${runCount} ${runCount === 1 ? 'run' : 'runs'}`);
  if (cleanCount) parts.push(`${cleanCount} clean`);
  if (maintCount) parts.push(`${maintCount} maint`);
  const summary = parts.join(' · ');
  if (period === 'week' && subLabel) {
    return `${subLabel} · ${summary}`;
  }
  return summary;
}
