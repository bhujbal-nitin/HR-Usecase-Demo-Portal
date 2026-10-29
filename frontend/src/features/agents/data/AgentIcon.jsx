const ICON_PATHS = {
  onboarding: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
      <circle cx="9" cy="7" r="4"></circle>
      <line x1="19" y1="8" x2="19" y2="14"></line>
      <line x1="22" y1="11" x2="16" y2="11"></line>
    </>
  ),
  offboarding: (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
      <polyline points="16 17 21 12 16 7"></polyline>
      <line x1="21" y1="12" x2="9" y2="12"></line>
    </>
  ),
  leave_attendance: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
      <line x1="16" y1="2" x2="16" y2="6"></line>
      <line x1="8" y1="2" x2="8" y2="6"></line>
      <line x1="3" y1="10" x2="21" y2="10"></line>
      <polyline points="9 16 11 18 15 14"></polyline>
    </>
  ),
  payroll_salary: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2"></rect>
      <circle cx="12" cy="12" r="2.5"></circle>
      <path d="M6 12h.01M18 12h.01"></path>
    </>
  ),
  hr_policy: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
      <polyline points="14 2 14 8 20 8"></polyline>
      <line x1="16" y1="13" x2="8" y2="13"></line>
      <line x1="16" y1="17" x2="8" y2="17"></line>
      <polyline points="10 9 9 9 8 9"></polyline>
    </>
  ),
  reimbursement_benefits: (
    <>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
      <path d="M8 9h8"></path>
      <path d="M8 13h6"></path>
    </>
  ),
};

/** Blue outline icon used on catalog cards and the chat avatar. */
export default function AgentIcon({ agentId }) {
  return (
    <svg
      className="agent-card-icon-svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#1a73e8"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICON_PATHS[agentId]}
    </svg>
  );
}
