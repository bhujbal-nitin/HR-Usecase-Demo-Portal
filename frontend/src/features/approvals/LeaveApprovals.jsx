import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { applyLeaveRequest, approveLeaveRequest, clearLeaveRequests, listLeaveRequests, rejectLeaveRequest } from '../../api/leave';
import ConfirmDialog from '../../components/common/ConfirmDialog';
import Modal from '../../components/common/Modal';
import StatusBadge from '../../components/common/StatusBadge';
import { useToast } from '../../context/ToastContext';
import { useAgentDemo } from '../agentDemo/engine/AgentDemoContext';
import { formatDate, formatDateTime, initials } from '../../utils/format';

const POLL_MS = 5000;
const STATS = [
  { status: 'Pending Approval', label: 'Pending', icon: 'fa-hourglass-half', color: 'amber' },
  { status: 'Approved', label: 'Approved', icon: 'fa-circle-check', color: 'emerald' },
  { status: 'Rejected', label: 'Rejected', icon: 'fa-circle-xmark', color: 'purple' },
];

const isLeave = (record) => record.kind === 'leave';
const days = (count) => `${count} day${count === 1 ? '' : 's'}`;
const kindOf = (record) => (isLeave(record)
  ? { label: 'Leave', icon: 'fa-umbrella-beach', title: 'A leave application' }
  : { label: 'Attendance', icon: 'fa-fingerprint', title: 'A missed punch to correct' });
/** One line saying what is being asked for. */
const summaryOf = (record) => (isLeave(record)
  ? `${record.leaveType}: ${formatDate(record.startDate)} to ${formatDate(record.endDate)} (${days(record.days)})`
  : `Out-punch ${record.outPunch} on ${formatDate(record.attendanceDate)}`);

function Rows({ rows }) {
  return (
    <table className="chat-widget-table">
      <tbody>{rows.map(([label, value]) => <tr key={label}><td><strong>{label}</strong></td><td>{value ?? '—'}</td></tr>)}</tbody>
    </table>
  );
}

const needsRecording = (record) => record.status === 'Approved' && !record.applied;

