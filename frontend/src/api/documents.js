import { api } from './client';

/** Is OPENAI_API_KEY set on the backend, i.e. will uploaded documents be read and checked? */
export const getVerificationStatus = () => api.get('/documents/verification');

/** Run the AutomationEdge "HR Demo Document Verification" workflow; resolves when it has finished (can take a while). */
export const runVerificationWorkflow = () => api.post('/documents/verification-workflow');

/**
 * Read one uploaded document and check it against the joining form.
 * `referenceDob` (YYYY-MM-DD, read from the Aadhaar card) is only needed for the PAN card.
 */
export function verifyDocument(docKey, file, fullName, referenceDob) {
  const form = new FormData();
  form.append('docKey', docKey);
  form.append('fullName', fullName);
  if (referenceDob) form.append('referenceDob', referenceDob);
  form.append('file', file, file.name);
  return api.post('/documents/verify', form);
}
