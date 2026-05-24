import InfoPopover from './InfoPopover.jsx';

/* KPIStrip - daily OEE opportunities plus compact operating KPIs. */
export default function KPIStrip({ data, events = {}, settings = {} }) {
  const lines = data?.lineCentre ? Object.keys(data.lineCentre).length : 3;
  const urgentCount = data?.urgentOrders?.filter((o) => o.status === 'urgent').length ?? 0;
  const queuedCount = data?.urgentOrders?.filter((o) => o.status === 'queued' || o.status === 'scheduled').length ?? 0;
  const eventList = Object.entries(events ?? {}).flatMap(([line, list]) => (list ?? []).map((event) => ({ ...event, line })));
  const stoppages = eventList.filter((event) => event.type === 'stoppage').length;
  const stoppedLines = new Set(eventList.filter((event) => event.type === 'stoppage').map((event) => event.line));
  const runningLines = Math.max(0, lines - stoppedLines.size);
  const comparison = aggregateYearCompare(data?.yearCompare);

  const scenarios = [
    {
      key: 'changeover',
      label: 'Changeover loss',
      delta: '+6.2',
      title: 'Reduce changeover loss',
      description: 'Group format and brand transitions.',
      tone: 'good',
    },
    {
      key: 'runtime',
      label: 'Runtime loss',
      delta: stoppages ? `+${(2.9 + stoppages * 0.7).toFixed(1)}` : '+2.9',
      title: 'Recover runtime loss',
      description: stoppages ? `${stoppages} local stoppage logged.` : 'Cut short stops and restart delays.',
      tone: 'neutral',
    },
  ];

  const cards = [
    {
      key: 'oee',
      label: 'OEE today',
      value: '0.58',
      delta: '+2.1',
      deltaKind: 'good',
      foot: settings?.comparisonBaseline === 'lastYear' ? 'vs. same week last year' : 'vs. 7-day avg',
      info: 'Plant-wide Overall Equipment Effectiveness for today, weighted by line. Compared to the rolling 7-day average.',
    },
    {
      key: 'lines',
      label: 'Lines running',
      value: `${runningLines}/${lines}`,
      foot: stoppages ? `${stoppages} logged stoppage${stoppages > 1 ? 's' : ''}` : 'no unplanned stops',
      tone: stoppages ? 'warn' : 'good',
      info: 'Lines currently producing versus lines scheduled. Excludes planned downtime.',
    },
    {
      key: 'throughput',
      label: 'Throughput',
      value: '12.4',
      unit: 'k hl',
      foot: 'paced for 14.0k',
      info: 'Hectolitres bottled so far today. "Paced for" projects end-of-shift volume at current rate.',
    },
    {
      key: 'orders',
      label: 'Pending orders',
      value: `${urgentCount + queuedCount}`,
      foot: `${urgentCount} urgent · ${queuedCount} queued`,
      tone: urgentCount > 0 ? 'warn' : 'neutral',
      info: 'Orders not yet placed on the plan. "Urgent" flags requests routed by operations that need a decision today.',
    },
  ];

  return (
    <div className="kpi-block">
      <div className="kpi-strip" role="group" aria-label="Daily summary">
        {scenarios.map((s) => (
          <button key={s.key} type="button" className={`opportunity-card t-${s.tone}`}>
            <span className="opportunity-stat">
              <span className="opportunity-label">{s.label}</span>
              <span className="opportunity-value-row">
                <span className="opportunity-value">{s.delta}</span>
                <span className="opportunity-description">{s.description}</span>
              </span>
            </span>
            <span className="opportunity-action">
              <span className="opportunity-action-arrow" aria-hidden="true">→</span>
              <span className="opportunity-action-label">Optimize</span>
            </span>
          </button>
        ))}
        {cards.map((c) => (
          <div key={c.key} className={`kpi-stat${c.tone ? ` t-${c.tone}` : ''}`}>
            {c.info && (
              <span className="kpi-stat-info">
                <InfoPopover title={c.label}>{c.info}</InfoPopover>
              </span>
            )}
            <span className="kpi-stat-label">{c.label}</span>
            <span className="kpi-stat-value">
              {c.value}
              {c.unit && <span className="kpi-stat-unit">{c.unit}</span>}
              {c.delta && (
                <span className={`kpi-stat-delta ${c.deltaKind === 'good' ? 'good' : 'bad'}`}>
                  {c.deltaKind === 'good' ? '▲' : '▼'}{c.delta}
                </span>
              )}
            </span>
            <span className="kpi-stat-foot">{c.foot}</span>
          </div>
        ))}
      </div>
      {comparison && (
        <div className="kpi-yoy" aria-label="Same week last year comparison">
          <span className="kpi-yoy-label">Same week last year</span>
          <span className={comparison.oeeDelta >= 0 ? 'pos' : 'neg'}>OEE {fmtSigned(comparison.oeeDelta * 100)} pts</span>
          <span className={comparison.volDelta >= 0 ? 'pos' : 'neg'}>Volume {fmtSigned(comparison.volDelta)} hl</span>
          <span className={comparison.changeDelta <= 0 ? 'pos' : 'neg'}>Changeovers {fmtSigned(comparison.changeDelta)}</span>
          <span className="kpi-yoy-week">{data?.yearCompare?.weekLabel}</span>
        </div>
      )}
    </div>
  );
}

function aggregateYearCompare(yearCompare) {
  const lines = Object.values(yearCompare?.lines ?? {});
  if (!lines.length) return null;
  const mean = (field) => lines.reduce((sum, row) => sum + Number(row[field] ?? 0), 0) / lines.length;
  const sum = (field) => lines.reduce((total, row) => total + Number(row[field] ?? 0), 0);
  return {
    oeeDelta: mean('oeeNow') - mean('oeeLast'),
    volDelta: sum('volNow') - sum('volLast'),
    changeDelta: sum('changesNow') - sum('changesLast'),
  };
}

function fmtSigned(value) {
  const abs = Math.abs(value);
  const rounded = abs >= 10 ? Math.round(abs) : abs.toFixed(1);
  return `${value >= 0 ? '+' : '-'}${rounded}`;
}
