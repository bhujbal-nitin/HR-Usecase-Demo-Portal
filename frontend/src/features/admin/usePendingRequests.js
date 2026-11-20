import { useCallback, useEffect, useState } from 'react';
import { getPendingAccessCount } from '../../api/admin';

export const REQUESTS_CHANGED = 'access-requests:changed';

/** Tell every counter that a request was approved, rejected or added, so the numbers refresh at once. */
export const announceRequestsChanged = () => window.dispatchEvent(new Event(REQUESTS_CHANGED));

/** How many access requests are waiting. Only asks when `enabled` (admins); refreshes every minute and when announced. */
export default function usePendingRequests(enabled) {
  const [count, setCount] = useState(0);
  const refresh = useCallback(() => {
    if (!enabled) return;
    getPendingAccessCount().then((r) => setCount(r.count || 0)).catch(() => {});
  }, [enabled]);

  useEffect(() => {
    refresh();
    if (!enabled) return undefined;
    const timer = setInterval(refresh, 60000);
    window.addEventListener(REQUESTS_CHANGED, refresh);
    return () => { clearInterval(timer); window.removeEventListener(REQUESTS_CHANGED, refresh); };
  }, [enabled, refresh]);

  return enabled ? count : 0;
}
