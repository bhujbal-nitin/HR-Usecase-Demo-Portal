// Front-end demo agent (no backend): canned responses ported from the Piraji reference portal.

export const config = {
  id: 'offboarding',
  name: 'Offboarding Agent',
  catalogName: 'Offboarding',
  category: 'lifecycle',
  description:
    'Processes resignations, conducts multi-department clearance across IT/Finance, revokes Active Directory access, and generates relieving letters.',
  tags: ['Resignation Intake', 'Exit Approval', 'AD · O365 Access Removal', 'OrangeHRM Termination', 'Asset Return · Clearances', 'Settlement · Relieving Letter'],
  badge: 'Autonomous',
  greeting: (
    <>
      👋 Hello. I am the <strong>Offboarding AI Agent</strong>. I coordinate smooth employee departures, manage
      department clearance checklists, IT asset recovery, and generate official relieving paperwork.
    </>
  ),
  quickPrompts: [
    { text: '📝 Submit Resignation Notice', action: 'init_resignation' },
    { text: '📋 View Department Clearance Checklist', action: 'clearance_status' },
    { text: '💻 IT Asset & Laptop Return Protocol', action: 'asset_return' },
    { text: '📜 Generate Relieving & Experience Letter', action: 'relieving_letter' },
  ],
};

export function respond(action) {
  switch (action) {
    case 'init_resignation':
      return {
        text: (
          <>
            📝 <strong>Resignation Notice Workflow</strong>
            <br />I can help submit your resignation to OrangeHRMS and initiate notice period tracking.
          </>
        ),
        widget: {
          title: 'Resignation Submission Preview',
          icon: 'fa-right-from-bracket',
          badge: { label: 'Draft Notice', tone: 'pending' },
          rows: [
            ['Employee:', 'Samantha Chang (EMP-8821)'],
            ['Notice Period:', '30 Days (Standard Engineering Contract)'],
            ['Tentative Last Day:', 'November 20, 2026'],
            ['Reporting Manager:', 'Michael Torres (Engineering Director)'],
          ],
          actions: [
            {
              label: 'Confirm & Submit Resignation to HR',
              icon: 'fa-paper-plane',
              variant: 'emerald',
              effect: {
                process: 'offboarding.submit_resignation',
                toast: ['🚪 Resignation notice logged in OrangeHRMS and manager notified!', 'success'],
                reply: (
                  <>
                    ✅ <strong>Resignation Recorded in OrangeHRMS!</strong>
                    <br />Manager approval request sent to Michael Torres. Last working day marked as November 20, 2026.
                  </>
                ),
              },
            },
          ],
        },
      };

    case 'clearance_status':
      return {
        text: (
          <>
            📋 <strong>Department Exit Clearance Status Tracker</strong>
            <br />Here is the real-time clearance status across all departments:
          </>
        ),
        widget: {
          title: '4-Tier Department Clearance Tracker',
          icon: 'fa-list-check',
          badge: { label: '3 of 4 Cleared', tone: 'approved' },
          rows: [
            ['1. Manager Approval & KT:', <span className="badge badge-approved">Approved (Oct 18)</span>],
            ['2. IT Asset Recovery:', <span className="badge badge-pending">Pending Return of MacBook</span>],
            ['3. Finance & Expense No-Dues:', <span className="badge badge-approved">Cleared ($0 Due)</span>],
            ['4. HR Exit Interview:', <span className="badge badge-approved">Completed (Feedback Logged)</span>],
          ],
          actions: [
            {
              label: 'Schedule IT Asset Pickup Courier',
              icon: 'fa-box',
              variant: 'primary',
              effect: { toast: ['📦 IT asset pickup scheduled with the courier', 'success'] },
            },
          ],
        },
      };

    case 'asset_return':
      return {
        text: (
          <>
            📦 <strong>IT Asset & Equipment Return Protocol:</strong>
            <br />Our IT Asset Recovery team has initiated a prepaid FedEx return box to your registered address.
          </>
        ),
        widget: {
          title: 'IT Return Manifest',
          icon: 'fa-box-archive',
          badge: { label: 'Prepaid Label Ready', tone: 'verified' },
          rows: [
            ['Assets to Return:', '1x Apple MacBook Pro 16", 1x YubiKey 5C NFC'],
            ['FedEx Tracking:', <strong style={{ color: '#2563eb' }}>7812 9941 2309</strong>],
            ['Pickup Window:', 'Friday, 10:00 AM - 02:00 PM PST'],
            ['System Access:', 'Active Directory credentials auto-expire on Last Day'],
          ],
        },
      };

    case 'relieving_letter':
      return {
        text: (
          <>
            📜 <strong>Relieving & Experience Letter Generated!</strong>
            <br />Your official relieving document has been digitally generated and signed through AutomationEdge.
          </>
        ),
        widget: {
          title: 'Digital Relieving & Service Certificate',
          icon: 'fa-certificate',
          badge: { label: 'Digitally Signed', tone: 'approved' },
          rows: [
            ['Certificate ID:', 'MHRM-REL-2026-9912'],
            ['Signatory:', 'Director of People & Culture (Cryptographically Signed)'],
            ['Date of Issue:', 'Today, 11:30 AM'],
          ],
          actions: [
            {
              label: 'Download Signed Relieving Letter (PDF)',
              icon: 'fa-download',
              variant: 'emerald',
              effect: {
                toast: ['📥 Downloading Relieving_Letter_Samantha_Chang.pdf...', 'success'],
                download: {
                  filename: 'Relieving_Letter_Samantha_Chang.pdf',
                  content: 'MANGO HRM RELIEVING LETTER - Official Digitally Signed Certificate of Service',
                },
              },
            },
          ],
        },
      };

    default:
      return null;
  }
}
