import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { buildAnalogueIndex, evidenceVerdict } from '../lib/analogues.js';
import AnalogueModal from './AnalogueModal.jsx';

/* RecommendationPanel — narrow column on the left of the recs view.
   Shows a compact summary; the spacious distribution + verdict + table live
   in the AnalogueModal, opened from the "See all N analogues →" button.
   The verdict tone is mirrored on the panel block (border color) so the
   honesty state is visible without opening the modal. */
export default function RecommendationPanel({
  data,
  order,
  objective,
  selectedImpact,
  selectedLine,
  manualSlot,
  onSelectImpact,
  onSelectCard,
  onClearManual,
  onBack,
}) {
  const impactOptions = useMemo(() => buildImpactOptions(data), [data]);
  const fallbackOption = impactOptions.find((option) => option.id === objective) || impactOptions[0];
  const activeOption = manualSlot
    ? null
    : impactOptions.find((option) => option.id === selectedImpact)
      || impactOptions.find((option) => option.recKey === selectedLine)
      || fallbackOption;
  const recKey = manualSlot
    ? data.manualSlots[manualSlot].recKey
    : selectedLine || activeOption.recKey;
  const rec = data.recommendations[recKey];
  const evidence = rec.evidence;

  /* Pre-build the rows + verdict here so the panel can show the verdict tone
     without opening the modal. The modal recomputes on its own mount, which
     is fine — the inputs are pure and the work is small. */
  const rows = useMemo(() => buildAnalogueIndex(recKey, evidence), [recKey, evidence]);
  const verdict = useMemo(() => evidenceVerdict(rec, rows), [rec, rows]);

  const topAnalogues = evidence.analogues.slice(0, 3);
  const [modalOpen, setModalOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const note = activeOption?.detail || data.objectives[objective]?.notes?.[recKey];
  const gainTone = verdict.tone === 'bad' ? 'bad' : verdict.tone === 'warn' ? 'mid' : 'good';
  const recoveryHours = rec.recovery?.hours ? `~${rec.recovery.hours}h to recover` : 'recovery n/a';
  const optimizerRows = buildOptimizerRows(rec);

  function selectOption(option) {
    onClearManual?.();
    onSelectImpact?.(option.id);
    onSelectCard?.(option.recKey);
  }

  function openWhy(option) {
    selectOption(option);
    setDrawerOpen(true);
  }

  return (
    <div className="panel-pad">
      <button className="btn-back slot-back" onClick={onBack}>← back to planner board</button>

      <div className="impact-picker" aria-label="Impact options">
        <div className="impact-picker-head">
          <div>
            <div className="impact-picker-kicker">Results</div>
            <h2>Choose what to optimise</h2>
          </div>
          <span>{impactOptions.length} options</span>
        </div>

        <div className="impact-option-list">
          {impactOptions.map((option, index) => {
            const optionRec = data.recommendations[option.recKey];
            const selected = !manualSlot && activeOption?.id === option.id;
            return (
              <div
                key={option.id}
                className={`impact-option-card${selected ? ' selected' : ''}`}
              >
                <button
                  type="button"
                  className="impact-option-select"
                  onClick={() => selectOption(option)}
                  aria-pressed={selected}
                >
                  <span className={`impact-option-banner target-${option.tone}`}>
                    {option.banner}
                  </span>
                  <span className="impact-option-top">
                    <span className="impact-option-num">{String(index + 1).padStart(2, '0')}</span>
                    <span className="impact-option-main">
                      <b>{option.title}</b>
                      <span>{optionRec.line} · {optionRec.position}</span>
                    </span>
                  </span>
                  <span className="impact-option-facts" aria-label={`${option.title} key impact`}>
                    <span><small>OEE impact</small><b>{optionRec.evidence.gain} pts</b></span>
                    <span><small>Due date</small><b>{optionRec.deadline}</b></span>
                    <span><small>Orders moved</small><b>{optionRec.ordersMoved}</b></span>
                    <span><small>Tradeoff</small><b>{option.tradeoff}</b></span>
                  </span>
                </button>
                <button
                  className="impact-option-why"
                  type="button"
                  onClick={() => openWhy(option)}
                >
                  Why this recommendation <span aria-hidden="true">→</span>
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <AnimatePresence>
        {drawerOpen && (
          <WhyRecommendationDrawer
            key="why-drawer"
            activeOption={activeOption}
            evidence={evidence}
            gainTone={gainTone}
            note={note}
            onClose={() => setDrawerOpen(false)}
            onOpenAnalogues={() => setModalOpen(true)}
            optimizerRows={optimizerRows}
            order={order}
            rec={rec}
            recoveryHours={recoveryHours}
            topAnalogues={topAnalogues}
            verdict={verdict}
          />
        )}
        {modalOpen && (
          <AnalogueModal
            key="an-modal"
            recKey={recKey}
            rec={rec}
            order={order}
            onClose={() => setModalOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function WhyRecommendationDrawer({
  activeOption,
  evidence,
  gainTone,
  note,
  onClose,
  onOpenAnalogues,
  optimizerRows,
  order,
  rec,
  recoveryHours,
  topAnalogues,
  verdict,
}) {
  return (
    <>
      <motion.button
        className="why-drawer-scrim"
        type="button"
        aria-label="Close explanation"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      />
      <motion.aside
        className={`why-drawer slot-card tone-${verdict.tone}`}
        aria-label="Why this recommendation"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ duration: 0.22, ease: 'easeOut' }}
      >
        <div className="why-drawer-top">
          <div className="slot-kicker">
            <span className="slot-kicker-mark" aria-hidden="true" />
            <span>{activeOption?.eyebrow || 'Recommendation evidence'}</span>
          </div>
          <button className="why-drawer-close" type="button" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="slot-hero">
          <div>
            <h2>{activeOption?.title || rec.line}</h2>
            <p>{rec.line} · {rec.position}</p>
          </div>
          <div className={`slot-gain slot-gain-${gainTone}`}>
            <b>{evidence.gain}</b>
            <span>OEE</span>
          </div>
        </div>

        <div className="slot-chips" aria-label="Slot summary">
          <span><span aria-hidden="true">◷</span>{rec.deadline}</span>
          <span><span aria-hidden="true">↩</span>{recoveryHours}</span>
          <span><span aria-hidden="true">▦</span>{evidence.n} analogues</span>
        </div>

        {note && <p className="slot-note">{note}</p>}

        <div className="optimizer-grid" aria-label="Optimisation fit">
          {optimizerRows.map((row) => (
            <div className={`optimizer-row fit-${row.tone}`} key={row.label}>
              <span>{row.label}</span>
              <b>{row.value}</b>
            </div>
          ))}
        </div>

        <div className="slot-section-body">
          <div className="slot-h first">Why this recommendation</div>
          <p className="slot-reason" dangerouslySetInnerHTML={{ __html: evidence.reason }} />

          <div className="slot-h">Changeover breakdown — this insertion</div>
          <div className="slot-bars">
            {evidence.breakdown.map((row) => (
              <div className="slot-bar-row" key={row.name}>
                <span className="slot-bar-name">{row.name}</span>
                <span className="slot-bar-track">
                  <span
                    className={`slot-bar-fill slot-bar-${row.band}`}
                    style={{ width: `${Math.max(6, row.pct)}%` }}
                  />
                </span>
                <span className={`slot-bar-val slot-bar-val-${row.band}`}>{row.val}</span>
              </div>
            ))}
          </div>

          <div className="slot-h">Historical analogues — same transition type</div>
          <div className="slot-table-wrap">
            <table className="slot-table">
              <thead>
                <tr>
                  <th>OF</th>
                  <th>Date</th>
                  <th>Line</th>
                  <th>Changeover</th>
                  <th>OEE</th>
                </tr>
              </thead>
              <tbody>
                {topAnalogues.map((a) => (
                  <tr key={`${a.of}-${a.date}`}>
                    <td className="slot-of">{a.of}</td>
                    <td>{a.date}</td>
                    <td>L{a.line}</td>
                    <td>{a.type.replace('-', ' ')}</td>
                    <td className="slot-oee">{a.oee}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button className="slot-see-all" onClick={onOpenAnalogues}>
            see all {evidence.n} analogues <span aria-hidden="true">→</span>
          </button>

          <div className="slot-metrics">
            <div>
              <span>analogue mean OEE</span>
              <b>{evidence.analogueMean}</b>
            </div>
            <div>
              <span>naive-slot mean OEE</span>
              <b className="metric-bad">{evidence.naiveMean}</b>
            </div>
            <div className="metric-gain">
              <span>predicted gain</span>
              <b>{evidence.gain}</b>
            </div>
          </div>

          <div className={`slot-verdict slot-verdict-${verdict.tone}`}>
            <div className="slot-verdict-title">{verdict.headline}</div>
          </div>

          <div className="slot-blindspot">
            <div>What this estimate cannot see</div>
            <p>
              Crew experience, shift staffing and downstream micro-stoppages are not in the data.
              The figure is a historical average, so a single run can land outside it.
            </p>
          </div>

          <div className="slot-order">
            <span>Selected order</span>
            <b>{order.of}</b>
            <span>{order.sku} · {order.units.toLocaleString()} units · due {order.due}</span>
          </div>
        </div>
      </motion.aside>
    </>
  );
}

function buildImpactOptions(data) {
  /* Force the four impact options to point at distinct recommendations
     so they don't all collapse to the same line when one line wins
     every axis. Mirrors PlanLab's buildPlanLabOptions resolution. */
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
      eyebrow: 'Impact option — OEE',
      target: 'OEE',
      tone: 'good',
      recKey: oeeKey,
      metric: `${data.recommendations[oeeKey].evidence.gain} OEE`,
      detail: data.objectives.oee.notes[oeeKey],
      tradeoff: 'misses due date',
    },
    {
      id: 'time',
      title: 'Protect due date',
      banner: 'Best for due date',
      eyebrow: 'Impact option — Time',
      target: 'Time',
      tone: 'mid',
      recKey: timeKey,
      metric: data.recommendations[timeKey].deadline,
      detail: data.objectives.time.notes[timeKey],
      tradeoff: 'lower OEE',
    },
    {
      id: 'dis',
      title: 'Minimise disruption',
      banner: 'Best for low disruption',
      eyebrow: 'Impact option — Disruption',
      target: 'Disruption',
      tone: 'quiet',
      recKey: disKey,
      metric: `${data.recommendations[disKey].ordersMoved} moves`,
      detail: data.objectives.dis.notes[disKey],
      tradeoff: 'OEE loss',
    },
    {
      id: 'balanced',
      title: 'Balanced plan',
      banner: 'Best overall',
      eyebrow: 'Impact option — balanced',
      target: 'OEE + Time',
      tone: 'brand',
      recKey: balanceKey,
      metric: `${data.recommendations[balanceKey].deadline} · ${data.recommendations[balanceKey].evidence.gain}`,
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

function buildOptimizerRows(rec) {
  const moves = rec.ordersMoved || 0;
  return [
    {
      label: 'OEE',
      value: rec.evidence.gain,
      tone: rec.oeeGood ? 'strong' : 'weak',
    },
    {
      label: 'Time',
      value: rec.deadline,
      tone: rec.deadline === 'on time' ? 'strong' : 'medium',
    },
    {
      label: 'Disruption',
      value: moves === 0 ? '0 moves' : `${moves} moved`,
      tone: moves === 0 ? 'strong' : 'medium',
    },
  ];
}

function parseDelta(value) {
  return Number.parseFloat(String(value).replace('−', '-').replace('+', '')) || 0;
}
