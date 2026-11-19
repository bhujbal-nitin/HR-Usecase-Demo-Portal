import { useAuth } from '../../context/AuthContext';
import ForcePasswordChange from './ForcePasswordChange';
import LoginPage from './LoginPage';

/** Shows the portal only to a signed-in user (or to everyone when the backend has login switched off). */
export default function AuthGate({ children }) {
  const { status, error, authEnabled, authenticated, mustChangePassword, retry } = useAuth();

  if (status === 'loading') return <div className="login-page"><p className="login-sub">Loading…</p></div>;
  if (status === 'error') {
    return (
      <div className="login-page">
        <div className="login-card">
          <h1>HR AI Agents</h1>
          <div className="login-error" role="alert">{error}</div>
          <button type="button" className="btn btn-primary login-submit" onClick={retry}>Try again</button>
        </div>
      </div>
    );
  }
  if (authEnabled && !authenticated) return <LoginPage />;
  if (authEnabled && mustChangePassword) return <ForcePasswordChange />;
  return children;
}
