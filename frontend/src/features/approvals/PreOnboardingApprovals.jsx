import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { approveHr, clearCandidates, documentUrl, listCandidates, rejectHr, runBackgroundCheck } from '../../api/preOnboarding';
import ConfirmDialog from '../../components/common/ConfirmDialog';
import Modal from '../../components/common/Modal';
import StatusBadge from '../../components/common/StatusBadge';
import { useToast } from '../../context/ToastContext';
import { useAgentDemo } from '../agentDemo/engine/AgentDemoContext';
import { DOCUMENTS } from '../agentDemo/lib/preOnboarding';
import { formatDate, formatDateTime, formatInr, initials } from '../../utils/format';

const POLL_MS = 5000;
const HR = 'Awaiting HR approval';
const STATS = [
  { status: HR, label: 'Waiting for HR approval', icon: 'fa-stamp', color: 'cyan' },
  { status: 'Approved', label: 'Approved, joining being confirmed', icon: 'fa-calendar-check', color: 'amber' },
  { status: 'Completed', label: 'Pre-onboarding completed', icon: 'fa-circle-check', color: 'emerald' },
  { status: 'Rejected', label: 'Rejected', icon: 'fa-circle-xmark', color: 'purple' },
];
const waiting = (candidate) => candidate.status === HR;
/** All seven documents passed the name check; the background verification only needs to be marked done. */
const bgvDue = (candidate) => candidate.status === 'Collecting documents' && Boolean(candidate.verification?.allMatch);
const finished = (candidate) => ['Rejected', 'Completed', 'Offer sent'].includes(candidate.status);

/** What is going on with the candidate, as a short sentence. */
const nextStep = (candidate) => {
  switch (candidate.status) {
    case 'Offer released': return 'Waiting for the candidate to accept the offer';
    case 'Offer accepted': return 'Candidate is filling in personal information';
    case 'Collecting documents':
      if (bgvDue(candidate)) return 'Background verification: mark it done when it is complete';
      return `Candidate is sending documents (${Object.keys(candidate.documents ?? {}).length} of ${DOCUMENTS.length})`;
    case HR: return 'Review and approve the pre-onboarding';
    case 'Approved': return 'Joining instructions being sent';
    case 'Joining confirmed': return 'Completing the pre-onboarding';
    default: return null;
  }
};

