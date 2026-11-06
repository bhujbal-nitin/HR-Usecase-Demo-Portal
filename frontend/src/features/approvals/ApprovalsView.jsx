import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { approveCandidate, clearEmployees, rejectCandidate, syncServiceNowApprovals } from '../../api/employees';
import ConfirmDialog from '../../components/common/ConfirmDialog';
import StatusBadge from '../../components/common/StatusBadge';
import { useEmployees } from '../../context/EmployeesContext';
import { useToast } from '../../context/ToastContext';
import { useAgentDemo } from '../agentDemo/engine/AgentDemoContext';
import { formatDate, initials } from '../../utils/format';
import CandidateDetailModal from './CandidateDetailModal';

// Why Approve is greyed out, by intake state.
const APPROVE_BLOCKED = {
  running: 'Intake is still running',
  failed: 'Intake failed: open the candidate and retry it first',
  awaiting_documents: 'The candidate is still sending documents',
};

const STATS = [
  { status: 'Pending Review', label: 'Pending Review', icon: 'fa-hourglass-half', color: 'amber' },
  { status: 'Processing Approval', label: 'Provisioning', icon: 'fa-gear', color: 'cyan' },
  { status: 'Approved', label: 'Approved', icon: 'fa-circle-check', color: 'emerald' },
  { status: 'Rejected', label: 'Rejected', icon: 'fa-circle-xmark', color: 'purple' },
];

function progressOf(employee) {
  const total = employee.pipeline.length;
  if (!total) return null;
  const finished = employee.pipeline.filter((s) => s.status !== 'pending' && s.status !== 'running').length;
  const failed = employee.pipeline.some((s) => s.status === 'failed');
  return { finished, total, failed };
}

function ProvisioningCell({ employee }) {
  const progress = progressOf(employee);
  if (!progress) return <span style={{ color: 'var(--text-dim)' }}>—</span>;
  const running = employee.status === 'Processing Approval';
  return (
    <div className="progress-cell" title={`${progress.finished} of ${progress.total} steps finished`}>
      <div className="progress-track">
        <div className={`progress-bar${progress.failed ? ' has-errors' : ''}`} style={{ width: `${(progress.finished / progress.total) * 100}%` }}></div>
      </div>
      <span>
        {progress.finished}/{progress.total}
        {!running && progress.failed && <i className="fa-solid fa-triangle-exclamation" style={{ color: 'var(--accent-amber)', marginLeft: 6 }} title="Some steps failed"></i>}
      </span>
    </div>
  );
}

