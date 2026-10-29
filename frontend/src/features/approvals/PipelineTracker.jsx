import { plain } from '../../utils/wording';

const STATE_CLASS = { pending: 'pending', running: 'active', success: 'done', failed: 'failed', skipped: 'skipped' };
const STATE_ICON = {
  pending: 'fa-ellipsis',
  running: 'fa-gear',
  success: 'fa-check',
  failed: 'fa-xmark',
  skipped: 'fa-forward',
};
const STATE_LABEL = { pending: 'Waiting', running: 'Running', success: 'Done', failed: 'Failed', skipped: 'Skipped' };

function duration(step) {
  if (!step.startedAt || !step.finishedAt) return null;
  const seconds = (new Date(step.finishedAt) - new Date(step.startedAt)) / 1000;
  return seconds >= 1 ? `${seconds.toFixed(0)}s` : '<1s';
}

/** Live view of the 7-step provisioning pipeline, styled like the AutomationEdge execution tracker. */
export default function PipelineTracker({ steps, emptyText = 'The provisioning pipeline starts when HR approves this candidate.' }) {
  if (!steps.length) {
    return <p style={{ color: 'var(--text-muted)' }}>{emptyText}</p>;
  }
  return (
    <div className="ae-step-container" style={{ margin: 0 }}>
      {steps.map((step, index) => (
        <div key={step.key} className={`ae-step-item ${STATE_CLASS[step.status]}`}>
          <div className="ae-step-icon">
            {step.status === 'pending' ? index + 1 : <i className={`fa-solid ${STATE_ICON[step.status]}`}></i>}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong>{index + 1}. {step.label}</strong>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>
              {plain(step.message) ?? step.system}
            </div>
          </div>
          <div className="step-meta">
            <span className={`step-state step-state-${step.status}`}>{STATE_LABEL[step.status]}</span>
            {duration(step) && <span style={{ color: 'var(--text-dim)' }}>{duration(step)}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
