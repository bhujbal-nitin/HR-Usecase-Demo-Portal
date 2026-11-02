import * as realApi from '../../../api/hrPolicy';
import { AUTO_POLICY_WORD, AUTO_QUESTIONS, SCENARIOS, SUGGESTED_QUESTIONS, detectIntent, findLetter } from '../lib/hrPolicy';
import DownloadLink from '../components/DownloadLink';
import { LETTER_WORKFLOWS, hrPolicyWorkflowStep } from './phases/hrPolicyWorkflow';
import { card, fillForm, firstName, identify, makeAsk, showCard, understand } from './leaveJourney.jsx';
import { createSimulatedHrPolicyApi } from './simulatedHrPolicyApi';

// HR policy & documents. Manual: YOU are the employee and the chat waits for you at every step. Auto-play: the same journey with the
// policy download, the questions and the two letters asked for you. Live: the policy PDFs in the policies folder are offered in a dropdown and
// the one you pick is downloaded as it is; a policy question goes to the knowledge base (with the earlier questions of the chat,
// so a follow-up is understood) and a letter is a Word file made from the template in the HR documents folder, with the employee's details. Auto-play · Simulated: the very same
// journey runs against simulatedHrPolicyApi, so the flows cannot drift apart; its steps are tagged Simulated.
// Five AutomationEdge showcase workflows run, each right AFTER the step it stands for, and the chat goes on once it is Complete: Search Policy after a
// search, Get Policy Document after a policy is taken, Ask Policy Question after every answer, and a Generate Letter workflow after each letter.

const MAX_HISTORY = 10;
const DONE_LABEL = 'That’s all';
const ANOTHER_LABEL = 'Another policy';

// ------------------------------------------------------------------------------------------------ Policy search
/** List the policies in the policies folder. Returns the list, or null if it could not be read (the employee is told). */
async function listPolicies({ r, S }) {
  let found = null;
  const phase = r.phase('Find the policies', 'The policy documents in the policies folder are listed.');
  await r.runSteps(phase, [{
    kind: 'tool', agent: 'policy', title: 'List the policies', name: 'hr_documents.search_policies()', live: !S.api.simulated,
    note: 'Looks in the policies folder for the policy documents, to offer them in a dropdown.',
    run: async () => {
      found = await S.api.listPolicies();
      return { payload: { policies: found.map((p) => p.title) } };
    },
  }, hrPolicyWorkflowStep(S, 'search-policy')]);
  if (!found) await r.bot('Sorry, I could not look up the policies right now. Please try again shortly.', { wait: 500 });
  return found;
}

/** Hand over one policy: its card and the download. */
async function givePolicy({ r, S, policy }) {
  let download = null;
  const phase = r.phase(policy.title, 'The policy document is handed over as it is.');
  await r.runSteps(phase, [{
    kind: 'tool', agent: 'policy', title: 'Get the policy', name: 'hr_documents.get_policy()', live: !S.api.simulated,
    note: 'Takes the policy PDF from the policies folder.',
    run: async () => {
      download = S.api.policyDownload(policy);
      return { payload: { policy: policy.title, file: policy.fileName } };
    },
  }, hrPolicyWorkflowStep(S, 'get-policy')]);
  if (!download) return;
  await r.bot(<>Here is the <b>{policy.title}</b>.</>, { wait: 500 });
  showCard(r, card(policy.title, 'fa-file-pdf', { label: 'Policy', tone: 'approved' }, [['Document:', policy.fileName]]));
  await r.sleep(400);
  await r.bot(<DownloadLink {...download} icon="fa-file-pdf" />, { wait: 400 });
}

/** 1. Policy search: a dropdown of the policies, and the chosen one is downloaded. */
async function policySearch({ r, S, set, ask, auto }) {
  for (;;) {
    const policies = await listPolicies({ r, S });
    if (!policies) return;
    if (policies.length === 0) {
      await r.bot('There are no policies in the policies folder yet. Please contact HR.', { wait: 500 });
      return;
    }
    await r.phaseGap();
    await r.bot('Sure. Choose the policy you want from the list and tap Submit.', { wait: 500 });
    const form = {
      title: 'Policy', hint: 'Choose the policy to download.',
      fields: [{ id: 'policy', label: 'Policy', type: 'select', options: policies.map((p) => ({ value: p.key, label: p.title })) }],
    };
    const sample = { policy: (policies.find((p) => p.title.toLowerCase().includes(AUTO_POLICY_WORD)) ?? policies[0]).key };
    const { policy: key } = await fillForm({ r, set, ask, auto, form, sample });
    const policy = policies.find((p) => p.key === key);
    r.msg('out', <>{policy.title}</>);
    await r.phaseGap();
    await givePolicy({ r, S, policy });
    if (auto) return;
    await r.bot('Would you like another policy?', { wait: 500 });
    const { text } = await ask({ kind: 'text', suggestions: [ANOTHER_LABEL, DONE_LABEL] });
    if (text === DONE_LABEL || detectIntent(text) === 'done') {
      r.msg('out', text);
      return;
    }
    r.msg('out', text);
  }
}

