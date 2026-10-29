import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import Modal from '../../components/common/Modal';
import { AGENTS, AGENT_BY_ID } from '../agents/data/agentRegistry';
import AgentTimeline from './components/AgentTimeline';
import EmployeePicker from './components/EmployeePicker';
import PhoneChat from './components/PhoneChat';
import SystemLinks from './components/SystemLinks';
import { useAgentDemo, useDefaultAgent } from './engine/AgentDemoContext';

export default function AgentDemoPage() {
  const { agentId: named } = useParams();
  const { defaultAgentId, remember } = useDefaultAgent();
  const agentId = named ?? defaultAgentId;
  const agent = AGENT_BY_ID[agentId];
  const { state, start, restart, resolveGate, respond } = useAgentDemo(agentId);
  const [askMode, setAskMode] = useState(false);
  const [picking, setPicking] = useState(false); // offboarding / leave Auto-play · Live: choose the employee first
  const [employeeRef, setEmployeeRef] = useState('');
  const location = useLocation();
  const navigate = useNavigate();
  const handled = useRef(null);
  const isOnboarding = agentId === 'onboarding';
  const isOffboarding = agentId === 'offboarding';
  const isLeave = agentId === 'leave_attendance';
  const hasLiveModes = isOffboarding || isLeave; // Auto-play · Simulated, Auto-play · Live (pick an employee) and Manual · Live

  // Each agent keeps its own run in the app-level provider, so switching agent or leaving the page does not lose it.
  const shownAgent = useRef(agentId);
  useEffect(() => {
    if (shownAgent.current === agentId) return; // not on mount: a start dialog may have just been requested
    shownAgent.current = agentId;
    setAskMode(false);
    setPicking(false);
  }, [agentId]);

  // "Live Demo" / "Auto-Fill Demo" navigate here with `state.autoplay` set.
  const request = location.state?.autoplay;
  useEffect(() => {
    if (!agent || !request || handled.current === request) return;
    handled.current = request; // StrictMode runs effects twice in development
    navigate(location.pathname, { replace: true, state: null });
    setAskMode(true); // always ask: auto-play or manual (and, for Onboarding, live or simulated)
  }, [agent, request, navigate, location.pathname]);

  // Remember what the user is looking at, so the sidebar link comes back to it.
  useEffect(() => { if (named && AGENT_BY_ID[named]) remember(named); }, [named, remember]);

  // No agent in the address: pin the one to show (a run in progress, else the last viewed) so it never changes under you.
  if (!named) return <Navigate to={`/agent-demo/${defaultAgentId}`} replace />;
  if (!agent) return <Navigate to="/agent-demo" replace />;

  const play = () => setAskMode(true);
  const closeDialog = () => { setAskMode(false); setPicking(false); };
  const run = (mode, manual = false, extra = {}) => {
    closeDialog();
    start(agentId, mode, { manual, ...extra });
  };

  return (
    <section className="view-section active agent-demo">
      <header className="ad-top">
        <div>
          <div className="ad-crumb">HR AI Agents › <b>{agent.catalogName}</b></div>
          <h1>{agent.name}, live demo</h1>
        </div>
        <div className="ad-controls">
          {state.mode === 'live' && <SystemLinks run={state.runRecord} busy={state.busy} />}
          <select className="ad-select" value={agentId} onChange={(event) => navigate(`/agent-demo/${event.target.value}`)} aria-label="Choose agent">
            {AGENTS.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          {state.mode && (
            <span className={`ad-mode ${state.mode}`}>
              {state.manual ? 'Manual · ' : ''}{state.mode === 'live' ? 'Live' : 'Simulated only'}
            </span>
          )}
          <button type="button" className="ad-btn" onClick={restart} disabled={!state.mode}>Restart</button>
          <button type="button" className="ad-btn primary" onClick={play} disabled={state.busy}>Start demo</button>
        </div>
      </header>

      <div className="ad-screens">
        <section aria-label="Candidate's WhatsApp chat">
          <div className="ad-cap">Screen 1 · What the user sees</div>
          <PhoneChat state={state} title={agent.name} initial={agent.catalogName[0]} onRespond={respond} />
        </section>
        <section aria-label="What the agents do">
          <div className="ad-cap">Screen 2 · What the agents do behind it</div>
          <AgentTimeline state={state} onGate={resolveGate} agentId={agentId} agentName={agent.catalogName} />
        </section>
      </div>

      {askMode && (
        <Modal
          title={`Start the ${agent.catalogName.toLowerCase()} demo`}
          icon="fa-play"
          onClose={closeDialog}
          maxWidth={600}
          footer={
            hasLiveModes && picking ? (
              <>
                <button type="button" className="btn btn-secondary" onClick={() => setPicking(false)}>Back</button>
                <button type="button" className="btn btn-primary" disabled={!employeeRef} onClick={() => run('live', false, { employeeRef })}><i className="fa-solid fa-bolt"></i> Start live run</button>
              </>
            ) : hasLiveModes ? (
              <>
                <button type="button" className="btn btn-secondary" onClick={closeDialog}>Cancel</button>
                <button type="button" className="btn btn-secondary" onClick={() => run('simulated')}>Auto-play · Simulated</button>
                <button type="button" className="btn btn-secondary" onClick={() => { setEmployeeRef(''); setPicking(true); }}><i className="fa-solid fa-bolt"></i> Auto-play · Live</button>
                <button type="button" className="btn btn-primary" onClick={() => run('live', true)}><i className="fa-solid fa-keyboard"></i> Manual · Live</button>
              </>
            ) : isOnboarding ? (
              <>
                <button type="button" className="btn btn-secondary" onClick={closeDialog}>Cancel</button>
                <button type="button" className="btn btn-secondary" onClick={() => run('simulated')}>Auto-play · Simulated</button>
                <button type="button" className="btn btn-secondary" onClick={() => run('live')}><i className="fa-solid fa-bolt"></i> Auto-play · Live</button>
                <button type="button" className="btn btn-primary" onClick={() => run('live', true)}><i className="fa-solid fa-keyboard"></i> Manual · Live</button>
              </>
            ) : (
              <>
                <button type="button" className="btn btn-secondary" onClick={() => setAskMode(false)}>Cancel</button>
                <button type="button" className="btn btn-secondary" onClick={() => run('simulated')}>Auto-play</button>
                <button type="button" className="btn btn-primary" onClick={() => run('simulated', true)}><i className="fa-solid fa-keyboard"></i> Manual</button>
              </>
            )
          }
        >
          <div style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
            {isLeave && picking ? (
              <>
                <p>This is a <b>real</b> run: it reads and changes the employee’s leave and punches in OrangeHRM, each step preceded by its AutomationEdge workflow. After the manager approves on the HR Approvals page (Leave tab), the leave is booked and the punch corrected in OrangeHRM. Pick a test employee.</p>
                <EmployeePicker value={employeeRef} onChange={setEmployeeRef} kind="leave" />
              </>
            ) : isLeave ? (
              <>
                <p><b>Manual · Live</b> — you are the employee. Give your employee ID or work e-mail (it must be someone onboarded through this portal), then ask for your leave balance and holidays, apply for leave, or fix a missed attendance punch. Balances, holidays and punches come from <b>OrangeHRM</b>, and each step runs its <b>AutomationEdge</b> workflow first. The manager approves on the HR Approvals page (Leave tab); only then is the leave booked, or the punch corrected, in OrangeHRM.</p>
                <p><b>Auto-play · Live</b> plays the same three requests for an employee you choose. <b>Auto-play · Simulated</b> is the scripted demo; nothing is saved or contacted.</p>
              </>
            ) : isOffboarding && picking ? (
              <>
                <p>This is a <b>real</b> run: it blocks the chosen employee's Microsoft 365 account, ends their OrangeHRM employment and raises ServiceNow tickets, after HR approves it on the HR Approvals page. Pick a test employee.</p>
                <EmployeePicker value={employeeRef} onChange={setEmployeeRef} />
              </>
            ) : isOnboarding ? (
              <>
                <p><b>Manual · Live</b> — you are the candidate. You type, fill the joining form, attach your own PDF/Word documents and sign. A <b>real record and ServiceNow request are created from what you enter</b>, and the AutomationEdge candidate workflow starts. Accounts, laptop ticket and offer letter are created only after you click “Approve &amp; provision”. Document reading/verification is not included yet: files are accepted and attached.</p>
                <p><b>Auto-play · Live</b> plays the same journey with sample data and real systems. <b>Auto-play · Simulated</b> contacts nothing.</p>
              </>
            ) : isOffboarding ? (
              <>
                <p><b>Manual · Live</b> — you are the employee. Give your employee ID or work e-mail (it must be someone onboarded through this portal), fill in the resignation form, and a <b>real offboarding record and ServiceNow ticket</b> are created. Access is removed, the employment ended and the relieving letter sent only after HR approves it on the HR Approvals page (Offboarding tab): AutomationEdge workflows run first, then Active Directory, Microsoft 365, OrangeHRM and ServiceNow are updated.</p>
                <p><b>Auto-play · Live</b> plays the same journey for an employee you choose, with real systems. <b>Auto-play · Simulated</b> is the scripted demo; no real system is contacted.</p>
              </>
            ) : (
              <>
                <p><b>Manual</b> — type a message or tap a suggestion and the agent answers with its scripted response. Everything is <i>Simulated</i>; no real system is contacted.</p>
                <p><b>Auto-play</b> runs all of this agent’s scripted prompts one after another.</p>
              </>
            )}
          </div>
        </Modal>
      )}
    </section>
  );
}
