import * as realApi from '../../../api/payroll';
import DownloadLink from '../components/DownloadLink';
import { SCENARIOS, detectIntent, monthLabel } from '../lib/payroll';
import { payrollWorkflowStep } from './phases/payrollWorkflow';
import { createSimulatedPayrollApi } from './simulatedPayrollApi';
import { fillForm, firstName, identify, loadSamples, askWho, makeAsk, understand } from './leaveJourney.jsx';

// Payroll & salary. Manual: YOU are the employee and the chat waits for you at every step. Auto-play: the same journey with the chosen
// employee's answers filled in for you. The employee can download three documents, PDFs the backend draws from their figures: the payslip of a month, the
// CTC statement and Form 16 (the full year). Live: the annual CTC is read from OrangeHRM (PIM -> Salary,
// where onboarding recorded it) and the backend fills the template. Auto-play · Simulated: the very same journey runs against simulatedPayrollApi, so the flows
// cannot drift apart; its steps are tagged Simulated. Nothing is shown in the chat but the download: no breakdown, no tables.
// AutomationEdge showcase workflows run BEFORE each document (Fetch Salary Details, then the document's own Generate workflow); the chat goes on once they are Complete.

const PDF_ICON = 'fa-file-pdf';

/** Make one document in a single step (the file is fetched now, so a problem shows up as this step failing) and hand it over as a download. */
async function makeDocument({ r, S, phaseTitle, phaseNote, workflow, step, make, icon, intro }) {
  let file = null;
  const phase = r.phase(phaseTitle, phaseNote);
  await r.runSteps(phase, [payrollWorkflowStep(S, 'fetch-salary'), payrollWorkflowStep(S, workflow), {
    kind: 'api', agent: 'pay', title: step.title, name: step.name, live: !S.api.simulated, note: step.note,
    run: async () => {
      file = await make(); // a problem here fails the step (Rerun / Skip)
      return { payload: { file: file.filename } };
    },
  }]);
  if (!file) {
    await r.bot('Sorry, I could not make that document right now. Please try again shortly.', { wait: 500 });
    return;
  }
  await r.bot(intro, { wait: 500 });
  await r.bot(<DownloadLink {...file} icon={icon} />, { wait: 400 });
}

// ------------------------------------------------------------------------------------------------ the three requests
/** 1. Payslip: pick a month, then the PDF. */
async function payslip({ r, S, set, ask, auto, employee }) {
  let months = [];
  const prepare = r.phase('Prepare the payslip request', 'The months a payslip can be asked for are worked out.');
  await r.runSteps(prepare, [{
    kind: 'tool', agent: 'pay', title: 'List the pay months', name: 'payroll.options()', live: !S.api.simulated,
    note: 'A payslip exists for last month and the months before it, not for the current month or months still to come.',
    run: async () => {
      months = (await S.api.getPayrollOptions()).months;
      return { payload: { months: months.map(monthLabel) } };
    },
  }]);
  await r.bot('Sure. Which month would you like the payslip for?', { wait: 500 });
  const form = {
    title: 'Payslip request', hint: 'Choose the pay month.',
    fields: [{ id: 'month', label: 'Pay month', type: 'select', options: months.map((value) => ({ value, label: monthLabel(value) })) }],
  };
  const { month } = await fillForm({ r, set, ask, auto, form, sample: { month: months[0] } });
  r.msg('out', <>Payslip for <b>{monthLabel(month)}</b>, please.</>);
  await r.phaseGap();

  await makeDocument({
    r, S, icon: PDF_ICON,
    phaseTitle: 'Make the payslip', phaseNote: 'The salary workflows run, the salary is read from OrangeHRM and the payslip is made as a PDF.', workflow: 'generate-payslip',
    step: { title: 'Generate the payslip PDF', name: 'payroll.payslip()', note: 'Reads the employee’s annual CTC from OrangeHRM (PIM → Salary), works out the month’s pay and deductions and draws the payslip as a PDF.' },
    make: () => S.api.fetchPayslip(employee.employeeId, month),
    intro: <>Here is your payslip for <b>{monthLabel(month)}</b>, {firstName(employee)}.</>,
  });
}

/** 2. CTC statement. */
async function ctc({ r, S, employee }) {
  await makeDocument({
    r, S, icon: PDF_ICON,
    phaseTitle: 'Make the CTC statement', phaseNote: 'The salary workflows run, the annual CTC is read from OrangeHRM and the CTC statement is made as a PDF.', workflow: 'generate-ctc',
    step: { title: 'Generate the CTC statement PDF', name: 'payroll.ctc()', note: 'Reads the employee’s annual CTC from OrangeHRM (PIM → Salary), splits it into its components, monthly and yearly, and draws the CTC statement as a PDF.' },
    make: () => S.api.fetchCtc(employee.employeeId),
    intro: <>Here is your <b>CTC statement</b>, {firstName(employee)}.</>,
  });
}

