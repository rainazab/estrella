/* The single entry point the app uses to talk to the backend.
   - Reads (`/plan`, `/health`) work against either the FastAPI server
     (set `VITE_API_BASE`) or the Vite dev `fakeApi` middleware.
   - Writes (`/issues`, `/stoppages`, `/plan/move*`, `/plan/stoppage-replan`)
     only work against the real backend — the dev middleware doesn't
     handle them, so the App treats a failure as "stay local" rather
     than blocking the user. */

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

async function postJSON(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body == null ? '{}' : JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).detail || ''; } catch { /* ignore */ }
    const err = new Error(`API ${path} → ${res.status}${detail ? ': ' + detail : ''}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export function fetchPlan() {
  return getJSON('/plan');
}

export function fetchHealth() {
  return getJSON('/health');
}

/* ---------- writes (contract v2.3) ----------
   Each function returns the server's view of the affected state. The App
   treats any rejection as "the backend isn't available right now" and
   falls back to local-only behaviour. */

export function postIssue({ line, category, severity, note, ts }) {
  return postJSON('/issues', { line, category, severity, note, ts });
}

export function postStoppage({ line, reason, startedAt, startAgoMin, duration, ts }) {
  return postJSON('/stoppages', { line, reason, startedAt, startAgoMin, duration, ts });
}

export function resumeStoppage(id) {
  return postJSON(`/stoppages/${encodeURIComponent(id)}/resume`);
}

export function postStoppageReplan({ stoppageId, line, durationKey }) {
  return postJSON('/plan/stoppage-replan', { stoppageId, line, durationKey });
}

export function postMovePreview({ runId, fromLine, toLine, slotIndex }) {
  return postJSON('/plan/move/preview', { runId, fromLine, toLine, slotIndex });
}

export function postMove({ runId, fromLine, toLine, slotIndex }) {
  return postJSON('/plan/move', { runId, fromLine, toLine, slotIndex });
}
