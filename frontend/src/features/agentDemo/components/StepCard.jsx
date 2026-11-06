import { useState } from 'react';
import Icon from '../panel/Icon';
import { plain } from '../../../utils/wording';
import { iconFor } from '../panel/stageSpec';
import { toRows } from '../lib/humanize';

const KIND_LABEL = { trigger: 'Trigger', agent: 'Agent', tool: 'Tool', api: 'Integration', human: 'Human', notify: 'Notify' };
const AGENT_NAME = { orch: 'AutomationEdge Orchestrator', doc: 'Document Agent', ver: 'Verification Agent', prov: 'Provisioning Agent', spec: 'Specialist Agent', sys: 'Integration Agent', leave: 'Leave & Attendance Agent', pay: 'Payroll & Salary Agent', reimb: 'Reimbursement & Benefits Agent', policy: 'HR Policy & Document Agent' };
const BADGE = { queued: 'Pending', running: 'Active', waiting: 'Waiting', done: 'Done', warn: 'Attention', failed: 'Failed', skipped: 'Skipped' };

function Rows({ rows }) {
  return (
    <dl className="ad-rows">
      {rows.map((row, i) => (
        <div key={`${row.label}-${i}`} className="ad-row">
          <dt>{row.label}</dt>
          <dd>{row.children ? <Rows rows={row.children} /> : row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** One line of the compact step log. Click it to see the note and the data the step handled. `map` is the demo's system map: the agent is named as the map names it. */
export default function StepCard({ step, index, map }) {
  const [open, setOpen] = useState(false);
  const waiting = step.gate || step.awaitHr || step.rerun;

  return (
    <div className={`ad-step${open ? ' open' : ''}`} data-s={step.status} data-step-id={step.id}>
      <span className={`ad-ico k-${step.kind}`}>
        <Icon name={iconFor(step)} size={16} />
        <span className="ad-badge-dot">{step.status === 'failed' ? '×' : step.status === 'warn' ? '!' : <Icon name="check" size={9} />}</span>
      </span>
      <div className="ad-card">
        <button type="button" className="ad-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="ad-t1">
            <span className={`ad-kind ${step.kind}`}>{KIND_LABEL[step.kind]}</span>
            <h4>{index}. {plain(step.title)}</h4>
            <span className={`ad-tag ${step.live ? 'live' : 'sim'}`}>{step.live ? 'Live' : 'Simulated'}</span>
            <span className="ad-lat">{step.status === 'skipped' ? '' : step.latLabel}</span>
            <span className={`ad-badge ${step.status}`}>{waiting ? 'Waiting' : BADGE[step.status] ?? step.status}</span>
            <svg className="ad-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
          </span>
          <span className="ad-t2"><span>{map?.nodes[map.alias?.[step.agent] ?? step.agent]?.label ?? AGENT_NAME[step.agent]}</span></span>
        </button>
        {open && (
          <div className="ad-more">
            <p>{plain(step.note)}</p>
            {step.payload && <Rows rows={toRows(step.payload)} />}
          </div>
        )}
      </div>
    </div>
  );
}
