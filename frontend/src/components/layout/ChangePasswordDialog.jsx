import { useState } from 'react';
import { changeOwnPassword } from '../../api/auth';
import { useToast } from '../../context/ToastContext';
import Modal from '../common/Modal';

export const MIN_PASSWORD_LENGTH = 8;

/** The first thing wrong with the three boxes, or '' when the password can be changed. */
export function passwordProblem({ current, next, again }) {
  if (!current) return 'Enter your current password.';
  if (next.length < MIN_PASSWORD_LENGTH) return `The new password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (next === current) return 'The new password must be different from the current one.';
  if (next !== again) return 'The two new passwords do not match.';
  return '';
}

/** A signed-in user changes their own password. */
export default function ChangePasswordDialog({ onClose }) {
  const { showToast } = useToast();
  const [values, setValues] = useState({ current: '', next: '', again: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (field) => (event) => setValues((v) => ({ ...v, [field]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    const problem = passwordProblem(values);
    if (problem) { setError(problem); return; }
    setBusy(true);
    try {
      await changeOwnPassword(values.current, values.next);
      showToast('Your password was changed.', 'success');
      onClose();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <Modal title="Change password" icon="fa-key" onClose={onClose} maxWidth={440}>
      <form onSubmit={submit} style={{ display: 'grid', gap: '0.9rem', padding: '1rem 1.25rem 1.25rem' }}>
        <div className="form-group"><label htmlFor="cp-current">Current password</label>
          <input id="cp-current" className="form-control" type="password" autoComplete="current-password" autoFocus value={values.current} onChange={set('current')} /></div>
        <div className="form-group"><label htmlFor="cp-new">New password</label>
          <input id="cp-new" className="form-control" type="password" autoComplete="new-password" value={values.next} onChange={set('next')} placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`} /></div>
        <div className="form-group"><label htmlFor="cp-again">New password again</label>
          <input id="cp-again" className="form-control" type="password" autoComplete="new-password" value={values.again} onChange={set('again')} /></div>
        {error && <div className="login-error" role="alert">{error}</div>}
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button>
        </div>
      </form>
    </Modal>
  );
}