export default function ApprovalsView({ embedded = false }) {
  const Shell = embedded ? 'div' : 'section';
  const { showToast } = useToast();
  const navigate = useNavigate();
  const demoRunning = useAgentDemo('onboarding').state.busy; // an Onboarding demo is waiting for this decision
  const { employees, loading, error, refresh } = useEmployees();
  const [filter, setFilter] = useState(null);
  const [search, setSearch] = useState('');
  const [detailId, setDetailId] = useState(null);
  const [confirm, setConfirm] = useState(null); // { kind: 'approve' | 'reject' | 'clear', employee? }
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const counts = useMemo(
    () => Object.fromEntries(STATS.map(({ status }) => [status, employees.filter((e) => e.status === status).length])),
    [employees],
  );

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return employees.filter((e) => {
      if (filter && e.status !== filter) return false;
      return !query || [e.fullName, e.email, e.id, e.jobTitle, e.department, e.serviceNow.reqNumber ?? ''].join(' ').toLowerCase().includes(query);
    });
  }, [employees, filter, search]);

  const runAction = async (action, successMessage) => {
    setBusy(true);
    try {
      const result = await action();
      showToast(successMessage, 'success');
      return result ?? true;
    } catch (err) {
      showToast(err.message, 'error');
      return null;
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const confirmAction = async () => {
    const { kind, employee } = confirm;
    if (kind === 'approve') {
      const started = await runAction(() => approveCandidate(employee.id), `Provisioning started for ${employee.fullName}.`);
      // A demo waiting for this approval carries on in the Agent Demo screen; otherwise show the steps here.
      if (started) { if (demoRunning) navigate('/agent-demo/onboarding'); else setDetailId(employee.id); }
    } else if (kind === 'reject') {
      await runAction(() => rejectCandidate(employee.id), `${employee.fullName} was rejected.`);
    } else {
      await runAction(() => clearEmployees('processed'), 'Finished records cleared.');
    }
    setConfirm(null);
  };

  const sync = async () => {
    setSyncing(true);
    try {
      const started = await syncServiceNowApprovals();
      showToast(started.length ? `${started.length} approval(s) found in ServiceNow — provisioning started.` : 'No new approvals found in ServiceNow.', started.length ? 'success' : 'info');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSyncing(false);
      refresh();
    }
  };

  const openApprove = (employee) => setConfirm({ kind: 'approve', employee });
  const openReject = (employee) => setConfirm({ kind: 'reject', employee });

  return (
    <Shell className={embedded ? undefined : 'view-section active'}>
      <div className="dashboard-header">
        <div>
          <h2>Approvals &amp; Provisioning</h2>
          <p style={{ color: 'var(--text-muted)' }}>
            Review candidate documents, then approve to provision ServiceNow, Active Directory, Microsoft 365, OrangeHRM and IT hardware.
          </p>
        </div>
        <div className="header-actions">
          <button type="button" className="btn btn-secondary" onClick={refresh}><i className="fa-solid fa-rotate"></i> Refresh</button>
          <button type="button" className="btn btn-secondary" onClick={sync} disabled={syncing} title="Check ServiceNow for requests approved there">
            <i className={`fa-solid ${syncing ? 'fa-spinner fa-spin' : 'fa-headset'}`}></i> Sync ServiceNow
          </button>
        </div>
      </div>

      <div className="stats-grid">
        {STATS.map(({ status, label, icon, color }) => (
          <button
            key={status}
            type="button"
            className={`stat-card clickable${filter === status ? ' active' : ''}`}
            onClick={() => setFilter(filter === status ? null : status)}
            aria-pressed={filter === status}
          >
            <div className={`stat-icon ${color}`}><i className={`fa-solid ${icon}`}></i></div>
            <div className="stat-info">
              <div className="stat-value">{counts[status]}</div>
              <div className="stat-label">{label}</div>
            </div>
          </button>
        ))}
      </div>

      <div className="dashboard-controls">
        <div className="search-box">
          <i className="fa-solid fa-magnifying-glass"></i>
          <input type="text" className="form-control" placeholder="Search by name, email, ID or request…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search candidates" />
        </div>
        <div className="filter-group">
          {filter && <button type="button" className="btn btn-secondary" onClick={() => setFilter(null)}><i className="fa-solid fa-filter-circle-xmark"></i> Clear filter</button>}
          <button type="button" className="btn btn-secondary" onClick={() => setConfirm({ kind: 'clear' })} disabled={!employees.some((e) => e.status === 'Approved' || e.status === 'Rejected')}>
            <i className="fa-solid fa-broom"></i> Clear history
          </button>
        </div>
      </div>

      {error && <p className="inline-warning"><i className="fa-solid fa-triangle-exclamation"></i> {error}</p>}

      <div className="table-responsive">
        <table className="data-table approvals-table">
          <thead>
            <tr>
              <th>Candidate</th><th>Request</th><th>Role</th><th>Joining</th><th>ServiceNow</th><th>Status</th><th>Provisioning</th><th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2.5rem' }}>
                  {loading ? 'Loading…' : employees.length === 0 ? 'No candidates yet. Start by onboarding a new hire.' : 'No candidates match the current filter.'}
                </td>
              </tr>
            ) : (
              visible.map((employee) => (
                <tr key={employee.id}>
                  <td>
                    <div className="candidate-profile">
                      <div className="avatar">{initials(employee.fullName)}</div>
                      <div className="candidate-info">
                        <div className="candidate-name">{employee.fullName}</div>
                        <div className="candidate-email">{employee.email}</div>
                      </div>
                    </div>
                  </td>
                  <td><span className="badge badge-verified" title="A new hire waiting to be onboarded"><i className="fa-solid fa-user-plus" aria-hidden="true"></i> Onboarding</span></td>
                  <td className="wrap">{employee.jobTitle}<div className="candidate-email">{employee.department}</div></td>
                  <td>{formatDate(employee.startDate)}</td>
                  <td>
                    {employee.serviceNow.reqNumber ? (
                      <a href={employee.serviceNow.reqUrl} target="_blank" rel="noreferrer">{employee.serviceNow.reqNumber}</a>
                    ) : (
                      <span className="candidate-email" title={employee.serviceNow.syncError ?? ''}>{employee.serviceNow.approvalStatus}</span>
                    )}
                  </td>
                  <td><StatusBadge status={employee.status} /></td>
                  <td><ProvisioningCell employee={employee} /></td>
                  <td>
                    <div className="action-btn-group" style={{ justifyContent: 'flex-end' }}>
                      <button type="button" className="icon-btn" onClick={() => setDetailId(employee.id)} title="View details" aria-label={`View ${employee.fullName}`}>
                        <i className="fa-solid fa-eye"></i>
                      </button>
                      {employee.status === 'Pending Review' && (
                        <>
                          <button
                            type="button" className="icon-btn approve" onClick={() => openApprove(employee)}
                            disabled={['running', 'failed', 'awaiting_documents'].includes(employee.intakeStatus)}
                            title={APPROVE_BLOCKED[employee.intakeStatus] ?? 'Approve & provision'}
                            aria-label={`Approve ${employee.fullName}`}
                          >
                            <i className="fa-solid fa-check"></i>
                          </button>
                          <button type="button" className="icon-btn reject" onClick={() => openReject(employee)} title="Reject" aria-label={`Reject ${employee.fullName}`}>
                            <i className="fa-solid fa-xmark"></i>
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {detailId && (
        <CandidateDetailModal
          employeeId={detailId}
          onClose={() => setDetailId(null)}
          onApprove={(employee) => { setDetailId(null); openApprove(employee); }}
          onReject={(employee) => { setDetailId(null); openReject(employee); }}
        />
      )}

      {confirm?.kind === 'approve' && (
        <ConfirmDialog
          title={`Approve ${confirm.employee.fullName}?`}
          icon="fa-bolt"
          confirmLabel="Approve & Provision"
          confirmClass="btn-emerald"
          busy={busy}
          onConfirm={confirmAction}
          onCancel={() => setConfirm(null)}
        >
          <p>This approves the ServiceNow request and then creates, in order:</p>
          <ol style={{ margin: '0.5rem 0 0.5rem 1.25rem' }}>
            <li>AutomationEdge management approval</li>
            <li>Active Directory account</li>
            <li>Microsoft 365 account</li>
            <li>OrangeHRM employee profile</li>
            <li>Laptop request and ServiceNow hardware incident</li>
          </ol>
          <p>These actions create real records in the connected systems and cannot be undone from here.</p>
        </ConfirmDialog>
      )}
      {confirm?.kind === 'reject' && (
        <ConfirmDialog
          title={`Reject ${confirm.employee.fullName}?`}
          icon="fa-xmark"
          confirmLabel="Reject candidate"
          confirmClass="btn-rose"
          busy={busy}
          onConfirm={confirmAction}
          onCancel={() => setConfirm(null)}
        >
          <p>The ServiceNow request is closed as rejected and no accounts are created.</p>
        </ConfirmDialog>
      )}
      {confirm?.kind === 'clear' && (
        <ConfirmDialog
          title="Clear finished records?"
          icon="fa-broom"
          confirmLabel="Clear history"
          busy={busy}
          onConfirm={confirmAction}
          onCancel={() => setConfirm(null)}
        >
          <p>Removes approved and rejected candidates (and their uploaded documents) from this list. Pending candidates are kept. Records already created in other systems are not touched.</p>
        </ConfirmDialog>
      )}
    </Shell>
  );
}
