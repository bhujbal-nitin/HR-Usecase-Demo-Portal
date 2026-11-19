import { useState } from 'react';
import { signIn } from '../api';
import { Wordmark } from './HrmsShell';

export const DEMO_LOGIN = { username: 'Admin', password: 'admin123' };

export default function HrmsLogin({ onSignedIn }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (!username.trim() || !password) {
      setError('Please enter your username and password.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await signIn(username.trim(), password);
      onSignedIn({ username: res?.data?.username ?? username.trim() });
    } catch (e) {
      setError(e.status === 401 ? 'Invalid credentials. Please check your username and password.' : e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="hrms-login-page">
      <div className="hrms-login-card">
        <div className="hrms-login-brand"><Wordmark dark /></div>
        <h1>Login</h1>
        <div className="hrms-login-hint" aria-label="Demo login details">
          <p>Username : <b>{DEMO_LOGIN.username}</b></p>
          <p>Password : <b>{DEMO_LOGIN.password}</b></p>
        </div>
        <form onSubmit={submit} noValidate>
          <div className="hrms-field">
            <label htmlFor="hrms-username">Username</label>
            <input id="hrms-username" name="username" autoComplete="username" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div className="hrms-field">
            <label htmlFor="hrms-password">Password</label>
            <input id="hrms-password" name="password" type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && <div className="hrms-notice error" role="alert">{error}</div>}
          <button type="submit" className="hrms-btn primary hrms-login-btn" disabled={busy}>{busy ? 'Signing in...' : 'Login'}</button>
        </form>
        <p className="hrms-login-foot">Demo HR management system.</p>
      </div>
    </div>
  );
}
