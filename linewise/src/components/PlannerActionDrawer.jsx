import { useState } from 'react';
import { motion } from 'framer-motion';
import { allowedFormats } from '../lib/lineRules.js';

const ISSUE_TYPES = ['Material shortage', 'Quality hold', 'Operator note', 'Sensor anomaly'];
const STOP_REASONS = ['Micro-stop cluster', 'CIP overrun', 'Mechanical check', 'Material wait'];

export default function PlannerActionDrawer({ type, lineRules, onClose, onSubmit }) {
  const isStoppage = type === 'stoppage';
  const [line, setLine] = useState('14');
  const [category, setCategory] = useState(isStoppage ? STOP_REASONS[0] : ISSUE_TYPES[0]);
  const [severity, setSeverity] = useState('medium');
  const [duration, setDuration] = useState(30);
  const [notes, setNotes] = useState('');

  function submit(e) {
    e.preventDefault();
    onSubmit?.({
      id: `${type}-${Date.now()}`,
      type,
      line,
      category,
      severity,
      durationMinutes: isStoppage ? Number(duration) : null,
      notes,
      createdAt: new Date().toISOString(),
    });
    onClose?.();
  }

  return (
    <motion.div
      className="inbox-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <motion.form
        className="drawer-panel action-drawer"
        initial={{ x: 20, opacity: 0.6 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 20, opacity: 0 }}
        transition={{ duration: 0.16, ease: 'easeOut' }}
        onSubmit={submit}
      >
        <div className="inbox-head">
          <div>
            <div className="eyebrow">{isStoppage ? 'Log stoppage' : 'Report line issue'}</div>
            <div className="panel-title">{isStoppage ? 'Runtime marker' : 'Line marker'}</div>
          </div>
          <span className="inbox-x" onClick={onClose}>✕</span>
        </div>

        <div className="drawer-field">
          <label>Line</label>
          <select value={line} onChange={(e) => setLine(e.target.value)}>
            {['14', '17', '19'].map((lineKey) => (
              <option key={lineKey} value={lineKey}>L{lineKey}</option>
            ))}
          </select>
          <div className="drawer-rule-note">
            {allowedFormats(line, lineRules).map((fmt) => (
              <span key={fmt.key} className="line-rule-chip">{fmt.label}</span>
            ))}
          </div>
        </div>

        <div className="drawer-field">
          <label>{isStoppage ? 'Reason' : 'Issue type'}</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {(isStoppage ? STOP_REASONS : ISSUE_TYPES).map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </div>

        <div className="drawer-field">
          <label>Severity</label>
          <div className="segmented-mini">
            {['low', 'medium', 'high'].map((item) => (
              <button
                key={item}
                type="button"
                className={severity === item ? 'on' : ''}
                onClick={() => setSeverity(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        {isStoppage && (
          <div className="drawer-field">
            <label>Estimated duration</label>
            <input
              type="number"
              min="5"
              step="5"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </div>
        )}

        <div className="drawer-field">
          <label>Notes</label>
          <textarea
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={isStoppage ? 'What is blocking runtime?' : 'What should the planner know?'}
          />
        </div>

        <div className="drawer-actions">
          <button type="button" className="rd-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="rd-btn rd-btn-primary">Add marker</button>
        </div>
      </motion.form>
    </motion.div>
  );
}