// ------------------------------------------------------------------------------------------------ Q&A
/** One question: send it with the chat history, show the answer and the policies it came from. Returns { question, answer } or null. */
async function answerQuestion({ r, S, question, history }) {
  let result = null;
  const phase = r.phase('Search the policies', 'The question goes to the knowledge base, which answers from the company’s policy documents.');
  await r.runSteps(phase, [{
    kind: 'api', agent: 'policy', title: 'Ask the knowledge base', name: 'km.query()', live: !S.api.simulated,
    note: 'Sends the question together with the earlier questions and answers of this chat, so a follow-up is understood. The knowledge base answers from the policy documents and names its sources.',
    run: async () => {
      result = await S.api.askPolicy(question, history.slice(-MAX_HISTORY));
      return { payload: { question, answer: result.answer, sources: result.sources.length ? result.sources : 'none named', earlierQuestions: history.length } };
    },
  }, hrPolicyWorkflowStep(S, 'ask-question')]);
  if (!result) {
    await r.bot('Sorry, I could not get an answer to that right now. Please try again shortly.', { wait: 500 });
    return null;
  }
  await r.bot(result.answer, { wait: 500 });
  if (result.sources.length) {
    showCard(r, card('Where this comes from', 'fa-book', { label: 'Policy documents', tone: 'verified' }, result.sources.map((name) => ['Source:', name])));
  }
  return { question, answer: result.answer };
}

/** 1. Policy questions: the first one, then follow-ups until the employee is done. */
async function policyQuestions({ r, S, ask, auto, employee }) {
  const history = [];
  await r.bot('Sure. What would you like to know about our policies?', { wait: 500 });
  let { text } = await ask({ kind: 'text', suggestions: SUGGESTED_QUESTIONS, pick: AUTO_QUESTIONS[0] }, { text: AUTO_QUESTIONS[0] });
  for (;;) {
    r.msg('out', text);
    await r.phaseGap();
    const turn = await answerQuestion({ r, S, question: text, history });
    if (turn) history.push(turn);
    await r.phaseGap();

    if (auto) {
      if (history.length >= AUTO_QUESTIONS.length) break;
      ({ text } = await ask({ kind: 'text', suggestions: [] }, { text: AUTO_QUESTIONS[history.length] }));
      continue;
    }
    await r.bot(`Anything else on this, ${firstName(employee)}? Ask a follow-up question, or tell me when you are done.`, { wait: 500 });
    const notAsked = SUGGESTED_QUESTIONS.filter((q) => !history.some((turn) => turn.question === q));
    ({ text } = await ask({ kind: 'text', suggestions: [...notAsked, DONE_LABEL] }));
    if (text === DONE_LABEL || detectIntent(text) === 'done') {
      r.msg('out', text);
      break;
    }
  }
}

// ------------------------------------------------------------------------------------------------ Letters
/** 2. A letter: list what is on offer, take the one asked for, give its file. */
async function letters({ r, S, ask, auto, employee }) {
  let offered = [];
  const list = r.phase('Find the letters', 'The letters that can be asked for are looked up.');
  await r.runSteps(list, [{
    kind: 'tool', agent: 'policy', title: 'List the letters', name: 'hr_documents.list()', live: !S.api.simulated,
    note: 'Looks in the HR documents folder for the address proof letter and the bank account opening letter templates.',
    run: async () => {
      offered = await S.api.getLetters(employee.employeeId);
      return { payload: Object.fromEntries(offered.map((l) => [l.title, l.available ? l.fileName : 'file not placed yet'])) };
    },
  }]);
  if (offered.length === 0) {
    await r.bot('I could not look up the letters right now. Please try again shortly.', { wait: 500 });
    return;
  }
  await r.bot('I can give you an address proof letter or a bank account opening letter. Which one do you need?', { wait: 500 });

  // Auto-play asks for each letter in turn; Manual asks until the employee is done.
  const wanted = [];
  for (;;) {
    const pick = auto ? offered[wanted.length] : null;
    if (auto && !pick) break;
    const { text } = await ask({ kind: 'text', suggestions: offered.map((l) => l.title).concat(auto ? [] : [DONE_LABEL]), pick: pick?.title }, { text: pick?.title });
    r.msg('out', text);
    if (!auto && (text === DONE_LABEL || detectIntent(text) === 'done')) break;
    const letter = findLetter(offered, text);
    if (!letter) {
      await r.bot('I can give you the address proof letter or the bank account opening letter. Please choose one.', { wait: 500 });
      continue;
    }
    wanted.push(letter);
    await giveLetter({ r, S, employee, letter });
    if (!auto) await r.bot('Would you like the other letter too? Choose it, or tell me you are done.', { wait: 500 });
  }
}

