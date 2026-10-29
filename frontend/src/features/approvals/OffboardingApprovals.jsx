import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  approveOffboarding, clearOffboardings, listOffboardings, rejectOffboarding, relievingLetterUrl, retryOffboarding, retryOffboardingIntake,
  skipOffboardingIntakeStep, skipOffboardingStep,
} from '../../api/offboardings';
import ConfirmDialog from '../../components/common/ConfirmDialog';
import Modal from '../../components/common/Modal';
import StatusBadge from '../../components/common/StatusBadge';
import { useToast } from '../../context/ToastContext';
import { useAgentDemo } from '../agentDemo/engine/AgentDemoContext';
import { formatDate, formatDateTime, formatInr, initials } from '../../utils/format';
import PipelineTracker from './PipelineTracker';

const POLL_FAST_MS = 3000;
const POLL_IDLE_MS = 15000;
const STATS = [
  { status: 'Pending Review', label: 'Pending Review', icon: 'fa-hourglass-half', color: 'amber' },
  { status: 'Processing', label: 'Offboarding', icon: 'fa-gear', color: 'cyan' },
  { status: 'Completed', label: 'Completed', icon: 'fa-circle-check', color: 'emerald' },
  { status: 'Rejected', label: 'Rejected', icon: 'fa-circle-xmark', color: 'purple' },
];

const progressOf = (record) => {
  const total = record.pipeline.length;
  if (!total) return null;
  return { finished: record.pipeline.filter((s) => s.status !== 'pending' && s.status !== 'running').length, total, failed: record.pipeline.some((s) => s.status === 'failed') };
};

function Rows({ rows }) {
  return (
    <table className="chat-widget-table">
      <tbody>{rows.map(([label, value]) => <tr key={label}><td><strong>{label}</strong></td><td>{value ?? '—'}</td></tr>)}</tbody>
    </table>
  );
}

function DetailModal({ record, onClose, onApprove, onReject, act }) {
  const settlement = record.pipeline.find((s) => s.key === 'settlement')?.details;
  const failedIntake = record.status === 'Pending Review' && record.intakeStatus === 'failed';
  const failedChain = record.status === 'Offboarding Failed';
  return (
    <Modal
      title={record.fullName}
      icon="fa-door-open"
      onClose={onClose}
      maxWidth={820}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
          {failedChain && (
            <>
              <button type="button" className="btn btn-secondary" onClick={() => act(retryOffboarding, 'Re-running from the failed step.')}><i className="fa-solid fa-rotate-right"></i> Rerun from failed step</button>
              <button type="button" className="btn btn-secondary" onClick={() => act(skipOffboardingStep, 'Skipped the failed step; continuing.')}><i className="fa-solid fa-forward"></i> Skip failed step</button>
            </>
          )}
          {failedIntake && (
            <>
              <button type="button" className="btn btn-secondary" onClick={() => act(retryOffboardingIntake, 'Retrying the resignation intake.')}><i className="fa-solid fa-rotate"></i> Retry intake</button>
              <button type="button" className="btn btn-secondary" onClick={() => act(skipOffboardingIntakeStep, 'Skipped the failed intake step; continuing.')}><i className="fa-solid fa-forward"></i> Skip failed step</button>
            </>
          )}
          {record.status === 'Pending Review' && (
            <>
              <button type="button" className="btn btn-rose" onClick={() => onReject(record)}><i className="fa-solid fa-xmark"></i> Reject</button>
              <button type="button" className="btn btn-emerald" onClick={() => onApprove(record)} disabled={record.intakeStatus !== 'completed'}><i className="fa-solid fa-bolt"></i> Approve &amp; Offboard</button>
            </>
          )}
        </>
      }
    >
      <div className="detail-top">
        <span style={{ color: 'var(--text-muted)' }}>{record.id} · submitted {formatDateTime(record.submittedAt)}</span>
        <StatusBadge status={record.status} />
      </div>
      <section className="detail-section">
        <h4><i className="fa-solid fa-user text-accent"></i> Employee</h4>
        <Rows rows={[['Employee ID', record.employeeId], ['Work e-mail', record.workEmail], ['Role', `${record.jobTitle} · ${record.department}`], ['Reporting manager', record.manager], ['Laptop', record.hardware]]} />
      </section>
      <section className="detail-section">
        <h4><i className="fa-solid fa-calendar-xmark text-accent"></i> Resignation</h4>
        <Rows rows={[['Reason', record.reason], ['Comments', record.comments || '—'], ['Resigned on', formatDate(record.resignationDate)], ['Last working day', formatDate(record.lastWorkingDay)], ['Notice period', `${record.noticePeriodDays} days`], ['Leave balance', `${record.leaveBalanceDays} day(s)`]]} />
      </section>
      {settlement && (
        <section className="detail-section">
          <h4><i className="fa-solid fa-indian-rupee-sign text-accent"></i> Final settlement (estimate)</h4>
          <Rows rows={[['Salary for the final month', formatInr(settlement.salaryPayable)], ['Leave encashment', formatInr(settlement.leaveEncashment)], ['Notice recovery', `- ${formatInr(settlement.noticeRecovery)}`], ['Net payable', <b key="n">{formatInr(settlement.netPayable)}</b>]]} />
        </section>
      )}
      {record.relievingLetter?.filename && (
        <section className="detail-section">
          <h4><i className="fa-solid fa-file-pdf text-accent"></i> Relieving letter</h4>
          <a href={relievingLetterUrl(record.id)} target="_blank" rel="noreferrer">{record.relievingLetter.filename}</a>
        </section>
      )}
      <section className="detail-section">
        <h4><i className="fa-solid fa-list-check text-accent"></i> Intake</h4>
        <PipelineTracker steps={record.intake} emptyText="Intake has not started." />
      </section>
      <section className="detail-section">
        <h4><i className="fa-solid fa-list-check text-accent"></i> Offboarding steps</h4>
        <PipelineTracker steps={record.pipeline} emptyText="The offboarding steps start when HR approves this resignation." />
      </section>
    </Modal>
  );
}

