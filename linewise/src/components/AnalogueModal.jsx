import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { buildAnalogueIndex, evidenceVerdict, TYPE_LABELS } from '../lib/analogues.js';

/* AnalogueModal — spacious "See all N analogues" viewer.
   Owns the verdict-driven distribution strip (the load-bearing element),
   the verdict block, filter chips, and the sortable N-row table.
   Mounted by RecommendationPanel; AnimatePresence in the parent. */
export default function AnalogueModal({ recKey, rec, order, onClose }) {
  const evidence = rec.evidence;
  const rows = useMemo(() => buildAnalogueIndex(recKey, evidence), [recKey, evidence]);
  const verdict = useMemo(() => evidenceVerdict(rec, rows), [rec, rows]);

  const [typeFilter, setTypeFilter] = useState('all');
  const [lineFilter, setLineFilter] = useState('all');
  const [sortKey, setSortKey] = useState('date');
  const [sortDir, setSortDir] = useState('desc');

  const filtered = useMemo(() => {
    let r = rows;
    if (typeFilter !== 'all') r = r.filter((x) => x.type === typeFilter);
    if (lineFilter !== 'all') r = r.filter((x) => x.line === lineFilter);
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...r].sort((a, b) => {
      if (sortKey === 'oee') return (parseFloat(a.oee) - parseFloat(b.oee)) * dir;
      if (sortKey === 'line') return a.line.localeCompare(b.line) * dir;
      if (sortKey === 'type') return a.typeLabel.localeCompare(b.typeLabel) * dir;
      return (parseDate(a.date) - parseDate(b.date)) * dir;
    });
  }, [rows, typeFilter, lineFilter, sortKey, sortDir]);

  function toggleSort(k) {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir(k === 'date' ? 'desc' : 'asc'); }
  }

  const analogueMean = parseFloat(evidence.analogueMean);
  const naiveMean = parseFloat(evidence.naiveMean);

  return (
    <motion.div
      className="rd-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.14 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        className={`rd-modal an-modal an-modal-${verdict.tone}`}
        initial={{ y: 8, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 8, opacity: 0 }}
        transition={{ duration: 0.16, ease: 'easeOut' }}
      >
        <div className="rd-head">
          <div className="rd-head-main">
            <div className="rd-head-row1">
              <span className="rd-mat">Historical analogues</span>
              <span className="rd-fmt rd-fmt-medio">{rec.line}</span>
            </div>
            <div className="rd-sku">{order.sku} — inserted {rec.position}</div>
            <div className="rd-line">{evidence.n} matching changeovers from 2025 execution history</div>
          </div>
          <button className="rd-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="rd-stats">
          <div className={`rd-stat rd-stat-${verdict.tone}`}>
            <span className="rd-stat-l">Analogue mean OEE</span>
            <span className="rd-stat-v">{evidence.analogueMean}</span>
            <span className="rd-stat-s">across {evidence.n} runs</span>
          </div>
          <div className="rd-stat rd-stat-bad">
            <span className="rd-stat-l">Naive-slot mean</span>
            <span className="rd-stat-v">{evidence.naiveMean}</span>
            <span className="rd-stat-s">brand-and-clean band</span>
          </div>
          <div className={`rd-stat rd-stat-${verdict.tone}`}>
            <span className="rd-stat-l">Gain</span>
            <span className="rd-stat-v">{evidence.gain}</span>
            <span className="rd-stat-s">vs. naive</span>
          </div>
          <div className="rd-stat">
            <span className="rd-stat-l">Sample size</span>
            <span className="rd-stat-v">{evidence.n}</span>
            <span className="rd-stat-s">{verdict.thinN ? 'thin evidence' : '2025 to date'}</span>
          </div>
        </div>

        <div className="rd-section">
          <div className="rd-section-h">OEE distribution</div>
          <Distribution
            rows={rows}
            analogueMean={analogueMean}
            naiveMean={naiveMean}
            verdict={verdict}
          />
          <div className={`an-verdict an-verdict-${verdict.tone}`}>
            <div className="an-verdict-headline">{verdict.headline}</div>
            <div className="an-verdict-detail">{verdict.detail}</div>
          </div>
        </div>

        <div className="rd-section an-filters">
          <FilterChips
            label="Match type"
            value={typeFilter}
            onChange={setTypeFilter}
            options={[['all', 'All']].concat(uniqueTypes(rows).map((t) => [t, TYPE_LABELS[t] || t]))}
            counts={countBy(rows, 'type')}
          />
          <FilterChips
            label="Line"
            value={lineFilter}
            onChange={setLineFilter}
            options={[['all', 'All']].concat(uniqueLines(rows).map((l) => [l, `Line ${l}`]))}
            counts={countBy(rows, 'line')}
          />
        </div>

        <div className="an-table-wrap">
          <table className="an-table">
            <thead>
              <tr>
                <th className="an-th-of">Order</th>
                <th>SKU</th>
                <SortableTh k="date" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort}>Date</SortableTh>
                <SortableTh k="line" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort}>Line</SortableTh>
                <SortableTh k="type" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort}>Match</SortableTh>
                <SortableTh k="oee" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right">OEE</SortableTh>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => (
                <tr key={`${row.of}-${row.date}-${i}`} className={row.sample ? 'an-row-sample' : ''}>
                  <td className="an-td-of">
                    <span className="ocode">{row.of}</span>
                    {row.sample && <span className="an-pin" title="Cited in the recommendation">★</span>}
                  </td>
                  <td className="an-td-sku">{row.sku || '—'}</td>
                  <td className="an-td-date">{row.date}</td>
                  <td>Line {row.line}</td>
                  <td><span className={`an-type an-type-${row.type}`}>{row.typeLabel}</span></td>
                  <td className="an-td-oee">{row.oee}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan="6" className="an-empty">No analogues match this filter.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="an-foot">
          Showing {filtered.length} of {rows.length} analogues · ★ rows are cited in the recommendation
        </div>
      </motion.div>
    </motion.div>
  );
}

