import { api, apiUrl } from './client';

const id = (offboardingId) => encodeURIComponent(offboardingId);

export const listOffboardings = (options) => api.get('/offboardings', options);
export const getOffboarding = (offboardingId) => api.get(`/offboardings/${id(offboardingId)}`);
export const getOffboardingOptions = () => api.get('/offboardings/options');
/** Recognise an onboarded employee by Employee ID or e-mail. Rejects with a readable message if unknown or already offboarding. */
export const lookupEmployee = (ref) => api.get(`/offboardings/lookup?ref=${encodeURIComponent(ref)}`);
/** { employeeRef, lastWorkingDay (YYYY-MM-DD), reason, comments, leaveBalanceDays } */
export const submitResignation = (resignation) => api.post('/offboardings', resignation);
export const approveOffboarding = (offboardingId) => api.post(`/offboardings/${id(offboardingId)}/approve`);
export const rejectOffboarding = (offboardingId) => api.post(`/offboardings/${id(offboardingId)}/reject`);
export const retryOffboardingIntake = (offboardingId) => api.post(`/offboardings/${id(offboardingId)}/retry-intake`);
export const skipOffboardingIntakeStep = (offboardingId) => api.post(`/offboardings/${id(offboardingId)}/skip-intake-step`);
export const skipOffboardingStep = (offboardingId) => api.post(`/offboardings/${id(offboardingId)}/skip-step`);
export const retryOffboarding = (offboardingId) => api.post(`/offboardings/${id(offboardingId)}/retry`);
export const clearOffboardings = () => api.delete('/offboardings');
export const relievingLetterUrl = (offboardingId) => apiUrl(`/offboardings/${id(offboardingId)}/relieving-letter`);
