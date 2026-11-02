// Scripted "backend activity" for the earlier prototype answers.
// These have NO real backend: the right-hand panel plays these steps as an animation and labels them as a demo.
// Keys are `<agentId>.<action>` (quick prompts / free text) or `<agentId>.<effect>` (widget buttons).

const sim = (title, systems, steps, result) => ({
  kind: 'simulated',
  title,
  systems,
  steps: steps.map(([label, detail, ms = 1000]) => ({ label, detail, ms })),
  result,
});

const OHRM = 'OrangeHRMS';
const AE = 'AutomationEdge';

export const SIMULATED_PROCESSES = {
  // ---- Offboarding -------------------------------------------------------
  'offboarding.init_resignation': sim('Preparing resignation notice', [OHRM, AE], [
    ['Reading employee record', 'OrangeHRMS PIM · Samantha Chang (AE-8821)', 900],
    ['Calculating notice period', '30 days (Standard Engineering Contract)', 1000],
    ['Resolving last working day', 'Tentative: November 20, 2026', 800],
    ['Looking up reporting manager', 'Michael Torres (Engineering Director)', 900],
  ], { title: 'Draft notice ready', rows: [['Employee', 'Samantha Chang'], ['Last day', 'Nov 20, 2026'], ['Status', 'Awaiting confirmation']] }),

  'offboarding.submit_resignation': sim('Submitting resignation to HR', [OHRM, AE, 'Microsoft 365'], [
    ['Authenticating with AutomationEdge', 'Session established', 800],
    ['Recording resignation in OrangeHRMS', 'Resignation request created', 1200],
    ['Starting notice-period tracking', 'Countdown to Nov 20, 2026', 900],
    ['Notifying manager', 'Approval request e-mailed to Michael Torres', 1000],
  ], { title: 'Resignation recorded', rows: [['Reference', 'EXIT-347'], ['Manager approval', 'Requested']] }),

  'offboarding.clearance_status': sim('Checking department clearances', [OHRM, 'ServiceNow'], [
    ['Loading clearance checklist', '4 departments', 800],
    ['Manager approval & KT', 'Approved (Oct 18)', 800],
    ['IT asset recovery', 'MacBook return still pending', 900],
    ['Finance no-dues', 'Cleared ($0 due)', 800],
    ['HR exit interview', 'Completed, feedback logged', 800],
  ], { title: '3 of 4 cleared', rows: [['Blocking item', 'IT asset recovery']] }),

  'offboarding.asset_return': sim('Arranging IT asset return', ['ServiceNow', AE], [
    ['Reading assigned assets', '1x MacBook Pro 16", 1x YubiKey 5C NFC', 900],
    ['Creating prepaid return label', 'FedEx 7812 9941 2309', 1100],
    ['Scheduling courier pickup', 'Friday, 10:00 AM – 02:00 PM PST', 1000],
    ['Scheduling access expiry', 'Active Directory credentials expire on last day', 900],
  ], { title: 'Return arranged', rows: [['Tracking', '7812 9941 2309'], ['Pickup', 'Friday, 10:00–14:00 PST']] }),

  'offboarding.relieving_letter': sim('Generating relieving letter', [AE, OHRM], [
    ['Collecting service record', 'Joined → last working day', 900],
    ['Rendering letter from template', 'Certificate MHRM-REL-2026-9912', 1200],
    ['Applying digital signature', 'Director of People & Culture', 1100],
    ['Publishing document', 'PDF ready to download', 800],
  ], { title: 'Letter signed', rows: [['Certificate', 'MHRM-REL-2026-9912'], ['Format', 'PDF']] }),

  // ---- Leave & Attendance ------------------------------------------------
  'leave_attendance.check_balances': sim('Fetching leave balances', [OHRM], [
    ['Authenticating with OrangeHRMS', 'Session established', 800],
    ['Loading leave entitlements', 'Casual, Sick, Earned, Comp-off', 1000],
    ['Subtracting approved leave', 'Used days applied per type', 900],
  ], { title: 'Balances up to date', rows: [['Casual', '14 days'], ['Sick', '10 days'], ['Earned', '8 days'], ['Comp-off', '2 days']] }),

  'leave_attendance.apply_leave': sim('Preparing leave request', [OHRM], [
    ['Validating dates', 'Oct 27 – Oct 28, 2026 (2 working days)', 900],
    ['Checking balance', '14 days available → 12 after', 900],
    ['Checking team calendar', 'No blackout dates', 1000],
  ], { title: 'Ready to submit', rows: [['Type', 'Casual Leave'], ['Days', '2']] }),

  'leave_attendance.submit_leave': sim('Submitting leave request', [OHRM, AE], [
    ['Calling AutomationEdge workflow', 'Apply Leave', 1000],
    ['Creating leave in OrangeHRMS', 'Casual Leave · Oct 27–28', 1200],
    ['Deducting balance', '14 → 12 days', 800],
    ['Sending calendar invite to manager', 'Notification dispatched', 900],
  ], { title: 'Leave approved & logged', rows: [['Balance after', '12 days']] }),

  'leave_attendance.regularize_punch': sim('Reviewing attendance exception', ['Biometric system', OHRM], [
    ['Reading biometric log', 'Oct 20: in-punch 09:12 AM (Gate 2)', 900],
    ['Detecting missing out-punch', 'No check-out recorded', 1000],
    ['Matching incident report', 'Scanner offline during fire drill', 1000],
  ], { title: 'Exception found', rows: [['Proposed out-punch', '06:30 PM']] }),

  'leave_attendance.confirm_punch': sim('Regularizing punch', [OHRM, AE], [
    ['Writing out-punch 06:30 PM', 'Attendance record updated', 1000],
    ['Recalculating hours', '9h 18m worked on Oct 20', 900],
    ['Auto-approving exception', 'Policy: scanner outage', 800],
  ], { title: 'Attendance regularized', rows: [['Hours', '9h 18m']] }),

  'leave_attendance.holidays_list': sim('Loading holiday calendar', [OHRM], [
    ['Reading company calendar', '2026 list', 800],
    ['Filtering upcoming holidays', 'Q4 2026 → Jan 2027', 900],
  ], { title: '4 holiday dates found', rows: [['Next', 'Nov 12 · Diwali']] }),

  // ---- Payroll & Salary --------------------------------------------------
  'payroll_salary.download_payslip': sim('Retrieving payslip', ['Payroll database', AE], [
    ['Verifying identity', 'Employee session validated', 800],
    ['Querying payroll database', 'September 2026 · Alex Vance', 1100],
    ['Computing earnings & deductions', 'Gross $8,500 − PF − TDS', 1000],
    ['Rendering payslip PDF', 'Payslip_September_2026.pdf', 900],
  ], { title: 'Payslip ready', rows: [['Net pay', '$7,000.00']] }),

  'payroll_salary.explain_taxes': sim('Computing TDS breakdown', ['Payroll database'], [
    ['Loading tax declarations', 'FY 2026-27', 900],
    ['Applying New Regime slabs', '15% marginal bracket', 1100],
    ['Applying exemptions', 'Standard deduction, 80C, 80D', 900],
  ], { title: 'TDS explained', rows: [['Monthly TDS', '$900']] }),

  'payroll_salary.ctc_breakdown': sim('Building CTC breakdown', ['Payroll database'], [
    ['Reading compensation plan', 'Annual package', 900],
    ['Splitting components', 'Base · bonus · PF & gratuity', 1000],
    ['Adding employer-paid benefits', 'Health & life insurance', 800],
  ], { title: 'CTC $125,000', rows: [['Base', '$102,000'], ['Bonus', '$15,000']] }),

  'payroll_salary.tax_regime_compare': sim('Comparing tax regimes', ['Payroll database'], [
    ['Loading declarations', '80C / 80D proofs', 900],
    ['Calculating Old Regime', '$12,220 / year', 1100],
    ['Calculating New Regime', '$10,800 / year', 1100],
    ['Choosing the better option', 'New Regime saves ≈ $1,420', 800],
  ], { title: 'New Regime recommended', rows: [['Annual saving', '$1,420']] }),
};
