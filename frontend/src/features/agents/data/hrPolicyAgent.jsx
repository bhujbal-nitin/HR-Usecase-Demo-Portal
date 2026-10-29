// Front-end demo agent (no backend): canned responses ported from the Piraji reference portal.

export const config = {
  id: 'hr_policy',
  name: 'HR Policy & Document Agent',
  catalogName: 'HR Policy & Document',
  category: 'compliance',
  description: 'Answers enterprise policy inquiries, verifies benefits eligibility, and generates signed verification letters on demand.',
  tags: ['Policy RAG Search', 'Handbook Q&A', 'Instant Letter PDF'],
  badge: '24/7 Available',
  greeting: (
    <>
      👋 Hello! I am your <strong>HR Policy & Document AI Assistant</strong>. I have indexed all company policies,
      employee handbooks, maternity/paternity guidelines, and can generate official verification letters.
    </>
  ),
  quickPrompts: [
    { text: '👶 Maternity & Paternity Leave Policy', action: 'policy_parental' },
    { text: '🏠 Remote Work & Internet Allowance Policy', action: 'policy_remote' },
    { text: '🏥 Medical Insurance & Hospital Coverage', action: 'policy_insurance' },
    { text: '📄 Request Signed Employment Letter', action: 'generate_emp_letter' },
  ],
};

export function respond(action) {
  switch (action) {
    case 'policy_parental':
      return {
        text: (
          <>
            👶 <strong>Maternity & Paternity Leave Policy Highlights:</strong>
            <br />MangoHRM provides industry-leading parental support for all full-time employees:
          </>
        ),
        widget: {
          title: 'Parental Leave Benefits',
          icon: 'fa-baby-carriage',
          badge: { label: 'Policy Ref: HR-POL-042', tone: 'approved' },
          rows: [
            ['Maternity Leave:', <><strong>26 Weeks Fully Paid</strong> + Optional 12 weeks unpaid</>],
            ['Paternity Leave:', <><strong>4 Weeks Fully Paid</strong> within first 12 months</>],
            ['Adoption Leave:', <><strong>16 Weeks Paid</strong> for primary caregiver</>],
            ['Gradual Return-to-Work:', 'Half-day schedule for first 4 weeks back with 100% pay'],
          ],
          actions: [
            {
              label: 'Download Complete Parental Handbook',
              icon: 'fa-file-pdf',
              variant: 'primary',
              effect: { toast: ['📑 Full Parental Handbook PDF downloaded', 'info'] },
            },
          ],
        },
      };

    case 'policy_remote':
      return {
        text: (
          <>
            🏠 <strong>Remote Work & Internet Allowance Policy:</strong>
            <br />Our flexible hybrid workplace policy entitles you to work remotely up to 3 days per week with home office stipends:
          </>
        ),
        widget: {
          title: 'Hybrid & Remote Work Guidelines',
          icon: 'fa-house-laptop',
          badge: { label: 'Active Policy', tone: 'approved' },
          rows: [
            ['Monthly Internet Allowance:', <><strong>$50.00 / month</strong> reimbursed automatically</>],
            ['Home Office Setup Grant:', <><strong>$500.00 one-time</strong> for ergonomic chair/monitor</>],
            ['Core Collaboration Hours:', '10:00 AM – 03:00 PM local timezone'],
          ],
        },
      };

    case 'policy_insurance':
      return {
        text: (
          <>
            🏥 <strong>Group Health Insurance Coverage & Hospital Network:</strong>
            <br />You and your dependents are covered under the MangoHRM Comprehensive Health Plan.
          </>
        ),
        widget: {
          title: 'Comprehensive Health Plan',
          icon: 'fa-heart-pulse',
          badge: { label: 'Policy #CORP-MED-9921', tone: 'verified' },
          rows: [
            ['Sum Insured:', <><strong>$25,000 Family Floater</strong> (Self + Spouse + 2 Children)</>],
            ['Cashless Hospitals:', 'Over 8,500 network hospitals nationwide'],
            ['Pre & Post Hospitalization:', '30 days prior, 60 days following discharge'],
            ['Maternity Care:', 'Covered up to $4,000 per delivery'],
          ],
        },
      };

    case 'generate_emp_letter':
      return {
        text: (
          <>
            📄 <strong>Official Employment Verification Letter Generated!</strong>
            <br />Your letter has been automatically populated with official company letterhead, HR watermark, and digital signature.
          </>
        ),
        widget: {
          title: 'Employment Verification Document',
          icon: 'fa-file-signature',
          badge: { label: 'Signed by HR', tone: 'approved' },
          rows: [
            ['Letter Addressed To:', 'Whomsoever It May Concern / Bank Loan Verification'],
            ['Employee:', 'Alex Vance (Staff Engineer)'],
            ['Employment Status:', 'Permanent, Full-Time (Joined: Jan 15, 2023)'],
          ],
          actions: [
            {
              label: 'Download Signed Letter (PDF)',
              icon: 'fa-download',
              variant: 'emerald',
              effect: {
                toast: ['📥 Downloading Employment_Verification_Letter.pdf...', 'success'],
                download: { filename: 'Employment_Verification_Letter.pdf', content: 'MANGO HRM OFFICIAL EMPLOYMENT VERIFICATION LETTER' },
              },
            },
          ],
        },
      };

    default:
      return null;
  }
}
