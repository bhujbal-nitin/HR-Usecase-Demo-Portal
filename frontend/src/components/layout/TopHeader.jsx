import { useLocation, useNavigate } from 'react-router-dom';
import { THEMES, useTheme } from '../../context/ThemeContext';

const TITLES = {
  '/': 'HR AI Agents',
  '/agent-demo': 'Onboarding Agent Demo',
  '/approvals': 'HR Approvals & Provisioning',
};

export default function TopHeader({ onToggleSidebar, collapsed }) {
  const { theme, setTheme, cycleTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const current = THEMES.find((t) => t.id === theme) ?? THEMES[0];

  // The demo page listens for this navigation state and offers to play the onboarding journey.
  const autoFill = () => navigate('/agent-demo', { state: { autoplay: Date.now() } });

  return (
    <header className="top-header">
      <div className="top-header-left">
        <button type="button" className="sidebar-toggle-btn" onClick={onToggleSidebar} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          <i className="fa-solid fa-bars"></i>
        </button>
        <div className="header-breadcrumbs">
          <span>HR AI Agents</span>
          <i className="fa-solid fa-chevron-right" style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}></i>
          <strong>{location.pathname.startsWith('/agent-demo') ? 'Agent Demo' : TITLES[location.pathname] ?? 'HR AI Agents'}</strong>
        </div>
      </div>

      <div className="top-header-right">
        <button type="button" className="btn btn-secondary header-btn" onClick={autoFill} title="Play the Onboarding Agent demo with a sample candidate">
          <i className="fa-solid fa-bolt"></i> Auto-Fill Demo
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <select
            value={theme}
            onChange={(event) => setTheme(event.target.value)}
            className="form-control header-select"
            aria-label="Colour theme"
          >
            {THEMES.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
          <button
            type="button" role="switch" aria-checked={theme === 'dark'} className={`mode-switch${theme === 'dark' ? ' on' : ''}`}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label="Dark mode"
          >
            <i className="fa-solid fa-sun" aria-hidden="true"></i>
            <i className="fa-solid fa-moon" aria-hidden="true"></i>
            <span className="mode-knob"></span>
          </button>
          <button type="button" className="theme-toggle-btn" onClick={cycleTheme} title="Cycle palette theme" aria-label="Cycle palette theme">
            <i className={`fa-solid ${current.icon}`}></i>
          </button>
        </div>
      </div>
    </header>
  );
}
