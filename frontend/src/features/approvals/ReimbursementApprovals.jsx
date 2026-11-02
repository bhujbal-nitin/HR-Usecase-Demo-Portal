import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { applyClaim, approveClaim, clearClaims, listClaims, rejectClaim } from '../../api/reimbursement';
import ConfirmDialog from '../../components/common/ConfirmDialog';
import Modal from '../../components/common/Modal';
import StatusBadge from '../../components/common/StatusBadge';
import { useToast } from '../../context/ToastContext';
import { useAgentDemo } from '../agentDemo/engine/AgentDemoContext';
import { formatDate, formatDateTime, formatInr, initials } from '../../utils/format';

const POLL_MS = 5000;
const STATS = [
  { status: 'Pending Approval', label: 'Pending', icon: 'fa-hourglass-half', color: 'amber' },
  { status: 'Approved', label: 'Approved', icon: 'fa-circle-check', color: 'emerald' },
  { status: 'Rejected', label: 'Rejected', icon: 'fa-circle-xmark', color: 'purple' },
];

const needsRecording = (claim) => claim.status === 'Approved' && !claim.applied;
const billCount = (claim) => `${claim.items.length} bill${claim.items.length === 1 ? '' : 's'}`;
/** One line saying what is being asked for. */
const summaryOf = (claim) => `${formatInr(claim.totalAmount)} (${billCount(claim)})`;
const sumOf = (bills) => bills.reduce((total, bill) => total + bill.amount, 0);

const PolicyBadge = ({ bill }) => (
  <span className={`badge ${bill.withinPolicy ? 'badge-approved' : 'badge-pending'}`} title={bill.withinPolicy ? 'Travel and Food are within the company policy' : 'Outside the company policy: you can still approve it'}>
    {bill.withinPolicy ? 'Within policy' : 'Outside policy'}
  </span>
);

