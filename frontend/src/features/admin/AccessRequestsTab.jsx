import { useCallback, useEffect, useState } from 'react';
import { approveAccessRequest, getAccessRequests, rejectAccessRequest } from '../../api/admin';
import ConfirmDialog from '../../components/common/ConfirmDialog';
import Modal from '../../components/common/Modal';
import { useToast } from '../../context/ToastContext';
import { when } from './format';

const DEFAULTS = { role: 'user', accessType: 'days', accessDays: 13, expiresAt: '' };
const BADGE = { pending: 'badge-pending', approved: 'badge-approved', rejected: 'badge-rejected' };
const LABEL = { pending: 'Waiting', approved: 'Approved', rejected: 'Rejected' };

/** Turn the approve form's choices into what the server takes. */
export function approvalPayload(choices) {
  const payload = { role: choices.role, accessType: choices.accessType, accessDays: null, expiresAt: null };
  if (choices.accessType === 'days') payload.accessDays = Math.max(1, parseInt(choices.accessDays, 10) || 13);
  if (choices.accessType === 'date') {
    if (!choices.expiresAt) throw new Error('Please select an expiration date.');
    payload.expiresAt = new Date(`${choices.expiresAt}T23:59:59`).toISOString();
  }
  return payload;
}

/** People who asked for access on the login page. Approving makes the user and e-mails the login; rejecting e-mails a short note. */
export default function AccessRequestsTab() {
  const { showToast } = useToast();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [approving, setApproving] = useState(null); // { request, ...choices }
  const [rejecting, setRejecting] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => getAccessRequests().then(setRows).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const approve = async () => {
    setBusy(true);
    try {
      const done = await approveAccessRequest(approving.request.id, approvalPayload(approving));
      showToast(`${done.username} was created and the login details were e-mailed to ${done.email}.`, 'success');
      setApproving(null);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setBusy(false);
      load();
    }
  };

  const reject = async () => {
    setBusy(true);
    try {
      const done = await rejectAccessRequest(rejecting.id);
      showToast(done.emailed ? `${done.email} was told the request was not approved.` : 'Rejected, but the e-mail could not be sent.', done.emailed ? 'success' : 'error');
      setRejecting(null);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setBusy(false);
      load();
    }
  };

  const choose = (field) => (event) => setApproving((a) => ({ ...a, [field]: event.target.value }));

  return (
    <>
      <p className="admin-note">People who asked for an account on the login page. Approving makes a user and e-mails a password to the address they gave. The full e-mail address is the user name, and the user must choose their own password at the first sign-in.</p>
      {error && <div className="login-error" role="alert">{error}</div>}
      {rows === null && !error && <p className="admin-note">Loading requests…</p>}
      {rows && (
        <div className="table-responsive">
          <table className="data-table compact">
            <thead><tr><th>Name</th><th>E-mail</th><th>Asked</th><th>Status</th><th>Decided</th><th>Actions</th></tr></thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>No requests yet.</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.fullName}</strong></td>
                  <td>{r.email}</td>
                  <td>{when(r.requestedAt)}</td>
                  <td><span className={`badge ${BADGE[r.status]}`}>{LABEL[r.status]}</span></td>
                  <td>{r.decidedAt ? <>{when(r.decidedAt)}<div className="admin-sub">by {r.decidedBy}{r.username ? ` · user ${r.username}` : ''}</div></> : '—'}</td>
                  <td className="admin-actions">
                    {r.status === 'pending' && (
                      <>
                        <button type="button" className="btn btn-primary" onClick={() => setApproving({ request: r, ...DEFAULTS })}><i className="fa-solid fa-check"></i> Approve</button>
                        <button type="button" className="btn btn-secondary" onClick={() => setRejecting(r)}><i className="fa-solid fa-xmark"></i> Reject</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {approving && (
        <Modal
          title={`Approve ${approving.request.fullName}`}
          icon="fa-user-check"
          onClose={() => !busy && setApproving(null)}
          footer={(
            <>
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setApproving(null)}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={approve}><i className="fa-solid fa-paper-plane"></i> {busy ? 'Approving…' : 'Approve and e-mail the login'}</button>
            </>
          )}
        >
          <p className="admin-note">A generated password is e-mailed to <b>{approving.request.email}</b>, which is also the user name. Change the access below if needed.</p>
          <div className="form-group">
            <label htmlFor="ar-role">Role</label>
            <select id="ar-role" className="form-control" value={approving.role} onChange={choose('role')}>
              <option value="user">Normal user</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div style={{ padding: '0.85rem 1rem', background: 'var(--bg-main)', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
            <label style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <i className="fa-solid fa-clock-rotate-left" style={{ color: 'var(--accent-primary)' }}></i> Login access
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', marginBottom: '0.65rem' }}>
              {[['days', 'Days from first login (default 13 days)'], ['date', 'Up to a fixed date'], ['lifetime', 'Lifetime access']].map(([value, text]) => (
                <label key={value} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.9rem' }}>
                  <input type="radio" name="ar-accessType" checked={approving.accessType === value} onChange={() => setApproving((a) => ({ ...a, accessType: value }))} />
                  <span>{text}</span>
                </label>
              ))}
            </div>
            {approving.accessType === 'days' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                {[13, 30, 90].map((d) => (
                  <button key={d} type="button" className={`btn btn-sm ${Number(approving.accessDays) === d ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setApproving((a) => ({ ...a, accessDays: d }))}>{d} days</button>
                ))}
                <span className="admin-sub">or</span>
                <input type="number" min="1" max="3650" aria-label="Days of access" className="form-control" style={{ width: '90px', height: '32px', padding: '0.3rem 0.5rem' }} value={approving.accessDays} onChange={choose('accessDays')} />
                <span className="admin-sub">days. The clock starts at the first sign-in.</span>
              </div>
            )}
            {approving.accessType === 'date' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                <span className="admin-sub" style={{ fontWeight: 600 }}>Access ends on:</span>
                <input type="date" aria-label="Access ends on" className="form-control" style={{ width: 'auto', height: '34px', padding: '0.3rem 0.6rem' }} min={new Date().toISOString().split('T')[0]} value={approving.expiresAt} onChange={choose('expiresAt')} />
              </div>
            )}
            {approving.accessType === 'lifetime' && (
              <p className="admin-note" style={{ margin: 0, color: 'var(--accent-emerald)' }}><i className="fa-solid fa-infinity"></i> No end date, until the user is disabled or changed.</p>
            )}
          </div>
        </Modal>
      )}

      {rejecting && (
        <ConfirmDialog title={`Reject ${rejecting.fullName}?`} icon="fa-xmark" confirmLabel="Reject" confirmClass="btn-rose" busy={busy} onConfirm={reject} onCancel={() => setRejecting(null)}>
          <p>No user is created. A short e-mail tells {rejecting.email} that the request was not approved.</p>
        </ConfirmDialog>
      )}
    </>
  );
}
