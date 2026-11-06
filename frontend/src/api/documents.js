import { api } from './client';

/** Is document scanning set up on the backend, i.e. will uploaded documents be read and checked? */
export const getVerificationStatus = () => api.get('/documents/verification');

/** Run the AutomationEdge "HR Demo Document Verification" workflow; resolves when it has finished (can take a while). */
export const runVerificationWorkflow = () => api.post('/documents/verification-workflow');

/**
 * Read one uploaded document and check it against the joining form.
 * `referenceDob` (YYYY-MM-DD, read from the Aadhaar card) is only needed for the PAN card.
 * `employeeId` (a candidate whose ServiceNow request is already open) makes the backend note the outcome on that request.
 */
export function verifyDocument(docKey, file, fullName, referenceDob, employeeId) {
  const form = new FormData();
  form.append('docKey', docKey);
  form.append('fullName', fullName);
  if (referenceDob) form.append('referenceDob', referenceDob);
  if (employeeId) form.append('employeeId', employeeId);
  form.append('file', file, file.name);
  return api.post('/documents/verify', form);
}
