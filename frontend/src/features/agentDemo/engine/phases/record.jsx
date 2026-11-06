import { finishDocuments, retryIntake, skipIntakeStep, startCandidate } from '../../../../api/employees';
import { maskPhone } from './common';
import { mirrorWithRerun } from './mirror';

const INTAKE_TIMEOUT_MS = 10 * 60 * 1000;

/** Same field names the onboarding wizard sends. */
const wizardValues = (D) => ({
  fullName: D.fullName, email: D.email, phone: D.phone, dob: D.dob, aadhaar: D.aadhaar,
  emergencyName: D.emergencyName, emergencyPhone: D.emergencyPhone, address: D.address, department: D.department,
  jobTitle: D.jobTitle, manager: D.manager, startDate: D.startDate, annualCtc: D.annualCtc, hardware: D.hardware, workLocation: D.workLocation,
});

/** Mirrors the intake steps with these keys; the backend runs the request first and the candidate-details workflow once the documents are in. */
const mirrorIntake = ({ r, set, phase, S, keys, timeoutMessage }) => mirrorWithRerun({
  r, set, label: 'Intake', phaseId: phase, employeeId: S.employeeId, agent: 'orch', pick: (e) => e.intake.filter((step) => keys.includes(step.key)),
  isDone: (e) => e.intakeStatus !== 'running', failed: (e) => e.intake.find((step) => keys.includes(step.key) && step.status === 'failed'),
  retry: retryIntake, skip: skipIntakeStep, timeoutMs: INTAKE_TIMEOUT_MS, timeoutMessage,
});

/**
 * Save the candidate and raise the ServiceNow request, before any document arrives: the request exists first and each document is
 * attached to it as it comes in (see `attachDocumentStep`). Real in live mode (record and ServiceNow request).
 * `ask` is what the candidate is told next (the first document is requested there).
 */
export async function openRequest({ r, D, S, set, live, ask }) {
  const phase = r.phase(
    'Create the onboarding record and the ServiceNow request',
    live ? 'Live: this saves a real record and raises a real ServiceNow request. The documents are attached to it as they arrive.' : 'Simulated: nothing is saved anywhere.',
  );

  await r.runSteps(phase, [
    {
      kind: 'tool', agent: 'orch', title: 'Package the candidate details', note: 'Collects the form data into one submission. The documents are not part of it: they are attached to the request afterwards.', name: 'onboarding.package()', lat: 90, live,
      payload: () => ({ fields: Object.keys(wizardValues(D)).length, documents: 'attached next' }),
    },
    live ? {
      kind: 'api', agent: 'orch', title: 'Create the onboarding record', note: 'Validates the details and saves the record. The ServiceNow request is raised from it next.', name: 'POST /api/employees/start', live: true, noSkip: true,
      run: async () => {
        const employee = await startCandidate(wizardValues(D));
        S.employeeId = employee.id;
        set({ runRecord: { kind: 'onboarding', id: employee.id } }); // lets the header open what this run creates
        return { payload: { request: 'POST /api/employees/start (multipart, no documents)', response: { id: employee.id, status: employee.status, submittedAt: employee.submittedAt } } };
      },
    } : {
      kind: 'api', agent: 'orch', title: 'Create the onboarding record', note: 'Simulated: a record would be created in the HR system.', name: 'hrms.create_employee()', lat: 520,
      payload: { request: 'POST /api/v2/pim/employees', response: { status: 201, empNumber: 'AE-DEMO' } },
      after: async () => { S.employeeId = 'AE-DEMO'; },
    },
    ...(live ? [] : [{
      kind: 'api', agent: 'orch', title: 'Raise the ServiceNow request', note: 'Simulated: a request would be raised with the candidate’s details. The documents are attached to it as they arrive.', name: 'servicenow.create_request()', lat: 610,
      payload: { request: 'POST /api/sn_sc/servicecatalog/items/…/order_now', response: { number: 'REQ0010001', approval: 'requested' } },
      after: async () => { S.requestNumber = 'REQ0010001'; },
    }]),
  ]);

  if (live) {
    // The backend raises the ServiceNow request and then waits for the documents. A failure stops the run here.
    const { employee, stopped } = await mirrorIntake({ r, set, phase, S, keys: ['servicenow_request'], timeoutMessage: 'The ServiceNow request was not created in time.' });
    S.requestNumber = employee.serviceNow.reqNumber;
    if (stopped) {
      await r.bot('Sorry, something went wrong while opening your request. Please try again shortly.', { wait: 500 });
      S.stopped = true;
      set({ stage: 'done', stopped: true });
      return;
    }
  }

  await ask();
}

/**
 * All documents are in and accepted: run the candidate-details workflow (live: the backend runs it and the chat waits until it is
 * Complete), then tell the candidate the file is with HR.
 */
export async function finishIntake({ r, D, S, set, live }) {
  const phase = r.phase(
    'Complete the candidate file',
    live ? 'Live: AutomationEdge runs the candidate-details workflow now that every document is on the request.' : 'Simulated: nothing is saved anywhere.',
  );

  if (live) {
    await r.runSteps(phase, [{
      kind: 'api', agent: 'orch', title: 'Mark the documents complete', note: 'Tells the backend that all three documents are on the request. It then runs the candidate-details workflow.', name: 'POST /api/employees/finish-documents', live: true, noSkip: true,
      run: async () => {
        const employee = await finishDocuments(S.employeeId);
        return { payload: { request: S.requestNumber ?? null, documents: Object.keys(employee.documents).length, intakeStatus: employee.intakeStatus } };
      },
    }]);
    const { stopped } = await mirrorIntake({ r, set, phase, S, keys: ['candidate_details'], timeoutMessage: 'The candidate intake did not finish in time.' });
    if (stopped) {
      await r.bot('Sorry, something went wrong while saving your file. Please try again shortly.', { wait: 500 });
      S.stopped = true;
      set({ stage: 'done', stopped: true });
      return;
    }
  } else {
    await r.runSteps(phase, [{
      kind: 'api', agent: 'orch', title: 'Run the candidate-details workflow', note: 'Simulated: AutomationEdge would run "HR Demo Get Employee Details" and the chat would wait for it to complete.', name: 'HR Demo Get Employee Details', lat: 900,
      payload: { workflow: 'HR Demo Get Employee Details', status: 'Complete', message: 'Candidate details fetched' },
    }]);
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
