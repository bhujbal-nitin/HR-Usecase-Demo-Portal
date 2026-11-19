import { api, apiUrl } from './client';

const id = (candidateId) => encodeURIComponent(candidateId);

/**
 * The pre-onboarding record: { id, fullName, email, status, personal, documents: { key: { label, fileName, check } }, verification, bgv, hr, serviceNow, offer, acceptance, joining, ... }.
 * status: "Offer released" | "Offer accepted" | "Collecting documents" | "Awaiting HR approval" | "Approved" | "Joining confirmed" | "Completed" | "Rejected".
 */

/** Register the candidate and raise their ServiceNow request. -> the record. */
export const createCandidate = (details) => api.post('/pre-onboarding/candidates', details);
export const listCandidates = (options) => api.get('/pre-onboarding/candidates', options);
export const getCandidate = (candidateId) => api.get(`/pre-onboarding/candidates/${id(candidateId)}`);

/** Send one document (key: tenth | twelfth | degree | aadhaar | pan | photo | resume). -> { document, record }; document.check says whether it passed. */
export function uploadDocument(candidateId, key, file) {
  const form = new FormData();
  form.append('key', key);
  form.append('file', file, file.name);
  return api.post(`/pre-onboarding/candidates/${id(candidateId)}/documents`, form);
}

/** Compare the name on all seven documents. -> the record (verification.allMatch). */
export const verifyDocuments = (candidateId) => api.post(`/pre-onboarding/candidates/${id(candidateId)}/verify`);

/** Step 1: make the offer letter (a PDF) and e-mail it (to the candidate's address unless `to` is given). Each returns the record. */
export const makeOffer = (candidateId) => api.post(`/pre-onboarding/candidates/${id(candidateId)}/offer`);
export const dispatchOffer = (candidateId, to) => api.post(`/pre-onboarding/candidates/${id(candidateId)}/dispatch`, to ? { to } : undefined);
/** Where the offer letter can be downloaded: { href, filename }. */
export const offerDownload = (record) => ({ href: apiUrl(`/pre-onboarding/candidates/${id(record.id)}/offer/download`), filename: record.offer.fileName });

/** Step 2: the candidate accepts the offer and confirms the joining date ({ joiningDate }). -> the record. */
export const acceptOffer = (candidateId, joiningDate) => api.post(`/pre-onboarding/candidates/${id(candidateId)}/accept`, { joiningDate });
/** Step 4: the personal information ({ dateOfBirth, gender, maritalStatus, currentAddress, permanentAddress, emergencyName, emergencyRelation, emergencyPhone }). -> the record. */
export const savePersonal = (candidateId, personal) => api.post(`/pre-onboarding/candidates/${id(candidateId)}/personal`, personal);
/** Step 6: the (dummy) background verification. -> the record, with bgv. */
export const runBackgroundCheck = (candidateId) => api.post(`/pre-onboarding/candidates/${id(candidateId)}/bgv`);

/** Step 7: HR's decision, made on the Approvals page. */
export const approveHr = (candidateId) => api.post(`/pre-onboarding/candidates/${id(candidateId)}/hr/approve`);
export const rejectHr = (candidateId) => api.post(`/pre-onboarding/candidates/${id(candidateId)}/hr/reject`);

/** Step 8: make the joining instructions (a PDF) and e-mail them. -> the record, with joining. */
export const confirmJoining = (candidateId, to) => api.post(`/pre-onboarding/candidates/${id(candidateId)}/joining`, to ? { to } : undefined);
export const joiningDownload = (record) => ({ href: apiUrl(`/pre-onboarding/candidates/${id(record.id)}/joining/download`), filename: record.joining.fileName });
/** Step 9: pre-onboarding is completed (the ServiceNow request is closed). -> the record. */
export const completePreOnboarding = (candidateId) => api.post(`/pre-onboarding/candidates/${id(candidateId)}/complete`);

/** Where a stored document can be opened in the browser. */
export const documentUrl = (candidateId, key) => apiUrl(`/pre-onboarding/candidates/${id(candidateId)}/documents/${key}/download`);

/** Remove the finished candidates (rejected or completed) from the portal. -> { removed } */
export const clearCandidates = () => api.delete('/pre-onboarding/candidates');
