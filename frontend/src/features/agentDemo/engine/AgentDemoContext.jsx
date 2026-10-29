import { createContext, useCallback, useContext, useMemo, useReducer, useRef, useState } from 'react';
import { getDemoConfig } from '../../../api/system';
import { AGENT_BY_ID } from '../../agents/data/agentRegistry';
import { buildCandidate } from './candidate';
import { demoReducer, initialState } from './demoReducer';
import { runGenericJourney, runGenericManual } from './genericJourney.jsx';
import { runManualOnboarding } from './manualJourney.jsx';
import { runLeaveAttendance } from './leaveJourney.jsx';
import { runLiveOffboarding } from './offboardingJourney.jsx';
import { SIM_EMPLOYEE } from './simulatedOffboardingApi';
import { runJourney } from './index';
import { CANCELLED, DEFAULT_TIMING, createRunner } from './runner';

const AgentDemoContext = createContext(null);

// One independent run per agent. The provider lives for the whole app session, so a run keeps going while you
// visit other screens and is exactly where you left it when you come back. Only Restart / starting again resets it.
function multiReducer(states, { agentId, inner }) {
  return { ...states, [agentId]: demoReducer(states[agentId] ?? initialState, inner) };
}

export function AgentDemoProvider({ children }) {
  const [states, dispatchAll] = useReducer(multiReducer, {});
  const tokens = useRef({});
  const gates = useRef({});
  const asks = useRef({});
  // The agent the Agent Demo page should open on when no agent is named: the run in progress, else the last one looked at.
  const [lastAgent, setLastAgent] = useState('onboarding');

  const restart = useCallback((agentId) => {
    tokens.current[agentId] = (tokens.current[agentId] ?? 0) + 1; // cancels the run in progress
    gates.current[agentId] = null;
    asks.current[agentId] = null;
    dispatchAll({ agentId, inner: { type: 'reset' } });
  }, []);

  /**
   * @param {'live'|'simulated'} mode  (only the onboarding, offboarding and leave & attendance agents have a live mode)
   * @param {{ manual?: boolean, employeeRef?: string }} options  manual: the user drives the chat instead of the scripted auto-play;
   *        employeeRef: the employee an offboarding or leave & attendance Auto-play · Live run is about
   */
  const start = useCallback(async (agentId, mode, { manual = false, employeeRef } = {}) => {
    const token = (tokens.current[agentId] ?? 0) + 1;
    tokens.current[agentId] = token;
    setLastAgent(agentId);
    const gateRef = { get current() { return gates.current[agentId]; }, set current(value) { gates.current[agentId] = value; } };
    gateRef.current = null;
    const askRef = { get current() { return asks.current[agentId]; }, set current(value) { asks.current[agentId] = value; } };
    askRef.current = null;

    const dispatch = (inner) => dispatchAll({ agentId, inner });
    const set = (patch) => dispatch({ type: 'set', patch });
    const isCurrent = () => tokens.current[agentId] === token;

    dispatch({ type: 'reset' });
    set({ mode, manual, busy: true });

    try {
      // Pacing from backend/.env (DEMO_SIMULATED_* / DEMO_LIVE_*); defaults if the backend is unreachable.
      const config = await getDemoConfig().catch(() => null);
      if (!isCurrent()) return;
      const timing = { ...DEFAULT_TIMING, ...config?.[mode === 'live' ? 'live' : 'simulated'] };
      const r = createRunner({ dispatch, isCurrent, gateRef, askRef, timing });
      if (manual && agentId === 'onboarding') {
        await runManualOnboarding({ r, set });
      } else if (agentId === 'offboarding' && mode === 'live') {
        await runLiveOffboarding({ r, set, auto: manual ? null : { employeeId: employeeRef } });
      } else if (agentId === 'offboarding' && !manual) {
        await runLiveOffboarding({ r, set, auto: { employeeId: SIM_EMPLOYEE.employeeId }, simulated: true });
      } else if (agentId === 'leave_attendance') {
        // Manual · Live, Auto-play · Live and Auto-play · Simulated all run the same journey; only the calls behind it differ.
        await runLeaveAttendance({ r, set, auto: manual ? null : { employeeId: mode === 'live' ? employeeRef : SIM_EMPLOYEE.employeeId }, simulated: mode === 'simulated' });
      } else if (manual) {
        await runGenericManual({ r, agent: AGENT_BY_ID[agentId], set });
      } else if (agentId === 'onboarding') {
        const D = await buildCandidate();
        if (!isCurrent()) return;
        await runJourney({ r, D, S: {}, set, live: mode === 'live' });
      } else {
        await runGenericJourney({ r, agent: AGENT_BY_ID[agentId], set });
      }
    } catch (error) {
      if (error !== CANCELLED) set({ error: error.message ?? String(error) });
    } finally {
      if (isCurrent()) {
        set({ busy: false, typing: false });
        dispatch({ type: 'agent', agent: null });
      }
    }
  }, []);

  const resolveGate = useCallback((agentId, choice) => gates.current[agentId]?.(choice), []);
  /** Manual mode: hand the user's input (message, file, form values) to the waiting script. */
  const respond = useCallback((agentId, payload) => asks.current[agentId]?.(payload), []);

  const defaultAgentId = useMemo(() => {
    const running = Object.entries(states).find(([, s]) => s.busy);
    return (states[lastAgent]?.busy ? lastAgent : running?.[0]) ?? lastAgent;
  }, [states, lastAgent]);

  const value = useMemo(
    () => ({ states, start, restart, resolveGate, respond, defaultAgentId, setLastAgent }),
    [states, start, restart, resolveGate, respond, defaultAgentId],
  );
  return <AgentDemoContext.Provider value={value}>{children}</AgentDemoContext.Provider>;
}

/** The run for one agent: { state, start(agentId, mode, options), restart(), resolveGate(choice), respond(payload) }. */
export function useAgentDemo(agentId) {
  const context = useContext(AgentDemoContext);
  if (!context) throw new Error('useAgentDemo must be used inside <AgentDemoProvider>');
  const { states, start, restart, resolveGate, respond } = context;
  return {
    state: states[agentId] ?? initialState,
    start,
    restart: useCallback(() => restart(agentId), [restart, agentId]),
    resolveGate: useCallback((choice) => resolveGate(agentId, choice), [resolveGate, agentId]),
    respond: useCallback((payload) => respond(agentId, payload), [respond, agentId]),
  };
}

/** Which agent the Agent Demo page opens on when the address names none. */
export function useDefaultAgent() {
  const context = useContext(AgentDemoContext);
  if (!context) throw new Error('useDefaultAgent must be used inside <AgentDemoProvider>');
  return { defaultAgentId: context.defaultAgentId, remember: context.setLastAgent };
}
