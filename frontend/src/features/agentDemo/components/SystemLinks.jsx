import { useEffect, useState } from 'react';
import { getEmployee } from '../../../api/employees';
import { getLeaveLinks, getLeaveRequest } from '../../../api/leave';
import { getOffboarding } from '../../../api/offboardings';
import { getPayrollLinks } from '../../../api/payroll';
import { getCandidate } from '../../../api/preOnboarding';
import { getClaim } from '../../../api/reimbursement';
import { systemLinks } from '../lib/systemLinks';

const SYSTEMS = [
  { id: 'servicenow', label: 'ServiceNow', icon: 'fa-solid fa-headset' },
  { id: 'orangehrm', label: 'HRMS', icon: 'fa-solid fa-database' },
  { id: 'office365', label: 'Microsoft 365', icon: 'fa-brands fa-microsoft' },
  { id: 'documents', label: 'Policy documents', icon: 'fa-solid fa-file-pdf' },
];
const POLL_MS = 4000;
// A run only shows the systems it can create something in (leave & attendance only creates records in HRMS).
const SYSTEMS_BY_KIND = { leave: ['orangehrm'], reimbursement: ['orangehrm'], payroll: ['orangehrm'], policy: ['documents'], preonboarding: ['servicenow'] };
const CONNECTED = ['servicenow', 'orangehrm', 'office365'];
const LOAD = {
  onboarding: (run) => getEmployee(run.id),
  offboarding: (run) => getOffboarding(run.id),
  reimbursement: (run) => getClaim(run.id),
  preonboarding: (run) => getCandidate(run.id), // the request raised for the candidate in ServiceNow
  policy: async (run) => ({ items: run.items ?? [] }), // the policy and letter files this run used
  payroll: (run) => getPayrollLinks(run.employeeId), // the salary is only read, so the link is the employee's Salary page
  // A leave run opens everything it did: the balances it read and each request it saved.
  leave: async (run) => ({
    requests: await Promise.all((run.requestIds ?? []).map((id) => getLeaveRequest(id))),
    balanceReportUrl: run.balance ? (await getLeaveLinks()).balanceReportUrl : null,
  }),
};

/** Live runs only: one button per system; each opens, in a new tab, what this run created there. */
export default function SystemLinks({ run, busy }) {
  const [record, setRecord] = useState(null);
  const [open, setOpen] = useState(null);

  useEffect(() => {
    if (!run) { setRecord(null); return undefined; }
    let alive = true;
    const load = async () => {
      try {
        const next = await LOAD[run.kind](run);
        if (alive) setRecord(next);
      } catch { /* the buttons simply stay as they are */ }
    };
    load();
    const timer = busy ? setInterval(load, POLL_MS) : null;
    return () => { alive = false; if (timer) clearInterval(timer); };
  }, [run, busy]);

  if (!run) return null;
  const links = systemLinks(run.kind, record);

  return (
    <div className="ad-syslinks" role="group" aria-label="Open the connected systems">
      {SYSTEMS.filter(({ id }) => (SYSTEMS_BY_KIND[run.kind] ?? CONNECTED).includes(id)).map(({ id, label, icon }) => {
        const items = links[id];
        return (
          <div key={id} className="ad-sys-wrap">
            {items.length === 1 ? (
              <a className="ad-btn ad-sysbtn" href={items[0].url} target="_blank" rel="noopener noreferrer" title={items[0].label}>
                <i className={icon}></i> {label}
              </a>
            ) : (
              <button
                type="button" className="ad-btn ad-sysbtn" disabled={items.length === 0} aria-expanded={open === id}
                onClick={() => setOpen(open === id ? null : id)} title={items.length ? `Open in ${label}` : `Nothing created in ${label} yet`}
              >
                <i className={icon}></i> {label}{items.length > 1 && <i className="fa-solid fa-caret-down"></i>}
              </button>
            )}
            {open === id && items.length > 1 && (
              <div className="ad-sysmenu" role="menu">
                {items.map((item) => (
                  <a key={item.url} role="menuitem" href={item.url} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(null)}>{item.label}</a>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
