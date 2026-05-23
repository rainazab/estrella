import { useEffect, useState } from 'react';
import { fetchPlan } from '../api/client.js';

/* usePlan — loads the planning data once on mount.
   Returns { data, loading, error, reload }.
   Consumers should render a loading state until `data` is available;
   the rest of the app then treats `data` as the same shape DEMO_DATA had. */
export function usePlan() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let active = true;
    setError(null);
    fetchPlan()
      .then((d) => { if (active) setData(d); })
      .catch((e) => { if (active) setError(e); });
    return () => { active = false; };
  }, [nonce]);

  return {
    data,
    loading: !data && !error,
    error,
    reload: () => setNonce((n) => n + 1),
  };
}
