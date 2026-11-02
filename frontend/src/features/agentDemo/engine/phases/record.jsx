import { retryIntake, skipIntakeStep, submitCandidate } from '../../../../api/employees';
import { maskPhone } from './common';
import { mirrorWithRerun } from './mirror';

const INTAKE_TIMEOUT_MS = 10 * 60 * 1000;

/** Same field names the onboarding wizard sends. */
const wizardValues = (D) => ({
  fullName: D.fullName, email: D.email, phone: D.phone, dob: D.dob, aadhaar: D.aadhaar,
  emergencyName: D.emergencyName, emergencyPhone: D.emergencyPhone, address: D.address, department: D.department,
  jobTitle: D.jobTitle, manager: D.manager, startDate: D.startDate, annualCtc: D.annualCtc, hardware: D.hardware, workLocation: D.workLocation,
});

/** Phase 6: save the candidate. Real in live mode (record, ServiceNow request, AutomationEdge workflow). */
export async function record({ r, D, S, set, live }) {
  const phase = r.phase(
    'Create the onboarding record',
    live ? 'Live: this saves a real record, raises a real ServiceNow request and starts a real AutomationEdge workflow.' : 'Simulated: nothing is saved anywhere.',
  );

  await r.runSteps(phase, [
    {
      kind: 'tool', agent: 'orch', title: 'Package the candidate file', note: 'Collects the form data, and the three documents into one submission.', name: 'onboarding.package()', lat: 90, live,
      payload: () => ({
        fields: Object.keys(wizardValues(D)).length,
        documents: Object.fromEntries(Object.entries(D.files).map(([key, file]) => [key, `${file.name} (${(file.size / 1024).toFixed(1)} KB)`])),
      }),
    },
    live ? {
      kind: 'api', agent: 'orch', title: 'Create the onboarding record', note: 'Validates the details and saves the record with its documents.', name: 'POST /api/employees', live: true, noSkip: true,
      run: async () => {
        const employee = await submitCandidate(wizardValues(D), D.files);
        S.employeeId = employee.id;
        set({ runRecord: { kind: 'onboarding', id: employee.id } }); // lets the header open what this run creates
        return { payload: { request: 'POST /api/employees (multipart)', response: { id: employee.id, status: employee.status, submittedAt: employee.submittedAt } } };
      },
    } : {
      kind: 'api', agent: 'orch', title: 'Create the onboarding record', note: 'Simulated: a record would be created in the HR system.', name: 'hrms.create_employee()', lat: 520,
      payload: { request: 'POST /api/v2/pim/employees', response: { status: 201, empNumber: 'AE-DEMO' } },
      after: async () => { S.employeeId = 'AE-DEMO'; },
    },
    ...(live ? [] : [
      {
        kind: 'api', agent: 'orch', title: 'Raise the ServiceNow request', note: 'Simulated: a request would be raised with the documents attached.', name: 'servicenow.create_request()', lat: 610,
        payload: { request: 'POST /api/sn_sc/servicecatalog/items/…/order_now', response: { number: 'REQ0010001', approval: 'requested' } },
        after: async () => { S.requestNumber = 'REQ0010001'; },
      },
      {
        kind: 'api', agent: 'orch', title: 'Run the candidate-details workflow', note: 'Simulated: AutomationEdge would run "HR Demo Get Employee Details" and the chat would wait for it to complete.', name: 'HR Demo Get Employee Details', lat: 900,
        payload: { workflow: 'HR Demo Get Employee Details', status: 'Complete', message: 'Candidate details fetched' },
      },
    ]),
  ]);

  if (live) {
    // The backend creates the ServiceNow request, then runs HR Demo Get Employee Details and waits until it is Complete.
    // Only then does the chat continue. A failure stops the run here.
    const { employee, stopped } = await mirrorWithRerun({
      r, set, label: 'Intake', phaseId: phase, employeeId: S.employeeId, agent: 'orch', pick: (e) => e.intake,
      isDone: (e) => e.intakeStatus !== 'running', failed: (e) => e.intake.find((step) => step.status === 'failed'),
      retry: retryIntake, skip: skipIntakeStep, timeoutMs: INTAKE_TIMEOUT_MS, timeoutMessage: 'The candidate intake did not finish in time.',
    });
    S.requestNumber = employee.serviceNow.reqNumber;
    if (stopped) {
      await r.bot('Sorry, something went wrong while saving your file. Please try again shortly.', { wait: 500 });
      S.stopped = true;
      set({ stage: 'done', stopped: true });
      return;
    }
  }

  await r.runSteps(phase, [
    {
      kind: 'notify', agent: 'orch', title: 'Tell the candidate it is with HR', note: 'Confirms the file is saved and what happens next.', name: 'whatsapp.send_text()', lat: 170,
      payload: () => ({ to: maskPhone(D.mobile), reference: S.employeeId, request: S.requestNumber ?? null, state_change: 'DOCUMENTS_COMPLETE → AWAITING_HR_APPROVAL' }),
      after: async () => {
        await r.bot(<>Your file is saved (ref <b>{S.employeeId}</b>{S.requestNumber ? <>, request <b>{S.requestNumber}</b></> : null}). It is now with HR for approval.</>);
        set({ stage: 'review' });
      },
    },
  ]);
}
