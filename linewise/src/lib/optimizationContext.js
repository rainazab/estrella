export function buildOptimizationContext(data, optionId = 'oee', recKeyOverride = null) {
  if (!data?.recommendations || !data?.objectives) return null;
  const options = buildOptimizationOptions(data);
  const option = options.find((item) => item.id === optionId) || options[0];
  const recKey = recKeyOverride || option?.recKey;
  const rec = data.recommendations[recKey];
  if (!option || !rec) return null;

  const recovery = rec.recovery?.hours ? `${rec.recovery.hours}h` : '--';
  const moves = Number.isFinite(rec.ordersMoved) ? rec.ordersMoved : 0;

  return {
    title: option.title,
    banner: option.banner,
    target: option.target,
    tradeoff: deriveTradeoff(rec, option.tradeoff),
    placement: `${rec.line} · ${rec.position}`,
    note: option.detail,
    kpis: [
      {
        label: 'OEE',
        value: rec.oeeDelta,
        tone: rec.oeeGood ? 'good' : 'bad',
        detail: 'pts vs naive',
      },
      {
        label: 'Due date',
        value: rec.deadline,
        tone: rec.deadline === 'on time' ? 'good' : 'mid',
        detail: 'customer promise',
      },
      {
        label: 'Orders moved',
        value: String(moves),
        tone: moves === 0 ? 'good' : 'mid',
        detail: 'schedule disruption',
      },
      {
        label: 'Recovery',
        value: recovery,
        tone: 'quiet',
        detail: 'back to baseline',
      },
    ],
  };
}

function buildOptimizationOptions(data) {
  /* Distinct-pick so each card surfaces a different line even when
     one line dominates every axis. Same resolution rule as PlanLab. */
  const oeeOrder = data.objectives?.oee?.order ?? [];
  const timeOrder = data.objectives?.time?.order ?? [];
  const disOrder = data.objectives?.dis?.order ?? [];
  const pickDistinct = (order, exclude) => order.find((k) => !exclude.has(k)) ?? order[0];
  const oeeKey = oeeOrder[0];
  const used = new Set([oeeKey]);
  const timeKey = pickDistinct(timeOrder, used);
  used.add(timeKey);
  const disKey = pickDistinct(disOrder, used);
  used.add(disKey);
  const recKeys = Object.keys(data.recommendations ?? {});
  const balanceKey = recKeys.find((k) => !used.has(k)) ?? findBalancedKey(data, timeKey);

  return [
    {
      id: 'oee',
      title: 'Maximise OEE',
      banner: 'Best for OEE',
      target: 'OEE',
      recKey: oeeKey,
      detail: data.objectives.oee.notes[oeeKey],
      tradeoff: 'misses due date',
    },
    {
      id: 'time',
      title: 'Protect due date',
      banner: 'Best for due date',
      target: 'Time',
      recKey: timeKey,
      detail: data.objectives.time.notes[timeKey],
      tradeoff: 'lower OEE',
    },
    {
      id: 'dis',
      title: 'Minimise disruption',
      banner: 'Best for low disruption',
      target: 'Disruption',
      recKey: disKey,
      detail: data.objectives.dis.notes[disKey],
      tradeoff: 'OEE loss',
    },
    {
      id: 'balanced',
      title: 'Balanced plan',
      banner: 'Best overall',
      target: 'OEE + Time',
      recKey: balanceKey,
      detail: 'The compromise option: keeps the order serviceable while still recovering some OEE versus the naive slot.',
      tradeoff: 'not max OEE',
    },
  ];
}

function findBalancedKey(data, fallbackKey) {
  const candidates = Object.entries(data.recommendations);
  const onTime = candidates
    .filter(([, rec]) => rec.deadline === 'on time' && rec.oeeGood)
    .sort(([, a], [, b]) => parseDelta(b.oeeDelta) - parseDelta(a.oeeDelta));

  if (onTime[0]) return onTime[0][0];
  return fallbackKey;
}

function deriveTradeoff(rec, fallback) {
  const moves = Number.isFinite(rec.ordersMoved) ? rec.ordersMoved : 0;
  if (rec.deadline && rec.deadline !== 'on time') return `due date ${rec.deadline}`;
  if (moves > 0) return `${moves} orders moved`;
  if (rec.oeeGood === false) return fallback || 'lower OEE';
  return 'none flagged';
}

function parseDelta(value) {
  return Number.parseFloat(String(value).replace(/\u2212/g, '-').replace('+', '')) || 0;
}
