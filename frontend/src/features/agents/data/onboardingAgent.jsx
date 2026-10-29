// The Onboarding agent is the one agent backed by the real API. Its demo journey is not scripted from this
// file: it lives in features/agentDemo (engine/phases), where each step is tagged Live or Simulated.

export const config = {
  id: 'onboarding',
  name: 'Onboarding Agent',
  catalogName: 'Onboarding',
  category: 'lifecycle',
  description:
    'Collects candidate details and Aadhaar, EPFO and payslip documents, routes them for HR approval, then provisions ServiceNow, Active Directory, Microsoft 365, OrangeHRM and the IT laptop.',
  tags: ['Document Verification', 'HR Approval', 'ServiceNow · AD · O365', 'OrangeHRM · Laptop · Offer Letter'],
  badge: 'Autonomous',
  greeting: null,
  quickPrompts: [],
};
