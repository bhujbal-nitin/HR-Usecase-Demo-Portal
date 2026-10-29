export const initialState = {
  run: 0,
  mode: null, // 'live' | 'simulated'
  stage: 'idle', // idle | form | docs | record | review | done
  busy: false,
  typing: false,
  chat: [],
  phases: [],
  agent: null,
  used: [],
  stats: { steps: 0, tools: 0, lat: 0, human: 0 },
  outcome: null,
  stopped: false,
  runRecord: null, // { kind, id } of the live record this run created (for the system buttons)
  manual: false,
  awaiting: null, // manual mode: what the chat is waiting for (see runner.ask)
  draft: '',
  error: null,
};

const patchById = (list, id, patch) => list.map((item) => (item.id === id ? { ...item, ...patch } : item));

export function demoReducer(state, action) {
  switch (action.type) {
    case 'reset':
      return { ...initialState, run: state.run + 1 };
    case 'set':
      return { ...state, ...action.patch };
    case 'msg':
      return { ...state, chat: [...state.chat, action.message] };
    case 'patchMsg':
      return { ...state, chat: patchById(state.chat, action.id, action.patch) };
    case 'phase':
      return { ...state, phases: [...state.phases, action.phase] };
    case 'step':
      return {
        ...state,
        phases: state.phases.map((phase) => (phase.id === action.phaseId ? { ...phase, steps: [...phase.steps, action.step] } : phase)),
      };
    case 'patchStep':
      return {
        ...state,
        phases: state.phases.map((phase) => ({ ...phase, steps: patchById(phase.steps, action.id, action.patch) })),
      };
    case 'agent':
      return { ...state, agent: action.agent, used: action.agent && !state.used.includes(action.agent) ? [...state.used, action.agent] : state.used };
    case 'stat':
      return { ...state, stats: { ...state.stats, ...Object.fromEntries(Object.entries(action.delta).map(([k, v]) => [k, state.stats[k] + v])) } };
    default:
      return state;
  }
}
