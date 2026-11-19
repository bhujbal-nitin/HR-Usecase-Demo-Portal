import { addHoliday, listHolidays } from '../api';
import ConfigList from '../components/ConfigList';
import { fmtDate } from '../components/helpers';

export default function HolidayListPage({ adding }) {
  return (
    <ConfigList
      title="Holidays"
      noun="Holiday"
      adding={adding}
      load={() => listHolidays()}
      add={addHoliday}
      initial={{ length: '0', recurring: 'no' }}
      fields={[
        { key: 'name', label: 'Name', required: true },
        { key: 'date', label: 'Date', type: 'date', required: true },
        { key: 'length', label: 'Duration', options: [{ value: '0', label: 'Full Day' }, { value: '4', label: 'Half Day' }] },
        { key: 'recurring', label: 'Repeats every year', options: [{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }] },
      ]}
      toBody={(f) => ({ name: f.name.trim(), date: f.date, length: Number(f.length), recurring: f.recurring === 'yes' })}
      columns={[
        { key: 'name', label: 'Name' },
        { key: 'date', label: 'Date', render: (r) => fmtDate(r.date) },
        { key: 'length', label: 'Full Day/Half Day', render: (r) => (Number(r.length) === 0 ? 'Full Day' : 'Half Day') },
        { key: 'recurring', label: 'Repeats Annually', render: (r) => (r.recurring ? 'Yes' : 'No') },
      ]}
    />
  );
}