function DetailModal({ record, onClose, onApprove, onReject, onRecord }) {
  const pending = record.status === 'Pending Approval';
  return (
    <Modal
      title={`${kindOf(record).label} request · ${record.fullName}`}
      icon={kindOf(record).icon}
      onClose={onClose}
      maxWidth={640}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
          {needsRecording(record) && <button type="button" className="btn btn-primary" onClick={() => onRecord(record)}><i className="fa-solid fa-cloud-arrow-up"></i> Record in OrangeHRM</button>}
          {pending && (
            <>
              <button type="button" className="btn btn-rose" onClick={() => onReject(record)}><i className="fa-solid fa-xmark"></i> Reject</button>
              <button type="button" className="btn btn-emerald" onClick={() => onApprove(record)}><i className="fa-solid fa-check"></i> Approve</button>
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
        <Rows rows={[['Employee ID', record.employeeId], ['Work e-mail', record.workEmail], ['Role', `${record.jobTitle} · ${record.department}`], ['Reporting manager', record.manager]]} />
      </section>
      <section className="detail-section">
        <h4><i className={`fa-solid ${kindOf(record).icon} text-accent`}></i> {isLeave(record) ? 'Leave' : 'Attendance correction'}</h4>
        <Rows rows={isLeave(record)
          ? [['Leave type', record.leaveType], ['From', formatDate(record.startDate)], ['To', formatDate(record.endDate)], ['Working days', record.days], ['Balance after', record.balanceAfter === null ? '—' : days(record.balanceAfter)], ['Reason', record.reason]]
          : [['Day', formatDate(record.attendanceDate)], ['In-punch', record.inPunch], ['Out-punch (requested)', record.outPunch], ['Hours worked', record.hoursWorked], ['Reason', record.reason]]}
        />
      </section>
      {record.status === 'Approved' && (
        <section className="detail-section">
          <h4><i className="fa-solid fa-database text-accent"></i> OrangeHRM</h4>
          {record.applied
            ? <p>Recorded {formatDateTime(record.appliedAt)}. {record.orangeHrmUrl && <a href={record.orangeHrmUrl} target="_blank" rel="noreferrer">Open in OrangeHRM</a>}</p>
            : <p style={{ color: 'var(--text-muted)' }}>Approved, but not recorded in OrangeHRM yet.</p>}
        </section>
      )}
      {record.decidedAt && <p style={{ color: 'var(--text-muted)' }}>Decided {formatDateTime(record.decidedAt)}.</p>}
    </Modal>
  );
}

/** The manager's side of leave & attendance: review leave applications and attendance corrections, then approve or reject. */
export default function LeaveApprovals() {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const demoRunning = useAgentDemo('leave_attendance').state.busy; // a Leave & Attendance demo is waiting for this decision
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
      setRecords(await listLeaveRequests());
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const counts = useMemo(() => Object.fromEntries(STATS.map(({ status }) => [status, records.filter((r) => r.status === status).length])), [records]);
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return records.filter((r) => (!filter || r.status === filter) && (!query || [r.fullName, r.employeeId, r.id, r.department, kindOf(r).label, summaryOf(r)].join(' ').toLowerCase().includes(query)));
  }, [records, filter, search]);
  const detail = records.find((r) => r.id === detailId);

  const act = async (action, message, id) => {
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
      // A demo waiting for this decision records it in OrangeHRM itself and carries on in the Agent Demo screen; otherwise record it here.
      if (await act(approveLeaveRequest, `${record.id} was approved.`, record.id)) {
        if (demoRunning) navigate('/agent-demo/leave_attendance');
        else await act(applyLeaveRequest, `${record.id} was recorded in OrangeHRM.`, record.id);
      }
    } else if (kind === 'reject') {
      if (await act(rejectLeaveRequest, `${record.id} was rejected.`, record.id) && demoRunning) navigate('/agent-demo/leave_attendance');
    } else {
      await act(clearLeaveRequests, 'Decided requests cleared.');
    }
    setConfirm(null);
  };

  return (
    <>
      <div className="dashboard-header">
        <div>
          <h2>Leave &amp; Attendance</h2>
          <p style={{ color: 'var(--text-muted)' }}>Review leave applications and attendance corrections. Approving books the leave, or corrects the punch, in OrangeHRM.</p>
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
          <input type="text" className="form-control" placeholder="Search by name, ID or request…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search requests" />
        </div>
        <div className="filter-group">
          {filter && <button type="button" className="btn btn-secondary" onClick={() => setFilter(null)}><i className="fa-solid fa-filter-circle-xmark"></i> Clear filter</button>}
          <button type="button" className="btn btn-secondary" onClick={() => setConfirm({ kind: 'clear' })} disabled={!records.some((r) => r.status !== 'Pending Approval')}><i className="fa-solid fa-broom"></i> Clear history</button>
        </div>
      </div>

      {error && <p className="inline-warning"><i className="fa-solid fa-triangle-exclamation"></i> {error}</p>}

      <div className="table-responsive">
        <table className="data-table approvals-table">
          <thead><tr><th>Employee</th><th>Request</th><th>Details</th><th>Reason</th><th>Manager</th><th>Status</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
          <tbody>
            {visible.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2.5rem' }}>{loading ? 'Loading…' : records.length === 0 ? 'No leave or attendance requests yet.' : 'No requests match the current filter.'}</td></tr>
            ) : visible.map((record) => (
              <tr key={record.id}>
                <td>
                  <div className="candidate-profile">
                    <div className="avatar">{initials(record.fullName)}</div>
                    <div className="candidate-info"><div className="candidate-name">{record.fullName}</div><div className="candidate-email">{record.employeeId}</div></div>
                  </div>
                </td>
                <td><span className="badge badge-pending" title={kindOf(record).title}><i className={`fa-solid ${kindOf(record).icon}`} aria-hidden="true"></i> {kindOf(record).label}</span></td>
                <td className="wrap">{summaryOf(record)}<div className="candidate-email">{record.id}</div></td>
                <td className="wrap">{record.reason}</td>
                <td className="wrap">{record.manager}</td>
                <td><StatusBadge status={record.status} />{needsRecording(record) && <div className="candidate-email">Not in OrangeHRM yet</div>}</td>
                <td>
                  <div className="action-btn-group" style={{ justifyContent: 'flex-end' }}>
                    <button type="button" className="icon-btn" onClick={() => setDetailId(record.id)} title="View details" aria-label={`View ${record.id}`}><i className="fa-solid fa-eye"></i></button>
                    {record.status === 'Pending Approval' && (
                      <>
                        <button type="button" className="icon-btn approve" onClick={() => setConfirm({ kind: 'approve', record })} title="Approve" aria-label={`Approve ${record.id}`}><i className="fa-solid fa-check"></i></button>
                        <button type="button" className="icon-btn reject" onClick={() => setConfirm({ kind: 'reject', record })} title="Reject" aria-label={`Reject ${record.id}`}><i className="fa-solid fa-xmark"></i></button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detail && (
        <DetailModal
          record={detail}
          onClose={() => setDetailId(null)}
          onApprove={(r) => { setDetailId(null); setConfirm({ kind: 'approve', record: r }); }}
          onReject={(r) => { setDetailId(null); setConfirm({ kind: 'reject', record: r }); }}
          onRecord={(r) => act(applyLeaveRequest, `${r.id} was recorded in OrangeHRM.`, r.id)}
        />
      )}

      {confirm?.kind === 'approve' && (
        <ConfirmDialog title={`Approve ${confirm.record.id}?`} icon="fa-check" confirmLabel="Approve" confirmClass="btn-emerald" busy={busy} onConfirm={confirmAction} onCancel={() => setConfirm(null)}>
          <p>{confirm.record.fullName}: {summaryOf(confirm.record)}.</p>
          <p>{isLeave(confirm.record) ? 'The leave is booked in OrangeHRM and deducted from their balance there.' : 'The employee is punched out in OrangeHRM at the requested time.'}</p>
        </ConfirmDialog>
      )}
      {confirm?.kind === 'reject' && (
        <ConfirmDialog title={`Reject ${confirm.record.id}?`} icon="fa-xmark" confirmLabel="Reject" confirmClass="btn-rose" busy={busy} onConfirm={confirmAction} onCancel={() => setConfirm(null)}>
          <p>{confirm.record.fullName}: {summaryOf(confirm.record)}.</p>
          <p>{isLeave(confirm.record) ? 'Nothing is booked in OrangeHRM, and the days held for this request go back to their balance.' : 'Nothing is changed in OrangeHRM; their attendance for that day stays as it is.'}</p>
        </ConfirmDialog>
      )}
      {confirm?.kind === 'clear' && (
        <ConfirmDialog title="Clear decided requests?" icon="fa-broom" confirmLabel="Clear history" busy={busy} onConfirm={confirmAction} onCancel={() => setConfirm(null)}>
          <p>Removes approved and rejected requests from this list. What was recorded in OrangeHRM stays there (leave already booked, punches already corrected). Pending requests are kept.</p>
        </ConfirmDialog>
      )}
    </>
  );
}
