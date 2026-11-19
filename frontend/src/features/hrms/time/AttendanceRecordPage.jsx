import { useState } from 'react';
import { deleteAttendance, listAttendance, punchIn, punchOut } from '../api';
import EmployeePicker from '../components/EmployeePicker';
import { attendanceRow, fmtDuration, todayISO } from '../components/helpers';
import { AsyncBody, Button, DataTable, Notice, PageCard, rowsOf, StatusPill, TextField } from '../components/ui';
import { useAsync } from '../components/useAsync';

const nowTime = () => new Date().toTimeString().slice(0, 5);

/** Body for a punch call: the time zone comes from the browser. */
export function punchBody({ date, time, note }, now = new Date()) {
  return {
    date,
    time,
    timezoneOffset: -now.getTimezoneOffset() / 60,
    timezoneName: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata',
    note: note ?? '',
  };
}

export default function AttendanceRecordPage() {
  const [employee, setEmployee] = useState(null);
  const [date, setDate] = useState(todayISO());
  const [applied, setApplied] = useState(null);
  const [punch, setPunch] = useState({ date: todayISO(), time: nowTime(), note: '' });
  const [selected, setSelected] = useState(new Set());
  const [status, setStatus] = useState({ busy: false, error: '', ok: '' });

  const state = useAsync(applied ? () => listAttendance(applied.employee.empNumber, { fromDate: applied.date, toDate: applied.date }) : null, [applied]);
  const rows = rowsOf(state.data).map(attendanceRow);
  const open = rows.some((r) => r.open);
  const total = rows.reduce((sum, r) => sum + r.hours, 0);

  const run = async (fn, ok) => {
    setStatus({ busy: true, error: '', ok: '' });
    try {
      await fn();
      setSelected(new Set());
      setStatus({ busy: false, error: '', ok });
      state.reload();
    } catch (e) {
      setStatus({ busy: false, error: e.message, ok: '' });
    }
  };

  const doPunch = (event) => {
    event.preventDefault();
    const n = applied.employee.empNumber;
    const body = punchBody(punch);
    return open ? run(() => punchOut(n, body), 'Punched out.') : run(() => punchIn(n, body), 'Punched in.');
  };
  const toggle = (id) => setSelected((s) => { const next = new Set(s); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  const columns = [
    { key: 'punchIn', label: 'Punch In' },
    { key: 'punchOut', label: 'Punch Out' },
    { key: 'duration', label: 'Duration' },
    { key: 'note', label: 'Note' },
    { key: 'state', label: 'State', render: (r) => <StatusPill status={r.open ? 'Punched In' : 'Punched Out'} /> },
  ];

  return (
    <>
      <PageCard title="Employee Attendance Records">
        <form className="hrms-filters" onSubmit={(e) => { e.preventDefault(); setApplied({ employee, date }); setSelected(new Set()); setStatus({ busy: false, error: '', ok: '' }); }}>
          <EmployeePicker required value={employee} onChange={setEmployee} />
          <TextField label="Date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          <div className="hrms-filter-actions"><Button type="submit" disabled={!employee || !date}>View</Button></div>
        </form>
      </PageCard>
      {applied && (
        <>
          <PageCard title={open ? 'Punch Out' : 'Punch In'}>
            <form className="hrms-form" onSubmit={doPunch}>
              <div className="hrms-form-row three">
                <TextField label="Date" type="date" required value={punch.date} onChange={(e) => setPunch({ ...punch, date: e.target.value })} />
                <TextField label="Time" type="time" required value={punch.time} onChange={(e) => setPunch({ ...punch, time: e.target.value })} />
                <TextField label="Note" value={punch.note} onChange={(e) => setPunch({ ...punch, note: e.target.value })} />
              </div>
              <Notice>{status.error}</Notice>
              <Notice kind="success">{status.ok}</Notice>
              <div className="hrms-form-actions"><Button type="submit" disabled={status.busy || !punch.date || !punch.time}>{open ? 'Punch Out' : 'Punch In'}</Button></div>
            </form>
          </PageCard>
          <PageCard
            title={`Records for ${applied.employee.name}`}
            actions={selected.size > 0 && <Button kind="danger" disabled={status.busy} onClick={() => run(() => deleteAttendance(applied.employee.empNumber, [...selected]), 'Records deleted.')}>Delete Selected ({selected.size})</Button>}
          >
            <AsyncBody state={state}>
              {() => (
                <>
                  <p className="hrms-muted">Total duration: <strong>{fmtDuration(total)}</strong></p>
                  <DataTable columns={columns} rows={rows} selected={selected} onToggle={toggle} empty="No attendance records for this day." />
                </>
              )}
            </AsyncBody>
          </PageCard>
        </>
      )}
    </>
  );
}
