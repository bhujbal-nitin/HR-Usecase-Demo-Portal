import { api } from './client';

export const getAutofillProfile = () => api.get('/autofill');
export const getDemoConfig = () => api.get('/demo-config');
export const getIntegrationHealth = (options) => api.get('/integrations/health', options);
export const checkSingleIntegration = (system, options) => api.post(`/integrations/health/${system}/check`, null, options);
