import { motion } from 'framer-motion';
import { allowedFormats } from '../lib/lineRules.js';

export default function SettingsDrawer({ settings, lineRules, onChange, onClose }) {
  function update(key, value) {
    onChange?.({ ...settings, [key]: value });
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
      <motion.div
        className="drawer-panel settings-drawer"
        initial={{ x: 20, opacity: 0.6 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 20, opacity: 0 }}
        transition={{ duration: 0.16, ease: 'easeOut' }}
      >
        <div className="inbox-head">
          <div>
            <div className="eyebrow">Settings</div>
            <div className="panel-title">Planner preferences</div>
          </div>
          <span className="inbox-x" onClick={onClose}>✕</span>
        </div>

        <section className="settings-section">
          <div className="drawer-field">
            <label>Default objective</label>
            <select value={settings.defaultObjective} onChange={(e) => update('defaultObjective', e.target.value)}>
              <option value="oee">OEE</option>
              <option value="time">Due date</option>
              <option value="dis">Low disruption</option>
            </select>
          </div>
          <div className="drawer-field">
            <label>Default view</label>
            <select value={settings.defaultView} onChange={(e) => update('defaultView', e.target.value)}>
              <option value="week">Week</option>
              <option value="month">Month</option>
              <option value="quarter">Quarter</option>
            </select>
          </div>
          <div className="drawer-field">
            <label>Comparison baseline</label>
            <select value={settings.comparisonBaseline} onChange={(e) => update('comparisonBaseline', e.target.value)}>
              <option value="sevenDay">7-day average</option>
              <option value="lastYear">Same week last year</option>
            </select>
          </div>
        </section>

        <section className="settings-section">
          <label className="setting-toggle">
            <input
              type="checkbox"
              checked={!!settings.showOriginalOverlay}
              onChange={(e) => update('showOriginalOverlay', e.target.checked)}
            />
            Show original-plan overlay
          </label>
          <label className="setting-toggle">
            <input
              type="checkbox"
              checked={!!settings.compactCards}
              onChange={(e) => update('compactCards', e.target.checked)}
            />
            Compact timeline cards
          </label>
        </section>

        <section className="settings-section">
          <div className="settings-section-title">Locked line rules</div>
          {['14', '17', '19'].map((lineKey) => (
            <div key={lineKey} className="settings-rule-line">
              <b>L{lineKey}</b>
              <span>
                {allowedFormats(lineKey, lineRules).map((fmt) => (
                  <span key={fmt.key} className="line-rule-chip">{fmt.label}</span>
                ))}
              </span>
            </div>
          ))}
        </section>
      </motion.div>
    </motion.div>
  );
}
