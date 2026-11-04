import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useEmployees } from '../../context/EmployeesContext';

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
  const { employees } = useEmployees();
  const pending = employees.filter((e) => e.status === 'Pending Review').length;
  const engine = engineStatus(health, backendUp);

  return (
    <aside className={`sidebar${open ? ' mobile-open' : ''}`} id="mainSidebar">
      <div className="sidebar-header">
        <div className="sidebar-brand-icon app-brand-icon">
          <i className="fa-solid fa-robot"></i>
        </div>
        <div className="sidebar-brand-text">
          <span className="sidebar-brand-title">HR AI Agents</span>
          <span className="sidebar-brand-badge"><i className="fa-solid fa-sparkles"></i> Demo Portal</span>
        </div>
      </div>

      <nav className="sidebar-nav" aria-label="Main navigation">
        <div className="sidebar-section-title">AI AGENTS &amp; DEMOS</div>
        <Tab to="/" end featured icon="fa-wand-magic-sparkles" title="AI Agents" subtitle="6 Interactive Demos" badge="Live" onNavigate={onNavigate} />

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
          <Tab to="/sample-files/onboarding" icon="fa-user-plus" title="Onboarding" subtitle="3 people" onNavigate={onNavigate} />
          <Tab to="/sample-files/reimbursement" icon="fa-file-invoice-dollar" title="Reimbursement" subtitle="9 sample bills" onNavigate={onNavigate} />
        </TabGroup>
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-status-box" style={{ color: engine.color }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span className="sidebar-status-pulse" style={{ background: engine.color }}></span>
            <span>AE Engine</span>
          </div>
          <span style={{ fontWeight: 700 }}>{engine.label}</span>
        </div>
      </div>
    </aside>
  );
}
