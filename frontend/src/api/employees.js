import { api, apiUrl } from './client';

export const DOCUMENT_KEYS = ['idDoc', 'panDoc', 'uanDoc', 'salaryDoc'];

export const listEmployees = (options) => api.get('/employees', options);
export const getEmployee = (id) => api.get(`/employees/${encodeURIComponent(id)}`);
export const approveCandidate = (id) => api.post(`/employees/${encodeURIComponent(id)}/approve`);
export const rejectCandidate = (id) => api.post(`/employees/${encodeURIComponent(id)}/reject`);
export const retryIntake = (id) => api.post(`/employees/${encodeURIComponent(id)}/retry-intake`);
export const skipIntakeStep = (id) => api.post(`/employees/${encodeURIComponent(id)}/skip-intake-step`);
export const skipProvisioningStep = (id) => api.post(`/employees/${encodeURIComponent(id)}/skip-provisioning-step`);
export const retryProvisioning = (id) => api.post(`/employees/${encodeURIComponent(id)}/retry-provisioning`);
export const syncServiceNowApprovals = () => api.post('/employees/sync-servicenow');
export const clearEmployees = (scope = 'processed') => api.delete(`/employees?scope=${scope}`);

export const documentUrl = (id, key) => apiUrl(`/employees/${encodeURIComponent(id)}/documents/${key}`);

/**
 * Submit the wizard. Text fields go as multipart form fields (camelCase, matching the API),
 * the documents as files and, if there is one, a drawn signature as a PNG data URL.
 */
export function submitCandidate(values, files, signature = '') {
  const form = new FormData();
  Object.entries(values).forEach(([key, value]) => form.append(key, String(value ?? '').trim()));
  DOCUMENT_KEYS.forEach((key) => files[key] && form.append(key, files[key], files[key].name));
  if (signature) form.append('signature', signature);
  return api.post('/employees', form);
}

/**
 * Register a candidate without documents: the backend raises the ServiceNow request now and the documents follow one by one
 * (`attachDocument`), then `finishDocuments`. Used by the agent demo; the onboarding wizard sends everything at once with `submitCandidate`.
 */
export function startCandidate(values) {
  const form = new FormData();
  Object.entries(values).forEach(([key, value]) => form.append(key, String(value ?? '').trim()));
  return api.post('/employees/start', form);
}

/** Send one document to a candidate started with `startCandidate`; it is attached to the candidate's ServiceNow request. */
export function attachDocument(id, key, file) {
  const form = new FormData();
  form.append('file', file, file.name);
  return api.post(`/employees/${encodeURIComponent(id)}/documents/${key}`, form);
}

/** Every required document is in and accepted: the backend runs the rest of the intake. */
export const finishDocuments = (id) => api.post(`/employees/${encodeURIComponent(id)}/finish-documents`);
