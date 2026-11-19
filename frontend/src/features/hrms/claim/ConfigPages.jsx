import { addClaimEvent, addExpenseType, listClaimEvents, listExpenseTypes } from '../api';
import ConfigList from '../components/ConfigList';
import { StatusPill } from '../components/ui';

const fields = [
  { key: 'name', label: 'Name', required: true },
  { key: 'description', label: 'Description' },
];
const toBody = (f) => ({ name: f.name.trim(), description: f.description.trim(), status: true });
const columns = [
  { key: 'name', label: 'Name' },
  { key: 'description', label: 'Description' },
  { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.status === false ? 'Inactive' : 'Active'} /> },
];

export function EventsPage() {
  return <ConfigList title="Events" noun="Event" load={listClaimEvents} add={addClaimEvent} fields={fields} toBody={toBody} columns={columns} />;
}

export function ExpenseTypesPage() {
  return <ConfigList title="Expense Types" noun="Expense Type" load={listExpenseTypes} add={addExpenseType} fields={fields} toBody={toBody} columns={columns} />;
}
