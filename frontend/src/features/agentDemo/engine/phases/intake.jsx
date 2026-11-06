import { validateField } from '../../../onboarding/validation';
import { maskPhone, trigger } from './common';

export const FORM_FIELDS = [
  ['fullName', 'Full name'], ['email', 'Personal email'], ['mobile', 'Mobile number'], ['dob', 'Date of birth'],
  ['address', 'Residential address'], ['emergencyName', 'Emergency contact'], ['emergencyPhone', 'Emergency phone'], ['department', 'Department'],
];

/** Phase 1: first message, intent, candidate lookup, and the joining form appears in the chat. */
export async function greeting({ r, D, S, set }) {
  set({ draft: 'Hi' });
  await r.sleep(700);
  set({ draft: '' });
  r.msg('out', 'Hi');

  const phase = r.phase('Greeting and identity lookup', 'A new thread opens. The agent works out who this is and what to do.');
  await r.runSteps(phase, [
    trigger('Inbound message received', 'WhatsApp delivers the message from the candidate. Nothing has been decided yet.', {
      object: 'whatsapp_business_account', from: `91${D.mobile.slice(0, 2)}XXXX${D.mobile.slice(-4)}`, type: 'text', text: { body: 'Hi' }, timestamp: Math.floor(Date.now() / 1000),
    }),
    {
      kind: 'agent', agent: 'orch', title: 'Understand intent', note: 'The LLM reads the message with the thread state and picks a workflow.', name: 'llm.classify_intent()', lat: 640,
      payload: { thread_state: 'NEW_THREAD', intent: 'start_onboarding', confidence: 0.97, workflow: 'onboarding.v3', reasoning: 'First message from a number with an accepted offer. Start joining-form collection.' },
    },
    {
      kind: 'notify', agent: 'orch', title: 'Send the joining form', note: 'Replies with a short greeting and a form that opens inside WhatsApp.', name: 'whatsapp.send_flow()', lat: 210,
      payload: { to: maskPhone(D.mobile), flow: 'joining_details_v2', prefill: { first_name: D.first } },
      after: async () => {
        await r.bot(<>Hi {D.first}, welcome! I’m your onboarding assistant. I’ll help you finish your joining formalities in about 3 minutes.</>);
        await r.bot('First, please confirm a few details.', { wait: 500 });
        S.formId = r.msg('in', null, { kind: 'form', wide: true, form: { values: {}, submitted: false } });
        set({ stage: 'form' });
      },
    },
  ]);
}

/** The candidate fills and submits the in-chat form (animated), then the form phase runs. */
export async function joiningForm({ r, D, S }) {
  const display = { ...D, mobile: D.mobile };
  const values = {};
  for (const [id] of FORM_FIELDS) {
    await r.sleep(450);
    values[id] = display[id];
    r.patchMsg(S.formId, { form: { values: { ...values }, submitted: false } });
  }
  await r.sleep(700);
  r.patchMsg(S.formId, { form: { values: { ...values }, submitted: true } });
  r.msg('out', <><b>{D.fullName}</b><br />{D.email}<br />{maskPhone(D.mobile)} · DOB {D.dobDisplay}<br />{D.department}</>);

  const phase = r.phase('Form intake', 'The submitted form is checked before anything is saved.');
  await r.runSteps(phase, [
    trigger('Form submission received', 'The form arrives as a structured reply, not free text, so no guessing is needed.', {
      type: 'interactive', nfm_reply: { name: 'joining_details_v2', response_json: { name: D.fullName, email: D.email, mobile: maskPhone(D.mobile), dob: D.dob, department: D.department } },
    }),
    {
      kind: 'agent', agent: 'orch', title: 'Plan the next actions', note: 'The agent writes a short plan and moves the thread to the next state.', name: 'llm.plan()', lat: 580,
      payload: { state_change: 'AWAITING_FORM → FORM_RECEIVED', plan: ['validate_form', 'create_onboarding_record', 'raise_servicenow_request', 'collect_documents', 'verify_identity'], on_failure: 'ask_candidate_to_correct' },
    },
    {
      kind: 'tool', agent: 'orch', title: 'Validate every field', note: 'Runs the same validation rules as the onboarding wizard, on the real values. Same input, same answer.', name: 'validators.run()', lat: 120, live: true,
      payload: () => {
        const checks = {
          fullName: validateField('fullName', D.fullName), email: validateField('email', D.email), phone: validateField('phone', `+91 ${D.mobile}`),
          dob: validateField('dob', D.dob), address: validateField('address', D.address), emergencyName: validateField('emergencyName', D.emergencyName),
          emergencyPhone: validateField('emergencyPhone', D.emergencyPhone), department: validateField('department', D.department),
        };
        return Object.fromEntries(Object.entries(checks).map(([k, v]) => [k, v || 'ok']));
      },
    },
  ]);
}

/** Once the request is open: thank the candidate, say which request it is and ask for the first document. */
export async function askForAadhaar({ r, D, S, set }) {
  await r.bot(<>Thanks, {D.first}. Your details are captured{S.requestNumber ? <>, and I have opened request <b>{S.requestNumber}</b> for your onboarding</> : null}.</>);
  await r.bot(<>First, please attach your <b>Aadhaar card</b> (PDF or Word) with the paperclip. I will add it to the request.</>, { wait: 600 });
  D.idUploadId = r.msg('in', null, { kind: 'upload', wide: true, upload: { docKey: 'idDoc', label: 'Aadhaar card' } });
  set({ stage: 'docs' });
}
