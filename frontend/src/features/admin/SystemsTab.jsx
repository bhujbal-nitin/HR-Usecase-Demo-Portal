import { useCallback, useEffect, useMemo, useState } from 'react';
import { checkSingleIntegration, getIntegrationHealth } from '../../api/system';
import { useToast } from '../../context/ToastContext';

const SYSTEM_META = {
  orangehrm: {
    name: 'HRMS',
    category: 'Core HRMS & Records',
    icon: 'fa-users-gear',
    color: '#f97316',
    description: 'Employee profiles, leave quotas & balances, attendance punch logs, CTC salary components, expense claims.',
  },
  servicenow: {
    name: 'ServiceNow',
    category: 'IT Service Management',
    icon: 'fa-ticket',
    color: '#0284c7',
    description: 'Onboarding tickets (REQ/RITM), hardware provisioning requests, exit asset recovery, clearance tasks.',
  },
  automationedge: {
    name: 'AutomationEdge Engine',
    category: 'Process Automation (RPA)',
    icon: 'fa-robot',
    color: '#2563eb',
    description: 'Active Directory user creation, management approval orchestration, and automated agent workflows.',
  },
  office365: {
    name: 'Microsoft 365 / Entra ID',
    category: 'Identity & Cloud Productivity',
    icon: 'fa-cloud',
    color: '#0078d4',
    description: 'Microsoft Graph API user mailbox provisioning, license assignment, session revocation, and offboarding.',
  },
  gemini: {
    name: 'Google Gemini (Vertex AI)',
    category: 'AI & Document Intelligence',
    icon: 'fa-wand-magic-sparkles',
    color: '#8b5cf6',
    description: 'Multimodal document intelligence: OCR verification for Aadhaar, PAN, salary slips, and reimbursement bills.',
  },
  knowledge_base: {
    name: 'AE Knowledge Base (KM)',
    category: 'HR Policy Intelligence',
    icon: 'fa-book-bookmark',
    color: '#0d9488',
    description: 'Knowledge Base API for conversational Q&A on company policies, rules, and employee guidelines.',
  },
  database: {
    name: 'PostgreSQL Database',
    category: 'Storage & Audit Logs',
    icon: 'fa-database',
    color: '#336791',
    description: 'User management accounts, AI token usage metrics, demo execution history, and persistent records.',
  },
  mailer: {
    name: 'SMTP Mail Service',
    category: 'Outbound Notifications',
    icon: 'fa-envelope',
    color: '#ea580c',
    description: 'Email delivery for job offer letters, relieving letters, and automated HR notifications.',
  },
};

