import { addLeaveType, listLeaveTypes } from '../api';
import ConfigList from '../components/ConfigList';

export default function LeaveTypesPage({ adding }) {
  return (
    <ConfigList
      title="Leave Types"
      noun="Leave Type"
      adding={adding}
      load={listLeaveTypes}
      add={addLeaveType}
      initial={{ situational: 'no' }}
      fields={[
        { key: 'name', label: 'Name', required: true },
        { key: 'situational', label: 'Situational leave', options: [{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }] },
      ]}
      toBody={(f) => ({ name: f.name.trim(), situational: f.situational === 'yes' })}
      columns={[
        { key: 'name', label: 'Name' },
        { key: 'situational', label: 'Situational', render: (r) => (r.situational ? 'Yes' : 'No') },
      ]}
    />
  );
}
