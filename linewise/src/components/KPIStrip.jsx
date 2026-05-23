/* KPIStrip — five compact KPI cards above the timeline.
   Placeholder values for now; wire to real plan metrics later. */
export default function KPIStrip({ data }) {
  const lines = data?.lineCentre ? Object.keys(data.lineCentre).length : 3;
  const urgentCount = data?.urgentOrders?.filter((o) => o.status === 'urgent').length ?? 0;
  const queuedCount = data?.urgentOrders?.filter((o) => o.status === 'queued' || o.status === 'scheduled').length ?? 0;

  const cards = [
    {
      key: 'oee',
      label: 'OEE today',
      value: '0.58',
      delta: '+2.1',
      deltaKind: 'good',
      foot: 'vs. 7-day avg',
    },
    {
      key: 'lines',
      label: 'Lines running',
      value: `${lines}/${lines}`,
      foot: 'no unplanned stops',
      tone: 'good',
    },
    {
      key: 'throughput',
      label: 'Throughput',
      value: '12.4',
      unit: 'k hl',
      foot: 'paced for 14.0k',
    },
    {
      key: 'ontime',
      label: 'On-time delivery',
      value: '96',
      unit: '%',
      delta: '−1.2',
      deltaKind: 'bad',
      foot: 'last 7 days',
    },
    {
      key: 'orders',
      label: 'Pending orders',
      value: `${urgentCount + queuedCount}`,
      foot: `${urgentCount} urgent · ${queuedCount} queued`,
      tone: urgentCount > 0 ? 'warn' : 'neutral',
    },
  ];

  return (
    <div className="kpi-strip">
      {cards.map((c) => (
        <div key={c.key} className={`kpi-card${c.tone ? ` t-${c.tone}` : ''}`}>
          <div className="kpi-label">{c.label}</div>
          <div className="kpi-value-row">
            <span className="kpi-value">{c.value}</span>
            {c.unit && <span className="kpi-unit">{c.unit}</span>}
            {c.delta && (
              <span className={`kpi-delta ${c.deltaKind === 'good' ? 'good' : 'bad'}`}>
                {c.deltaKind === 'good' ? '▲' : '▼'} {c.delta}
              </span>
            )}
          </div>
          <div className="kpi-foot">{c.foot}</div>
        </div>
      ))}
    </div>
  );
}
