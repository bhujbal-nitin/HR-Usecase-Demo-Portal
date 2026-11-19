import { describe, expect, it } from 'vitest';
import { systemLinks } from './systemLinks';

describe('systemLinks', () => {
  it('is empty until something was created', () => {
    expect(systemLinks('onboarding', { serviceNow: {} })).toEqual({ servicenow: [], orangehrm: [], office365: [] });
    expect(systemLinks('onboarding', null).servicenow).toEqual([]);
  });

  it('links the onboarding request, laptop incident, profile and account', () => {
    const out = systemLinks('onboarding', {
      serviceNow: { reqNumber: 'REQ1', reqUrl: 'https://sn/req' }, laptop: { ticketNumber: 'INC2', ticketUrl: 'https://sn/inc' },
      orangeHrm: { empNumber: 9, profileUrl: 'https://hr/9' }, office365: { userPrincipalName: 'a@b.c', adminUrl: 'https://az/u' },
    });
    expect(out.servicenow.map((l) => l.url)).toEqual(['https://sn/req', 'https://sn/inc']);
    expect(out.orangehrm[0]).toEqual({ label: 'Employee profile #9', url: 'https://hr/9' });
    expect(out.office365[0].label).toBe('a@b.c');
  });

  it('links what a leave or attendance run recorded in HRMS, and nothing else', () => {
    expect(systemLinks('leave', { kind: 'leave', applied: false })).toEqual({ servicenow: [], orangehrm: [], office365: [] });
    expect(systemLinks('leave', { kind: 'leave', applied: true, orangeHrmId: 31, orangeHrmUrl: 'https://hr/leave/31' }).orangehrm).toEqual([{ label: 'Leave request #31', url: 'https://hr/leave/31' }]);
    expect(systemLinks('leave', { kind: 'regularization', orangeHrmUrl: 'https://hr/attendance' }).orangehrm[0].label).toBe('Attendance records');

    // A whole run: the balances, the leave and the attendance each get their own link (a request that is not recorded yet has none).
    const run = {
      balanceReportUrl: 'https://hr/report',
      requests: [
        { kind: 'leave', orangeHrmId: 31, orangeHrmUrl: 'https://hr/leave/31' },
        { kind: 'regularization', orangeHrmUrl: 'https://hr/attendance' },
        { kind: 'regularization', orangeHrmUrl: 'https://hr/attendance' },
        { kind: 'leave', orangeHrmUrl: null },
      ],
    };
    expect(systemLinks('leave', run).orangehrm).toEqual([
      { label: 'Leave balance', url: 'https://hr/report' },
      { label: 'Leave request #31', url: 'https://hr/leave/31' },
      { label: 'Attendance records', url: 'https://hr/attendance' },
    ]);
    expect(systemLinks('leave', { balanceReportUrl: null, requests: [] }).orangehrm).toEqual([]);
  });

  it('reads offboarding links from the steps that succeeded', () => {
    const record = {
      userPrincipalName: 'a@b.c',
      intake: [{ key: 'servicenow_ticket', status: 'success', details: { ticket: 'INC1', url: 'https://sn/1' } }],
      pipeline: [
        { key: 'asset_return', status: 'failed', details: { ticket: 'INC2', url: 'https://sn/2' } },
        { key: 'hrm_terminate', status: 'success', details: { empNumber: 9, profileUrl: 'https://hr/9' } },
        { key: 'o365_block', status: 'success', details: { adminUrl: 'https://az/u' } },
      ],
    };
    const out = systemLinks('offboarding', record);
    expect(out.servicenow).toEqual([{ label: 'Offboarding ticket INC1', url: 'https://sn/1' }]); // the failed step produced nothing
    expect(out.orangehrm[0].url).toBe('https://hr/9');
    expect(out.office365[0].url).toBe('https://az/u');
  });

  it('payroll: opens the Salary page of the employee in HRMS only', () => {
    const out = systemLinks('payroll', { salaryUrl: 'https://hr/pim/viewSalaryList/empNumber/7' });
    expect(out.orangehrm).toEqual([{ label: 'Salary details', url: 'https://hr/pim/viewSalaryList/empNumber/7' }]);
    expect(out.servicenow).toEqual([]);
    expect(systemLinks('payroll', null).orangehrm).toEqual([]);
  });

  it('hr policy: opens the policy and letter files the run used', () => {
    const out = systemLinks('policy', { items: [{ label: 'Leave Policy', url: 'https://x/leave.pdf' }, { label: 'Address proof letter (Word file)', url: 'https://x/letter' }] });
    expect(out.documents.map((d) => d.label)).toEqual(['Leave Policy', 'Address proof letter (Word file)']);
    expect(out.orangehrm).toEqual([]);
    expect(systemLinks('policy', null).documents).toEqual([]);
  });
});
