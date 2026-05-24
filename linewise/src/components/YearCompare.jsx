/* YearCompare — compact "vs same week last year" strip rendered under
   the KPI strip. Reads `data.yearCompare` and shows one chip per line
   with OEE / volume / changeovers deltas vs the same ISO week of the
   previous year. */
import InfoPopover from './InfoPopover.jsx';

const LINE_ORDER = ['14', '17', '19'];

function fmtDelta(now, last, { kind = 'number' } = {}) {
  if (now == null || last == null) return null;
  const delta = now - last;
  const sign = delta >= 0 ? '+' : '−';
  if (kind === 'oee') {
    return `${sign}${Math.abs(delta * 100).toFixed(1)} pp`;
  }
  if (kind === 'volume') {
    const k = Math.abs(delta) >= 1000 ? `${(Math.abs(delta) / 1000).toFixed(1)}k` : `${Math.round(Math.abs(delta))}`;
    return `${sign}${k}`;
  }
  return `${sign}${Math.round(Math.abs(delta))}`;
}

function tone(delta, { higherIsBetter = true } = {}) {
  if (delta == null || Number.isNaN(delta)) return 'neutral';
  if (delta === 0) return 'neutral';
  const good = higherIsBetter ? delta > 0 : delta < 0;
  return good ? 'good' : 'bad';
}

export default function YearCompare({ data }) {
  const yc = data?.yearCompare;
  if (!yc?.lines) return null;
  const lines = LINE_ORDER.filter((line) => yc.lines[line]);
  if (!lines.length) return null;

  return (
    <div className="yc-strip" role="group" aria-label="Same week last year">
      <div className="yc-strip-head">
        <span className="yc-strip-title">vs same week last year</span>
        <span className="yc-strip-week">{yc.weekLabel}</span>
        <InfoPopover title="Year-on-year comparison">
          <p>
            Compares the current ISO week to the <b>same week of the previous calendar year</b>.
            OEE is in percentage points; volume in HL; changeovers in count.
          </p>
          <p className="ip-foot">Source: MES history pull (Damm El Prat).</p>
        </InfoPopover>
      </div>
      <div className="yc-line-chips">
        {lines.map((line) => {
          const row = yc.lines[line];
          const oeeDelta = row.oeeNow - row.oeeLast;
          const volDelta = (row.volNow ?? 0) - (row.volLast ?? 0);
          const chgDelta = (row.changesNow ?? 0) - (row.changesLast ?? 0);
          return (
            <div key={line} className="yc-chip">
              <div className="yc-chip-h">
                <span className="yc-chip-line">L{line}</span>
                <span className={`yc-chip-oee t-${tone(oeeDelta, { higherIsBetter: true })}`}>
                  {fmtDelta(row.oeeNow, row.oeeLast, { kind: 'oee' }) ?? '—'}
                  <span className="yc-chip-oee-label">OEE</span>
                </span>
              </div>
              <div className="yc-chip-row">
                <span className="yc-chip-k">Volume</span>
                <span className={`yc-chip-v t-${tone(volDelta, { higherIsBetter: true })}`}>
                  {fmtDelta(row.volNow, row.volLast, { kind: 'volume' }) ?? '—'}
                </span>
              </div>
              <div className="yc-chip-row">
                <span className="yc-chip-k">Changeovers</span>
                <span className={`yc-chip-v t-${tone(chgDelta, { higherIsBetter: false })}`}>
                  {fmtDelta(row.changesNow, row.changesLast, { kind: 'count' }) ?? '—'}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
