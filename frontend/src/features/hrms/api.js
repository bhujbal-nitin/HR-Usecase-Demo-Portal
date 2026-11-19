// The only module of the HRMS replica that talks to the network. It uses the same API shape HRMS 5 exposes.
import { buildQuery, errorText } from './components/helpers';

const ROOT = '/api/hrms/web/index.php';
const API = `${ROOT}/api/v2`;

export const SESSION_ENDED = 'hrms:session-ended';

export class HrmsError extends Error {
  constructor(message, { status = 0, keys = [] } = {}) {
    super(message);
    this.name = 'HrmsError';
    this.status = status;
    this.keys = keys; // names of the fields the server rejected
  }
}

async function send(url, { method = 'GET', body, quiet = false } = {}) {
  const init = { method, credentials: 'include', headers: { Accept: 'application/json' } };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers['Content-Type'] = 'application/json';
  }
  let response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new HrmsError(errorText(null, 0));
  }
  let payload = null;
  try { payload = await response.json(); } catch { /* an empty body is fine */ }
  if (!response.ok) {
    if (response.status === 401 && !quiet && typeof window !== 'undefined') window.dispatchEvent(new Event(SESSION_ENDED));
    throw new HrmsError(errorText(payload, response.status), { status: response.status, keys: payload?.error?.data?.invalidParamKeys ?? [] });
  }
  return payload ?? {};
}

const get = (path, params, opts) => send(`${API}/${path}${buildQuery(params)}`, opts);
const post = (path, body) => send(`${API}/${path}`, { method: 'POST', body });
const put = (path, body) => send(`${API}/${path}`, { method: 'PUT', body });
const del = (path, ids) => send(`${API}/${path}`, { method: 'DELETE', body: { ids } });

// ---- session
export const getSession = () => get('auth/session', undefined, { quiet: true });
export const signIn = (username, password) => send(`${ROOT}/auth/validate-json`, { method: 'POST', body: { username, password }, quiet: true });
export const signOut = () => send(`${ROOT}/auth/logout`, { method: 'POST', quiet: true });

// ---- PIM
export const listEmployees = (params) => get('pim/employees', { limit: 50, ...params });
export const createEmployee = (body) => post('pim/employees', body);
export const getEmployee = (n) => get(`pim/employees/${n}`);
export const getPersonal = (n) => get(`pim/employees/${n}/personal-details`);
export const savePersonal = (n, body) => put(`pim/employees/${n}/personal-details`, body);
export const getContact = (n) => get(`pim/employee/${n}/contact-details`);
export const saveContact = (n, body) => put(`pim/employee/${n}/contact-details`, body);
export const getJob = (n) => get(`pim/employees/${n}/job-details`);
export const saveJob = (n, body) => put(`pim/employees/${n}/job-details`, body);
export const listEmergency = (n) => get(`pim/employees/${n}/emergency-contacts`);
export const addEmergency = (n, body) => post(`pim/employees/${n}/emergency-contacts`, body);
export const listSalary = (n) => get(`pim/employees/${n}/salary-components`);
export const addSalary = (n, body) => post(`pim/employees/${n}/salary-components`, body);
export const listAttachments = (n) => get(`pim/employees/${n}/screen/personal/attachments`);
export const addAttachment = (n, body) => post(`pim/employees/${n}/screen/personal/attachments`, body);
export const attachmentUrl = (n, id) => `${API}/pim/employees/${n}/screen/personal/attachments/${id}`;
export const terminateEmployee = (n, body) => post(`pim/employees/${n}/terminations`, body);
export const listTerminationReasons = () => get('pim/termination-reasons');

// ---- Leave
export const listLeaveTypes = () => get('leave/leave-types');
export const addLeaveType = (body) => post('leave/leave-types', body);
export const listLeavePeriods = () => get('leave/leave-periods');
export const listEntitlements = (params) => get('leave/leave-entitlements', params);
export const addEntitlement = (body) => post('leave/leave-entitlements', body);
export const getLeaveBalances = (empNumber) => get('leave/employees/leave-balances', { empNumber, limit: 100 });
export const listHolidays = (params) => get('leave/holidays', { limit: 100, ...params });
export const addHoliday = (body) => post('leave/holidays', body);
export const listLeaveRequests = (params) => get('leave/leave-requests', { limit: 100, ...params });
export const getLeaveRequest = (id) => get(`leave/leave-requests/${id}`);
export const cancelLeaveRequest = (id) => put(`leave/employees/leave-requests/${id}`, { action: 'CANCEL' });
export const assignLeave = (body) => post('leave/employees/leave-requests', body);

// ---- Time (attendance)
export const listAttendance = (n, params) => get(`attendance/employees/${n}/records`, { limit: 100, ...params });
export const punchIn = (n, body) => post(`attendance/employees/${n}/records`, body);
export const punchOut = (n, body) => put(`attendance/employees/${n}/records`, body);
export const deleteAttendance = (n, ids) => del(`attendance/employees/${n}/records`, ids);
export const attendanceSummary = (params) => get('attendance/employees/summary', params);

// ---- Claim
export const listClaimEvents = () => get('claim/events', { limit: 100 });
export const addClaimEvent = (body) => post('claim/events', body);
export const listExpenseTypes = () => get('claim/expenses/types', { limit: 100 });
export const addExpenseType = (body) => post('claim/expenses/types', body);
export const createClaim = (n, body) => post(`claim/employees/${n}/requests`, body);
export const getClaim = (id) => get(`claim/requests/${id}`);
export const listClaims = (params) => get('claim/employees/requests', { limit: 100, ...params });
export const listClaimExpenses = (id) => get(`claim/requests/${id}/expenses`);
export const addClaimExpense = (id, body) => post(`claim/requests/${id}/expenses`, body);
export const claimAction = (id, action) => put(`claim/requests/${id}/action`, { action });