/** 3. Form 16 for the last financial year. */
async function form16({ r, S, employee }) {
  await makeDocument({
    r, S, icon: PDF_ICON,
    phaseTitle: 'Make Form 16', phaseNote: 'The salary workflows run and Form 16 is made as a PDF with the employee’s full-year figures for the last financial year.', workflow: 'generate-form16',
    step: { title: 'Generate the Form 16 PDF', name: 'payroll.form16()', note: 'Reads the employee’s annual CTC from OrangeHRM (PIM → Salary) and draws Form 16 as a PDF with the full-year salary, deductions and tax.' },
    make: () => S.api.fetchForm16(employee.employeeId),
    intro: <>Here is your <b>Form 16</b>, {firstName(employee)}.</>,
  });
}

const SCENARIO_RUNNERS = { payslip, ctc, form16 };

/** @param auto  null for Manual; { employeeId } for Auto-play (the three downloads are asked for by themselves) */
export async function runPayrollSalary({ r, set, auto = null, simulated = false }) {
  const S = { api: simulated ? createSimulatedPayrollApi(r.timing.stepScale) : realApi, stopped: false };
  const ask = makeAsk(r, auto);
  r.msg('sys', simulated
    ? 'Auto-play · Simulated: this asks for the three documents for a sample employee. Nothing is contacted or saved anywhere.'
    : auto
    ? 'Auto-play · Live: this asks for the three documents for the employee you chose. It is real: the salary is read from OrangeHRM and the backend makes the three PDFs.'
    : 'Manual mode: you are the employee. Type a message to begin. It is real: the salary is read from OrangeHRM and the backend makes the three PDFs.');
  set({ stage: 'idle' });

  const first = await ask({ kind: 'text', suggestions: ['Hi'] }, { text: 'Hi' });
  r.msg('out', first.text);
  await understand({ r, text: first.text, intent: 'greeting', workflow: 'payroll_salary.v1' });
  await r.bot('Hi, I’m your payroll and salary assistant.');
  const samples = await loadSamples('payroll', auto, S.api);
  await askWho(r, samples);

  const employee = await identify({ r, set, ask, auto, api: S.api, samples });
  await r.bot(<>Thanks, <b>{firstName(employee)}</b>. I found you: <b>{employee.jobTitle}</b>, {employee.department}, reporting to {employee.manager}.</>);
  await r.bot('I can give you your payslip, your CTC statement or your Form 16 to download. What would you like?', { wait: 600 });

  const context = { r, S, set, ask, auto, employee };
  if (auto) {
    for (const scenario of SCENARIOS) {
      const { text } = await ask({ kind: 'text', suggestions: SCENARIOS.map((s) => s.label), pick: scenario.label }, { text: scenario.label });
      r.msg('out', text);
      await understand({ r, text, intent: scenario.intent, workflow: `${scenario.intent}.v1` });
      await SCENARIO_RUNNERS[scenario.id](context);
      await r.phaseGap();
    }
  } else {
    for (;;) {
      const { text } = await ask({ kind: 'text', suggestions: SCENARIOS.map((s) => s.label) });
      r.msg('out', text);
      const intent = detectIntent(text);
      if (intent === 'done') break;
      const scenario = SCENARIOS.find((s) => s.id === intent);
      if (!scenario) {
        await r.bot('I can give you your payslip, your CTC statement or your Form 16. Try one of the suggestions below.', { wait: 600 });
        continue;
      }
      await understand({ r, text, intent: scenario.intent, workflow: `${scenario.intent}.v1` });
      await SCENARIO_RUNNERS[scenario.id](context);
      await r.bot('Is there anything else I can help you with?', { wait: 600 });
    }
  }

  await r.phaseGap();
  const bye = r.phase('Close the conversation', 'A short goodbye; the conversation is closed.');
  await r.runSteps(bye, [{
    kind: 'notify', agent: 'pay', title: 'Close the conversation', name: 'whatsapp.send_text()', lat: 160,
    note: 'The assistant says goodbye.',
    payload: () => ({ message: 'Happy to help. Have a great day!' }),
    after: async () => {
      await r.bot(<>Happy to help, {firstName(employee)}. Have a great day!</>, { wait: 500 });
      set({ stage: 'done', outcome: true });
    },
  }]);
}