async function giveLetter({ r, S, employee, letter }) {
  let download = null;
  const phase = r.phase(letter.title, 'The employee is recognised and the letter is handed over.');
  await r.runSteps(phase, [{
    kind: 'tool', agent: 'policy', title: 'Get the letter', name: 'hr_documents.get_letter()', live: !S.api.simulated,
    note: 'Makes the employee’s copy of the letter: the Word template from the HR documents folder with their name, employee code, designation and dates filled in.',
    run: async () => {
      if (!letter.available) return { warn: true, payload: { letter: letter.title, result: 'Not available yet', reason: 'The file has not been placed in the HR documents folder' } };
      download = S.api.letterDownload(employee.employeeId, letter);
      return { payload: { letter: letter.title, file: letter.fileName, employee: employee.fullName, designation: employee.jobTitle } };
    },
  }, ...(letter.available ? [hrPolicyWorkflowStep(S, LETTER_WORKFLOWS[letter.key])] : [])]); // a letter that is not there has nothing to run a workflow for
  if (!download) {
    await r.bot(<>The <b>{letter.title.toLowerCase()}</b> is not available yet. Please contact HR.</>, { wait: 500 });
    return;
  }
  await r.bot(<>Here is your <b>{letter.title.toLowerCase()}</b>, {firstName(employee)}.</>, { wait: 500 });
  showCard(r, card(letter.title, 'fa-file-signature', { label: 'Ready', tone: 'approved' }, [['Employee:', employee.fullName], ['Designation:', employee.jobTitle], ['Word file:', letter.fileName]]));
  await r.sleep(400);
  await r.bot(<DownloadLink {...download} />, { wait: 400 });
}

const SCENARIO_RUNNERS = { search: policySearch, ask: policyQuestions, letter: letters };

/** @param auto  null for Manual; { employeeId } for Auto-play (a policy search, a policy question with its follow-up, then both letters) */
export async function runHrPolicy({ r, set, auto = null, simulated = false }) {
  const S = { api: simulated ? createSimulatedHrPolicyApi(r.timing.stepScale) : realApi };
  const ask = makeAsk(r, auto);
  r.msg('sys', simulated
    ? 'Auto-play · Simulated: this downloads a policy, asks a sample policy question and requests both letters for a sample employee. Nothing is contacted anywhere.'
    : auto
    ? 'Auto-play · Live: this downloads a policy, asks a policy question and requests both letters for the employee you chose. It is real: the policies are the PDFs in the policies folder (offered in a dropdown), the question goes to the knowledge base and the letters are made from the Word templates in the HR documents folder.'
    : 'Manual mode: you are the employee. Type a message to begin. It is real: your questions go to the knowledge base and the letters are made from the Word templates in the HR documents folder.');
  set({ stage: 'idle' });

  const first = await ask({ kind: 'text', suggestions: ['Hi'] }, { text: 'Hi' });
  r.msg('out', first.text);
  await understand({ r, text: first.text, intent: 'greeting', workflow: 'hr_policy.v1' });
  await r.bot('Hi, I’m your HR policy and document assistant.');
  await r.bot(<>First, who are you? Please type your <b>employee ID</b> (like AE-123456) or your <b>work e-mail</b>.</>, { wait: 500 });

  const employee = await identify({ r, set, ask, auto, api: S.api });
  await r.bot(<>Thanks, <b>{firstName(employee)}</b>. I found you: <b>{employee.jobTitle}</b>, {employee.department}, reporting to {employee.manager}.</>);
  await r.bot('I can give you a policy to download, answer questions about the company’s policies, or give you a letter: an address proof letter or a bank account opening letter. What would you like to do?', { wait: 600 });

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
        await r.bot('I can give you a policy, answer policy questions or give you a letter. Try one of the suggestions below.', { wait: 600 });
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
    kind: 'notify', agent: 'policy', title: 'Close the conversation', name: 'whatsapp.send_text()', lat: 160,
    note: 'The assistant says goodbye.',
    payload: () => ({ message: 'Happy to help. Have a great day!' }),
    after: async () => {
      await r.bot(<>Happy to help, {firstName(employee)}. Have a great day!</>, { wait: 500 });
      set({ stage: 'done', outcome: true });
    },
  }]);
}
