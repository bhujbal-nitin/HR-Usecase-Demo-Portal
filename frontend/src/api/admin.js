import { api } from './client';

// Admin only. Users are { username, fullName, role: 'admin' | 'user', isActive, createdAt }.
export const listUsers = () => api.get('/admin/users');
export const createUser = (user) => api.post('/admin/users', user);
export const changeUser = (username, changes) => api.patch(`/admin/users/${encodeURIComponent(username)}`, changes);

/** People who asked for access: { id, email, fullName, status: 'pending' | 'approved' | 'rejected', requestedAt, decidedAt, decidedBy, username }, waiting ones first. */
export const getAccessRequests = () => api.get('/admin/access-requests');
/** Make the user and e-mail the login. `choices`: { role, accessType, accessDays, expiresAt }. */
export const approveAccessRequest = (id, choices) => api.post(`/admin/access-requests/${id}/approve`, choices);
export const rejectAccessRequest = (id) => api.post(`/admin/access-requests/${id}/reject`);

/** One row per user: { username, fullName, role, isActive, calls, inputTokens, outputTokens, totalTokens, lastUsed }. `days` limits it to recent use. */
export const getUsage = (days) => api.get(`/admin/usage${days ? `?days=${days}` : ''}`);

/** { items: [{ id, username, feature, model, inputTokens, outputTokens, totalTokens, at }], total } */
export const getUsageHistory = ({ username, limit = 25, offset = 0 } = {}) => {
  const query = new URLSearchParams({ limit, offset, ...(username ? { username } : {}) });
  return api.get(`/admin/usage/history?${query}`);
};

/** { items: [{ id, username, agent, mode, manual, startedAt, endedAt, seconds, outcome, detail }], total }: every demo run, newest first. */
export const getDemoRuns = ({ username, agent, limit = 25, offset = 0 } = {}) => {
  const query = new URLSearchParams({ limit, offset, ...(username ? { username } : {}), ...(agent ? { agent } : {}) });
  return api.get(`/admin/demo-runs?${query}`);
};