function SortableTh({ children, k, sortKey, sortDir, onClick, align }) {
  const active = sortKey === k;
  return (
    <th
      className={`an-th-sort${active ? ' on' : ''}`}
      style={align === 'right' ? { textAlign: 'right' } : undefined}
      onClick={() => onClick(k)}
    >
      {children}
      <span className="an-th-caret">{active ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span>
    </th>
  );
}

function FilterChips({ label, value, onChange, options, counts }) {
  return (
    <div className="an-filter-row">
      <span className="an-filter-l">{label}</span>
      <div className="an-chips">
        {options.map(([k, lbl]) => {
          const c = k === 'all' ? Object.values(counts).reduce((a, b) => a + b, 0) : (counts[k] || 0);
          return (
            <button
              key={k}
              className={`an-chip${value === k ? ' on' : ''}`}
              onClick={() => onChange(k)}
            >
              {lbl} <span className="an-chip-n">{c}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* Distribution strip — verdict-driven.
   - At low n: track desaturates to a hatched pattern, dots dim, "Thin evidence"
     badge pins to the strip so the visual confidence matches reality.
   - Mean marker color follows verdict tone (good/warn/bad), so the worse-than-
     naive case reads red instead of green.
   - The labels flip sides based on whether the mean sits left or right of naive
     so they never overlap. */
function Distribution({ rows, analogueMean, naiveMean, verdict }) {
  const values = rows.map((r) => parseFloat(r.oee));
  const dataMin = Math.min(...values, naiveMean, analogueMean);
  const dataMax = Math.max(...values, naiveMean, analogueMean);
  const pad = (dataMax - dataMin) * 0.1 || 0.02;
  const lo = Math.max(0.3, dataMin - pad);
  const hi = Math.min(0.75, dataMax + pad);
  const span = hi - lo;
  const pct = (v) => ((v - lo) / span) * 100;

  const ticks = [];
  for (let v = Math.ceil(lo * 20) / 20; v <= hi + 1e-6; v += 0.05) {
    ticks.push(Number(v.toFixed(2)));
  }

  const meanLeft = analogueMean <= naiveMean;

  return (
    <div className={`an-dist verdict-${verdict.tone}${verdict.thinN ? ' is-thin' : ''}`}>
      <div className="an-dist-axis">
        {ticks.map((t) => (
          <span key={t} className="an-dist-axis-tick" style={{ left: `${pct(t)}%` }}>{t.toFixed(2)}</span>
        ))}
      </div>
      <div className="an-dist-track">
        {rows.map((r, i) => (
          <span
            key={`${r.of}-${i}`}
            className={`an-dist-dot${r.sample ? ' sample' : ''}`}
            style={{ left: `${pct(parseFloat(r.oee))}%` }}
            title={`${r.of} · ${r.date} · ${r.typeLabel} · ${r.oee}`}
          />
        ))}
        <span className="an-dist-marker an-dist-marker-naive" style={{ left: `${pct(naiveMean)}%` }}>
          <span className={`an-dist-marker-l ${meanLeft ? 'side-r' : 'side-l'}`}>naive {naiveMean.toFixed(2)}</span>
        </span>
        <span
          className={`an-dist-marker an-dist-marker-mean tone-${verdict.tone}`}
          style={{ left: `${pct(analogueMean)}%` }}
        >
          <span className={`an-dist-marker-l ${meanLeft ? 'side-l' : 'side-r'}`}>mean {analogueMean.toFixed(2)}</span>
        </span>
      </div>
      {verdict.thinN && <span className="an-dist-thin-badge">Thin evidence — n={rows.length}</span>}
    </div>
  );
}

function countBy(rows, key) {
  const c = {};
  for (const r of rows) c[r[key]] = (c[r[key]] || 0) + 1;
  return c;
}

function uniqueTypes(rows) {
  const seen = new Set();
  for (const r of rows) seen.add(r.type);
  return [...seen];
}

function uniqueLines(rows) {
  const seen = new Set();
  for (const r of rows) seen.add(r.line);
  return [...seen].sort();
}

function parseDate(d) {
  const months = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
  const [day, mon, yr] = d.split(' ');
  return new Date(Number(yr), months[mon] || 0, Number(day)).getTime();
}
