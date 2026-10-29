// Front-end demo agent (no backend): canned responses ported from the Piraji reference portal.

export const config = {
  id: 'reimbursement_benefits',
  name: 'Reimbursement & Benefits Agent',
  catalogName: 'Reimbursement & Benefits',
  category: 'compliance',
  description:
    'Files expense claims, scans receipt bills, tracks reimbursement approvals, and manages health plan benefits and dependents.',
  tags: ['Receipt OCR Scan', 'Broadband & Travel', 'Dependent Health Plans'],
  badge: 'Instant Approvals',
  greeting: (
    <>
      👋 Hello Alex! I am your <strong>Reimbursement & Benefits AI Agent</strong>. Submit expense claims with auto
      receipt scanning, track reimbursement status, or manage health insurance benefits.
    </>
  ),
  quickPrompts: [
    { text: '🧾 Submit Travel & Client Dinner Claim ($145)', action: 'submit_expense' },
    { text: '📶 Claim Monthly Broadband Allowance ($50)', action: 'broadband_claim' },
    { text: '🩺 Enroll Family Dependent in Insurance', action: 'dependent_enroll' },
    { text: '🔍 Track Pending Reimbursements Status', action: 'track_claims' },
  ],
};

export function respond(action) {
  switch (action) {
    case 'submit_expense':
      return {
        text: (
          <>
            🧾 <strong>Travel & Client Dinner Expense Claim Ready!</strong>
            <br />Receipt scanned via AutomationEdge OCR with 99.4% confidence score:
          </>
        ),
        widget: {
          title: 'OCR Expense Receipt Scan',
          icon: 'fa-receipt',
          badge: { label: 'Receipt Verified', tone: 'approved' },
          rows: [
            ['Merchant:', 'The Capital Grille Restaurant'],
            ['Category:', 'Client Relationship & Meals'],
            ['Amount Extracted:', <><strong>$145.20</strong> (Tip & Taxes Included)</>],
            ['Receipt File:', 'receipt_oct20_dinner.jpg (Attached)'],
          ],
          actions: [
            {
              label: 'Submit Claim to Finance for Approval',
              icon: 'fa-paper-plane',
              variant: 'emerald',
              effect: {
                process: 'reimbursement_benefits.submit_claim',
                toast: ['🧾 Expense claim #EXP-9942 submitted to Finance!', 'success'],
                reply: (
                  <>
                    ✅ <strong>Expense Claim #EXP-9942 Logged!</strong>
                    <br />Amount: $145.20. Receipt passed automated audit rules. Payout scheduled for next payroll run.
                  </>
                ),
              },
            },
          ],
        },
      };

    case 'broadband_claim':
      return {
        text: (
          <>
            📶 <strong>Monthly Broadband Allowance Claim ($50):</strong>
            <br />Under the remote work policy, your recurring internet allowance can be claimed with 1-click:
          </>
        ),
        widget: {
          title: 'Broadband Allowance',
          icon: 'fa-wifi',
          badge: { label: 'Pre-Approved', tone: 'approved' },
          rows: [
            ['Month:', 'October 2026'],
            ['Claim Amount:', '$50.00 Fixed Allowance'],
            ['Payout:', 'Included in October 31 Salary Credit'],
          ],
          actions: [
            {
              label: 'Auto-Approve Broadband Payout',
              icon: 'fa-bolt',
              variant: 'primary',
              effect: {
                process: 'reimbursement_benefits.confirm_broadband',
                toast: ['📶 Monthly broadband allowance ($50) approved!', 'success'],
                reply: (
                  <>
                    ✅ <strong>Broadband Allowance Approved!</strong>
                    <br />$50.00 will be credited directly with your month-end salary.
                  </>
                ),
              },
            },
          ],
        },
      };

    case 'dependent_enroll':
      return {
        text: (
          <>
            🩺 <strong>Add Dependent to Health Insurance Policy:</strong>
            <br />You can add your spouse or children to your group insurance plan:
          </>
        ),
        widget: {
          title: 'Dependent Beneficiary Enrollment',
          icon: 'fa-user-plus',
          badge: { label: 'Action Required', tone: 'pending' },
          rows: [
            ['Current Enrolled:', 'Self (Alex Vance) + Spouse (Claire Vance)'],
            ['Available Slots:', 'Up to 2 Children ($0 additional premium)'],
            ['Required Document:', 'Birth Certificate or Marriage Certificate'],
          ],
          actions: [
            {
              label: 'Send Dependent Enrollment Link',
              icon: 'fa-envelope',
              variant: 'emerald',
              effect: { toast: ['📋 Dependent enrollment form dispatched to your email', 'success'] },
            },
          ],
        },
      };

    case 'track_claims':
      return {
        text: (
          <>
            🔍 <strong>Your Reimbursement Claims Status Tracker:</strong>
            <br />Here are your recent expense submissions:
          </>
        ),
        widget: {
          title: 'Expense History',
          icon: 'fa-clock-rotate-left',
          badge: { label: 'Updated', tone: 'verified' },
          rows: [
            ['Claim #EXP-9821:', <>Broadband Allowance ($50.00) – <span className="badge badge-approved">Approved</span></>],
            ['Claim #EXP-9844:', <>Tech Book Purchase ($38.50) – <span className="badge badge-approved">Paid</span></>],
            ['Claim #EXP-9912:', <>Client Uber Travel ($24.00) – <span className="badge badge-pending">Pending Review</span></>],
          ],
        },
      };

    default:
      return null;
  }
}
