import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { MODULES, hrmsPath, moduleForPath } from './menu';
import { useHrmsSession } from './session';

export function Wordmark({ dark }) {
  return <span className={`hrms-wordmark${dark ? ' dark' : ''}`}><b>HR</b>MS</span>;
}

export default function HrmsShell() {
  const { pathname } = useLocation();
  const { user, logout } = useHrmsSession();
  const current = moduleForPath(pathname);

  return (
    <div className="hrms-app">
      <aside className="hrms-menu" aria-label="HRMS menu">
        <div className="hrms-menu-brand"><Wordmark /></div>
        <nav>
          {MODULES.map((m) => (
            <NavLink key={m.key} to={hrmsPath(m.home)} className={() => `hrms-menu-item${m.key === current.key ? ' active' : ''}`}>
              <i className={`fa-solid ${m.icon}`} aria-hidden="true"></i> <span>{m.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="hrms-main">
        <header className="hrms-topbar">
          <h1>{current.label}</h1>
          <div className="hrms-user">
            <i className="fa-solid fa-circle-user" aria-hidden="true"></i>
            <span>{user?.fullName || user?.username || 'Admin'}</span>
            <button type="button" className="hrms-btn ghost" onClick={logout}>
              <i className="fa-solid fa-right-from-bracket" aria-hidden="true"></i> Logout
            </button>
          </div>
        </header>
        {current.tabs.length > 0 && (
          <nav className="hrms-tabs" aria-label={`${current.label} sections`}>
            {current.tabs.map((t) => (
              <NavLink key={t.page} to={hrmsPath(t.page)} className={({ isActive }) => `hrms-tab${isActive ? ' active' : ''}`}>{t.label}</NavLink>
            ))}
          </nav>
        )}
        <div className="hrms-content"><Outlet /></div>
      </div>
    </div>
  );
}
