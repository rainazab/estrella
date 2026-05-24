import InfoPopover from './InfoPopover.jsx';

/* KPIStrip - daily OEE opportunities plus compact operating KPIs.
   `stoppedLines` is an array of line keys ('14' | '17' | '19') currently
   logged as stopped; passed in from App state so the "Lines running"
   tile and its tone update live as the planner logs stoppages. */
export default function KPIStrip({ data, stoppedLines = [] }) {
  const lines = data?.lineCentre ? Object.keys(data.lineCentre).length : 3;
  const stoppedCount = stoppedLines.length;
  const running = Math.max(0, lines - stoppedCount);
  const urgentCount = data?.urgentOrders?.filter((o) => o.status === 'urgent').length ?? 0;
  const queuedCount = data?.urgentOrders?.filter((o) => o.status === 'queued' || o.status === 'scheduled').length ?? 0;

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
      delta: '+2.9',
      title: 'Recover runtime loss',
      description: 'Cut short stops and restart delays.',
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
      foot: 'vs. 7-day avg',
      info: 'Plant-wide Overall Equipment Effectiveness for today, weighted by line. Compared to the rolling 7-day average.',
    },
    {
      key: 'lines',
      label: 'Lines running',
      value: `${running}/${lines}`,
      foot: stoppedCount > 0
        ? `L${stoppedLines.join(', L')} stopped`
        : 'no unplanned stops',
      tone: stoppedCount > 0 ? 'bad' : 'good',
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
  );
}
