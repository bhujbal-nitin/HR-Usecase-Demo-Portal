import { api } from './client';

const id = (claimId) => encodeURIComponent(claimId);

/** Recognise an onboarded employee by Employee ID or e-mail. Rejects with a readable message if unknown. */
export const lookupEmployee = (employeeRef) => api.get(`/reimbursement/lookup?ref=${encodeURIComponent(employeeRef)}`);

/**
 * Read one bill (a PDF or a photo) with OpenAI. Nothing is saved.
 * -> { fileName, expenseType, date, amount, vendor, withinPolicy }. Rejects if OpenAI is not set up or the bill cannot be read.
 */
export function readBill(employeeRef, file) {
  const form = new FormData();
  form.append('ref', employeeRef);
  form.append('file', file, file.name);
  return api.post('/reimbursement/bills/read', form);
}

/** { employeeRef, items: [bills as returned by readBill] } -> the claim, waiting for the manager. */
export const submitClaim = (submission) => api.post('/reimbursement/claims', submission);

export const listClaims = (options) => api.get('/reimbursement/claims', options);
export const getClaim = (claimId) => api.get(`/reimbursement/claims/${id(claimId)}`);
/** Approve the chosen bills (their 0-based positions in the claim; leave out to approve all) and reject the rest. */
export const approveClaim = (claimId, approvedBills) => api.post(`/reimbursement/claims/${id(claimId)}/approve`, approvedBills ? { approvedBills } : undefined);
/** Reject the whole claim. */
export const rejectClaim = (claimId) => api.post(`/reimbursement/claims/${id(claimId)}/reject`);
/** Record an approved claim in OrangeHRM (Claim module). Repeating it does nothing. */
export const applyClaim = (claimId) => api.post(`/reimbursement/claims/${id(claimId)}/apply`);
export const clearClaims = () => api.delete('/reimbursement/claims');

/** Run one AutomationEdge showcase workflow and wait for it: read-bill | check-policy | submit-claim | create-claim.
 *  -> { workflowName, status, ok, automationRequestId, agent, message }. Rejects if AutomationEdge is not configured. */
export const runReimbursementWorkflow = (key) => api.post(`/reimbursement/workflows/${key}`);
