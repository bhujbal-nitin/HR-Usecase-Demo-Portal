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
export const sendOfferLetter = (id) => api.post(`/employees/${encodeURIComponent(id)}/offer-letter`);
export const syncServiceNowApprovals = () => api.post('/employees/sync-servicenow');
export const clearEmployees = (scope = 'processed') => api.delete(`/employees?scope=${scope}`);

export const documentUrl = (id, key) => apiUrl(`/employees/${encodeURIComponent(id)}/documents/${key}`);
export const offerLetterUrl = (id) => apiUrl(`/employees/${encodeURIComponent(id)}/offer-letter`);

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
