import { api } from './client';

/** { authEnabled, authenticated, username, fullName, role } for whoever holds the current session cookie. */
export const getSession = () => api.get('/auth/me');
export const signIn = (username, password) => api.post('/auth/login', { username, password });
/** From the login page: ask for an account. An admin approves it and the login details are e-mailed. */
export const requestAccess = (fullName, email) => api.post('/auth/request-access', { fullName, email });
export const signOut = () => api.post('/auth/logout');

/** The signed-in user changes their own password (the current one must be right). */
export const changeOwnPassword = (currentPassword, newPassword) => api.post('/auth/change-password', { currentPassword, newPassword });
