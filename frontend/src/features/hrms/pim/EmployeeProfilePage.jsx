import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { getContact, getEmployee, getPersonal, saveContact, savePersonal } from '../api';
import { fullName } from '../components/helpers';
import { AsyncBody, PageCard, StatusPill } from '../components/ui';
import { useAsync } from '../components/useAsync';
import JobTab from './JobTab';
import { AttachmentsTab, EmergencyTab, SalaryTab } from './ListTabs';
import RecordForm from './RecordForm';

export const PERSONAL_FIELDS = [
  { key: 'firstName', label: 'First Name' }, { key: 'middleName', label: 'Middle Name' }, { key: 'lastName', label: 'Last Name' },
  { key: 'employeeId', label: 'Employee Id' }, { key: 'otherId', label: 'Other Id' }, { key: 'birthday', label: 'Date of Birth', type: 'date' },
  { key: 'gender', label: 'Gender' }, { key: 'maritalStatus', label: 'Marital Status' }, { key: 'nationality', label: 'Nationality' },
];

export const CONTACT_FIELDS = [
  { key: 'street1', label: 'Street 1' }, { key: 'street2', label: 'Street 2' }, { key: 'city', label: 'City' },
  { key: 'province', label: 'State/Province' }, { key: 'zipCode', label: 'Zip/Postal Code' }, { key: 'countryCode', label: 'Country' },
  { key: 'homeTelephone', label: 'Home Telephone' }, { key: 'mobile', label: 'Mobile' }, { key: 'workTelephone', label: 'Work Telephone' },
  { key: 'workEmail', label: 'Work Email', type: 'email' }, { key: 'otherEmail', label: 'Other Email', type: 'email' },
];

const TABS = ['Personal Details', 'Contact Details', 'Emergency Contacts', 'Job', 'Salary', 'Attachments'];

export default function EmployeeProfilePage() {
  const { empNumber } = useParams();
  const [tab, setTab] = useState(TABS[0]);
  const [version, setVersion] = useState(0);
  const emp = useAsync(() => getEmployee(empNumber), [empNumber, version]);

  const body = (record) => {
    const terminated = Boolean(record?.terminationId);
    switch (tab) {
      case 'Personal Details':
        return <RecordForm reloadKey={empNumber} load={() => getPersonal(empNumber)} save={(b) => savePersonal(empNumber, b)} fields={PERSONAL_FIELDS} />;
      case 'Contact Details':
        return <RecordForm reloadKey={empNumber} load={() => getContact(empNumber)} save={(b) => saveContact(empNumber, b)} fields={CONTACT_FIELDS} />;
      case 'Emergency Contacts': return <EmergencyTab empNumber={empNumber} />;
      case 'Job': return <JobTab empNumber={empNumber} terminated={terminated} onChanged={() => setVersion((v) => v + 1)} />;
      case 'Salary': return <SalaryTab empNumber={empNumber} />;
      default: return <AttachmentsTab empNumber={empNumber} />;
    }
  };

  return (
    <AsyncBody state={emp}>
      {(res) => {
        const record = res?.data ?? {};
        return (
          <div className="hrms-profile">
            <PageCard className="hrms-profile-side">
              <div className="hrms-avatar" aria-hidden="true">{(record.firstName ?? '?').charAt(0)}</div>
              <h2>{fullName(record)}</h2>
              <p className="hrms-muted">Id {record.employeeId}</p>
              {record.terminationId ? <StatusPill status="Past employee" /> : <StatusPill status="Active" />}
              <div role="tablist" aria-label="Employee sections" className="hrms-vtabs">
                {TABS.map((t) => (
                  <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>
                ))}
              </div>
            </PageCard>
            <PageCard title={tab} className="hrms-profile-main"><div role="tabpanel">{body(record)}</div></PageCard>
          </div>
        );
      }}
    </AsyncBody>
  );
}
