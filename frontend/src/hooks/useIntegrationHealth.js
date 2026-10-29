import { useEffect, useState } from 'react';
import { getIntegrationHealth } from '../api/system';

const REFRESH_MS = 60000;

/** Live status of ServiceNow / AutomationEdge / Microsoft 365 / OrangeHRM (null until first answer). */
export function useIntegrationHealth() {
  const [health, setHealth] = useState(null);
  const [backendUp, setBackendUp] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        setHealth(await getIntegrationHealth({ signal: controller.signal }));
        setBackendUp(true);
      } catch (error) {
        if (error.name !== 'AbortError') setBackendUp(false);
      }
    };
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, []);

  return { health, backendUp };
}
