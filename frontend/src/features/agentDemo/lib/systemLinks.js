// What a live run created in each connected system, as links to open in a new tab. Built from the stored record,
// so a link only appears once the run has really created something there.

const step = (record, key) => [...(record.intake ?? []), ...(record.pipeline ?? [])].find((s) => s.key === key && s.status === 'success');
const link = (label, url) => (label && url ? { label, url } : null);

/** @returns {{ servicenow: Link[], orangehrm: Link[], office365: Link[], documents: Link[] }}  Link = { label, url } */
export function systemLinks(kind, record) {
  if (!record) return { servicenow: [], orangehrm: [], office365: [], documents: [] };

  if (kind === 'policy') {
    // HR policy & documents only reads files: the policy PDFs and the letters it handed over.
    return { servicenow: [], orangehrm: [], office365: [], documents: (record.items ?? []).map((item) => link(item.label, item.url)).filter(Boolean) };
  }

  if (kind === 'onboarding') {
    const { serviceNow: sn, orangeHrm, office365, laptop } = record;
    return {
      servicenow: [
        link(sn?.reqNumber ? `Request ${sn.reqNumber}` : null, sn?.reqUrl),
        link(laptop?.ticketNumber ? `Laptop incident ${laptop.ticketNumber}` : null, laptop?.ticketUrl),
      ].filter(Boolean),
      orangehrm: [link(orangeHrm?.empNumber ? `Employee profile #${orangeHrm.empNumber}` : null, orangeHrm?.profileUrl)].filter(Boolean),
      office365: [link(office365?.userPrincipalName, office365?.adminUrl)].filter(Boolean),
    };
  }

  if (kind === 'leave' && Array.isArray(record.requests)) {
    // A whole leave & attendance run: the balances it read, then each request it saved, in the order the scenarios ran.
    const requests = record.requests.map((r) => (r.kind === 'leave'
      ? link(r.orangeHrmId ? `Leave request #${r.orangeHrmId}` : null, r.orangeHrmUrl)
      : link('Attendance records', r.orangeHrmUrl)));
    const all = [link('Leave balance', record.balanceReportUrl), ...requests].filter(Boolean);
    const orangehrm = all.filter((item, index) => all.findIndex((other) => other.url === item.url) === index); // two attendance requests share one page
    return { servicenow: [], orangehrm, office365: [] };
  }

  if (kind === 'leave') {
    // Leave & attendance only touches HRMS for what it creates (Microsoft 365 is only read).
    const what = record.kind === 'leave' ? (record.orangeHrmId ? `Leave request #${record.orangeHrmId}` : 'Leave in HRMS') : 'Attendance records';
    return { servicenow: [], orangehrm: [link(what, record.orangeHrmUrl)].filter(Boolean), office365: [] };
  }

  if (kind === 'preonboarding') {
    // Pre-onboarding raises one ServiceNow request for the candidate (it is closed when the offer letter is sent).
    const sn = record.serviceNow;
    return { servicenow: [link(sn?.reqNumber ? `Request ${sn.reqNumber}` : null, sn?.reqUrl)].filter(Boolean), orangehrm: [], office365: [], documents: [] };
  }

  if (kind === 'payroll') {
    // Payroll only reads the salary from HRMS (PIM → Salary).
    return { servicenow: [], orangehrm: [link('Salary details', record.salaryUrl)].filter(Boolean), office365: [] };
  }

  if (kind === 'reimbursement') {
    // The expense claim only creates a claim in HRMS, once the manager has approved it.
    return { servicenow: [], orangehrm: [link(record.orangeHrmId ? `Claim #${record.orangeHrmId}` : null, record.orangeHrmUrl)].filter(Boolean), office365: [] };
  }

  const ticket = (key, name) => {
    const details = step(record, key)?.details;
    return link(details?.ticket ? `${name} ${details.ticket}` : null, details?.url);
  };
  const hrm = step(record, 'hrm_terminate')?.details;
  return {
    servicenow: [ticket('servicenow_ticket', 'Offboarding ticket'), ticket('asset_return', 'Asset return'), ticket('clearances', 'Clearances')].filter(Boolean),
    orangehrm: [link(hrm?.empNumber ? `Employee profile #${hrm.empNumber}` : null, hrm?.profileUrl)].filter(Boolean),
    office365: [link(record.userPrincipalName, step(record, 'o365_block')?.details?.adminUrl)].filter(Boolean),
  };
}