export default function SystemsTab() {
  const { showToast } = useToast();
  const [healthData, setHealthData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [testingSystem, setTestingSystem] = useState(null); // systemKey currently being tested individually
  const [filter, setFilter] = useState('all'); // 'all', 'issues', 'live', 'unconfigured'
  const [lastUpdated, setLastUpdated] = useState(null);

  const loadHealth = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const data = await getIntegrationHealth();
      setHealthData(data);
      setLastUpdated(new Date());
      if (isRefresh) showToast('System status refreshed.', 'success');
    } catch (err) {
      showToast(`Health check failed: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadHealth();
  }, [loadHealth]);

  const testSingle = async (key) => {
    setTestingSystem(key);
    try {
      const res = await checkSingleIntegration(key);
      setHealthData((prev) => ({ ...prev, [key]: res }));
      setLastUpdated(new Date());
      if (res.ok) {
        showToast(`${SYSTEM_META[key]?.name || key} is live and authenticated.`, 'success');
      } else if (!res.configured) {
        showToast(`${SYSTEM_META[key]?.name || key} is not configured in .env.`, 'warning');
      } else {
        showToast(`${SYSTEM_META[key]?.name || key} failed: ${res.message}`, 'error');
      }
    } catch (err) {
      showToast(`Failed to test ${key}: ${err.message}`, 'error');
    } finally {
      setTestingSystem(null);
    }
  };

  const systemsList = useMemo(() => {
    if (!healthData) return [];
    const keys = Object.keys(healthData);
    return keys.map((key) => {
      const meta = SYSTEM_META[key] || {
        name: key,
        category: 'External Integration',
        icon: 'fa-server',
        color: 'var(--accent-primary)',
        description: 'External service integration.',
      };
      const info = healthData[key] || { ok: false, configured: false, message: 'Unknown' };
      return { key, ...meta, ...info };
    });
  }, [healthData]);

  const counts = useMemo(() => {
    let live = 0;
    let issues = 0;
    let unconfigured = 0;
    systemsList.forEach((s) => {
      if (s.ok) live += 1;
      else if (s.configured) issues += 1;
      else unconfigured += 1;
    });
    return { total: systemsList.length, live, issues, unconfigured };
  }, [systemsList]);

  const filteredSystems = useMemo(() => {
    if (filter === 'live') return systemsList.filter((s) => s.ok);
    if (filter === 'issues') return systemsList.filter((s) => s.configured && !s.ok);
    if (filter === 'unconfigured') return systemsList.filter((s) => !s.configured);
    return systemsList;
  }, [systemsList, filter]);

  return (
    <div className="systems-status-view">
      {/* Top Banner / KPI Overview */}
      <div className="admin-card" style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', margin: '0 0 0.25rem 0', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <i className="fa-solid fa-server" style={{ color: 'var(--accent-primary)' }}></i>
              Connected Systems &amp; Service Liveness
            </h2>
            <p className="admin-note" style={{ margin: 0 }}>
              Live verification of enterprise integrations, service availability, and authentication credentials.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            {lastUpdated && (
              <span className="admin-sub" style={{ fontSize: '0.8rem' }}>
                <i className="fa-regular fa-clock"></i> Checked {lastUpdated.toLocaleTimeString()}
              </span>
            )}
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => loadHealth(true)}
              disabled={loading || testingSystem !== null}
            >
              <i className={`fa-solid fa-rotate-right ${loading ? 'fa-spin' : ''}`}></i>{' '}
              {loading ? 'Checking All…' : 'Check All Systems'}
            </button>
          </div>
        </div>

        {/* Stats Chips */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem' }}>
          <div
            style={{
              padding: '0.75rem 1rem',
              borderRadius: '8px',
              background: 'var(--bg-main)',
              border: '1px solid var(--border-color)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <div className="admin-sub">Total Integrations</div>
              <strong style={{ fontSize: '1.4rem' }}>{counts.total}</strong>
            </div>
            <i className="fa-solid fa-network-wired" style={{ fontSize: '1.5rem', opacity: 0.3 }}></i>
          </div>

          <div
            onClick={() => setFilter(filter === 'live' ? 'all' : 'live')}
            style={{
              padding: '0.75rem 1rem',
              borderRadius: '8px',
              background: filter === 'live' ? 'rgba(16, 185, 129, 0.15)' : 'var(--bg-main)',
              border: '1px solid var(--accent-emerald)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
            title="Click to filter operational systems"
          >
            <div>
              <div className="admin-sub" style={{ color: 'var(--accent-emerald)' }}>Live &amp; Operational</div>
              <strong style={{ fontSize: '1.4rem', color: 'var(--accent-emerald)' }}>{counts.live}</strong>
            </div>
            <i className="fa-solid fa-circle-check" style={{ fontSize: '1.5rem', color: 'var(--accent-emerald)' }}></i>
          </div>

          <div
            onClick={() => setFilter(filter === 'issues' ? 'all' : 'issues')}
            style={{
              padding: '0.75rem 1rem',
              borderRadius: '8px',
              background: filter === 'issues' ? 'rgba(239, 68, 68, 0.15)' : 'var(--bg-main)',
              border: `1px solid ${counts.issues > 0 ? 'var(--accent-rose)' : 'var(--border-color)'}`,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
            title="Click to filter failed or unreachable systems"
          >
            <div>
              <div className="admin-sub" style={{ color: counts.issues > 0 ? 'var(--accent-rose)' : 'inherit' }}>
                Attention / Down
              </div>
              <strong style={{ fontSize: '1.4rem', color: counts.issues > 0 ? 'var(--accent-rose)' : 'inherit' }}>
                {counts.issues}
              </strong>
            </div>
            <i
              className={`fa-solid ${counts.issues > 0 ? 'fa-triangle-exclamation' : 'fa-circle-check'}`}
              style={{ fontSize: '1.5rem', color: counts.issues > 0 ? 'var(--accent-rose)' : 'var(--text-dim)' }}
            ></i>
          </div>

          <div
            onClick={() => setFilter(filter === 'unconfigured' ? 'all' : 'unconfigured')}
            style={{
              padding: '0.75rem 1rem',
              borderRadius: '8px',
              background: filter === 'unconfigured' ? 'rgba(245, 158, 11, 0.15)' : 'var(--bg-main)',
              border: '1px solid var(--border-color)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
            title="Click to filter unconfigured systems"
          >
            <div>
              <div className="admin-sub">Not Configured</div>
              <strong style={{ fontSize: '1.4rem', color: 'var(--accent-amber)' }}>{counts.unconfigured}</strong>
            </div>
            <i className="fa-solid fa-circle-minus" style={{ fontSize: '1.5rem', color: 'var(--accent-amber)', opacity: 0.7 }}></i>
          </div>
        </div>
      </div>

      {/* Filter Chips Bar */}
      <div className="admin-toolbar" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`btn btn-sm ${filter === 'all' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setFilter('all')}
          >
            All Systems ({counts.total})
          </button>
          <button
            type="button"
            className={`btn btn-sm ${filter === 'live' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setFilter('live')}
          >
            <i className="fa-solid fa-circle-check" style={{ color: 'var(--accent-emerald)' }}></i> Live ({counts.live})
          </button>
          {counts.issues > 0 && (
            <button
              type="button"
              className={`btn btn-sm ${filter === 'issues' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setFilter('issues')}
              style={{ borderColor: 'var(--accent-rose)' }}
            >
              <i className="fa-solid fa-triangle-exclamation" style={{ color: 'var(--accent-rose)' }}></i> Errors ({counts.issues})
            </button>
          )}
          <button
            type="button"
            className={`btn btn-sm ${filter === 'unconfigured' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setFilter('unconfigured')}
          >
            <i className="fa-solid fa-circle-minus" style={{ color: 'var(--accent-amber)' }}></i> Not Configured ({counts.unconfigured})
          </button>
        </div>
      </div>

      {/* Systems Cards Grid */}
      {loading && !healthData ? (
        <div className="admin-card" style={{ textAlign: 'center', padding: '3rem' }}>
          <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: '2rem', color: 'var(--accent-primary)', marginBottom: '1rem' }}></i>
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>Probing enterprise systems and credential liveness…</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '1.1rem' }}>
          {filteredSystems.map((sys) => {
            const isTesting = testingSystem === sys.key;
            let statusBadge = null;

            if (isTesting) {
              statusBadge = (
                <span className="badge badge-processing" style={{ background: 'rgba(37, 99, 235, 0.15)', color: 'var(--accent-primary)' }}>
                  <i className="fa-solid fa-spinner fa-spin"></i> Testing…
                </span>
              );
            } else if (sys.ok) {
              statusBadge = (
                <span className="badge badge-approved" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: 'var(--accent-emerald)',
                      boxShadow: '0 0 6px var(--accent-emerald)',
                      display: 'inline-block',
                    }}
                  ></span>
                  Live &amp; Healthy
                </span>
              );
            } else if (!sys.configured) {
              statusBadge = (
                <span className="badge badge-draft" style={{ background: 'rgba(245, 158, 11, 0.15)', color: 'var(--accent-amber)' }}>
                  <i className="fa-solid fa-circle-minus"></i> Not Configured
                </span>
              );
            } else {
              statusBadge = (
                <span className="badge badge-rejected" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                  <i className="fa-solid fa-triangle-exclamation"></i> Down / Error
                </span>
              );
            }

            return (
              <div
                key={sys.key}
                className="admin-card"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  margin: 0,
                  position: 'relative',
                  borderLeft: `4px solid ${
                    sys.ok ? 'var(--accent-emerald)' : !sys.configured ? 'var(--accent-amber)' : 'var(--accent-rose)'
                  }`,
                }}
              >
                <div>
                  {/* Card Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem', marginBottom: '0.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <div
                        style={{
                          width: '42px',
                          height: '42px',
                          borderRadius: '10px',
                          background: `${sys.color}15`,
                          color: sys.color,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '1.25rem',
                          flexShrink: 0,
                        }}
                      >
                        <i className={`fa-solid ${sys.icon}`}></i>
                      </div>
                      <div>
                        <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600 }}>{sys.name}</h3>
                        <span className="admin-sub">{sys.category}</span>
                      </div>
                    </div>
                    <div>{statusBadge}</div>
                  </div>

                  {/* Description */}
                  <p className="admin-note" style={{ fontSize: '0.82rem', lineHeight: '1.35', marginBottom: '0.9rem' }}>
                    {sys.description}
                  </p>

                  {/* Diagnostic / Details Section */}
                  <div
                    style={{
                      background: 'var(--bg-main)',
                      padding: '0.7rem 0.85rem',
                      borderRadius: '8px',
                      fontSize: '0.82rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.4rem',
                      border: '1px solid var(--border-color)',
                      marginBottom: '0.9rem',
                    }}
                  >
                    {sys.endpoint && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Endpoint:</span>
                        <code style={{ fontSize: '0.78rem', wordBreak: 'break-all', maxWidth: '220px', textAlign: 'right' }} title={sys.endpoint}>
                          {sys.endpoint}
                        </code>
                      </div>
                    )}
                    {sys.identity && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Credential / User:</span>
                        <code style={{ fontSize: '0.78rem' }}>{sys.identity}</code>
                      </div>
                    )}
                    {sys.latencyMs !== undefined && sys.latencyMs !== null && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Response Latency:</span>
                        <span style={{ fontWeight: 600, color: sys.latencyMs < 500 ? 'var(--accent-emerald)' : 'var(--accent-amber)' }}>
                          {sys.latencyMs} ms
                        </span>
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                      <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>Message:</span>
                      <span
                        style={{
                          textAlign: 'right',
                          fontWeight: 500,
                          color: sys.ok
                            ? 'var(--accent-emerald)'
                            : !sys.configured
                            ? 'var(--accent-amber)'
                            : 'var(--accent-rose)',
                          wordBreak: 'break-word',
                        }}
                      >
                        {sys.message || (sys.ok ? 'Operational' : 'Failed')}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Card Action Footer */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', paddingTop: '0.5rem', borderTop: '1px solid var(--border-color)' }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => testSingle(sys.key)}
                    disabled={isTesting || loading}
                    title={`Trigger immediate live connection test for ${sys.name}`}
                  >
                    <i className={`fa-solid ${isTesting ? 'fa-spinner fa-spin' : 'fa-play'}`}></i>{' '}
                    {isTesting ? 'Testing…' : 'Test Connection'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
