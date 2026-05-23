import { useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { usePlan } from '../hooks/usePlan.js';
import RecommendationPanel from '../components/RecommendationPanel.jsx';
import AnalogueModal from '../components/AnalogueModal.jsx';

/* AnaloguesLab — /?lab=analogues
   Switches between the three recommendations (each one triggers a different
   verdict: confident / within-spread / thin+worse) and previews the panel
   summary next to the spacious modal viewer.  */
export default function AnaloguesLab() {
  const { data, loading, error } = usePlan();
  const [recKey, setRecKey] = useState('17');
  const [modalOpen, setModalOpen] = useState(false);

  if (loading) return <div className="lab"><div className="lab-h">Loading…</div></div>;
  if (error)   return <div className="lab"><div className="lab-h">Error: {String(error.message || error)}</div></div>;

  const order = data.urgentOrders[0];
  const rec = data.recommendations[recKey];
  const recKeys = Object.keys(data.recommendations);

  return (
    <div className="lab">
      <div className="lab-h">Analogues evidence · lab</div>
      <div className="lab-sub">
        Three recommendations, three verdict states. Line 17 (n=38, +6.2) is the
        confident case; Line 14 (n=24, +2.1) is within-spread; Line 19 (n=19, −0.4)
        is thin AND worse than naive — the strip should make that obvious.
      </div>

      <div className="lab-section">
        <div className="lab-section-h">Recommendation</div>
        <div className="lab-row" style={{ gap: 8 }}>
          {recKeys.map((k) => {
            const r = data.recommendations[k];
            return (
              <button
                key={k}
                className={`an-chip${recKey === k ? ' on' : ''}`}
                onClick={() => setRecKey(k)}
              >
                {r.line} · n={r.evidence.n} · gain {r.evidence.gain}
              </button>
            );
          })}
          <button
            className="ev-see-all"
            style={{ marginLeft: 'auto', width: 'auto', padding: '7px 14px' }}
            onClick={() => setModalOpen(true)}
          >
            Open modal <span className="ev-arrow">→</span>
          </button>
        </div>
      </div>

      <div className="lab-section">
        <div className="lab-section-h">Evidence panel (summary)</div>
        <div
          style={{
            width: 396,
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-lg)',
            overflow: 'hidden',
            boxShadow: 'var(--shadow)',
          }}
        >
          <RecommendationPanel
            key={recKey}
            data={data}
            order={order}
            objective="oee"
            selectedLine={recKey}
            manualSlot={null}
            onBack={() => { /* lab — no nav */ }}
          />
        </div>
      </div>

      <AnimatePresence>
        {modalOpen && (
          <AnalogueModal
            key="lab-modal"
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
