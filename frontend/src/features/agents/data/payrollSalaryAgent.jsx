// Front-end demo agent (no backend): canned responses ported from the Piraji reference portal.

export const config = {
  id: 'payroll_salary',
  name: 'Payroll & Salary Agent',
  catalogName: 'Payroll & Salary',
  category: 'core',
  description:
    'Pulls payslips, explains tax deductions (TDS), computes net take-home salary, and resolves payroll discrepancies instantly.',
  tags: ['Payslip PDF Fetch', 'TDS Tax Breakdown', 'Old vs New Regime'],
  badge: 'Secure Bank-Grade',
  greeting: (
    <>
      👋 Hello Alex! I am your <strong>Payroll & Salary AI Specialist</strong>. I can retrieve your monthly payslips,
      explain deductions, compute take-home salary, or compare tax regimes.
    </>
  ),
  quickPrompts: [
    { text: '💵 Download September 2026 Payslip', action: 'download_payslip' },
    { text: '📑 Explain TDS & Tax Deductions', action: 'explain_taxes' },
    { text: '💰 View Annual CTC & Net Pay Breakdown', action: 'ctc_breakdown' },
    { text: '⚖️ Old vs New Tax Regime Comparison', action: 'tax_regime_compare' },
  ],
};

export function respond(action) {
  switch (action) {
    case 'download_payslip':
      return {
        text: (
          <>
            💵 <strong>September 2026 Payslip Retrieved!</strong>
            <br />Here is your salary breakdown fetched securely from the payroll database:
          </>
        ),
        widget: {
          title: 'Payslip for September 2026',
          icon: 'fa-file-invoice-dollar',
          badge: { label: 'Credited to Bank', tone: 'approved' },
          rows: [
            ['Basic Salary:', '$5,000.00'],
            ['House Rent Allowance (HRA):', '$2,000.00'],
            ['Special & Performance Allowance:', '$1,500.00'],
            { cells: ['Gross Earnings:', <strong>$8,500.00</strong>], emphasis: 'total' },
            ['Provident Fund (PF):', '- $600.00'],
            ['Income Tax (TDS):', '- $900.00'],
            { cells: ['Net Take-Home Pay:', <span style={{ color: '#10b981' }}>$7,000.00</span>], emphasis: 'highlight' },
          ],
          actions: [
            {
              label: 'Download Official Payslip (PDF)',
              icon: 'fa-file-pdf',
              variant: 'primary',
              effect: {
                toast: ['📥 Downloading Payslip_September_2026.pdf...', 'success'],
                download: { filename: 'Payslip_September_2026.pdf', content: 'MANGO HRM MONTHLY SALARY SLIP - September 2026' },
              },
            },
          ],
        },
      };

    case 'explain_taxes':
      return {
        text: (
          <>
            📑 <strong>TDS & Tax Deduction Explanation (FY 2026-27):</strong>
            <br />Your monthly tax deduction is $900 calculated under the New Tax Regime structure.
          </>
        ),
        widget: {
          title: 'Tax Calculation Breakdown',
          icon: 'fa-calculator',
          badge: { label: 'Compliant', tone: 'verified' },
          rows: [
            ['Standard Deduction:', '$1,000 / month ($12,000 annual exemption)'],
            ['Section 80C Investment:', '$1,500 Annual max applied towards EPF'],
            ['Health Insurance 80D:', '$350 monthly premium deduction'],
            ['Effective Tax Slab:', '15% marginal tax bracket'],
          ],
        },
      };

    case 'ctc_breakdown':
      return {
        text: (
          <>
            💰 <strong>Annual Cost-to-Company (CTC) Breakdown:</strong>
            <br />Your total annual package is <strong>$125,000.00</strong> structured as follows:
          </>
        ),
        widget: {
          title: 'Annual Compensation Plan',
          icon: 'fa-chart-pie',
          badge: { label: '$125,000 CTC', tone: 'approved' },
          rows: [
            ['Fixed Base Salary:', '$102,000 (81.6%)'],
            ['Annual Performance Bonus:', '$15,000 (12.0%)'],
            ['Employer PF & Gratuity:', '$8,000 (6.4%)'],
            ['Health & Life Insurance:', 'Company Sponsored ($4,500 value)'],
          ],
        },
      };

    case 'tax_regime_compare':
      return {
        text: (
          <>
            ⚖️ <strong>Old vs New Tax Regime Comparison for Alex Vance:</strong>
            <br />Based on your declarations, the <strong>New Tax Regime</strong> saves you approximately{' '}
            <strong>$1,420</strong> per year!
          </>
        ),
        widget: {
          title: 'Regime Comparison',
          icon: 'fa-scale-balanced',
          badge: { label: 'New Regime Recommended', tone: 'approved' },
          rows: [
            [<strong>Metric</strong>, <strong>Old Regime</strong>, <strong>New Regime</strong>],
            ['Total Annual Tax:', '$12,220', <strong style={{ color: '#10b981' }}>$10,800</strong>],
            ['Deduction Paperwork:', 'Requires 80C/80D Proofs', 'Zero Proofs Needed'],
            ['Monthly Take-Home:', '$6,880', <strong style={{ color: '#10b981' }}>$7,000</strong>],
          ],
        },
      };

    default:
      return null;
  }
}
