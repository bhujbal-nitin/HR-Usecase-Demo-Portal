import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import AccessRequestsTab from './AccessRequestsTab';
import DemoRunsTab from './DemoRunsTab';
import HistoryTab from './HistoryTab';
import SystemsTab from './SystemsTab';
import UsageTab from './UsageTab';
import UsersTab from './UsersTab';
import usePendingRequests from './usePendingRequests';

const TABS = [
  { id: 'systems', label: 'System Status', icon: 'fa-server' },
  { id: 'users', label: 'Users', icon: 'fa-users' },
  { id: 'requests', label: 'Access requests', icon: 'fa-user-clock' },
  { id: 'usage', label: 'Token usage', icon: 'fa-gauge-high' },
  { id: 'history', label: 'Token usage history', icon: 'fa-clock-rotate-left' },
  { id: 'demos', label: 'Demo history', icon: 'fa-list-check' },
];

/** Admin: monitor live integrations, manage users, see AI token usage, and track demo runs. */
export default function AdminPage() {
  const { role, authEnabled } = useAuth();
  const [tab, setTab] = useState('systems');
  const [historyUser, setHistoryUser] = useState('');
  const waiting = usePendingRequests(authEnabled && role === 'admin');

  // When auth is enabled, only admins can view the Admin page.
  // When auth is disabled (demo mode), anyone can access the system health status.
  if (authEnabled && role !== 'admin') return <Navigate to="/" replace />;

  const showHistoryOf = (username) => { setHistoryUser(username); setTab('history'); };

  return (
    <section className="view-section active">
      <div className="filter-group" role="tablist" aria-label="Admin" style={{ marginBottom: '1rem' }}>
        {TABS.map(({ id, label, icon }) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`btn ${tab === id ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab(id)}>
            <i className={`fa-solid ${icon}`}></i> {label}
            {id === 'requests' && waiting > 0 && <span className="tab-badge" style={{ marginLeft: '0.4rem' }}>{waiting}</span>}
          </button>
        ))}
      </div>
      {tab === 'systems' && <SystemsTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'requests' && <AccessRequestsTab />}
      {tab === 'usage' && <UsageTab onShowHistory={showHistoryOf} />}
      {tab === 'history' && <HistoryTab initialUser={historyUser} />}
      {tab === 'demos' && <DemoRunsTab />}
    </section>
  );
}
