import { documentUrl, retryIntake, retryProvisioning, skipIntakeStep, skipProvisioningStep } from '../../api/employees';
import Modal from '../../components/common/Modal';
import StatusBadge from '../../components/common/StatusBadge';
import { useEmployees } from '../../context/EmployeesContext';
import { useToast } from '../../context/ToastContext';
import { formatDate, formatDateTime, formatInr, formatLpa } from '../../utils/format';
import { DOCUMENTS } from '../onboarding/constants';
import PipelineTracker from './PipelineTracker';
import Sensitive from './Sensitive';

function Section({ icon, title, children }) {
  return (
    <section className="detail-section">
      <h4><i className={`fa-solid ${icon} text-accent`}></i> {title}</h4>
      {children}
    </section>
  );
}

function Rows({ rows }) {
  return (
    <table className="chat-widget-table">
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}><td><strong>{label}</strong></td><td>{value ?? '—'}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

const external = (url, text) => (url ? <a href={url} target="_blank" rel="noreferrer">{text} <i className="fa-solid fa-arrow-up-right-from-square"></i></a> : text);

export default function CandidateDetailModal({ employeeId, onClose, onApprove, onReject }) {
  const { employees, refresh } = useEmployees();
  const { showToast } = useToast();
  const employee = employees.find((e) => e.id === employeeId);
  if (!employee) return null;

  const { serviceNow: sn, office365, orangeHrm, laptop } = employee;
  const pending = employee.status === 'Pending Review';

  const retry = async () => {
    try {
      await retryIntake(employee.id);
      showToast('Retrying the intake chain.', 'info');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      refresh();
    }
  };

  const rerun = async () => {
    try {
      await retryProvisioning(employee.id);
      showToast('Re-running from the failed step.', 'info');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      refresh();
    }
  };

  const skipFailed = async (skipStep, message) => {
    try {
      await skipStep(employee.id);
      showToast(message, 'info');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      refresh();
    }
  };

  return (
    <Modal
      title={employee.fullName}
      icon="fa-user"
      onClose={onClose}
      maxWidth={820}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
          {employee.pipeline.some((s) => s.status === 'failed') && ['Provisioning Failed', 'Approved'].includes(employee.status) && (
            <>
              <button type="button" className="btn btn-secondary" onClick={rerun}><i className="fa-solid fa-rotate-right"></i> Rerun from failed step</button>
              <button type="button" className="btn btn-secondary" onClick={() => skipFailed(skipProvisioningStep, 'Skipped the failed step; continuing with the next one.')}><i className="fa-solid fa-forward"></i> Skip failed step</button>
            </>
          )}
          {pending && employee.intakeStatus === 'failed' && (
            <>
              <button type="button" className="btn btn-secondary" onClick={retry}><i className="fa-solid fa-rotate"></i> Retry intake</button>
              <button type="button" className="btn btn-secondary" onClick={() => skipFailed(skipIntakeStep, 'Skipped the failed intake step; continuing.')}><i className="fa-solid fa-forward"></i> Skip failed step</button>
            </>
          )}
          {pending && (
            <>
              <button type="button" className="btn btn-rose" onClick={() => onReject(employee)}>
                <i className="fa-solid fa-xmark"></i> Reject
              </button>
              <button type="button" className="btn btn-emerald" onClick={() => onApprove(employee)}>
                <i className="fa-solid fa-bolt"></i> Approve &amp; Provision
              </button>
            </>
          )}
        </>
      }
    >
      <div className="detail-top">
        <span style={{ color: 'var(--text-muted)' }}>{employee.id} · submitted {formatDateTime(employee.submittedAt)}</span>
        <StatusBadge status={employee.status} />
      </div>

      <Section icon="fa-id-card" title="Candidate">
        <Rows rows={[
          ['Email', employee.email],
          ['Phone', employee.phone],
          ['Date of birth', formatDate(employee.dob)],
          ['Aadhaar', <Sensitive key="a" value={employee.aadhaar} label="Aadhaar number" />],
          ...(employee.uan ? [['EPFO UAN', <Sensitive key="u" value={employee.uan} label="UAN" />]] : []),
          ['Address', employee.address],
          ['Emergency contact', `${employee.emergencyName} · ${employee.emergencyPhone}`],
        ]} />
      </Section>

      <Section icon="fa-briefcase" title="Employment">
        <Rows rows={[
          ['Role', `${employee.jobTitle} · ${employee.department}`],
          ['Reporting manager', employee.manager],
          ['Joining date', formatDate(employee.startDate)],
          ['Compensation', `${formatInr(employee.annualCtc)} per annum (${formatLpa(employee.annualCtc)})`],
          ['Work location', employee.workLocation],
          ['Workstation', employee.hardware],
        ]} />
      </Section>

      <Section icon="fa-folder-open" title="Verification documents">
        <div className="doc-list">
          {DOCUMENTS.map(({ key, title }) => {
            const doc = employee.documents[key];
            return (
              <div key={key} className="doc-row">
                <i className="fa-solid fa-file-pdf"></i>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong>{title}</strong>
                  <div className="file-name" style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{doc?.filename ?? (employee.intakeStatus === 'awaiting_documents' ? 'Not received yet' : 'Not available')}</div>
                </div>
                {doc && (
                  <a className="btn btn-secondary" style={{ padding: '0.35rem 0.8rem', fontSize: '0.8rem' }} href={documentUrl(employee.id, key)} target="_blank" rel="noreferrer">
                    <i className="fa-solid fa-download"></i> Open
                  </a>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      <Section icon="fa-headset" title="ServiceNow request">
        <Rows rows={[
          ['Request', sn.reqNumber ? external(sn.reqUrl, sn.reqNumber) : 'Not created'],
          ['Requested item', sn.ritmNumber ? external(sn.ritmUrl, sn.ritmNumber) : '—'],
          ['Approval', sn.approvalStatus],
          ['Stage', sn.stage],
          ['Attachments', sn.attachedDocuments.length ? sn.attachedDocuments.join(', ') : '—'],
        ]} />
        {sn.syncError && <p className="inline-warning"><i className="fa-solid fa-triangle-exclamation"></i> {sn.syncError}</p>}
      </Section>

      {employee.intake.length > 0 && (
        <Section icon="fa-inbox" title="Intake (runs after submit)">
          <PipelineTracker steps={employee.intake} />
        </Section>
      )}

      <Section icon="fa-list-check" title="Provisioning pipeline">
        <PipelineTracker steps={employee.pipeline} />
      </Section>

      {(office365 || orangeHrm || laptop) && (
        <Section icon="fa-circle-check" title="Provisioned">
          <Rows rows={[
            ['Corporate e-mail', office365?.userPrincipalName ? external(office365.adminUrl, office365.userPrincipalName) : '—'],
            ['Temporary password', office365?.initialPassword ? <Sensitive key="p" value={office365.initialPassword} label="temporary password" /> : office365?.alreadyExisted ? 'Account already existed' : '—'],
            ['OrangeHRM profile', orangeHrm?.empNumber ? external(orangeHrm.profileUrl, `#${orangeHrm.empNumber}`) : '—'],
            ['Laptop incident', laptop?.ticketNumber ? external(laptop.ticketUrl, laptop.ticketNumber) : '—'],
          ]} />
        </Section>
      )}

      {employee.workflowRuns.length > 0 && (
        <Section icon="fa-bolt" title="AutomationEdge executions">
          <div className="table-responsive">
            <table className="data-table compact">
              <thead><tr><th>Workflow</th><th>Request</th><th>Status</th><th>Agent</th></tr></thead>
              <tbody>
                {employee.workflowRuns.map((run, index) => (
                  <tr key={`${run.workflowName}-${index}`} title={run.message ?? ''}>
                    <td>{run.workflowName}</td>
                    <td>{run.automationRequestId ? external(run.instanceUrl, `#${run.automationRequestId}`) : '—'}</td>
                    <td><span className={`badge ${run.executionStatus === 'Complete' ? 'badge-approved' : run.executionStatus?.startsWith('Fail') ? 'badge-rejected' : 'badge-pending'}`}>{run.executionStatus ?? '—'}</span></td>
                    <td>{run.agentName ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </Modal>
  );
}
