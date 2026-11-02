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
  const isPayroll = agentId === 'payroll_salary';
  const isReimbursement = agentId === 'reimbursement_benefits';
  const isPolicy = agentId === 'hr_policy';
  const hasLiveModes = isOffboarding || isLeave || isPayroll || isReimbursement || isPolicy; // Auto-play · Simulated, Auto-play · Live (pick an employee) and Manual · Live

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
          {state.mode === 'live' && !isPayroll && !isPolicy && <SystemLinks run={state.runRecord} busy={state.busy} />}
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
            {isPolicy && picking ? (
              <>
                <p>This is a <b>real</b> run, each step followed by its AutomationEdge workflow: a dropdown offers the PDFs in the policies folder, a policy question (and a follow-up) goes to the knowledge base, and both letters are made from the Word templates in the HR documents folder with the employee’s details. Nothing is changed anywhere. Pick a test employee.</p>
                <EmployeePicker value={employeeRef} onChange={setEmployeeRef} kind="hr_policy" />
              </>
            ) : isPolicy ? (
              <>
                <p><b>Manual · Live</b> — you are the employee. Give your employee ID or work e-mail (it must be someone onboarded through this portal), then <b>choose a policy</b> from a dropdown and download it (each step is followed by its <b>AutomationEdge</b> workflow), ask a <b>policy question</b> (and follow-ups) or request a <b>letter</b>: an address proof letter or a bank account opening letter. Questions are answered by the <b>knowledge base</b> from the company’s policy documents; the letters are Word files made from the templates kept in the HR documents folder, with your name, employee code, designation and dates filled in.</p>
                <p><b>Auto-play · Live</b> downloads a policy, asks a policy question and a follow-up, then requests both letters, for an employee you choose. <b>Auto-play · Simulated</b> is the scripted demo; nothing is contacted.</p>
              </>
            ) : isReimbursement && picking ? (
              <>
                <p>This is a <b>real</b> run: three sample bills are uploaded and read with OpenAI, each step followed by its AutomationEdge workflow. After the manager approves or rejects each bill on the Approvals page (Reimbursement tab), the approved bills are recorded in OrangeHRM (Claim). Pick a test employee.</p>
                <EmployeePicker value={employeeRef} onChange={setEmployeeRef} kind="reimbursement" />
              </>
            ) : isReimbursement ? (
              <>
                <p><b>Manual · Live</b> — you are the employee. Give your employee ID or work e-mail (it must be someone onboarded through this portal), then upload your bills of any kind, one after another (PDF or a photo). Each bill is read with <b>OpenAI</b>: the kind of expense, its date, amount and vendor, and the steps are followed by their <b>AutomationEdge</b> workflows. <b>Travel and Food</b> are within the company policy, but your manager approves or rejects <b>every bill</b> on the Approvals page (Reimbursement tab); only the approved bills are recorded in <b>OrangeHRM</b>.</p>
                <p><b>Auto-play · Live</b> uploads three sample bills for an employee you choose. <b>Auto-play · Simulated</b> is the scripted demo; nothing is saved or contacted.</p>
              </>
            ) : isPayroll && picking ? (
              <>
                <p>This is a <b>real</b> run: the employee’s salary is read from OrangeHRM and the backend makes the payslip, CTC statement and Form 16 as PDFs for download. Nothing is changed in OrangeHRM. Pick a test employee.</p>
                <EmployeePicker value={employeeRef} onChange={setEmployeeRef} kind="payroll" />
              </>
            ) : isPayroll ? (
              <>
                <p><b>Manual · Live</b> — you are the employee. Give your employee ID or work e-mail (it must be someone onboarded through this portal), then download your <b>payslip</b> (pick the month), your <b>CTC statement</b> or your <b>Form 16</b> (for the last financial year), each a PDF. The annual CTC comes from <b>OrangeHRM</b>.</p>
                <p><b>Auto-play · Live</b> asks for the same three documents for an employee you choose. <b>Auto-play · Simulated</b> is the scripted demo; nothing is contacted.</p>
              </>
            ) : isLeave && picking ? (
              <>
                <p>This is a <b>real</b> run: it reads and changes the employee’s leave and punches in OrangeHRM, each step preceded by its AutomationEdge workflow. After the manager approves on the Approvals page (Leave tab), the leave is booked and the attendance recorded in OrangeHRM. Pick a test employee.</p>
                <EmployeePicker value={employeeRef} onChange={setEmployeeRef} kind="leave" />
              </>
            ) : isLeave ? (
              <>
                <p><b>Manual · Live</b> — you are the employee. Give your employee ID or work e-mail (it must be someone onboarded through this portal), then ask for your leave balance and holidays, apply for leave, or raise an attendance request (the day, when you came in and when you left). Balances, holidays and punches come from <b>OrangeHRM</b>, and each step runs its <b>AutomationEdge</b> workflow first. The manager approves on the Approvals page (Leave tab); only then is the leave booked, or the attendance recorded, in OrangeHRM.</p>
                <p><b>Auto-play · Live</b> plays the same three requests for an employee you choose. <b>Auto-play · Simulated</b> is the scripted demo; nothing is saved or contacted.</p>
              </>
            ) : isOffboarding && picking ? (
              <>
                <p>This is a <b>real</b> run: it blocks the chosen employee's Microsoft 365 account, ends their OrangeHRM employment and raises ServiceNow tickets, after HR approves it on the Approvals page. Pick a test employee.</p>
                <EmployeePicker value={employeeRef} onChange={setEmployeeRef} />
              </>
            ) : isOnboarding ? (
              <>
                <p><b>Manual · Live</b> — you are the candidate. You type, fill the joining form, attach your own PDF/Word documents and sign. A <b>real record and ServiceNow request are created from what you enter</b>, and the AutomationEdge candidate workflow starts. Accounts and the laptop ticket are created only after you click “Approve &amp; provision”. Document reading/verification is not included yet: files are accepted and attached.</p>
                <p><b>Auto-play · Live</b> plays the same journey with sample data and real systems. <b>Auto-play · Simulated</b> contacts nothing.</p>
              </>
            ) : isOffboarding ? (
              <>
                <p><b>Manual · Live</b> — you are the employee. Give your employee ID or work e-mail (it must be someone onboarded through this portal), fill in the resignation form, and a <b>real offboarding record and ServiceNow ticket</b> are created. Access is removed, the employment ended and the relieving letter sent only after HR approves it on the Approvals page (Offboarding tab): AutomationEdge workflows run first, then Active Directory, Microsoft 365, OrangeHRM and ServiceNow are updated.</p>
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
