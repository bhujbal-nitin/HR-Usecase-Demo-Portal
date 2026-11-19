import { useState } from 'react';
import { attendanceSummary } from '../api';
import { fmtDuration, fullName, todayISO } from '../components/helpers';
import { AsyncBody, Button, DataTable, PageCard, rowsOf, TextField } from '../components/ui';
import { useAsync } from '../components/useAsync';

/** Total hours of a summary row: tolerant of the field names HRMS and the replica may use. */
export function summaryHours(r) {
  const v = r.totalHours ?? r.total ?? r.sum?.total ?? r.sum?.totalTime ?? 0;
  return Number(v) || 0;
}

const monthStart = () => `${todayISO().slice(0, 8)}01`;

export default function AttendanceSummaryPage() {
  const [draft, setDraft] = useState({ from: monthStart(), to: todayISO() });
  const [applied, setApplied] = useState(draft);
  const state = useAsync(() => attendanceSummary({ fromDate: applied.from, toDate: applied.to }), [applied]);

  const columns = [
    { key: 'name', label: 'Employee Name' },
    { key: 'hours', label: 'Total Duration' },
  ];

  return (
    <>
      <PageCard title="Attendance Summary">
        <form className="hrms-filters" onSubmit={(e) => { e.preventDefault(); setApplied(draft); }}>
          <TextField label="From Date" type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
          <TextField label="To Date" type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
          <div className="hrms-filter-actions"><Button type="submit">View</Button></div>
        </form>
      </PageCard>
      <PageCard title="Employee Records">
        <AsyncBody state={state}>
          {(res) => {
            const rows = rowsOf(res).map((r, i) => ({ id: r.empNumber ?? i, name: fullName(r), hours: fmtDuration(summaryHours(r)) }));
            return <DataTable columns={columns} rows={rows} empty="No attendance records in this period." />;
          }}
        </AsyncBody>
      </PageCard>
    </>
  );
}
