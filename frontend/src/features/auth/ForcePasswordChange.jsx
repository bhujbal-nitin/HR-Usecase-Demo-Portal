import { useState } from 'react';
import { changeOwnPassword } from '../../api/auth';
import { useAuth } from '../../context/AuthContext';
import { MIN_PASSWORD_LENGTH, passwordProblem } from '../../components/layout/ChangePasswordDialog';

/** Shown instead of the portal after the first sign-in with a password that was e-mailed: the user has to choose their own. */
export default function ForcePasswordChange() {
  const { fullName, username, passwordChanged, logout } = useAuth();
  const [values, setValues] = useState({ current: '', next: '', again: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (field) => (event) => setValues((v) => ({ ...v, [field]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    const problem = passwordProblem(values);
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError('');
    try {
      await changeOwnPassword(values.current, values.next);
      passwordChanged();
    } catch (failure) {
      setError(failure.message);
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <img className="login-logo" src={`${import.meta.env.BASE_URL}ae-icon.png`} alt="AutomationEdge" />
        <h1>Choose your password</h1>
        <p className="login-sub">Welcome{fullName ? `, ${fullName}` : ''}. For your security, replace the password that was e-mailed to {username} with your own before you continue.</p>
        <div className="form-group"><label htmlFor="fp-current">Password from the e-mail</label>
          <input id="fp-current" className="form-control" type="password" autoComplete="current-password" autoFocus value={values.current} onChange={set('current')} /></div>
        <div className="form-group"><label htmlFor="fp-new">New password</label>
          <input id="fp-new" className="form-control" type="password" autoComplete="new-password" value={values.next} onChange={set('next')} placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`} /></div>
        <div className="form-group"><label htmlFor="fp-again">New password again</label>
          <input id="fp-again" className="form-control" type="password" autoComplete="new-password" value={values.again} onChange={set('again')} /></div>
        {error && <div className="login-error" role="alert"><i className="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> {error}</div>}
        <button type="submit" className="btn btn-primary login-submit" disabled={busy}>{busy ? 'Saving…' : 'Save and continue'}</button>
        <p className="login-switch"><button type="button" className="login-link" onClick={logout}>Sign out</button></p>
      </form>
    </div>
  );
}
