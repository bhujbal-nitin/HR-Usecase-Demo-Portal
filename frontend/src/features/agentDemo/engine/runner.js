import { plain } from '../../../utils/wording';

// The script engine: helpers the phase scripts use to add chat messages, phases and step cards,
// run each step with its own timing, and wait for the human approval gate.

// Pacing comes from the DEMO_* settings in backend/.env (GET /api/demo-config).
export const DEFAULT_TIMING = { stepScale: 1.5, messageGapMs: 800, phaseGapMs: 1500, approvalWaitMs: 8000 };

export const CANCELLED = Symbol('demo-cancelled');
export class StopRun extends Error {}

const now = () => new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

/**
 * @param dispatch   reducer dispatch
 * @param isCurrent  () => boolean, false once the run was restarted (all pending sleeps then reject)
 * @param gateRef    ref that holds the resolver of the approval gate
 * @param askRef     ref that holds the resolver of the pending manual-mode input (see `ask`)
 */
export function createRunner({ dispatch, isCurrent, gateRef, askRef, timing = DEFAULT_TIMING }) {
  let counter = 0;
  const nextId = () => `${++counter}`;

  const wait = (ms) =>
    new Promise((resolve, reject) => {
      setTimeout(() => (isCurrent() ? resolve() : reject(CANCELLED)), ms);
    });
  /** Scripted pause: scaled by the configured step scale. */
  const sleep = (ms) => wait(ms * timing.stepScale);
  const phaseGap = () => wait(timing.phaseGapMs);

  const msg = (side, body, extra = {}) => {
    const id = nextId();
    dispatch({ type: 'msg', message: { id, side, body, time: now(), ...extra } });
    return id;
  };
  const patchMsg = (id, patch) => dispatch({ type: 'patchMsg', id, patch });

  const setTyping = (typing) => dispatch({ type: 'set', patch: { typing } });
  const bot = async (body, { wait: typingMs = 700 } = {}) => {
    setTyping(true);
    await sleep(typingMs);
    setTyping(false);
    const id = msg('in', body);
    await wait(timing.messageGapMs);
    return id;
  };

  const phase = (title, sub) => {
    const id = nextId();
    dispatch({ type: 'phase', phase: { id, title, sub, steps: [] } });
    return id;
  };

  const waitForGate = () =>
    new Promise((resolve, reject) => {
      gateRef.current = (choice) => (isCurrent() ? resolve(choice) : reject(CANCELLED));
    });

  /**
   * Manual mode: pause until the user acts. `awaiting` tells the phone UI what to enable:
   *   { kind: 'text', suggestions?: string[] }   typed message (or a suggestion chip / answer button)
   *   { kind: 'attach', docKey, label }          file picked with the paperclip
   *   { kind: 'form' }                        the in-chat form (resolved by that bubble)
   */
  const ask = (awaiting) =>
    new Promise((resolve, reject) => {
      askRef.current = (value) => (isCurrent() ? resolve(value) : reject(CANCELLED));
      dispatch({ type: 'set', patch: { awaiting } });
    }).finally(() => {
      askRef.current = null;
      if (isCurrent()) dispatch({ type: 'set', patch: { awaiting: null } });
    });

  async function runStep(stepId, def) {
    dispatch({ type: 'agent', agent: def.agent });
    dispatch({ type: 'patchStep', id: stepId, patch: { status: 'running' } });

    let payload = typeof def.payload === 'function' ? def.payload() : def.payload;
    let latency = def.lat ?? 0;
    let warn = Boolean(def.warn);
    const started = performance.now();

    // A step that really runs (live) and fails offers "Rerun from this step" or "Stop here"; a rerun just runs that step again.
    for (;;) {
      try {
        if (def.run) {
          dispatch({ type: 'patchStep', id: stepId, patch: { payload: payload ?? { status: 'calling…' } } });
          const result = await def.run({ patch: (patch) => dispatch({ type: 'patchStep', id: stepId, patch }), waitForGate });
          payload = result?.payload ?? payload;
          warn = result?.warn ?? warn;
          latency = result?.lat ?? Math.round(performance.now() - started);
          dispatch({ type: 'patchStep', id: stepId, patch: { payload } });
        } else {
          dispatch({ type: 'patchStep', id: stepId, patch: { payload } });
          await sleep(380 + latency * 0.65);
          await wait(timing.messageGapMs / 2);
        }
        break;
      } catch (error) {
        if (error === CANCELLED) throw error;
        const message = plain(error.message ?? String(error));
        if (!def.run) {
          dispatch({ type: 'patchStep', id: stepId, patch: { status: 'failed', latLabel: 'failed', payload: { error: message } } });
          throw new StopRun(message);
        }
        dispatch({ type: 'patchStep', id: stepId, patch: { status: 'failed', latLabel: 'failed', rerun: true, canSkip: !def.noSkip, payload: { message } } });
        dispatch({ type: 'set', patch: { error: message } });
        const choice = await waitForGate();
        dispatch({ type: 'patchStep', id: stepId, patch: { rerun: false } });
        if (choice === 'skip' && !def.noSkip) {
          // Carry on without this step: it stays on the list, marked Skipped.
          dispatch({ type: 'set', patch: { error: null } });
          dispatch({ type: 'patchStep', id: stepId, patch: { status: 'skipped', latLabel: 'skipped' } });
          return;
        }
        if (choice !== 'rerun') throw new StopRun(message);
        dispatch({ type: 'set', patch: { error: null } });
        dispatch({ type: 'patchStep', id: stepId, patch: { status: 'running', latLabel: '', payload: { status: 'calling…' } } });
      }
    }

    dispatch({
      type: 'patchStep',
      id: stepId,
      patch: { status: warn ? 'warn' : 'done', latLabel: def.kind === 'human' ? 'replied' : `${latency} ms` },
    });
    dispatch({
      type: 'stat',
      delta: { steps: 1, lat: latency, tools: def.kind === 'tool' || def.kind === 'api' ? 1 : 0, human: def.kind === 'human' ? 1 : 0 },
    });
    if (def.after) await def.after();
  }

  /** Adds all steps as queued, then runs them one by one. */
  async function runSteps(phaseId, defs) {
    const ids = defs.map((def) => {
      const id = nextId();
      dispatch({
        type: 'step',
        phaseId,
        step: { id, status: 'queued', kind: def.kind, agent: def.agent, title: def.title, note: def.note, name: def.name, live: Boolean(def.live), payload: null, latLabel: '' },
      });
      return id;
    });
    for (let i = 0; i < defs.length; i++) await runStep(ids[i], defs[i]);
  }

  /** Append a step while the run is in progress (used to mirror the real provisioning pipeline). */
  const addStep = (phaseId, def) => {
    const id = nextId();
    dispatch({
      type: 'step',
      phaseId,
      step: { id, status: 'queued', kind: def.kind, agent: def.agent, title: def.title, note: def.note, name: def.name, live: Boolean(def.live), payload: def.payload ?? null, latLabel: '' },
    });
    return id;
  };
  const patchStep = (id, patch) => dispatch({ type: 'patchStep', id, patch });

  return { timing, ask, sleep, wait, phaseGap, msg, patchMsg, bot, setTyping, phase, runSteps, addStep, patchStep, waitForGate, dispatch };
}
