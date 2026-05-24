/* useSignals — pull the external-context signals payload (Cala) from
   /api/signals. Polls on a slow interval; a manual refresh button on
   the UI can call `refresh()` to force a re-read.

   Backend semantics:
   - GET /signals just reads the disk cache → cheap, poll freely.
   - POST /signals/refresh re-runs Cala (~1 credit per category). Only
     fire from explicit user action.

   The hook never throws — any failure leaves the existing snapshot in
   place and surfaces the error string. The World Signals panel and
   the citation chips degrade to "empty" rather than break the board. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchSignals, refreshSignals as apiRefreshSignals } from '../api/client.js';

const POLL_INTERVAL_MS = 60_000;

const EMPTY = Object.freeze({ signals: [], citations: {}, source: 'seed', stale: true, generatedAt: 0, error: null });

export function useSignals({ pollMs = POLL_INTERVAL_MS } = {}) {
  const [data, setData] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    try {
      const next = await fetchSignals();
      if (mountedRef.current) {
        setData(next || EMPTY);
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err);
        if (import.meta.env.DEV) console.warn('[signals] fetch failed', err);
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const resp = await apiRefreshSignals();
      if (mountedRef.current && resp) {
        /* /signals/refresh returns an envelope `{ ok, source, signals,
           citations, generatedAt, ... }`. Strip the ok flag and apply.
           A failed live refresh still echoes the seed, so the panel
           never goes empty. */
        const next = {
          signals: resp.signals || [],
          citations: resp.citations || {},
          source: resp.source || 'seed',
          stale: resp.stale ?? false,
          generatedAt: resp.generatedAt ?? 0,
          error: resp.error ?? null,
        };
        setData(next);
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err);
        if (import.meta.env.DEV) console.warn('[signals] refresh failed', err);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    load();
    if (!pollMs) return () => { mountedRef.current = false; };
    const id = setInterval(load, pollMs);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [load, pollMs]);

  return { data, loading, error, refresh, reload: load };
}
