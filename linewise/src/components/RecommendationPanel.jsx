import { useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
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
  selectedLine,
  manualSlot,
  onBack,
}) {
  const recKey = manualSlot
    ? data.manualSlots[manualSlot].recKey
    : selectedLine || data.objectives[objective].order[0];
  const rec = data.recommendations[recKey];
  const evidence = rec.evidence;

  /* Pre-build the rows + verdict here so the panel can show the verdict tone
     without opening the modal. The modal recomputes on its own mount, which
     is fine — the inputs are pure and the work is small. */
  const rows = useMemo(() => buildAnalogueIndex(recKey, evidence), [recKey, evidence]);
  const verdict = useMemo(() => evidenceVerdict(rec, rows), [rec, rows]);

  const topAnalogues = evidence.analogues.slice(0, 3);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="panel-pad">
      <button className="btn-back" onClick={onBack}>← back to planner board</button>

      <div className="summary">
        <div className="summary-top">
          <span className="ocode">{order.of}</span>
          <span className="lbl">selected order</span>
        </div>
        <div className="summary-sku">{order.sku}</div>
        <div className="summary-grid">
          <div><b>{order.units.toLocaleString()}</b>units</div>
          <div><b>{order.hl}</b>hl</div>
          <div><b>{order.due}</b>due</div>
        </div>
      </div>

      <div className={`ev-block tone-${verdict.tone}`}>
        <div className="ev-head">
          <div className="eyebrow">Why this recommendation</div>
          <div className="ev-title">{rec.line} · {rec.position}</div>
        </div>
        <p className="ev-reason" dangerouslySetInnerHTML={{ __html: evidence.reason }} />

        <div className="ev-stats">
          <div><span className="k">n</span><span className="v">{evidence.n}</span></div>
          <div><span className="k">analogue mean</span><span className="v">{evidence.analogueMean}</span></div>
          <div><span className="k">naive mean</span><span className="v">{evidence.naiveMean}</span></div>
          <div>
            <span className={`k ${verdict.tone === 'good' ? 'good' : verdict.tone === 'bad' ? 'bad' : 'mid'}`}>gain</span>
            <span className={`v ${verdict.tone === 'good' ? 'good' : verdict.tone === 'bad' ? 'bad' : 'mid'}`}>{evidence.gain}</span>
          </div>
        </div>

        <div className={`ev-verdict ev-verdict-${verdict.tone}`}>
          <div className="ev-verdict-headline">{verdict.headline}</div>
        </div>

        <div className="ev-an-h">Top analogues</div>
        <ul className="ev-an-list">
          {topAnalogues.map((a) => (
            <li key={`${a.of}-${a.date}`}>
              <span className="ocode">{a.of}</span>
              <span className="ev-an-date">{a.date}</span>
              <span className="ev-an-line">Line {a.line}</span>
              <span className={`an-type an-type-${a.type}`}>{a.type.replace('-', ' ')}</span>
              <span className="ev-an-oee">{a.oee}</span>
            </li>
          ))}
        </ul>

        <button className="ev-see-all" onClick={() => setModalOpen(true)}>
          See all {evidence.n} analogues
          <span className="ev-arrow">→</span>
        </button>
      </div>

      <AnimatePresence>
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
