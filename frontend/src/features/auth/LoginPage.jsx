import { useState } from 'react';
import { requestAccess } from '../../api/auth';
import { useAuth } from '../../context/AuthContext';

/** The sign-in form, and (behind the "Request access" link) a form to ask for an account. */
export default function LoginPage() {
  const { login } = useAuth();
  const [asking, setAsking] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await login(username, password);
    } catch (failure) {
      setError(failure.message);
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  const ask = async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await requestAccess(fullName.trim(), email.trim());
      setSent(true);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  };

  const switchTo = (requesting) => { setAsking(requesting); setError(''); setSent(false); };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={asking ? ask : submit}>
        <img className="login-logo" src={`${import.meta.env.BASE_URL}ae-icon.png`} alt="AutomationEdge" />
        <h1>HR AI Agents</h1>
        <p className="login-sub">{asking ? 'Request access to the demo portal' : 'Sign in to open the demo portal'}</p>

        {asking && sent && (
          <div className="login-note" role="status">
            <i className="fa-solid fa-circle-check" aria-hidden="true"></i> Your request was sent. When an admin approves it, your user name and password are e-mailed to <b>{email.trim()}</b>.
          </div>
        )}

        {asking && !sent && (
          <>
            <div className="form-group">
              <label htmlFor="req-name">Full name</label>
              <input id="req-name" className="form-control" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" autoFocus required />
            </div>
            <div className="form-group">
              <label htmlFor="req-email">E-mail address</label>
              <input id="req-email" className="form-control" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
            </div>
          </>
        )}

        {!asking && (
          <>
            <div className="form-group">
              <label htmlFor="login-user">User name</label>
              <input id="login-user" className="form-control" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required />
            </div>
            <div className="form-group">
              <label htmlFor="login-pass">Password</label>
              <input id="login-pass" className="form-control" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
            </div>
          </>
        )}

        {error && <div className="login-error" role="alert"><i className="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> {error}</div>}

        {!(asking && sent) && (
          asking ? (
            <button type="submit" className="btn btn-primary login-submit" disabled={busy || !fullName.trim() || !email.trim()}>
              {busy ? 'Sending…' : 'Send request'}
            </button>
          ) : (
            <button type="submit" className="btn btn-primary login-submit" disabled={busy || !username || !password}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          )
        )}

        <p className="login-switch">
          {asking ? 'Already have a login?' : 'Need an account?'}{' '}
          <button type="button" className="login-link" onClick={() => switchTo(!asking)}>{asking ? 'Sign in' : 'Request access'}</button>
        </p>
      </form>
    </div>
  );
}
