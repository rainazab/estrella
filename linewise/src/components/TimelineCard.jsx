import { motion } from 'framer-motion';
import InfoPopover from './InfoPopover.jsx';

/* TimelineCard — the segment that lives inside a tren lane.
   Accepts clean primitives so the parent (real timeline OR the lab) owns
   data shaping. Renders four flavours:
     - planned product run
     - executed run (past, slightly faded)
     - insertion / shifted variants (kind: 'ins' | 'shift')
     - service blocks (kind: 'clean' | 'maint') — distinct visual, no SKU info

   Width is driven by `widthPx` (parent controls horizontal scale so all
   cards in a row share one pixels-per-hour ratio). If absent we fall back
   to a reasonable default. */
export default function TimelineCard({
  material,
  sku,
  format,
  volume,
  oee,
  lineBaseline,
  durationHours,
  kind = null,
  shiftFromHours = null,
  state = 'planned',
  widthPx,
  onClick,
  selected = false,
  dateLabel = null,
  ghost = false,
  label = null,
}) {
  const isService = kind === 'clean' || kind === 'maint';
  const fmt = format || deriveFormat({ sku, material });
  const delta = lineBaseline != null && oee != null ? oee - lineBaseline : null;
  const band = oeeBand(delta);
  const w = widthPx ?? Math.max(168, Math.round((durationHours ?? 1) * 110));

  if (isService) {
    return (
      <div
        className={`tc tc-service tc-${kind}`}
        style={{ width: w }}
        title={kind === 'clean' ? 'Cleaning / CIP' : 'Maintenance'}
      >
        <span className="tc-svc-label">
          {label || (kind === 'clean' ? 'Cleaning' : 'Maintenance')}
        </span>
        {dateLabel && <span className="tc-svc-date">{dateLabel}</span>}
        <span className="tc-svc-dur">{formatDuration(durationHours)}</span>
      </div>
    );
  }

  if (kind === 'ghost') {
    return (
      <div className="tc tc-ghost" style={{ width: w }} aria-hidden="true">
        <span className="tc-ghost-label">{material} · was here</span>
      </div>
    );
  }

  const cls = [
    'tc',
    `tc-${band}`,
    state === 'executed' ? 'tc-executed' : '',
    kind === 'ins' ? 'tc-ins' : '',
    kind === 'shift' ? 'tc-shift' : '',
    selected ? 'tc-selected' : '',
    ghost ? 'tc-moving-ghost' : '',
    onClick ? 'tc-clickable' : '',
  ].filter(Boolean).join(' ');

  return (
    <motion.button
      type="button"
      className={cls}
      style={{ width: w }}
      onClick={onClick}
      aria-label={`${material}, ${formatVol(volume)} units, OEE ${oee?.toFixed(2)}`}
    >
      {kind === 'ins' && <span className="tc-edge" aria-hidden="true" />}

      {kind === 'ins' && (
        <div className="tc-banner tc-banner-ins">
          <span className="tc-banner-dot" aria-hidden="true" />
          Urgent insert
        </div>
      )}
      {kind === 'shift' && shiftFromHours != null && (
        <div className="tc-banner tc-banner-shift">
          Shifted +{shiftFromHours}h to make room
        </div>
      )}

      <div className="tc-row tc-row-top">
        <span className="tc-mat">{material}</span>
        {fmt && <FormatChip format={fmt} />}
        <span className={`tc-dot tc-dot-${band}`} aria-hidden="true" />
      </div>

      {sku && <div className="tc-sku" title={sku}>{sku}</div>}
      {dateLabel && <div className="tc-date">{dateLabel}</div>}

      <div className="tc-bar" aria-hidden="true">
        <div className={`tc-bar-fill tc-bar-${band}`} />
      </div>

      <div className="tc-row tc-row-bot">
        <span className="tc-vol">{formatVol(volume)}<span className="tc-vol-u">un</span></span>
        <span className="tc-sep">·</span>
        <span className="tc-dur">{formatDuration(durationHours)}</span>
        <span className="tc-grow" />
        {oee != null && (
          <span className="tc-oee">
            <span className="tc-oee-l">OEE</span>
            <span className={`tc-oee-v tc-oee-v-${band}`}>{oee.toFixed(2)}</span>
          </span>
        )}
      </div>

      {delta != null && lineBaseline != null && (
        <div className={`tc-vsline tc-vsline-${band}`}>
          <span className="tc-vsline-arrow">
            {band === 'good' ? '↑' : band === 'bad' ? '↓' : '±'}
          </span>
          <span className="tc-vsline-delta">
            {Math.abs(delta).toFixed(2)}
          </span>
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

function FormatChip({ format }) {
  const tone =
    format === '33cl' ? 'tercio' :
    format === '50cl' ? 'medio'  :
    format === '44cl' ? 'cuarenta' : 'other';
  return <span className={`tc-fmt tc-fmt-${tone}`}>{format}</span>;
}

/* ---------- helpers (pure) — exported for the modal to reuse ---------- */

export function deriveFormat({ sku, material }) {
  if (sku) {
    const m = sku.match(/(\d{2,3})\s*cl/i);
    if (m) return `${m[1]}cl`;
  }
  if (material) {
    if (/13/.test(material)) return '33cl';
    if (/(12|05)/.test(material)) return '50cl';
    if (/(2\s*\/\s*5|2[-_]5|\b44\b)/.test(material)) return '44cl';
  }
  return null;
}

export function oeeBand(delta) {
  if (delta == null) return 'mid';
  if (delta >= 0.02) return 'good';
  if (delta <= -0.02) return 'bad';
  return 'mid';
}

export function fmtDelta(delta) {
  const pts = Math.round(delta * 100);
  if (pts === 0) return '±0 vs line';
  return `${pts > 0 ? '+' : ''}${pts} vs line`;
}

export function fmtDeltaShort(delta) {
  const pts = Math.round(delta * 100);
  if (pts === 0) return '±0';
  return `${pts > 0 ? '+' : ''}${pts}`;
}

export function formatVol(n) {
  if (n == null) return '—';
  if (n >= 1000) {
    const k = n / 1000;
    return `${k >= 100 ? Math.round(k) : k.toFixed(k < 10 ? 1 : 0)}k`;
  }
  return String(n);
}

export function formatDuration(h) {
  if (h == null) return '—';
  if (h < 1) return `${Math.round(h * 60)}m`;
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  if (mins === 0) return `${whole}h`;
  return `${whole}h ${mins}m`;
}
