import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { listEmployees } from '../api/employees';

const EmployeesContext = createContext(null);
const FAST_POLL_MS = 3000; // while a candidate is being provisioned
const IDLE_POLL_MS = 20000;

/**
 * Single shared copy of the onboarding records, so the sidebar badge, the approvals screen and the
 * onboarding chat agent all see the same data. Polls faster while provisioning is running.
 */
export function EmployeesProvider({ children }) {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      setEmployees(await listEmployees());
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  const processing = employees.some((e) => e.status === 'Processing Approval');

  useEffect(() => {
    refresh();
    const timer = setInterval(() => {
      if (!document.hidden) refresh();
    }, processing ? FAST_POLL_MS : IDLE_POLL_MS);
    return () => clearInterval(timer);
  }, [refresh, processing]);

  const value = useMemo(() => ({ employees, loading, error, refresh }), [employees, loading, error, refresh]);
  return <EmployeesContext.Provider value={value}>{children}</EmployeesContext.Provider>;
}

export function useEmployees() {
  const context = useContext(EmployeesContext);
  if (!context) throw new Error('useEmployees must be used inside <EmployeesProvider>');
  return context;
}
