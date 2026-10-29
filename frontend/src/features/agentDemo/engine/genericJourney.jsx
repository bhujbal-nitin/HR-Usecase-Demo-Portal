import ReadOnlyWidget from '../components/ReadOnlyWidget';
import { getSimulatedProcess } from '../../agents/data/agentRegistry';

// Scripted journey for the five demo agents. It replays each agent's quick prompts as a chat, and turns the agent's
// scripted process (see agents/process/simulatedProcesses.js) into timeline cards. Nothing here contacts a real system.

const slug = (text) => `${text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}()`;

/** Rough card type from the step wording, so the timeline shows the same mix of kinds as the reference. */
function inferKind(label, index, count) {
  if (/notif|send|e-?mail|invite|publish|schedul/i.test(label)) return index === count - 1 ? 'notify' : 'api';
  if (/authenticat|call|query|creat|submit|record|writ|upload|fetch|load|read/i.test(label)) return /creat|submit|record|writ|call|authenticat/i.test(label) ? 'api' : 'tool';
  if (/embed|compos|retriev|comput|calculat|decid|choos|match|identif|render|apply/i.test(label)) return 'agent';
  return 'tool';
}

function stepDefs(spec) {
  const count = spec.steps.length;
  return spec.steps.map((step, index) => {
    const kind = inferKind(step.label, index, count);
    return {
      kind,
      agent: kind === 'agent' ? 'spec' : kind === 'api' ? 'sys' : index === 0 ? 'orch' : 'spec',
      title: step.label,
      note: step.detail,
      name: slug(step.label),
      lat: step.ms,
      live: false,
      payload: {
        step: step.label,
        detail: step.detail,
        systems: spec.systems,
        ...(index === count - 1 ? { result: { summary: spec.result.title, ...Object.fromEntries(spec.result.rows) } } : {}),
      },
    };
  });
}

export async function playProcess(r, spec) {
  const phase = r.phase(spec.title, `Scripted demo · ${spec.systems.join(' · ')}`);
  await r.runSteps(phase, stepDefs(spec));
}

export async function runGenericJourney({ r, agent, set }) {
  const typeThenSend = async (text) => {
    set({ draft: text });
    await r.sleep(600);
    set({ draft: '' });
    r.msg('out', text);
  };

  const showResponse = async (response) => {
    await r.bot(response.text, { wait: 600 });
    if (response.widget) r.msg('in', <ReadOnlyWidget widget={response.widget} />, { wide: true });
  };

  r.msg('sys', 'Demo chat. Messages and data here are fictional and scripted.');
  await r.phaseGap();
  await r.bot(agent.greeting, { wait: 700 });

  for (const prompt of agent.quickPrompts) {
    await r.phaseGap();
    await typeThenSend(prompt.text);
    const response = agent.respond(prompt.action, { employees: [] });
    if (!response) continue;

    if (response.process) await playProcess(r, response.process);
    await showResponse(response);

    // Buttons inside the answer that would trigger a follow-up process (e.g. "Confirm & submit"): the candidate taps them.
    for (const action of response.widget?.actions ?? []) {
      const followUp = action.effect?.process && getSimulatedProcess(action.effect.process);
      if (!followUp) continue;
      await r.phaseGap();
      await typeThenSend(action.label);
      await playProcess(r, followUp);
      if (action.effect.reply) await r.bot(action.effect.reply, { wait: 500 });
    }
  }

  set({ stage: 'done', outcome: true });
}

// ---- Manual mode for the five demo agents: free text in, scripted answers out (all Simulated) -------------------------

function download(filename, content) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Pick the agent's quick prompt that best matches what the user typed (word overlap). Null if nothing matches. */
export function matchPrompt(agent, text) {
  const typed = text.toLowerCase().trim();
  const wanted = typed.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length >= 3);
  let best = null;
  let bestScore = 0;
  for (const prompt of agent.quickPrompts) {
    const haystack = `${prompt.text} ${prompt.action.replace(/_/g, ' ')}`.toLowerCase();
    if (typed.length > 2 && haystack.includes(typed)) return prompt;
    const score = wanted.filter((w) => haystack.includes(w)).length;
    if (score > bestScore) [best, bestScore] = [prompt, score];
  }
  return best;
}

export async function runGenericManual({ r, agent, set }) {
  r.msg('sys', 'Manual mode: type a message or tap a suggestion. This demo agent has scripted answers; nothing real is contacted.');
  await r.bot(agent.greeting, { wait: 700 });
  const suggestions = agent.quickPrompts.map((prompt) => prompt.text);

  for (;;) {
    const input = await r.ask({ kind: 'text', suggestions });
    const text = input.action ? input.action.label : input.text;
    r.msg('out', text);

    if (input.action) {
      // A button inside an earlier answer card (e.g. "Confirm & Submit Resignation").
      const effect = input.action.effect ?? {};
      const followUp = effect.process && getSimulatedProcess(effect.process);
      if (followUp) await playProcess(r, followUp);
      if (effect.download) download(effect.download.filename, effect.download.content);
      if (effect.reply) await r.bot(effect.reply, { wait: 500 });
      continue;
    }

    const prompt = matchPrompt(agent, text);
    const response = prompt && agent.respond(prompt.action, { employees: [] });
    if (!response) {
      await r.bot(<>I’m a demo agent with a few scripted answers, and I didn’t recognise that. Try one of the suggestions below.</>, { wait: 600 });
      continue;
    }
    if (response.process) await playProcess(r, response.process);
    await r.bot(response.text, { wait: 600 });
    if (response.widget) r.msg('in', null, { kind: 'widget', widget: response.widget, wide: true });
    set({ stage: 'answered' });
  }
}
