import { useCallback, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useIntegrationHealth } from '../../hooks/useIntegrationHealth';
import Sidebar from './Sidebar';
import TopHeader from './TopHeader';

const STORAGE_KEY = 'hr-sidebar-collapsed';
const MOBILE_QUERY = '(max-width: 900px)';

function readCollapsed() {
  try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
}

export default function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const { health, backendUp } = useIntegrationHealth();
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  // Phones slide the sidebar in and out; larger screens shrink it to an icon rail and remember the choice.
  const toggleSidebar = useCallback(() => {
    if (window.matchMedia(MOBILE_QUERY).matches) {
      setSidebarOpen((open) => !open);
      return;
    }
    setCollapsed((value) => {
      try { localStorage.setItem(STORAGE_KEY, value ? '0' : '1'); } catch { /* storage unavailable: just not remembered */ }
      return !value;
    });
  }, []);

  return (
    <div className={`app-layout${collapsed ? ' sidebar-collapsed' : ''}`}>
      <Sidebar open={sidebarOpen} onNavigate={closeSidebar} health={health} backendUp={backendUp} />
      <div className="main-wrapper">
        <TopHeader onToggleSidebar={toggleSidebar} collapsed={collapsed} />
        <main className="app-container">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
