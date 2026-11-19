import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { cancelLeaveRequest, getLeaveRequest } from '../api';
import { fmtDate, leaveRequestRow } from '../components/helpers';
import { AsyncBody, Button, Notice, PageCard, StatusPill } from '../components/ui';
import { useAsync } from '../components/useAsync';
import { hrmsPath } from '../layout/menu';

function Row({ label, children }) {
  return <div className="hrms-detail-row"><dt>{label}</dt><dd>{children}</dd></div>;
}

export default function LeaveRequestPage() {
  const { id } = useParams();
  const [version, setVersion] = useState(0);
  const state = useAsync(() => getLeaveRequest(id), [id, version]);
  const [status, setStatus] = useState({ busy: false, error: '' });

  const cancel = async () => {
    setStatus({ busy: true, error: '' });
    try {
      await cancelLeaveRequest(id);
      setStatus({ busy: false, error: '' });
      setVersion((v) => v + 1);
    } catch (e) {
      setStatus({ busy: false, error: e.message });
    }
  };

  return (
    <PageCard title={`Leave Request #${id}`} actions={<Link className="hrms-link" to={hrmsPath('leave/viewLeaveList')}>Back to Leave List</Link>}>
      <AsyncBody state={state}>
        {(res) => {
          const raw = res?.data ?? {};
          const r = leaveRequestRow(raw);
          const cancelled = /cancel|reject|taken/i.test(r.status);
          return (
            <>
              <dl className="hrms-details">
                <Row label="Employee">{r.employee}</Row>
                <Row label="Leave Type">{r.type}</Row>
                <Row label="Dates">{r.date}</Row>
                <Row label="Number of Days">{r.days}</Row>
                <Row label="Status"><StatusPill status={r.statusLabel} /></Row>
                <Row label="Comments">{r.comment || '-'}</Row>
                {raw.dates?.fromDate && <Row label="From / To">{fmtDate(raw.dates.fromDate)} / {fmtDate(raw.dates.toDate)}</Row>}
              </dl>
              <Notice>{status.error}</Notice>
              {!cancelled && <Button kind="danger" onClick={cancel} disabled={status.busy}>{status.busy ? 'Cancelling...' : 'Cancel Leave'}</Button>}
            </>
          );
        }}
      </AsyncBody>
    </PageCard>
  );
}
