import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const STORAGE_KEY = 'linewise.changeLedger.v1';
const SESSION_KEY = 'linewise.changeLedger.session.v1';

function readAllChanges() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function getSessionId() {
  if (typeof window === 'undefined') return 'server-session';
  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const generated = typeof window.crypto?.randomUUID === 'function'
      ? window.crypto.randomUUID()
      : `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.sessionStorage.setItem(SESSION_KEY, generated);
    return generated;
  } catch {
    return `session-${Date.now()}`;
  }
}

function compactChange(change) {
  const compact = { ...(change ?? {}) };
  delete compact.plan;
  delete compact.priorPlan;
  return compact;
}

/* useChangeLedger — append-only, browser-session scoped ledger.
   Records are persisted in localStorage so the morning briefing and
   evening handoff can read the same substrate, while sessionId keeps
   this hook focused on changes made during the current planner session. */
export function useChangeLedger() {
  const [sessionId] = useState(getSessionId);
  const serialRef = useRef(0);
  const [allChanges, setAllChanges] = useState(readAllChanges);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(allChanges));
    } catch {
      /* Best-effort demo persistence; losing this should not block planning. */
    }
  }, [allChanges]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (event) => {
      if (event.key !== STORAGE_KEY) return;
      setAllChanges(readAllChanges());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const appendChange = useCallback((change) => {
    const ts = Date.now();
    const id = `chg-${ts}-${serialRef.current++}`;
    const record = {
      id,
      sessionId,
      ts,
      ...compactChange(change),
    };
    setAllChanges((current) => [...current, record]);
    return record;
  }, [sessionId]);

  const sessionChanges = useMemo(
    () => allChanges.filter((change) => change.sessionId === sessionId),
    [allChanges, sessionId],
  );

  return {
    sessionId,
    changes: sessionChanges,
    appendChange,
    storageKey: STORAGE_KEY,
  };
}

export const CHANGE_LEDGER_STORAGE_KEY = STORAGE_KEY;
