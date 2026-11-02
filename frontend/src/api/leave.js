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
/** The punch records OrangeHRM holds for one day (YYYY-MM-DD): { date, records: [{ inPunch, outPunch }] }. */
export const getAttendance = (employeeRef, day) => api.get(`/leave/attendance?${ref(employeeRef)}&date=${day}`);
/** { employeeRef, leaveType, startDate, endDate, reason } */
export const submitLeave = (application) => api.post('/leave/requests/leave', application);
/** An attendance request: { employeeRef, attendanceDate, inPunch (HH:MM), outPunch (HH:MM), reason } */
export const submitRegularization = (application) => api.post('/leave/requests/regularization', application);

export const listLeaveRequests = (options) => api.get('/leave/requests', options);
export const getLeaveRequest = (requestId) => api.get(`/leave/requests/${id(requestId)}`);
export const approveLeaveRequest = (requestId) => api.post(`/leave/requests/${id(requestId)}/approve`);
export const rejectLeaveRequest = (requestId) => api.post(`/leave/requests/${id(requestId)}/reject`);
/** Record an approved request in OrangeHRM (book the leave / write the day's punch-in and punch-out). Repeating it does nothing. */
export const applyLeaveRequest = (requestId) => api.post(`/leave/requests/${id(requestId)}/apply`);
export const clearLeaveRequests = () => api.delete('/leave/requests');

/** Run one AutomationEdge showcase workflow and wait for it: balance | check | assign-leave | attendance | punch-in | punch-out.
 *  -> { workflowName, status, ok, automationRequestId, agent, message }. Rejects if AutomationEdge is not configured. */
export const runLeaveWorkflow = (key) => api.post(`/leave/workflows/${key}`);
