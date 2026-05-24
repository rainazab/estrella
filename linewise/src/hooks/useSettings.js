/* useSettings — planner preferences persisted to localStorage.
   Mirrors the read-only contract assumed by SettingsDrawer. */
import { useEffect, useState } from 'react';

const STORAGE_KEY = 'linewise.settings.v1';

const DEFAULTS = Object.freeze({
  defaultObjective: 'oee',         // 'oee' | 'time' | 'dis'
  defaultView: 'month',            // 'week' | 'month' | 'quarter'
  comparisonBaseline: 'sevenDay',  // 'sevenDay' | 'lastYear'
  showOriginalOverlay: false,
  compactCards: false,
});

function read() {
  if (typeof window === 'undefined') return { ...DEFAULTS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULTS };
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

export function useSettings() {
  const [settings, setSettings] = useState(read);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      /* quota or sandbox; preferences are non-critical */
    }
  }, [settings]);

  return [settings, setSettings];
}

export const SETTINGS_DEFAULTS = DEFAULTS;