/** HR side of offboarding: review resignations, then approve (runs the offboarding) or reject. */
export default function OffboardingApprovals() {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const demoRunning = useAgentDemo('offboarding').state.busy; // an Offboarding demo is waiting for this decision
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState(null);
  const [search, setSearch] = useState('');
  const [detailId, setDetailId] = useState(null);
  const [confirm, setConfirm] = useState(null); // { kind: 'approve' | 'reject' | 'clear', record? }
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setRecords(await listOffboardings());
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const running = records.some((r) => r.status === 'Processing' || r.intakeStatus === 'running');
  useEffect(() => {
    refresh();
    const timer = setInterval(() => { if (!document.hidden) refresh(); }, running ? POLL_FAST_MS : POLL_IDLE_MS);
    return () => clearInterval(timer);
  }, [refresh, running]);

  const counts = useMemo(() => Object.fromEntries(STATS.map(({ status }) => [status, records.filter((r) => r.status === status).length])), [records]);
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return records.filter((r) => (!filter || r.status === filter) && (!query || [r.fullName, r.employeeId, r.id, r.department, r.reason].join(' ').toLowerCase().includes(query)));
  }, [records, filter, search]);
  const detail = records.find((r) => r.id === detailId);

  const act = async (action, message, id = detailId) => {
    setBusy(true);
    try {
      await action(id);
      showToast(message, 'success');
      return true;
    } catch (err) {
      showToast(err.message, 'error');
      return false;
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const confirmAction = async () => {
    const { kind, record } = confirm;
    if (kind === 'approve') {
      // A demo waiting for this approval carries on in the Agent Demo screen; otherwise show the steps here.
      if (await act(approveOffboarding, `Offboarding started for ${record.fullName}.`, record.id)) { if (demoRunning) navigate('/agent-demo/offboarding'); else setDetailId(record.id); }
    } else if (kind === 'reject') {
      await act(rejectOffboarding, `${record.fullName}'s resignation was not accepted.`, record.id);
    } else {
      await act(clearOffboardings, 'Finished offboardings cleared.');
    }
    setConfirm(null);
  };

  return (
    <>
      <div className="dashboard-header">
        <div>
          <h2>HR Offboarding</h2>
          <p style={{ color: 'var(--text-muted)' }}>Review resignations, then approve to run the offboarding: exit workflows, access removal, asset return, clearances and the relieving letter.</p>
        </div>
        <div className="header-actions">
          <button type="button" className="btn btn-secondary" onClick={refresh}><i className="fa-solid fa-rotate"></i> Refresh</button>
        </div>
      </div>

      <div className="stats-grid">
        {STATS.map(({ status, label, icon, color }) => (
          <button key={status} type="button" className={`stat-card clickable${filter === status ? ' active' : ''}`} onClick={() => setFilter(filter === status ? null : status)} aria-pressed={filter === status}>
            <div className={`stat-icon ${color}`}><i className={`fa-solid ${icon}`}></i></div>
            <div className="stat-info"><div className="stat-value">{counts[status]}</div><div className="stat-label">{label}</div></div>
          </button>
        ))}
      </div>

      <div className="dashboard-controls">
        <div className="search-box">
          <i className="fa-solid fa-magnifying-glass"></i>
          <input type="text" className="form-control" placeholder="Search by name, ID or reason…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search resignations" />
        </div>
        <div className="filter-group">
          {filter && <button type="button" className="btn btn-secondary" onClick={() => setFilter(null)}><i className="fa-solid fa-filter-circle-xmark"></i> Clear filter</button>}
          <button type="button" className="btn btn-secondary" onClick={() => setConfirm({ kind: 'clear' })} disabled={!records.some((r) => r.status === 'Completed' || r.status === 'Rejected')}><i className="fa-solid fa-broom"></i> Clear history</button>
        </div>
      </div>

      {error && <p className="inline-warning"><i className="fa-solid fa-triangle-exclamation"></i> {error}</p>}

      <div className="table-responsive">
        <table className="data-table approvals-table">
          <thead><tr><th>Employee</th><th>Request</th><th>Role</th><th>Last working day</th><th>Reason</th><th>Status</th><th>Progress</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
          <tbody>
            {visible.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2.5rem' }}>{loading ? 'Loading…' : records.length === 0 ? 'No resignations yet.' : 'No resignations match the current filter.'}</td></tr>
            ) : visible.map((record) => {
              const progress = progressOf(record);
              return (
                <tr key={record.id}>
                  <td>
                    <div className="candidate-profile">
                      <div className="avatar">{initials(record.fullName)}</div>
                      <div className="candidate-info"><div className="candidate-name">{record.fullName}</div><div className="candidate-email">{record.employeeId}</div></div>
                    </div>
                  </td>
                  <td><span className="badge badge-pending" title="An employee who has resigned"><i className="fa-solid fa-door-open" aria-hidden="true"></i> Offboarding</span></td>
                  <td className="wrap">{record.jobTitle}<div className="candidate-email">{record.department}</div></td>
                  <td>{formatDate(record.lastWorkingDay)}</td>
                  <td className="wrap">{record.reason}</td>
                  <td><StatusBadge status={record.status} /></td>
                  <td>
                    {progress ? (
                      <div className="progress-cell" title={`${progress.finished} of ${progress.total} steps finished`}>
                        <div className="progress-track"><div className={`progress-bar${progress.failed ? ' has-errors' : ''}`} style={{ width: `${(progress.finished / progress.total) * 100}%` }}></div></div>
                        <span>{progress.finished}/{progress.total}</span>
                      </div>
                    ) : <span style={{ color: 'var(--text-dim)' }}>—</span>}
                  </td>
                  <td>
                    <div className="action-btn-group" style={{ justifyContent: 'flex-end' }}>
                      <button type="button" className="icon-btn" onClick={() => setDetailId(record.id)} title="View details" aria-label={`View ${record.fullName}`}><i className="fa-solid fa-eye"></i></button>
                      {record.status === 'Pending Review' && (
                        <>
                          <button type="button" className="icon-btn approve" onClick={() => setConfirm({ kind: 'approve', record })} disabled={record.intakeStatus !== 'completed'} title={record.intakeStatus === 'completed' ? 'Approve & offboard' : 'Intake is not finished: open the resignation to retry it'} aria-label={`Approve ${record.fullName}`}><i className="fa-solid fa-check"></i></button>
                          <button type="button" className="icon-btn reject" onClick={() => setConfirm({ kind: 'reject', record })} title="Reject" aria-label={`Reject ${record.fullName}`}><i className="fa-solid fa-xmark"></i></button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {detail && (
        <DetailModal
          record={detail}
          onClose={() => setDetailId(null)}
          onApprove={(r) => { setDetailId(null); setConfirm({ kind: 'approve', record: r }); }}
          onReject={(r) => { setDetailId(null); setConfirm({ kind: 'reject', record: r }); }}
          act={act}
        />
      )}

      {confirm?.kind === 'approve' && (
        <ConfirmDialog title={`Approve ${confirm.record.fullName}'s resignation?`} icon="fa-bolt" confirmLabel="Approve & Offboard" confirmClass="btn-emerald" busy={busy} onConfirm={confirmAction} onCancel={() => setConfirm(null)}>
          <p>This runs, in order:</p>
          <ol style={{ margin: '0.5rem 0 0.5rem 1.25rem' }}>
            <li>AutomationEdge exit approval</li>
            <li>Active Directory account disabled</li>
            <li>Microsoft 365 sign-in blocked and licences removed</li>
            <li>OrangeHRM employment ended</li>
            <li>Asset return and clearance tickets</li>
            <li>Final settlement and the relieving letter</li>
          </ol>
          <p>These actions change real accounts and cannot be undone from here.</p>
        </ConfirmDialog>
      )}
      {confirm?.kind === 'reject' && (
        <ConfirmDialog title={`Reject ${confirm.record.fullName}'s resignation?`} icon="fa-xmark" confirmLabel="Reject" confirmClass="btn-rose" busy={busy} onConfirm={confirmAction} onCancel={() => setConfirm(null)}>
          <p>The ServiceNow ticket is closed and nothing is changed in any account. The employee can resign again later.</p>
        </ConfirmDialog>
      )}
      {confirm?.kind === 'clear' && (
        <ConfirmDialog title="Clear finished offboardings?" icon="fa-broom" confirmLabel="Clear history" busy={busy} onConfirm={confirmAction} onCancel={() => setConfirm(null)}>
          <p>Removes completed and rejected offboardings from this list. Pending and running ones are kept.</p>
        </ConfirmDialog>
      )}
    </>
  );
}
