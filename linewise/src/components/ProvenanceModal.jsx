import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';
import { ExternalLink, GitBranch, ListChecks, Play, Send, X } from 'lucide-react';
import { CalaVerticalIcon, getCalaVertical } from '../lib/calaVerticals.js';

const PREVIEW_ACTIONS = [
  {
    key: 'mitigation',
    label: 'Run mitigation scenario',
    detail: 'Open a preview comparing the current plan with lower-exposure sequencing.',
    icon: Play,
  },
  {
    key: 'review',
    label: 'Review impacted OFs',
    detail: 'Keep the affected orders filtered for planner inspection.',
    icon: ListChecks,
  },
  {
    key: 'procurement',
    label: 'Notify procurement',
    detail: 'Draft a purchasing alert with the exposed volume and source signal.',
    icon: Send,
  },
  {
    key: 'replan',
    label: 'Replan impacted orders',
    detail: 'Preview a resolver pass limited to the impacted OF list.',
    icon: GitBranch,
  },
];

export default function ProvenanceModal({
  open,
  citations = [],
  title = 'Cala provenance',
  showPreviewActions = true,
  children,
  onClose,
}) {
  const [selectedAction, setSelectedAction] = useState(PREVIEW_ACTIONS[0].key);
  const items = Array.isArray(citations) ? citations.filter(Boolean) : [citations].filter(Boolean);
  const primary = items[0];
  if (!open || !primary) return null;

  const meta = getCalaVertical(primary.vertical);
  const selected = PREVIEW_ACTIONS.find((action) => action.key === selectedAction) ?? PREVIEW_ACTIONS[0];

  return (
    <AnimatePresence>
      <motion.div
        className="rd-overlay cala-modal-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.12 }}
        onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      >
        <motion.div
          className="rd-modal cala-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cala-modal-title"
          initial={{ opacity: 0, y: 10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
        >
          <header className={`cala-modal-head ${meta.accentClass}`}>
            <div className="cala-modal-icon">
              <CalaVerticalIcon vertical={primary.vertical} size={18} />
            </div>
            <div className="cala-modal-main">
              <div className="cala-modal-kicker">via Cala · {meta.shortLabel}</div>
              <h2 id="cala-modal-title">{title}</h2>
            </div>
            <button className="cala-modal-x" type="button" onClick={onClose} aria-label="Close">
              <X size={16} />
            </button>
          </header>

          <div className="cala-modal-body">
            {children && <div className="cala-modal-extra">{children}</div>}
            {showPreviewActions && (
              <section className={`cala-preview-actions ${meta.accentClass}`} aria-label="Planner preview actions">
                <div className="cala-preview-actions-head">
                  <div>
                    <span>Planner actions</span>
                    <b>Preview options</b>
                  </div>
                  <em>Backend not wired</em>
                </div>
                <div className="cala-preview-action-grid">
                  {PREVIEW_ACTIONS.map((action) => {
                    const Icon = action.icon;
                    const isSelected = selectedAction === action.key;
                    return (
                      <button
                        key={action.key}
                        type="button"
                        className={`cala-preview-action${isSelected ? ' on' : ''}`}
                        aria-pressed={isSelected}
                        title={`${action.label} - preview only`}
                        onClick={() => setSelectedAction(action.key)}
                      >
                        <span className="cala-preview-action-icon" aria-hidden="true">
                          <Icon size={14} strokeWidth={2.2} />
                        </span>
                        <span>{action.label}</span>
                      </button>
                    );
                  })}
                </div>
                <p>
                  <b>{selected.label}</b>
                  {selected.detail}
                </p>
              </section>
            )}
            {items.map((citation) => {
              const citationMeta = getCalaVertical(citation.vertical);
              return (
                <article className="cala-proof" key={citation.id}>
                  <div className="cala-proof-top">
                    <span className={`cala-vbadge ${citationMeta.accentClass}`}>
                      <CalaVerticalIcon vertical={citation.vertical} size={13} />
                      {citationMeta.shortLabel}
                    </span>
                    <span className={`cala-sev cala-sev-${citation.severity}`}>{citation.severity}</span>
                  </div>
                  <h3>{citation.headline}</h3>
                  <p>{citation.fact}</p>
                  <div className="cala-proof-metric">
                    <span>{citation.value}</span>
                    <b>{citation.delta}</b>
                  </div>
                  <div className="cala-lineage">
                    {(citation.lineage ?? []).map((step, index) => (
                      <span key={`${citation.id}-${step}`}>
                        {index > 0 && <i aria-hidden="true">→</i>}
                        {step}
                      </span>
                    ))}
                  </div>
                  <a className="cala-source" href={citation.sourceUrl} target="_blank" rel="noreferrer">
                    {citation.sourceName}
                    <ExternalLink size={13} />
                  </a>
                </article>
              );
            })}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
