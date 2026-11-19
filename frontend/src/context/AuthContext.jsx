import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getSession, signIn, signOut } from '../api/auth';
import { SESSION_ENDED_EVENT } from '../api/client';

const AuthContext = createContext(null);

/** Who is signed in. `status` is 'loading' until the server has said whether login is on, 'error' if it could not be asked. */
export function AuthProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', authEnabled: false, authenticated: false, username: null, fullName: null, error: '' });

  const refresh = useCallback(async () => {
    try {
      setState({ status: 'ready', error: '', ...(await getSession()) });
    } catch (error) {
      setState((s) => ({ ...s, status: 'error', error: error.message }));
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Any call refused with 401 means the session ended (expired, or the backend was restarted with a new key).
  useEffect(() => {
    const ended = () => setState((s) => (s.authEnabled ? { ...s, authenticated: false } : s));
    window.addEventListener(SESSION_ENDED_EVENT, ended);
    return () => window.removeEventListener(SESSION_ENDED_EVENT, ended);
  }, []);

  const login = useCallback(async (username, password) => {
    const session = await signIn(username, password);
    setState((s) => ({ ...s, ...session }));
  }, []);

  const logout = useCallback(async () => {
    try { await signOut(); } finally { setState((s) => ({ ...s, authenticated: false, username: null, fullName: null })); }
  }, []);

  const passwordChanged = useCallback(() => setState((s) => ({ ...s, mustChangePassword: false })), []);

  const value = useMemo(() => ({ ...state, login, logout, passwordChanged, retry: refresh }), [state, login, logout, passwordChanged, refresh]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