function DetailModal({ candidate, onClose, onApprove, onReject }) {
  const pending = waiting(candidate);
  const rows = candidate.verification?.rows ?? [];
  const personal = candidate.personal;
  return (
    <Modal
      title={`Pre-onboarding · ${candidate.fullName}`}
      icon="fa-file-circle-check"
      onClose={onClose}
      maxWidth={780}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
          {pending && (
            <>
              <button type="button" className="btn btn-rose" onClick={() => onReject(candidate)}><i className="fa-solid fa-xmark"></i> Reject</button>
              <button type="button" className="btn btn-emerald" onClick={() => onApprove(candidate)}><i className="fa-solid fa-check"></i> Approve</button>
            </>
          )}
        </>
      }
    >
      <div className="detail-top">
        <span style={{ color: 'var(--text-muted)' }}>{candidate.id} · started {formatDateTime(candidate.createdAt)}</span>
        <StatusBadge status={candidate.status} />
      </div>
      <section className="detail-section">
        <h4><i className="fa-solid fa-user text-accent"></i> Candidate</h4>
        <table className="chat-widget-table"><tbody>
          {[
            ['Name', candidate.fullName], ['E-mail', candidate.email], ['Phone', candidate.phone], ['Position', `${candidate.designation} · ${candidate.department}`],
            ['Reporting manager', candidate.manager], ['Location', candidate.location], ['Joining date', formatDate(candidate.joiningDate)], ['Yearly pay (CTC)', formatInr(candidate.annualCtc)],
            ['Offer', candidate.offer ? `${candidate.offer.letterNo}${candidate.offer.sentTo ? ` · e-mailed to ${candidate.offer.sentTo}` : ' · not sent yet'}` : '—'],
            ['Accepted', candidate.acceptance ? formatDateTime(candidate.acceptance.acceptedAt) : 'Not yet'],
            ['ServiceNow request', candidate.serviceNow?.reqNumber ?? '—'],
          ].map(([label, value]) => <tr key={label}><td><strong>{label}</strong></td><td>{value}</td></tr>)}
        </tbody></table>
      </section>
      {personal && (
        <section className="detail-section">
          <h4><i className="fa-solid fa-address-card text-accent"></i> Personal information</h4>
          <table className="chat-widget-table"><tbody>
            {[
              ['Date of birth', formatDate(personal.dateOfBirth)], ['Gender', personal.gender], ['Marital status', personal.maritalStatus],
              ['Current address', personal.currentAddress], ['Permanent address', personal.permanentAddress],
              ['Emergency contact', `${personal.emergencyName} (${personal.emergencyRelation}) · ${personal.emergencyPhone}`],
            ].map(([label, value]) => <tr key={label}><td><strong>{label}</strong></td><td>{value}</td></tr>)}
          </tbody></table>
        </section>
      )}
      <section className="detail-section">
        <h4><i className="fa-solid fa-folder-open text-accent"></i> Documents and name check</h4>
        {pending && <p style={{ color: 'var(--text-muted)' }}>Open each document to look at it, then approve if everything is in order.</p>}
        <table className="chat-widget-table">
          <thead><tr><th style={{ textAlign: 'left' }}>Document</th><th style={{ textAlign: 'left' }}>Name read from it</th><th style={{ textAlign: 'left' }}>Result</th><th style={{ textAlign: 'left' }}>File</th></tr></thead>
          <tbody>
            {DOCUMENTS.map((doc) => {
              const stored = candidate.documents?.[doc.key];
              const row = rows.find((item) => item.key === doc.key);
              return (
                <tr key={doc.key}>
                  <td><strong>{doc.title}</strong></td>
                  <td>{stored ? (stored.check.nameOnDocument ?? '—') : '—'}</td>
                  <td>
                    {!stored ? <span className="badge badge-draft">Not sent</span>
                      : <span className={`badge ${(row ? row.matches : stored.check.passed) ? 'badge-approved' : 'badge-rejected'}`}>{row ? (row.matches ? 'Matches' : 'Does not match') : stored.check.passed ? 'Accepted' : 'Not accepted'}</span>}
                  </td>
                  <td>{stored ? <a href={documentUrl(candidate.id, doc.key)} target="_blank" rel="noreferrer" title={stored.fileName}>Open</a> : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      {candidate.bgv && (
        <section className="detail-section">
          <h4><i className="fa-solid fa-user-shield text-accent"></i> Background verification (dummy)</h4>
          <table className="chat-widget-table"><tbody>
            {candidate.bgv.checks.map((check) => <tr key={check.name}><td><strong>{check.name}</strong></td><td><span className="badge badge-approved">{check.result}</span> {check.note}</td></tr>)}
          </tbody></table>
        </section>
      )}
      <section className="detail-section">
        <h4><i className="fa-solid fa-stamp text-accent"></i> HR decision</h4>
        <table className="chat-widget-table"><tbody>
          <tr><td><strong>HR approval</strong></td><td>{candidate.hr.status}{candidate.hr.approver ? ` · ${candidate.hr.approver}` : ''}{candidate.hr.decidedAt ? ` · ${formatDateTime(candidate.hr.decidedAt)}` : ''}</td></tr>
          {candidate.joining && <tr><td><strong>Joining instructions</strong></td><td>{candidate.joining.sentTo ? `e-mailed to ${candidate.joining.sentTo}` : 'not sent yet'}</td></tr>}
        </tbody></table>
      </section>
    </Modal>
  );
}

/** HR's side of pre-onboarding: review a candidate's details, documents and background check, then approve or reject. */
export default function PreOnboardingApprovals() {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const demoRunning = useAgentDemo('pre_onboarding').state.busy; // a Pre-Onboarding demo is waiting for this decision
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState(null);
  const [search, setSearch] = useState('');
  const [detailId, setDetailId] = useState(null);
  const [confirm, setConfirm] = useState(null); // { kind: 'approve' | 'reject' | 'clear', candidate? }
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setCandidates(await listCandidates());
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

  const counts = useMemo(() => Object.fromEntries(STATS.map(({ status }) => [status, candidates.filter((c) => c.status === status).length])), [candidates]);
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return candidates.filter((c) => (!filter || c.status === filter) && (!query || [c.fullName, c.id, c.email, c.designation, c.department].join(' ').toLowerCase().includes(query)));
  }, [candidates, filter, search]);
  const detail = candidates.find((c) => c.id === detailId);

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
    const { kind, candidate } = confirm;
    if (kind === 'clear') {
      await act(clearCandidates, 'Finished candidates cleared.');
    } else if (kind === 'bgv') {
      if (await act(runBackgroundCheck, `${candidate.fullName}: background verification done.`, candidate.id) && demoRunning) navigate('/agent-demo/pre_onboarding');
    } else {
      const approve = kind === 'approve';
      const action = approve ? approveHr : rejectHr;
      const message = approve ? `${candidate.fullName}: pre-onboarding approved.` : `${candidate.fullName}: pre-onboarding rejected.`;
      // A demo waiting for this decision carries on in the Agent Demo screen.
      if (await act(action, message, candidate.id) && demoRunning) navigate('/agent-demo/pre_onboarding');
    }
    setConfirm(null);
  };

  return (
    <>
      <div className="dashboard-header">
        <div>
          <h2>Pre-Onboarding</h2>
          <p style={{ color: 'var(--text-muted)' }}>Candidates in pre-onboarding. Once a candidate has accepted the offer, filled in their personal information, sent their seven documents and passed the background verification, HR approves here. The joining instructions are made and e-mailed after HR approves.</p>
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
          <input type="text" className="form-control" placeholder="Search by name, ID or position…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search candidates" />
        </div>
        <div className="filter-group">
          {filter && <button type="button" className="btn btn-secondary" onClick={() => setFilter(null)}><i className="fa-solid fa-filter-circle-xmark"></i> Clear filter</button>}
          <button type="button" className="btn btn-secondary" onClick={() => setConfirm({ kind: 'clear' })} disabled={!candidates.some(finished)}><i className="fa-solid fa-broom"></i> Clear history</button>
        </div>
      </div>

      {error && <p className="inline-warning"><i className="fa-solid fa-triangle-exclamation"></i> {error}</p>}

      <div className="table-responsive">
        <table className="data-table approvals-table">
          <thead><tr><th>Candidate</th><th>Position</th><th>Documents</th><th>Where it stands</th><th>Status</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
          <tbody>
            {visible.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2.5rem' }}>{loading ? 'Loading…' : candidates.length === 0 ? 'No pre-onboarding candidates yet.' : 'No candidates match the current filter.'}</td></tr>
            ) : visible.map((candidate) => (
              <tr key={candidate.id}>
                <td>
                  <div className="candidate-profile">
                    <div className="avatar">{initials(candidate.fullName)}</div>
                    <div className="candidate-info"><div className="candidate-name">{candidate.fullName}</div><div className="candidate-email">{candidate.id}</div></div>
                  </div>
                </td>
                <td className="wrap">{candidate.designation}<div className="candidate-email">{candidate.department} · joins {formatDate(candidate.joiningDate)}</div></td>
                <td>{Object.keys(candidate.documents ?? {}).length} of {DOCUMENTS.length}</td>
                <td className="wrap">{nextStep(candidate) ?? '—'}</td>
                <td><StatusBadge status={candidate.status} /></td>
                <td>
                  <div className="action-btn-group" style={{ justifyContent: 'flex-end' }}>
                    <button type="button" className="icon-btn" onClick={() => setDetailId(candidate.id)} title={waiting(candidate) ? 'Review and decide' : 'View details'} aria-label={`View ${candidate.id}`}><i className="fa-solid fa-eye"></i></button>
                    {bgvDue(candidate) && (
                      <button type="button" className="icon-btn approve" onClick={() => setConfirm({ kind: 'bgv', candidate })} title="Mark the background verification done" aria-label={`Mark background verification done for ${candidate.id}`}><i className="fa-solid fa-user-shield"></i></button>
                    )}
                    {waiting(candidate) && (
                      <>
                        <button type="button" className="icon-btn approve" onClick={() => setConfirm({ kind: 'approve', candidate })} title="Approve" aria-label={`Approve ${candidate.id}`}><i className="fa-solid fa-check"></i></button>
                        <button type="button" className="icon-btn reject" onClick={() => setConfirm({ kind: 'reject', candidate })} title="Reject" aria-label={`Reject ${candidate.id}`}><i className="fa-solid fa-xmark"></i></button>
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
          candidate={detail}
          onClose={() => setDetailId(null)}
          onApprove={(c) => { setDetailId(null); setConfirm({ kind: 'approve', candidate: c }); }}
          onReject={(c) => { setDetailId(null); setConfirm({ kind: 'reject', candidate: c }); }}
        />
      )}

      {confirm?.kind === 'bgv' && (
        <ConfirmDialog
          title={`Mark the background verification of ${confirm.candidate.fullName} as done?`}
          icon="fa-user-shield" confirmLabel="Mark as done" confirmClass="btn-emerald" busy={busy} onConfirm={confirmAction} onCancel={() => setConfirm(null)}
        >
          <p>The identity, education, employment and address checks are recorded as clear (this is a dummy check), and the candidate then waits for HR’s approval.</p>
        </ConfirmDialog>
      )}
      {confirm?.kind === 'approve' && (
        <ConfirmDialog
          title={`Approve the pre-onboarding of ${confirm.candidate.fullName}?`}
          icon="fa-check" confirmLabel="Approve" confirmClass="btn-emerald" busy={busy} onConfirm={confirmAction} onCancel={() => setConfirm(null)}
        >
          <p>The joining instructions are made and e-mailed to {confirm.candidate.email}, and the candidate moves on to onboarding.</p>
        </ConfirmDialog>
      )}
      {confirm?.kind === 'reject' && (
        <ConfirmDialog title={`Reject ${confirm.candidate.fullName}?`} icon="fa-xmark" confirmLabel="Reject" confirmClass="btn-rose" busy={busy} onConfirm={confirmAction} onCancel={() => setConfirm(null)}>
          <p>The pre-onboarding stops here: no joining instructions are sent, and the ServiceNow request is marked rejected.</p>
        </ConfirmDialog>
      )}
      {confirm?.kind === 'clear' && (
        <ConfirmDialog title="Clear finished candidates?" icon="fa-broom" confirmLabel="Clear history" busy={busy} onConfirm={confirmAction} onCancel={() => setConfirm(null)}>
          <p>Removes rejected and completed candidates, with their stored documents. Candidates still waiting are kept.</p>
        </ConfirmDialog>
      )}
    </>
  );
}
