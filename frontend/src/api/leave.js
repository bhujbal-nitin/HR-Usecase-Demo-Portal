import { api } from './client';

const id = (requestId) => encodeURIComponent(requestId);
const ref = (employeeRef) => `ref=${encodeURIComponent(employeeRef)}`;

export const getLeaveOptions = () => api.get('/leave/options');
/** Recognise an onboarded employee by Employee ID or e-mail. Rejects with a readable message if unknown. */
export const lookupEmployee = (employeeRef) => api.get(`/leave/lookup?${ref(employeeRef)}`);
export const getBalances = (employeeRef) => api.get(`/leave/balances?${ref(employeeRef)}`);
export const getHolidays = () => api.get('/leave/holidays');
/** { employeeRef, leaveType, startDate, endDate } -> the balance and policy checks against OrangeHRM (nothing is saved). */
export const checkLeave = (request) => api.post('/leave/check', request);
/** The recent punch log from OrangeHRM: { days, missing }. */
export const getAttendance = (employeeRef) => api.get(`/leave/attendance?${ref(employeeRef)}`);
/** Demo set-up: make sure the employee has a day with a missing out-punch in OrangeHRM. -> { created, day, message } */
export const prepareDemoPunch = (employeeRef) => api.post(`/leave/attendance/demo-punch?${ref(employeeRef)}`);
/** { employeeRef, leaveType, startDate, endDate, reason } */
export const submitLeave = (application) => api.post('/leave/requests/leave', application);
/** { employeeRef, attendanceDate, outPunch (HH:MM), reason } */
export const submitRegularization = (application) => api.post('/leave/requests/regularization', application);

export const listLeaveRequests = (options) => api.get('/leave/requests', options);
export const getLeaveRequest = (requestId) => api.get(`/leave/requests/${id(requestId)}`);
export const approveLeaveRequest = (requestId) => api.post(`/leave/requests/${id(requestId)}/approve`);
export const rejectLeaveRequest = (requestId) => api.post(`/leave/requests/${id(requestId)}/reject`);
/** Record an approved request in OrangeHRM (book the leave / punch the employee out). Repeating it does nothing. */
export const applyLeaveRequest = (requestId) => api.post(`/leave/requests/${id(requestId)}/apply`);
export const clearLeaveRequests = () => api.delete('/leave/requests');

/** Run one AutomationEdge showcase workflow and wait for it: balance | check | assign-leave | attendance | punch-in | punch-out.
 *  -> { workflowName, status, ok, automationRequestId, agent, message }. Rejects if AutomationEdge is not configured. */
export const runLeaveWorkflow = (key) => api.post(`/leave/workflows/${key}`);
