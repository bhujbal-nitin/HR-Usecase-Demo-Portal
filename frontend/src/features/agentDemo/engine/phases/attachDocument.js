import { attachDocument } from '../../../../api/employees';

const kb = (file) => `${Math.max(1, Math.round(file.size / 1024))} KB`;

/**
 * The step that puts one of the candidate's documents on the ServiceNow request, which already exists by then (the request
 * is raised first, see `openRequest`). Live, it uploads the file to the onboarding record and attaches it to the real request;
 * a work note on the request says it arrived. If the upload fails the step offers Rerun / Stop (it cannot be skipped: the
 * candidate file would be incomplete).
 */
export function attachDocumentStep({ S, docKey, label, file, live }) {
  const base = { kind: 'api', agent: 'doc', title: `Attach the ${label} to the ServiceNow request`, name: 'servicenow.attach_document()' };
  const note = 'The file is stored with the onboarding record and attached to the ServiceNow request, and a work note on the request says it arrived.';
  if (!live) {
    return {
      ...base, note: `Simulated: ${note}`, lat: 520,
      payload: () => ({ request: S.requestNumber, attachment: file.name, size: kb(file), work_note: `${label} received and attached` }),
    };
  }
  return {
    ...base, note, live: true, noSkip: true,
    run: async () => {
      const { serviceNow } = await attachDocument(S.employeeId, docKey, file);
      if (!serviceNow.reqNumber) {
        return { warn: true, payload: { status: 'Stored only', message: 'No ServiceNow request is linked to this candidate, so the file was not attached to a request.' } };
      }
      return {
        warn: Boolean(serviceNow.syncError),
        payload: { request: serviceNow.reqNumber, attachment: file.name, size: kb(file), attachedToRequest: serviceNow.attachedDocuments, ...(serviceNow.syncError ? { warnings: serviceNow.syncError } : {}) },
      };
    },
  };
}