/** The claim's bills. While the claim is pending, each has a tick box: the ticked bills are approved, the others rejected. */
function BillsTable({ claim, chosen, onToggle }) {
  const deciding = Boolean(onToggle);
  return (
    <table className="chat-widget-table">
      <thead>
        <tr>
          <th style={{ textAlign: 'left' }}>{deciding ? 'Approve' : 'Decision'}</th><th style={{ textAlign: 'left' }}>Type</th><th style={{ textAlign: 'left' }}>Date</th>
          <th style={{ textAlign: 'left' }}>Vendor</th><th style={{ textAlign: 'right' }}>Amount</th>
        </tr>
      </thead>
      <tbody>
        {claim.items.map((bill, index) => (
          <tr key={`${bill.fileName}-${index}`} title={bill.fileName}>
            <td>
              {deciding
                ? <input type="checkbox" checked={chosen.has(index)} onChange={() => onToggle(index)} aria-label={`Approve ${bill.expenseType} bill from ${bill.vendor}`} />
                : <span className={`badge ${bill.approved ? 'badge-approved' : 'badge-pending'}`}>{bill.approved === null ? 'Waiting' : bill.approved ? 'Approved' : 'Rejected'}</span>}
            </td>
            <td><strong>{bill.expenseType}</strong> <PolicyBadge bill={bill} /></td>
            <td>{bill.date ? formatDate(bill.date) : '—'}</td>
            <td>{bill.vendor}</td>
            <td style={{ textAlign: 'right' }}>{formatInr(bill.amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DetailModal({ claim, onClose, onApprove, onReject, onRecord }) {
  const pending = claim.status === 'Pending Approval';
  // Bills within the policy start ticked; the manager ticks or unticks any of them.
  const [chosen, setChosen] = useState(() => new Set(claim.items.flatMap((bill, index) => (bill.withinPolicy ? [index] : []))));
  const toggle = (index) => setChosen((current) => {
    const next = new Set(current);
    if (!next.delete(index)) next.add(index);
    return next;
  });
  const selected = claim.items.filter((_, index) => chosen.has(index));
  return (
    <Modal
      title={`Expense claim · ${claim.fullName}`}
      icon="fa-file-invoice-dollar"
      onClose={onClose}
      maxWidth={760}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
          {needsRecording(claim) && <button type="button" className="btn btn-primary" onClick={() => onRecord(claim)}><i className="fa-solid fa-cloud-arrow-up"></i> Record in OrangeHRM</button>}
          {pending && (
            <>
              <button type="button" className="btn btn-rose" onClick={() => onReject(claim)}><i className="fa-solid fa-xmark"></i> Reject all</button>
              <button type="button" className="btn btn-emerald" disabled={chosen.size === 0} onClick={() => onApprove(claim, [...chosen].sort((a, b) => a - b))}>
                <i className="fa-solid fa-check"></i> Approve selected ({chosen.size})
              </button>
            </>
          )}
        </>
      }
    >
      <div className="detail-top">
        <span style={{ color: 'var(--text-muted)' }}>{claim.id} · submitted {formatDateTime(claim.submittedAt)}</span>
        <StatusBadge status={claim.status} />
      </div>
      <section className="detail-section">
        <h4><i className="fa-solid fa-user text-accent"></i> Employee</h4>
        <table className="chat-widget-table"><tbody>
          {[['Employee ID', claim.employeeId], ['Work e-mail', claim.workEmail], ['Role', `${claim.jobTitle} · ${claim.department}`], ['Reporting manager', claim.manager]]
            .map(([label, value]) => <tr key={label}><td><strong>{label}</strong></td><td>{value}</td></tr>)}
        </tbody></table>
      </section>
      <section className="detail-section">
        <h4><i className="fa-solid fa-receipt text-accent"></i> Bills</h4>
        {pending && <p style={{ color: 'var(--text-muted)' }}>Tick the bills you approve; the others are rejected. Travel and Food are within the company policy, but you can approve any bill.</p>}
        <BillsTable claim={claim} chosen={chosen} onToggle={pending ? toggle : undefined} />
        <p>
          <strong>Total claimed: {formatInr(claim.totalAmount)}</strong>
          {pending ? ` · Selected: ${formatInr(sumOf(selected))}` : claim.approvedTotal !== null && ` · Approved: ${formatInr(claim.approvedTotal)}`}
        </p>
      </section>
      {claim.status === 'Approved' && (
        <section className="detail-section">
          <h4><i className="fa-solid fa-database text-accent"></i> OrangeHRM</h4>
          {claim.applied
            ? <p>Recorded {formatDateTime(claim.appliedAt)}. {claim.orangeHrmUrl && <a href={claim.orangeHrmUrl} target="_blank" rel="noreferrer">Open the claim in OrangeHRM</a>}</p>
            : <p style={{ color: 'var(--text-muted)' }}>Approved, but not recorded in OrangeHRM yet.</p>}
        </section>
      )}
      {claim.decidedAt && <p style={{ color: 'var(--text-muted)' }}>Decided {formatDateTime(claim.decidedAt)}.</p>}
    </Modal>
  );
}

/** The manager's side of reimbursement: review expense claims bill by bill, then approve the chosen bills or reject the claim. */
export default function ReimbursementApprovals() {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const demoRunning = useAgentDemo('reimbursement_benefits').state.busy; // a Reimbursement demo is waiting for this decision
  const [claims, setClaims] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState(null);
  const [search, setSearch] = useState('');
  const [detailId, setDetailId] = useState(null);
  const [confirm, setConfirm] = useState(null); // { kind: 'approve' | 'reject' | 'clear', claim?, bills? }
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setClaims(await listClaims());
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

  const counts = useMemo(() => Object.fromEntries(STATS.map(({ status }) => [status, claims.filter((c) => c.status === status).length])), [claims]);
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return claims.filter((c) => (!filter || c.status === filter) && (!query || [c.fullName, c.employeeId, c.id, c.department, summaryOf(c)].join(' ').toLowerCase().includes(query)));
  }, [claims, filter, search]);
  const detail = claims.find((c) => c.id === detailId);

  const act = async (action, message, ...args) => {
    setBusy(true);
    try {
      await action(...args);
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
    const { kind, claim, bills } = confirm;
    if (kind === 'approve') {
      // A demo waiting for this decision records it in OrangeHRM itself and carries on in the Agent Demo screen; otherwise record it here.
      if (await act(approveClaim, `${claim.id}: ${bills.length} bill${bills.length === 1 ? '' : 's'} approved.`, claim.id, bills)) {
        if (demoRunning) navigate('/agent-demo/reimbursement_benefits');
        else await act(applyClaim, `${claim.id} was recorded in OrangeHRM.`, claim.id);
      }
    } else if (kind === 'reject') {
      if (await act(rejectClaim, `${claim.id} was rejected.`, claim.id) && demoRunning) navigate('/agent-demo/reimbursement_benefits');
    } else {
      await act(clearClaims, 'Decided claims cleared.');
    }
    setConfirm(null);
  };

  return (
    <>
      <div className="dashboard-header">
        <div>
          <h2>Reimbursement</h2>
          <p style={{ color: 'var(--text-muted)' }}>Review expense claims bill by bill: tick the bills you approve, the others are rejected. Approved bills are recorded as a claim in OrangeHRM.</p>
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
          <input type="text" className="form-control" placeholder="Search by name, ID or claim…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search claims" />
        </div>
        <div className="filter-group">
          {filter && <button type="button" className="btn btn-secondary" onClick={() => setFilter(null)}><i className="fa-solid fa-filter-circle-xmark"></i> Clear filter</button>}
          <button type="button" className="btn btn-secondary" onClick={() => setConfirm({ kind: 'clear' })} disabled={!claims.some((c) => c.status !== 'Pending Approval')}><i className="fa-solid fa-broom"></i> Clear history</button>
        </div>
      </div>

      {error && <p className="inline-warning"><i className="fa-solid fa-triangle-exclamation"></i> {error}</p>}

      <div className="table-responsive">
        <table className="data-table approvals-table">
          <thead><tr><th>Employee</th><th>Claim</th><th>Claimed</th><th>Approved</th><th>Manager</th><th>Status</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
          <tbody>
            {visible.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2.5rem' }}>{loading ? 'Loading…' : claims.length === 0 ? 'No expense claims yet.' : 'No claims match the current filter.'}</td></tr>
            ) : visible.map((claim) => (
              <tr key={claim.id}>
                <td>
                  <div className="candidate-profile">
                    <div className="avatar">{initials(claim.fullName)}</div>
                    <div className="candidate-info"><div className="candidate-name">{claim.fullName}</div><div className="candidate-email">{claim.employeeId}</div></div>
                  </div>
                </td>
                <td className="wrap">{billCount(claim)}<div className="candidate-email">{claim.id}</div></td>
                <td>{formatInr(claim.totalAmount)}</td>
                <td>{claim.approvedTotal === null ? '—' : formatInr(claim.approvedTotal)}</td>
                <td className="wrap">{claim.manager}</td>
                <td><StatusBadge status={claim.status} />{needsRecording(claim) && <div className="candidate-email">Not in OrangeHRM yet</div>}</td>
                <td>
                  <div className="action-btn-group" style={{ justifyContent: 'flex-end' }}>
                    <button type="button" className="icon-btn" onClick={() => setDetailId(claim.id)} title={claim.status === 'Pending Approval' ? 'Review the bills' : 'View details'} aria-label={`View ${claim.id}`}><i className="fa-solid fa-eye"></i></button>
                    {claim.status === 'Pending Approval' && (
                      <>
                        <button type="button" className="icon-btn approve" onClick={() => setDetailId(claim.id)} title="Choose the bills to approve" aria-label={`Approve ${claim.id}`}><i className="fa-solid fa-check"></i></button>
                        <button type="button" className="icon-btn reject" onClick={() => setConfirm({ kind: 'reject', claim })} title="Reject all" aria-label={`Reject ${claim.id}`}><i className="fa-solid fa-xmark"></i></button>
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
          key={detail.id}
          claim={detail}
          onClose={() => setDetailId(null)}
          onApprove={(c, bills) => { setDetailId(null); setConfirm({ kind: 'approve', claim: c, bills }); }}
          onReject={(c) => { setDetailId(null); setConfirm({ kind: 'reject', claim: c }); }}
          onRecord={(c) => act(applyClaim, `${c.id} was recorded in OrangeHRM.`, c.id)}
        />
      )}

      {confirm?.kind === 'approve' && (
        <ConfirmDialog title={`Approve ${confirm.bills.length} of ${confirm.claim.items.length} bills in ${confirm.claim.id}?`} icon="fa-check" confirmLabel="Approve" confirmClass="btn-emerald" busy={busy} onConfirm={confirmAction} onCancel={() => setConfirm(null)}>
          <p>{confirm.claim.fullName}: {formatInr(sumOf(confirm.claim.items.filter((_, i) => confirm.bills.includes(i))))} of {formatInr(confirm.claim.totalAmount)} is approved; the other bills are rejected.</p>
          <p>A claim with the approved bills as expenses is created and submitted in OrangeHRM.</p>
        </ConfirmDialog>
      )}
      {confirm?.kind === 'reject' && (
        <ConfirmDialog title={`Reject ${confirm.claim.id}?`} icon="fa-xmark" confirmLabel="Reject all" confirmClass="btn-rose" busy={busy} onConfirm={confirmAction} onCancel={() => setConfirm(null)}>
          <p>{confirm.claim.fullName}: {summaryOf(confirm.claim)}. Every bill in the claim is rejected.</p>
          <p>Nothing is recorded in OrangeHRM.</p>
        </ConfirmDialog>
      )}
      {confirm?.kind === 'clear' && (
        <ConfirmDialog title="Clear decided claims?" icon="fa-broom" confirmLabel="Clear history" busy={busy} onConfirm={confirmAction} onCancel={() => setConfirm(null)}>
          <p>Removes approved and rejected claims from this list. What was recorded in OrangeHRM stays there. Pending claims are kept.</p>
        </ConfirmDialog>
      )}
    </>
  );
}
