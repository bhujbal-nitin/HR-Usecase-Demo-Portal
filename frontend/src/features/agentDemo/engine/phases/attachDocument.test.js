import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../api/employees', () => ({ attachDocument: vi.fn() }));

const { attachDocument } = await import('../../../../api/employees');
const { attachDocumentStep } = await import('./attachDocument');
const { hopsFor, iconFor, vizFor } = await import('../../panel/stageSpec');

const file = new File(['%PDF-1.4'], 'aadhaar_card.pdf', { type: 'application/pdf' });
const S = { employeeId: 'AE-123456', requestNumber: 'REQ0010001' };

describe('attachDocumentStep', () => {
  beforeEach(() => attachDocument.mockReset());

  it('simulated: shows which request the file goes on and does not call the backend', () => {
    const step = attachDocumentStep({ S, docKey: 'idDoc', label: 'Aadhaar card', file, live: false });
    expect(step.title).toBe('Attach the Aadhaar card to the ServiceNow request');
    expect(step.run).toBeUndefined();
    expect(step.payload()).toMatchObject({ request: 'REQ0010001', attachment: 'aadhaar_card.pdf', work_note: 'Aadhaar card received and attached' });
    expect(attachDocument).not.toHaveBeenCalled();
  });

  it('live: uploads the file to the candidate and reports what is now on the request', async () => {
    attachDocument.mockResolvedValue({ serviceNow: { reqNumber: 'REQ0010001', attachedDocuments: ['aadhaar_card.pdf'], syncError: null } });
    const step = attachDocumentStep({ S, docKey: 'idDoc', label: 'Aadhaar card', file, live: true });

    const result = await step.run();

    expect(attachDocument).toHaveBeenCalledWith('AE-123456', 'idDoc', file);
    expect(result.warn).toBe(false);
    expect(result.payload).toMatchObject({ request: 'REQ0010001', attachedToRequest: ['aadhaar_card.pdf'] });
    expect(step.live).toBe(true);
  });

  it('live: cannot be skipped, because the candidate file would be incomplete', () => {
    expect(attachDocumentStep({ S, docKey: 'idDoc', label: 'Aadhaar card', file, live: true }).noSkip).toBe(true);
  });

  it('live: warns when no request is linked or ServiceNow reported a problem', async () => {
    attachDocument.mockResolvedValueOnce({ serviceNow: { reqNumber: null, attachedDocuments: [], syncError: null } });
    const none = await attachDocumentStep({ S, docKey: 'panDoc', label: 'PAN card', file, live: true }).run();
    expect(none.warn).toBe(true);
    expect(none.payload.status).toBe('Stored only');

    attachDocument.mockResolvedValueOnce({ serviceNow: { reqNumber: 'REQ1', attachedDocuments: ['pan.pdf'], syncError: 'attach pan.pdf to sc_req_item: ACL' } });
    const partly = await attachDocumentStep({ S, docKey: 'panDoc', label: 'PAN card', file, live: true }).run();
    expect(partly.warn).toBe(true);
    expect(partly.payload.warnings).toContain('sc_req_item');
  });
});

describe('the new steps on the stage', () => {
  it('draws the attach step as a trip to ServiceNow, with its own icon and picture', () => {
    const step = { name: 'servicenow.attach_document()', kind: 'api' };
    expect(hopsFor(step, 'onboarding')).toEqual([['orch', 'prov'], ['prov', 'servicenow'], ['servicenow', 'prov'], ['prov', 'orch']]);
    expect(iconFor(step)).toBe('file');
    expect(vizFor(step)).toBe('external');
  });

  it('knows the record and the completion calls', () => {
    expect(vizFor({ name: 'POST /api/employees/start', kind: 'api' })).toBe('external');
    expect(iconFor({ name: 'POST /api/employees/finish-documents', kind: 'api' })).toBe('db');
  });
});
