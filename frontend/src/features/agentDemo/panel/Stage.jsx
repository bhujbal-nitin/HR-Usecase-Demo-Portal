import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon';
import { plain } from '../../../utils/wording';
import { VERB, iconFor, vizFor } from './stageSpec';
import { Buddy, Checks, Checksum, Classify, Compare, External, Gauge, Inbound, Intent, Ocr, Package, Plan, Range, RecordViz, Sent, Storage, Working, Workflow } from './Viz';

const VIZ = {
  inbound: Inbound, intent: Intent, plan: Plan, record: RecordViz, sent: Sent, checks: Checks, storage: Storage, classify: Classify, ocr: Ocr,
  checksum: Checksum, compare: Compare, external: External, range: Range, package: Package, gauge: Gauge, buddy: Buddy, workflow: Workflow, think: Intent,
};

/** Seconds left until a simulated approval approves itself (null when it does not). */
function useCountdown(until) {
  const [left, setLeft] = useState(() => (until ? Math.max(0, Math.ceil((until - Date.now()) / 1000)) : null));
  useEffect(() => {
    if (!until) return undefined;
    const tick = () => setLeft(Math.max(0, Math.ceil((until - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [until]);
  return left;
}

/** The step is waiting for HR: the approval gate lives here so it cannot be missed. */
function Approval({ step, onGate }) {
  const secondsLeft = useCountdown(step.gate ? step.payload?.autoApproveAt : null);
  if (step.awaitHr) {
    return (
      <div className="ad-vz ad-v-wait">
        <div className="ad-gate ad-await" role="status" aria-label="Waiting for HR approval">
          <div className="ad-v-waiting"><span><Icon name="user" size={18} />Waiting for HR to approve the request<span className="ad-dots"><i></i><i></i><i></i></span></span>
            <small>HR approves on the <b>HR Approvals</b> page. This run continues by itself as soon as the request is approved there.</small>
          </div>
          <div className="ad-gate-actions">
            <Link className="ad-btn primary" to={step.payload?.openTo ?? '/approvals'}><i className="fa-solid fa-clipboard-check"></i> Open HR Approvals</Link>
          </div>
        </div>
      </div>
    );
  }
  if (step.gate) {
    return (
      <div className="ad-vz ad-v-wait">
        <div className="ad-gate" role="group" aria-label="HR approval">
          <div className="ad-v-waiting"><span><Icon name="user" size={18} />Waiting for HR approval<span className="ad-dots"><i></i><i></i><i></i></span></span>
            <small>{step.payload?.warning ?? 'Approving creates real accounts and tickets in the connected systems.'}{secondsLeft !== null && <b> Approving itself in {secondsLeft}s.</b>}</small>
          </div>
          <div className="ad-gate-actions">
            <button type="button" className="ad-btn primary" onClick={() => onGate('approve')}><i className="fa-solid fa-bolt"></i> {step.payload?.approveLabel ?? 'Approve & provision'}</button>
            <button type="button" className="ad-btn" onClick={() => onGate('stop')}>Stop here</button>
          </div>
        </div>
      </div>
    );
  }
  const decision = step.payload?.decision;
  return (
    <div className="ad-vz">
      <span className="ad-tick big"><Icon name="check" size={20} /></span>
      <div><b>{decision ? String(decision).replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()) : 'Decision recorded'}</b>
        <div className="ad-v-sub">{step.payload?.reason ?? step.payload?.approver ?? step.payload?.note ?? ''}</div></div>
    </div>
  );
}

/** A step failed and the chain stopped: say why, and offer the rerun right here. */
function Failure({ step, onGate }) {
  return (
    <div className="ad-vz ad-v-wait">
      <div className="ad-rerun" role="group" aria-label="Rerun">
        <div className="ad-v-fail"><Icon name="alert" size={20} /><div><b>This step failed.</b>
          <div className="ad-v-sub">{plain(step.payload?.message ?? step.payload?.error) ?? 'Open this step in the log for details.'}</div>
          <div className="ad-v-sub">Rerun starts again from here (earlier steps are kept). Skip carries on with the next step without this one.</div></div></div>
        <div className="ad-gate-actions">
          <button type="button" className="ad-btn primary" onClick={() => onGate('rerun')}><i className="fa-solid fa-rotate-right"></i> Rerun from this step</button>
          {step.canSkip !== false && <button type="button" className="ad-btn" onClick={() => onGate('skip')}><i className="fa-solid fa-forward"></i> Skip this step</button>}
          <button type="button" className="ad-btn" onClick={() => onGate('stop')}>Stop here</button>
        </div>
      </div>
    </div>
  );
}

function Idle() {
  return (
    <div className="ad-empty">
      <p>Press <b>Start demo</b>. This area shows what the agents are doing at each moment: reading a document, checking a number, running a workflow, or waiting for a person.</p>
      <div className="ad-legend">
        {[['trigger', 'Trigger', 'event arrives'], ['agent', 'Agent', 'an LLM decides'], ['tool', 'Tool', 'fixed rule or internal call'], ['api', 'Integration', 'outside system'], ['human', 'Human', 'a person decides'], ['notify', 'Notify', 'reply goes out']].map(([kind, label, text]) => (
          <span key={kind} className="i"><span className={`ad-kind ${kind}`}>{label}</span>{text}</span>
        ))}
        <span className="i"><span className="ad-tag live">Live</span>really executed</span>
        <span className="i"><span className="ad-tag sim">Simulated</span>scripted</span>
      </div>
    </div>
  );
}

export default function Stage({ step, onGate }) {
  if (!step) {
    return (
      <div className="ad-stage">
        <div className="ad-st-head"><span className="ad-ico k-agent"><Icon name="sparkle" size={16} /></span><b>Idle</b><span className="ad-st-verb">Waiting to start</span></div>
        <div className="ad-st-body"><Idle /></div>
      </div>
    );
  }

  const running = step.status === 'running';
  const verb = step.status === 'failed' ? 'Failed' : step.status === 'queued' ? 'Up next' : running ? VERB[step.kind] : null;
  let body;
  if (step.rerun) body = <Failure step={step} onGate={onGate} />;
  else if (step.name === 'hr.approve()' || step.kind === 'human') body = <Approval step={step} onGate={onGate} />;
  else if (!step.payload && running) body = <Working step={step} />;
  else {
    const View = VIZ[vizFor(step)] ?? RecordViz;
    body = <View key={`${step.id}-${step.status}`} step={step} />;
  }

  return (
    <div className="ad-stage" aria-live="polite">
      <div className="ad-st-head">
        <span className={`ad-ico k-${step.kind}`}><Icon name={iconFor(step)} size={16} /></span>
        <b>{plain(step.title)}</b>
        <span className={`ad-tag ${step.live ? 'live' : 'sim'}`}>{step.live ? 'Live' : 'Simulated'}</span>
        <span className={`ad-st-verb${verb ? '' : ' done'}${step.status === 'failed' ? ' bad' : ''}`}>
          {verb ? <>{verb}{running && <span className="ad-dots"><i></i><i></i><i></i></span>}</> : <><Icon name="check" size={14} /> Done{step.latLabel ? ` in ${step.latLabel}` : ''}</>}
        </span>
      </div>
      <div className="ad-st-body">{body}</div>
    </div>
  );
}
