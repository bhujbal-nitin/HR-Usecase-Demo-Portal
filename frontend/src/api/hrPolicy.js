import { api, apiUrl } from './client';

const ref = (employeeRef) => `ref=${encodeURIComponent(employeeRef)}`;

/** Recognise an onboarded employee by Employee ID or e-mail. Rejects with a readable message if unknown. */
export const lookupEmployee = (employeeRef) => api.get(`/hr-policy/lookup?${ref(employeeRef)}`);

/**
 * Ask the knowledge base a policy question. `history` is the earlier [{ question, answer }] of this chat, oldest first.
 * -> { answer, sources: [file names] }. Rejects if the knowledge base is not set up (KM_PROJECT_ID / KM_PROJECT_SECRET in .env).
 */
export const askPolicy = (question, history) => api.post('/hr-policy/ask', { question, history });

/** Every policy document in the policies folder, by title: [{ key, title, fileName }]. */
export const listPolicies = () => api.get('/hr-policy/policies');

/** Where the policy PDF can be downloaded: { href, filename }. */
export const policyDownload = (policy) => ({ href: apiUrl(`/hr-policy/policies/${encodeURIComponent(policy.key)}/download`), filename: policy.fileName });

/**
 * The letters that can be asked for: [{ key, title, available, fileName }]. `available` is false until the Word template is placed in the HR
 * documents folder. With the employee, `fileName` is the name of their own copy (e.g. Address_Proof_Letter_Varun_Chopra.docx).
 */
export const getLetters = (employeeRef) => api.get(`/hr-policy/letters?${ref(employeeRef)}`);

/** Run one AutomationEdge showcase workflow and wait for it: search-policy | get-policy | ask-question | address-proof-letter | bank-account-letter.
 *  -> { workflowName, status, ok, automationRequestId, agent, message }. Rejects if AutomationEdge is not configured. */
export const runHrPolicyWorkflow = (key) => api.post(`/hr-policy/workflows/${key}`);

/** Where the letter can be downloaded (a Word file made for the employee, with their details filled in): { href, filename }. */
export const letterDownload = (employeeRef, letter) => ({
  href: apiUrl(`/hr-policy/letters/${encodeURIComponent(letter.key)}/download?${ref(employeeRef)}`),
  filename: letter.fileName,
});
