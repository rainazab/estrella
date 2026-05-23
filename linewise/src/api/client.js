/* The single entry point the app uses to read planning data.
   - Today: hits the Vite middleware in vite.config.js, which serves
     data/plan.json.
   - Later: point API_BASE at a real backend (env var VITE_API_BASE)
     and nothing else in the app changes. */

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

async function getJSON(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).detail || ''; } catch { /* ignore */ }
    throw new Error(`API ${path} → ${res.status}${detail ? ': ' + detail : ''}`);
  }
  return res.json();
}

export function fetchPlan() {
  return getJSON('/plan');
}

export function fetchHealth() {
  return getJSON('/health');
}
