import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { addClaimExpense, claimAction, getClaim, listClaimExpenses, listExpenseTypes } from '../api';
import { claimRow, fmtDate, fmtNumber, todayISO } from '../components/helpers';
import { AsyncBody, Button, DataTable, Notice, PageCard, rowsOf, SelectField, StatusPill, TextField } from '../components/ui';
import { useAsync } from '../components/useAsync';
import { hrmsPath } from '../layout/menu';

/** Which actions make sense for a claim in a given status. */
export function actionsFor(status) {
  switch (String(status).toLowerCase()) {
    case 'initiated': return [{ action: 'SUBMIT', label: 'Submit', kind: 'primary' }, { action: 'CANCEL', label: 'Cancel Claim', kind: 'danger' }];
    case 'submitted': return [{ action: 'APPROVE', label: 'Approve', kind: 'primary' }, { action: 'REJECT', label: 'Reject', kind: 'danger' }];
    case 'approved': return [{ action: 'PAY', label: 'Mark as Paid', kind: 'primary' }];
    default: return [];
  }
}

export function expenseTotal(expenses) {
  return expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
}

function AddExpense({ id, onAdded }) {
  const types = useAsync(listExpenseTypes, []);
  const [form, setForm] = useState({ typeId: '', date: todayISO(), amount: '', note: '' });
  const [status, setStatus] = useState({ busy: false, error: '' });

  const submit = async (event) => {
    event.preventDefault();
    if (!form.typeId || !form.date || !(Number(form.amount) > 0)) {
      setStatus({ busy: false, error: 'Please choose an expense type, a date and an amount above zero.' });
      return;
    }
    setStatus({ busy: true, error: '' });
    try {
      await addClaimExpense(id, { expenseTypeId: Number(form.typeId) || form.typeId, date: form.date, amount: form.amount, note: form.note });
      setForm({ ...form, amount: '', note: '' });
      setStatus({ busy: false, error: '' });
      onAdded();
    } catch (e) {
      setStatus({ busy: false, error: e.message });
    }
  };

  return (
    <form className="hrms-form hrms-inline-form" onSubmit={submit} noValidate>
      <div className="hrms-form-row three">
        <SelectField label="Expense Type" required value={form.typeId} onChange={(e) => setForm({ ...form, typeId: e.target.value })}
          options={rowsOf(types.data).filter((t) => t.status !== false && !t.deleted).map((t) => ({ value: t.id, label: t.name }))} />
        <TextField label="Date" type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        <TextField label="Amount" type="number" min="0" step="0.01" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        <TextField label="Note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
      </div>
      <Notice>{status.error || types.error}</Notice>
      <div className="hrms-form-actions"><Button type="submit" disabled={status.busy}>{status.busy ? 'Adding...' : '+ Add Expense'}</Button></div>
    </form>
  );
}

export default function ClaimDetailPage() {
  const { id } = useParams();
  const [version, setVersion] = useState(0);
  const claim = useAsync(() => getClaim(id), [id, version]);
  const expenses = useAsync(() => listClaimExpenses(id), [id, version]);
  const [status, setStatus] = useState({ busy: false, error: '' });
  const reload = () => setVersion((v) => v + 1);

  const act = async (action) => {
    setStatus({ busy: true, error: '' });
    try {
      await claimAction(id, action);
      setStatus({ busy: false, error: '' });
      reload();
    } catch (e) {
      setStatus({ busy: false, error: e.message });
    }
  };

  const columns = [
    { key: 'type', label: 'Expense Type', render: (r) => r.expenseType?.name ?? r.expenseTypeName ?? '-' },
    { key: 'date', label: 'Date', render: (r) => fmtDate(r.date ?? r.expenseDate) },
    { key: 'note', label: 'Note', render: (r) => r.note ?? '' },
    { key: 'amount', label: 'Amount', render: (r) => fmtNumber(r.amount) },
  ];

  return (
    <>
      <PageCard title={`Claim ${id}`} actions={<Link className="hrms-link" to={hrmsPath('claim/viewClaim')}>Back to Claims</Link>}>
        <AsyncBody state={claim}>
          {(res) => {
            const c = claimRow(res?.data ?? {});
            return (
              <>
                <dl className="hrms-details">
                  <div className="hrms-detail-row"><dt>Reference Id</dt><dd>{c.reference}</dd></div>
                  <div className="hrms-detail-row"><dt>Employee</dt><dd>{c.employee || '-'}</dd></div>
                  <div className="hrms-detail-row"><dt>Event</dt><dd>{c.event}</dd></div>
                  <div className="hrms-detail-row"><dt>Currency</dt><dd>{c.currency || '-'}</dd></div>
                  <div className="hrms-detail-row"><dt>Status</dt><dd><StatusPill status={c.status} /></dd></div>
                </dl>
                <Notice>{status.error}</Notice>
                <div className="hrms-form-actions">
                  {actionsFor(c.status).map((a) => <Button key={a.action} kind={a.kind} disabled={status.busy} onClick={() => act(a.action)}>{a.label}</Button>)}
                </div>
                {String(c.status).toLowerCase() === 'initiated' && <AddExpense id={id} onAdded={reload} />}
              </>
            );
          }}
        </AsyncBody>
      </PageCard>
      <PageCard title="Expenses">
        <AsyncBody state={expenses}>
          {(res) => (
            <>
              <DataTable columns={columns} rows={rowsOf(res).map((e, i) => ({ ...e, id: e.id ?? i }))} empty="No expenses added yet." />
              <p className="hrms-muted">Total: <strong>{fmtNumber(expenseTotal(rowsOf(res)))}</strong></p>
            </>
          )}
        </AsyncBody>
      </PageCard>
    </>
  );
}
