// What a live run created in each connected system, as links to open in a new tab. Built from the stored record,
// so a link only appears once the run has really created something there.

const step = (record, key) => [...(record.intake ?? []), ...(record.pipeline ?? [])].find((s) => s.key === key && s.status === 'success');
const link = (label, url) => (label && url ? { label, url } : null);

/** @returns {{ servicenow: Link[], orangehrm: Link[], office365: Link[] }}  Link = { label, url } */
export function systemLinks(kind, record) {
  if (!record) return { servicenow: [], orangehrm: [], office365: [] };

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

  if (kind === 'leave') {
    // Leave & attendance only touches OrangeHRM for what it creates (Microsoft 365 is only read).
    const what = record.kind === 'leave' ? (record.orangeHrmId ? `Leave request #${record.orangeHrmId}` : 'Leave in OrangeHRM') : 'Attendance records';
    return { servicenow: [], orangehrm: [link(what, record.orangeHrmUrl)].filter(Boolean), office365: [] };
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
