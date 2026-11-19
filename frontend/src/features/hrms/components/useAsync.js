import { useCallback, useEffect, useRef, useState } from 'react';

/** Runs `load()` on mount and whenever `deps` change. Returns {data, loading, error, reload}. Pass load=null to skip. */
export function useAsync(load, deps = []) {
  const [state, setState] = useState({ data: null, loading: Boolean(load), error: '' });
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    const fn = loadRef.current;
    if (!fn) {
      setState({ data: null, loading: false, error: '' });
      return undefined;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: '' }));
    fn().then(
      (data) => { if (!cancelled) setState({ data, loading: false, error: '' }); },
      (e) => { if (!cancelled) setState({ data: null, loading: false, error: e.message || 'Something went wrong.' }); },
    );
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, Boolean(load)]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}
