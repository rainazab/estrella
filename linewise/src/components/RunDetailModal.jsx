import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  deriveFormat, oeeBand, fmtDelta, formatVol, formatDuration,
} from './TimelineCard.jsx';
import InfoPopover from './InfoPopover.jsx';

const LINE_LABELS = { '14': 'Line 14', '17': 'Line 17', '19': 'Line 19' };

/* RunDetailModal — click a TimelineCard, get this.
   Sections (top → bottom):
     1. Header (material, SKU, format, kind badge, close)
     2. Stat row (volume, OEE, delta, duration)
     3. Sequence strip (prev → this → next, with changeover classification)
     4. Why-this-OEE narrative
     5. Action (Move to another line) — planned runs only           */
export default function RunDetailModal({
  open,
  run,
  prev,
  next,
  lineKey,
  lineBaseline,
  state = 'planned',
  onClose,
  onMove,
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence initial={false}>
      {open && run && (
        <motion.div
          key="rd-overlay"
          className="rd-overlay"
          initial={{ opacity: 1 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          onClick={onClose}
        >
          <motion.div
            className="rd-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`Run detail for ${run.material}`}
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 1, y: 4, scale: 0.995 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.99 }}
            transition={{ duration: 0.14, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <Body
              run={run}
              prev={prev}
              next={next}
              lineKey={lineKey}
              lineBaseline={lineBaseline}
              state={state}
              onClose={onClose}
              onMove={onMove}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Body({ run, prev, next, lineKey, lineBaseline, state, onClose, onMove }) {
  const isExecuted = state === 'executed';
  const fmt = run.format || deriveFormat({ sku: run.sku, material: run.material });
  const delta = lineBaseline != null && run.oee != null ? run.oee - lineBaseline : null;
  const band = oeeBand(delta);

  const prevFmt = prev ? (prev.format || deriveFormat({ sku: prev.sku, material: prev.material })) : null;
  const nextFmt = next ? (next.format || deriveFormat({ sku: next.sku, material: next.material })) : null;

  const inCost = classifyChangeover(prev, run);
  const outCost = classifyChangeover(run, next);

  return (
    <>
      {/* Header */}
      <header className="rd-head">
        <div className="rd-head-main">
          <div className="rd-head-row1">
            <h2 className="rd-mat">{run.material}</h2>
            {fmt && <span className={`rd-fmt rd-fmt-${formatTone(fmt)}`}>{fmt}</span>}
            {run.kind === 'ins' && <span className="rd-kind rd-kind-ins">Inserted urgent</span>}
            {run.kind === 'shift' && <span className="rd-kind rd-kind-shift">Shifted +{run.shiftFromHours ?? 0}h</span>}
          </div>
          {run.sku && <div className="rd-sku">{run.sku}</div>}
          {lineKey && <div className="rd-line">{LINE_LABELS[lineKey] ?? `Line ${lineKey}`} · CF Prat</div>}
        </div>
        <button className="rd-close" onClick={onClose} aria-label="Close">×</button>
      </header>

      {/* Stat row */}
      <section className="rd-stats">
        <Stat label="Volume" value={`${formatVol(run.volume)}`} sub="units" />
        <Stat
          label="OEE"
          value={run.oee != null ? run.oee.toFixed(2) : '—'}
          sub={lineBaseline != null ? (
            <>
              line avg {lineBaseline.toFixed(2)}
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
            </>
          ) : null}
          tone={band}
        />
        <Stat
          label="vs line"
          value={delta != null ? fmtDelta(delta).replace(' vs line', '') : '—'}
          sub={delta != null ? `${(delta * 100).toFixed(1)} pts` : null}
          tone={band}
        />
        <Stat label="Duration" value={formatDuration(run.durationHours)} sub={run.startLabel} />
      </section>

      {/* Sequence strip */}
      <section className="rd-section">
        <div className="rd-section-h">Sequence</div>
        <div className="rd-seq">
          <SeqSlot item={prev} role="prev" />
          <Changeover cost={inCost} />
          <SeqSlot item={{ ...run, format: fmt }} role="current" />
          <Changeover cost={outCost} />
          <SeqSlot item={next} role="next" />
        </div>
      </section>

      {/* Why this OEE */}
      <section className="rd-section">
        <div className="rd-section-h">Why this OEE {isExecuted ? 'result' : 'estimate'}</div>
        <p className="rd-prose">
          {whyProse({ run, prev, inCost, band, delta, isExecuted })}
        </p>
      </section>

      {/* Actions */}
      {isExecuted ? (
        <footer className="rd-foot rd-foot-readonly">
          <span className="rd-foot-note">Executed run · read-only</span>
        </footer>
      ) : (
        <footer className="rd-foot">
          <button className="rd-btn rd-btn-primary" onClick={onMove}>Move to another line</button>
        </footer>
      )}
    </>
  );
}

/* ---------- presentational pieces ---------- */

function Stat({ label, value, sub, tone }) {
  return (
    <div className={`rd-stat ${tone ? `rd-stat-${tone}` : ''}`}>
      <div className="rd-stat-l">{label}</div>
      <div className="rd-stat-v">{value}</div>
      {sub && <div className="rd-stat-s">{sub}</div>}
    </div>
  );
}

function SeqSlot({ item, role }) {
  if (!item) {
    return (
      <div className={`rd-seqslot rd-seqslot-empty rd-seqslot-${role}`}>
        <div className="rd-seqslot-l">{role === 'prev' ? 'Start of plan' : 'End of plan'}</div>
      </div>
    );
  }
  if (item.kind === 'clean' || item.kind === 'maint') {
    return (
      <div className={`rd-seqslot rd-seqslot-svc rd-seqslot-${role}`}>
        <div className="rd-seqslot-l">{role === 'prev' ? 'Before' : 'After'}</div>
        <div className="rd-seqslot-v">{item.kind === 'clean' ? 'Cleaning' : 'Maintenance'}</div>
        <div className="rd-seqslot-s">{formatDuration(item.durationHours)}</div>
      </div>
    );
  }
  const fmt = item.format || deriveFormat({ sku: item.sku, material: item.material });
  return (
    <div className={`rd-seqslot rd-seqslot-${role}`}>
      <div className="rd-seqslot-l">{role === 'prev' ? 'Before' : role === 'next' ? 'After' : 'This run'}</div>
      <div className="rd-seqslot-v">{item.material}</div>
      <div className="rd-seqslot-s">
        {fmt && <span className={`rd-fmt rd-fmt-${formatTone(fmt)}`}>{fmt}</span>}
      </div>
    </div>
  );
}

function Changeover({ cost }) {
  if (!cost) return <span className="rd-arrow">→</span>;
  return (
    <div className={`rd-changeover rd-co-${cost.band}`} title={cost.detail}>
      <span className="rd-co-arrow">→</span>
      <span className="rd-co-label">{cost.label}</span>
    </div>
  );
}

/* ---------- logic helpers ---------- */

function classifyChangeover(a, b) {
  if (!a || !b) return null;
  if (a.kind === 'clean' || a.kind === 'maint') {
    return { band: 'mid', label: 'post-service restart', detail: 'Coming out of a service block — typical OEE dip on first hour.' };
  }
  if (b.kind === 'clean' || b.kind === 'maint') {
    return { band: 'mid', label: 'into service', detail: 'Run ends before scheduled cleaning / maintenance.' };
  }
  const af = a.format || deriveFormat({ sku: a.sku, material: a.material });
  const bf = b.format || deriveFormat({ sku: b.sku, material: b.material });
  const sameFmt = af && bf && af === bf;
  const sameBrand = brandKey(a.material) && brandKey(a.material) === brandKey(b.material);

  if (sameFmt && sameBrand) {
    return { band: 'good', label: 'same envase, same brand', detail: 'Cheapest possible transition — no format change, no brand change.' };
  }
  if (sameFmt) {
    return { band: 'mid', label: 'same envase, brand change', detail: 'No format change, but brand switch costs ~1.4 OEE points historically.' };
  }
  return { band: 'bad', label: 'format change', detail: 'Different can format — implies tooling change and a CIP step.' };
}

function brandKey(material) {
  if (!material) return null;
  return material.slice(0, 2).toUpperCase();
}

function whyProse({ run, prev, inCost, band, delta, isExecuted = false }) {
  const parts = [];
  const prevLabel = prev?.material ?? (prev?.kind === 'clean' ? 'a cleaning block' : prev?.kind === 'maint' ? 'a maintenance block' : 'previous');

  if (inCost) {
    if (inCost.band === 'good') {
      parts.push(`Follows a same-format, same-brand run (${prevLabel}) — the cheapest transition available.`);
    } else if (inCost.band === 'mid' && inCost.label.startsWith('same envase')) {
      parts.push(`Same can format as the previous run (${prevLabel}), but a brand switch — ${isExecuted ? 'small OEE drag historically' : 'expect a small OEE drag'}.`);
    } else if (inCost.band === 'bad') {
      parts.push(`Different format from ${prevLabel} — a CIP/tooling change weighs on the first hour of OEE.`);
    } else {
      parts.push(`Restart after a service block — first-hour ramp pulls the run average down.`);
    }
  } else {
    parts.push(isExecuted ? 'First run of the executed window — no predecessor cost.' : 'First run of the plan — no predecessor cost.');
  }

  if (delta != null) {
    const noun = isExecuted ? 'Run landed' : 'Estimate lands';
    if (band === 'good') {
      parts.push(`${noun} ${Math.abs(delta * 100).toFixed(1)} pts above the line baseline — favourable.`);
    } else if (band === 'bad') {
      parts.push(`${noun} ${Math.abs(delta * 100).toFixed(1)} pts below the line baseline — flagged for review.`);
    } else {
      parts.push(`${isExecuted ? 'Result' : 'Estimate'} is within ±2 pts of the line baseline.`);
    }
  }

  if (run.analogue) {
    parts.push(`Historical analogue: ${run.analogue}.`);
  }

  return parts.join(' ');
}

function formatTone(fmt) {
  if (fmt === '33cl') return 'tercio';
  if (fmt === '50cl') return 'medio';
  if (fmt === '44cl') return 'cuarenta';
  return 'other';
}
