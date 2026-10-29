// Front-end demo agent (no backend): canned responses ported from the Piraji reference portal.

export const config = {
  id: 'leave_attendance',
  name: 'Leave & Attendance Agent',
  catalogName: 'Leave & Attendance',
  category: 'core',
  description:
    'Applies for leave, checks PTO and sick balances, regularizes missed attendance punches, and retrieves holiday schedules in one chat.',
  tags: ['Balances · Holidays', 'Leave Application', 'Missed Punch Correction', 'Manager Approval', 'OrangeHRM · AutomationEdge'],
  badge: 'Real-Time',
  greeting: (
    <>
      👋 Hello Alex! I am your <strong>Leave & Attendance AI Agent</strong>. Need to apply for paid time off, check
      remaining vacation days, or regularize a missed biometric punch? Ask me anything!
    </>
  ),
  quickPrompts: [
    { text: '📊 Check My Leave Balances', action: 'check_balances' },
    { text: '🏖️ Apply for 2 Days Casual Leave', action: 'apply_leave' },
    { text: '⏰ Regularize Missed Biometric Punch', action: 'regularize_punch' },
    { text: '🗓️ Upcoming 2026 Public Holidays', action: 'holidays_list' },
  ],
};

const applyCasualLeave = {
  label: 'Apply 2 Days Casual Leave',
  icon: 'fa-plane-departure',
  variant: 'primary',
  effect: {
    process: 'leave_attendance.submit_leave',
    toast: ['🏖️ Leave request submitted & synced with OrangeHRMS!', 'success'],
    reply: (
      <>
        🎉 <strong>Leave Approved & Logged!</strong>
        <br />Casual Leave for Oct 27-28, 2026 recorded. Your manager received calendar notification.
      </>
    ),
  },
};

export function respond(action) {
  switch (action) {
    case 'check_balances':
      return {
        text: (
          <>
            📊 <strong>Your Live Leave Balances (as of October 2026):</strong>
            <br />Fetched directly from your OrangeHRMS employee profile.
          </>
        ),
        widget: {
          title: 'Employee Leave Balances',
          icon: 'fa-umbrella-beach',
          badge: { label: 'Updated Today', tone: 'verified' },
          rows: [
            ['Casual Leave (CL):', <><strong>14 Days Left</strong> (Used: 4 / Total: 18)</>],
            ['Sick Leave (SL):', <><strong>10 Days Left</strong> (Used: 2 / Total: 12)</>],
            ['Earned Vacation (EL):', <><strong>8 Days Left</strong> (Used: 7 / Total: 15)</>],
            ['Compensatory Off:', <><strong>2 Days Left</strong> (Valid till Dec 31)</>],
          ],
          actions: [applyCasualLeave],
        },
      };

    case 'apply_leave':
      return {
        text: (
          <>
            🏖️ <strong>2-Day Casual Leave Request Prepared:</strong>
            <br />Review your leave dates and confirm submission to your manager and OrangeHRMS.
          </>
        ),
        widget: {
          title: 'Casual Leave Application',
          icon: 'fa-calendar-check',
          badge: { label: 'Ready to Submit', tone: 'pending' },
          rows: [
            ['Employee:', 'Alex Vance'],
            ['Duration:', 'Oct 27, 2026 – Oct 28, 2026 (2 Working Days)'],
            ['Reason:', 'Family Gathering & Personal Recharge'],
            ['Remaining Balance After:', '12 Days Casual Leave'],
          ],
          actions: [{ ...applyCasualLeave, label: 'Submit Leave to AutomationEdge Engine', icon: 'fa-check', variant: 'emerald' }],
        },
      };

    case 'regularize_punch':
      return {
        text: (
          <>
            ⏰ <strong>Biometric Punch Regularization Detected!</strong>
            <br />I noticed a missing check-out timestamp on your biometric log for yesterday (October 20, 2026).
          </>
        ),
        widget: {
          title: 'Biometric Attendance Exception',
          icon: 'fa-fingerprint',
          badge: { label: 'Missing Out-Punch', tone: 'pending' },
          rows: [
            ['Date:', 'October 20, 2026'],
            ['In-Punch Time:', '09:12 AM (Main Turnstile Gate 2)'],
            ['Proposed Out-Punch:', '06:30 PM (Regular Shift End)'],
            ['Reason:', 'Biometric scanner offline during building fire drill'],
          ],
          actions: [
            {
              label: 'Regularize & Auto-Approve Punch',
              icon: 'fa-circle-check',
              variant: 'primary',
              effect: {
                process: 'leave_attendance.confirm_punch',
                toast: ['⏰ Biometric punch regularized for Oct 20 (06:30 PM)!', 'success'],
                reply: (
                  <>
                    ✅ <strong>Attendance Punch Regularized!</strong>
                    <br />Out-punch recorded at 06:30 PM. Total hours worked on Oct 20 updated to 9h 18m.
                  </>
                ),
              },
            },
          ],
        },
      };

    case 'holidays_list':
      return {
        text: (
          <>
            🗓️ <strong>Upcoming Company Public Holidays (Q4 2026):</strong>
            <br />All company operations will be officially closed on the following paid holidays:
          </>
        ),
        widget: {
          title: 'Official Holiday Calendar',
          icon: 'fa-champagne-glasses',
          badge: { label: '2026 List', tone: 'approved' },
          rows: [
            ['Nov 12, 2026:', 'Diwali Festival of Lights (Paid Holiday)'],
            ['Nov 26-27, 2026:', 'Thanksgiving & Black Friday (2 Days)'],
            ['Dec 24-25, 2026:', 'Christmas Eve & Christmas Day'],
            ['Jan 01, 2027:', "New Year's Day (Paid Holiday)"],
          ],
        },
      };

    default:
      return null;
  }
}
