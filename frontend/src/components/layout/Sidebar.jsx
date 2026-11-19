import { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useEmployees } from '../../context/EmployeesContext';
import ChangePasswordDialog from './ChangePasswordDialog';

const tabClass = ({ isActive }) => `sidebar-tab-btn${isActive ? ' active' : ''}`;

function Tab({ to, icon, title, subtitle, badge, featured, onNavigate, end }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      title={title}
      className={(state) => `${tabClass(state)}${featured ? ' featured-agent-tab' : ''}`}
    >
      <div className="tab-icon"><i className={`fa-solid ${icon}`}></i></div>
      <div className="tab-info">
        <span className="tab-title">{title}</span>
        <span className="tab-subtitle">{subtitle}</span>
      </div>
      {badge !== undefined && badge !== null && <span className="tab-badge">{badge}</span>}
    </NavLink>
  );
}

/** A sidebar entry that opens and closes a list of pages under it. It starts open when one of those pages is showing. */
function TabGroup({ icon, title, subtitle, prefix, children }) {
  const { pathname } = useLocation();
  const inside = pathname.startsWith(prefix);
  const [open, setOpen] = useState(inside);
  return (
    <>
      <button type="button" className={`sidebar-tab-btn sidebar-group-btn${inside ? ' active' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open} title={title}>
        <div className="tab-icon"><i className={`fa-solid ${icon}`}></i></div>
        <div className="tab-info">
          <span className="tab-title">{title}</span>
          <span className="tab-subtitle">{subtitle}</span>
        </div>
        <i className={`fa-solid fa-chevron-down sidebar-group-chevron${open ? ' open' : ''}`} aria-hidden="true"></i>
      </button>
      {open && <div className="sidebar-subtabs">{children}</div>}
    </>
  );
}

function engineStatus(health, backendUp) {
  if (!backendUp) return { label: 'Offline', color: 'var(--accent-rose)' };
  if (!health) return { label: 'Checking…', color: 'var(--text-dim)' };
  const engine = health.automationedge;
  if (!engine.configured) return { label: 'Not configured', color: 'var(--accent-amber)' };
  return engine.ok ? { label: 'Online', color: 'var(--accent-emerald)' } : { label: 'Unreachable', color: 'var(--accent-rose)' };
}

export default function Sidebar({ open, onNavigate, health, backendUp }) {
  const navigate = useNavigate();
  const { employees } = useEmployees();
  const { authEnabled, username, fullName, role, logout } = useAuth();
  const [changingPassword, setChangingPassword] = useState(false);
  const pending = employees.filter((e) => e.status === 'Pending Review').length;
  const engine = engineStatus(health, backendUp);
  const canSeeAdmin = role === 'admin' || !authEnabled;

  return (
    <aside className={`sidebar${open ? ' mobile-open' : ''}`} id="mainSidebar">
      <div className="sidebar-header">
        <div className="sidebar-brand-icon">
          <img src={`${import.meta.env.BASE_URL}ae-icon.png`} alt="AutomationEdge" />
        </div>
        <div className="sidebar-brand-text">
          <span className="sidebar-brand-title">HR AI Agents</span>
          <span className="sidebar-brand-badge"><i className="fa-solid fa-sparkles"></i> Demo Portal</span>
        </div>
      </div>

      <nav className="sidebar-nav" aria-label="Main navigation">
        <div className="sidebar-section-title">AI AGENTS &amp; DEMOS</div>
        <Tab to="/" end featured icon="fa-wand-magic-sparkles" title="AI Agents" subtitle="7 Interactive Demos" badge="Live" onNavigate={onNavigate} />

        <Tab to="/agent-demo" icon="fa-comments" title="Agent Demo" subtitle="WhatsApp journey" onNavigate={onNavigate} />

        <div className="sidebar-section-title">ONBOARDING</div>
        <Tab
          to="/approvals"
          icon="fa-clipboard-check"
          title="Approvals"
          subtitle="Review & provision"
          badge={pending > 0 ? pending : null}
          onNavigate={onNavigate}
        />

        <div className="sidebar-section-title">SAMPLE DATA</div>
        <TabGroup icon="fa-file-arrow-down" title="Sample Files" subtitle="Documents & bills" prefix="/sample-files">
          <Tab to="/sample-files/pre-onboarding" icon="fa-file-circle-check" title="Pre-Onboarding" subtitle="3 candidates" onNavigate={onNavigate} />
          <Tab to="/sample-files/onboarding" icon="fa-user-plus" title="Onboarding" subtitle="3 people" onNavigate={onNavigate} />
          <Tab to="/sample-files/reimbursement" icon="fa-file-invoice-dollar" title="Reimbursement" subtitle="9 sample bills" onNavigate={onNavigate} />
        </TabGroup>

        <div className="sidebar-section-title">SIMULATED APPLICATIONS</div>
        <Tab to="/simulated/hrms" icon="fa-building-user" title="HRMS" subtitle="HR management system" onNavigate={onNavigate} />

        {canSeeAdmin && (
          <>
            <div className="sidebar-section-title">ADMIN</div>
            <Tab to="/admin" icon="fa-user-shield" title="Admin" subtitle="System status & users" onNavigate={onNavigate} />
          </>
        )}
      </nav>

      <div className="sidebar-footer">
        <div
          className="sidebar-status-box"
          style={{ color: engine.color, cursor: canSeeAdmin ? 'pointer' : 'default' }}
          onClick={() => {
            if (canSeeAdmin) {
              navigate('/admin');
              onNavigate?.();
            }
          }}
          title={canSeeAdmin ? 'Click to view all system health & integrations in Admin' : undefined}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span className="sidebar-status-pulse" style={{ background: engine.color }}></span>
            <span>AE Engine</span>
          </div>
          <span style={{ fontWeight: 700 }}>{engine.label}</span>
        </div>
        {authEnabled && (
          <div className="sidebar-user">
            <i className="fa-solid fa-user" aria-hidden="true"></i>
            <strong title={fullName || username}>{fullName || username}</strong>
            <button type="button" className="sidebar-signout sidebar-keybtn" onClick={() => setChangingPassword(true)} title="Change your password" aria-label="Change password">
              <i className="fa-solid fa-key"></i>
            </button>
            <button type="button" className="sidebar-signout" onClick={logout} title="Sign out" aria-label="Sign out">
              <i className="fa-solid fa-right-from-bracket"></i> <span>Sign out</span>
            </button>
          </div>
        )}
      </div>
      {changingPassword && <ChangePasswordDialog onClose={() => setChangingPassword(false)} />}
    </aside>
  );
}
