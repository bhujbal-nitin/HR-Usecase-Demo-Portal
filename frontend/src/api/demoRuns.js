import { api } from './client';

/**
 * Demo history: tell the backend a demo run started and how it ended, so an admin can see who ran what. History must never get in the way of a demo, so
 * both calls swallow every error (startDemoRun resolves to null when nothing could be recorded).
 */
export const startDemoRun = ({ agent, mode, manual }) =>
  api.post('/demo-runs', { agent, mode, manual: Boolean(manual) }).then((r) => r?.id ?? null).catch(() => null);

export const finishDemoRun = (id, outcome, detail = '') => (id ? api.post(`/demo-runs/${id}/finish`, { outcome, detail: String(detail).slice(0, 500) }).catch(() => {}) : Promise.resolve());
