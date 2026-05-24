import { useState } from 'react';

/* YearCompare - same-week YoY charts. The modal gives this room to breathe:
   tabs switch between an overview and focused grouped bar charts. */
const LINE_ORDER = ['14', '17', '19'];

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'oee', label: 'OEE' },
  { key: 'volume', label: 'Volume' },
  { key: 'changeovers', label: 'Changeovers' },
];

const METRICS = {
  oee: {
    label: 'OEE',
    deltaLabel: 'OEE',
    kind: 'oee',
    higherIsBetter: true,
    max: () => 1,
  },
  volume: {
    label: 'Volume',
    deltaLabel: 'volume',
    kind: 'volume',
    higherIsBetter: true,
    max: (rows) => Math.max(1, ...rows.flatMap(({ row }) => [row.volNow ?? 0, row.volLast ?? 0])),
  },
  changeovers: {
    label: 'Changeovers',
    deltaLabel: 'changeovers',
    kind: 'count',
    higherIsBetter: false,
    max: (rows) => Math.max(1, ...rows.flatMap(({ row }) => [row.changesNow ?? 0, row.changesLast ?? 0])),
  },
};

function fmtDelta(now, last, { kind = 'number' } = {}) {
  if (now == null || last == null) return null;
  const delta = now - last;
  const sign = delta >= 0 ? '+' : '−';
  if (kind === 'oee') return `${sign}${Math.abs(delta * 100).toFixed(1)} pp`;
  if (kind === 'volume') {
    const k = Math.abs(delta) >= 1000
      ? `${(Math.abs(delta) / 1000).toFixed(1)}k`
      : `${Math.round(Math.abs(delta))}`;
    return `${sign}${k}`;
  }
  return `${sign}${Math.round(Math.abs(delta))}`;
}

function fmtValue(value, { kind = 'number' } = {}) {
  if (value == null || Number.isNaN(value)) return '-';
  if (kind === 'oee') return `${Math.round(value * 100)}%`;
  if (kind === 'volume') {
    return Math.abs(value) >= 1000
      ? `${(value / 1000).toFixed(1)}k`
      : `${Math.round(value)}`;
  }
  return `${Math.round(value)}`;
}

function tone(delta, { higherIsBetter = true } = {}) {
  if (delta == null || Number.isNaN(delta)) return 'neutral';
  if (delta === 0) return 'neutral';
  const good = higherIsBetter ? delta > 0 : delta < 0;
  return good ? 'good' : 'bad';
}

function getMetricValues(row, metricKey) {
  if (metricKey === 'oee') return { now: row.oeeNow, last: row.oeeLast };
  if (metricKey === 'volume') return { now: row.volNow, last: row.volLast };
  return { now: row.changesNow, last: row.changesLast };
}

function pct(value, max) {
  if (value == null || Number.isNaN(value) || !max) return '0%';
  return `${Math.max(2, Math.min(100, (value / max) * 100))}%`;
}

export default function YearCompare({ data }) {
  const [activeTab, setActiveTab] = useState('overview');
  const yc = data?.yearCompare;
  if (!yc?.lines) return null;

  const lines = LINE_ORDER.filter((line) => yc.lines[line]);
  if (!lines.length) return null;

  const rows = lines.map((line) => ({ line, row: yc.lines[line] }));
  const activeMetrics = activeTab === 'overview'
    ? ['oee', 'volume', 'changeovers']
    : [activeTab];

  return (
    <div className="yc-chart-shell" role="group" aria-label="Same week last year">
      <div className="yc-chart-top">
        <div className="yc-chart-copy">
          <span className="yc-strip-title">vs same week last year</span>
          <span className="yc-strip-week">{yc.weekLabel}</span>
        </div>
        <div className="yc-tabs" role="tablist" aria-label="Comparison chart">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`yc-tab${activeTab === tab.key ? ' on' : ''}`}
              role="tab"
              aria-selected={activeTab === tab.key}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className={`yc-chart-grid${activeTab === 'overview' ? '' : ' yc-chart-grid-focused'}`}>
        {activeMetrics.map((metricKey) => (
          <GroupedBarChart
            key={metricKey}
            metricKey={metricKey}
            rows={rows}
            focused={activeTab !== 'overview'}
          />
        ))}
      </div>
    </div>
  );
}

function GroupedBarChart({ metricKey, rows, focused }) {
  const metric = METRICS[metricKey];
  const max = metric.max(rows);

  return (
    <section className={`yc-chart-card${focused ? ' is-focused' : ''}`}>
      <div className="yc-chart-card-head">
        <div>
          <h3>{metric.label}</h3>
          <span>This week compared with the same week last year</span>
        </div>
        <div className="yc-legend" aria-hidden="true">
          <span><i className="yc-legend-now" />This week</span>
          <span><i className="yc-legend-last" />Last year</span>
        </div>
      </div>

      <div className="yc-grouped-bars">
        {rows.map(({ line, row }) => {
          const { now, last } = getMetricValues(row, metricKey);
          const delta = now - last;
          const toneName = tone(delta, { higherIsBetter: metric.higherIsBetter });

          return (
            <div className="yc-bar-group" key={line}>
              <div className="yc-group-label">
                <strong>L{line}</strong>
                <span className={`yc-delta-pill t-${toneName}`}>
                  {fmtDelta(now, last, { kind: metric.kind }) ?? '-'} {metric.deltaLabel}
                </span>
              </div>
              <div className="yc-bars">
                <ChartBar
                  label="This week"
                  value={now}
                  kind={metric.kind}
                  width={pct(now, max)}
                  toneName={toneName}
                />
                <ChartBar
                  label="Last year"
                  value={last}
                  kind={metric.kind}
                  width={pct(last, max)}
                  toneName="last"
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ChartBar({ label, value, kind, width, toneName }) {
  return (
    <div className="yc-chart-bar-row">
      <span className="yc-chart-bar-label">{label}</span>
      <span className="yc-chart-track">
        <span className={`yc-chart-fill t-${toneName}`} style={{ width }} />
      </span>
      <span className="yc-chart-value">{fmtValue(value, { kind })}</span>
    </div>
  );
}
