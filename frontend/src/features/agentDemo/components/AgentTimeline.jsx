import { useEffect, useMemo, useRef, useState } from 'react';
import Stage from '../panel/Stage';
import SystemMap from '../panel/SystemMap';
import { hopsFor, mapFor } from '../panel/stageSpec';
import { plain } from '../../../utils/wording';
import StepCard from './StepCard';

function Stats({ stats }) {
  return (
    <div className="ad-stats">
      <div className="ad-stat"><b>{stats.steps}</b><span>Steps run</span></div>
      <div className="ad-stat"><b>{stats.tools}</b><span>System calls</span></div>
      <div className="ad-stat"><b>{(stats.lat / 1000).toFixed(1)}s</b><span>Agent time</span></div>
      <div className="ad-stat"><b>{stats.human}</b><span>Human touchpoints</span></div>
    </div>
  );
}

/** The step to show on the stage: the one running (or waiting for a person), else the latest one that has started. */
function pickStageStep(steps) {
  const running = [...steps].reverse().find((s) => s.status === 'running' || s.gate || s.awaitHr || s.rerun);
  if (running) return running;
  return [...steps].reverse().find((s) => s.status !== 'queued') ?? null;
}

/** Screen 2: what the agents do behind the chat - stats, who talks to whom, what is happening now, and the step log. */
export default function AgentTimeline({ state, onGate, agentId: agent = 'onboarding', agentName = 'Onboarding' }) {
  // Offboarding (live and simulated) has its own map of the systems it works with; the other agents keep the generic one.
  const agentId = agent === 'offboarding' ? 'offboarding-live' : agent;
  const panel = useRef(null);
  const [logOpen, setLogOpen] = useState(false); // the step log stays tucked away until asked for
  const config = useMemo(() => mapFor(agentId), [agentId]);
  const steps = useMemo(() => state.phases.flatMap((p) => p.steps), [state.phases]);
  const stageStep = pickStageStep(steps);
  const stageId = stageStep?.id;

  // A rerun puts the same step back to running: count the attempts so the flow starts again for it.
  const attempt = useRef({ id: null, status: null, count: 0 });
  if (attempt.current.id !== stageId) attempt.current = { id: stageId, status: null, count: 0 };
  if (attempt.current.status === 'failed' && stageStep?.status === 'running') attempt.current.count += 1;
  attempt.current.status = stageStep?.status ?? null;

  const { activeNodes, usedNodes, hops } = useMemo(() => {
    const active = new Set();
    const used = new Set();
    let stageHops = [];
    steps.forEach((step, index) => {
      if (step.status === 'queued') return;
      const stepHops = hopsFor(step, agentId, index, config.systemCount ?? 0);
      const touched = [step.agent, ...stepHops.flat()];
      touched.forEach((id) => config.nodes[id] && used.add(id));
      if (step.id === stageId) {
        touched.forEach((id) => config.nodes[id] && active.add(id));
        stageHops = stepHops;
      }
    });
    return { activeNodes: active, usedNodes: used, hops: stageHops };
  }, [steps, stageId, agentId, config]);

  const activeLog = steps.find((s) => s.status === 'running' || s.gate || s.awaitHr || s.rerun)?.id;
  useEffect(() => {
    const box = panel.current;
    const target = logOpen && activeLog && box?.querySelector(`[data-step-id="${activeLog}"]`);
    if (!target) return;
    const offset = target.getBoundingClientRect().top - box.getBoundingClientRect().top;
    box.scrollBy({ top: offset - 70, behavior: 'smooth' });
  }, [activeLog, logOpen]);

  useEffect(() => {
    if (state.outcome && panel.current) panel.current.scrollTo({ top: panel.current.scrollHeight, behavior: 'smooth' });
  }, [state.outcome]);

  return (
    <div className="ad-panel" ref={panel}>
      <Stats stats={state.stats} />
      <SystemMap config={config} activeNodes={activeNodes} usedNodes={usedNodes} hops={hops} animateKey={`${stageId ?? 'idle'}:${attempt.current.count}`} flowing={stageStep?.status === 'running' && !stageStep.gate} />
      <Stage step={stageStep} onGate={onGate} />

      <button type="button" className={`ad-logbar${logOpen ? ' open' : ''}`} aria-expanded={logOpen} onClick={() => setLogOpen(!logOpen)}>
        <svg className="ad-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
        <b>Step details</b>
        <span>{steps.filter((s) => s.status !== 'queued').length} of {steps.length} steps</span>
        <em>{logOpen ? 'Hide' : 'Show'}</em>
      </button>

      <div className={`ad-tl${logOpen ? ' open' : ''}`}>
        {logOpen && state.phases.map((phase, index) => (
          <section key={phase.id} className="ad-phase">
            <div className="ad-phase-h">
              <span className="ad-phase-n">{index + 1}</span>
              <div><h3>{phase.title}</h3><p>{phase.sub}</p></div>
            </div>
            <div className="ad-steps">
              {phase.steps.map((step, i) => <StepCard key={step.id} step={step} index={i + 1} />)}
            </div>
          </section>
        ))}

        {state.error && (
          <div className="ad-error" role="alert"><b>{state.busy ? 'A step failed.' : 'The run stopped.'}</b> {plain(state.error)}</div>
        )}

        {state.outcome && !state.stopped && (
          <div className="ad-outcome">
            {agentId === 'offboarding-live' ? (
              <>
                <h3>{state.mode === 'live' ? 'Offboarding complete' : 'Offboarding complete (simulated)'}</h3>
                <p>Every offboarding step finished: the connected systems were updated, the settlement was calculated and the relieving letter was prepared{state.stats.human ? ', with one human approval.' : '.'}</p>
              </>
            ) : agentId === 'leave_attendance' ? (
              <>
                <h3>{state.mode === 'live' ? 'Leave & attendance handled' : 'Leave & attendance handled (simulated)'}</h3>
                <p>The employee's balance, leave request and attendance correction were handled in one chat{state.stats.human ? `, with ${state.stats.human} manager approval${state.stats.human === 1 ? '' : 's'}` : ''}. {state.mode === 'live' ? 'Approved requests were recorded in OrangeHRM.' : 'Nothing was saved anywhere.'}</p>
              </>
            ) : agentName === 'Onboarding' ? (
              <>
                <h3>{state.mode === 'live' ? 'Candidate onboarded' : 'Candidate verified and set up (simulated)'}</h3>
                <p>Three documents checked (Aadhaar, PAN, salary slip) and Day 1 arranged from one WhatsApp conversation{state.stats.human ? ', with one human approval.' : ', with no work for HR.'}</p>
              </>
            ) : (
              <>
                <h3>{agentName} demo complete (simulated)</h3>
                <p>The scripted conversation finished. No real system was contacted.</p>
              </>
            )}
            <Stats stats={state.stats} />
          </div>
        )}
      </div>
    </div>
  );
}
