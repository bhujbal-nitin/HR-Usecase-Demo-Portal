// The Reimbursement & Benefits agent runs from features/agentDemo (reimbursementJourney.jsx): its bills are read with OpenAI and its
// claims go to the manager and into OrangeHRM. This file only describes the agent on its card.

export const config = {
  id: 'reimbursement_benefits',
  name: 'Reimbursement & Benefits Agent',
  catalogName: 'Reimbursement & Benefits',
  category: 'compliance',
  description:
    'Reads expense bills of any kind (PDF or photo), marks what is within the policy, lets the manager approve or reject each bill and records the approved ones in OrangeHRM.',
  tags: ['Bill Reading (OpenAI)', 'All Bill Types', 'Per-Bill Approval', 'OrangeHRM Claim', 'AutomationEdge'],
  badge: 'Instant Approvals',
  greeting: (
    <>
      👋 Hello! I am your <strong>Reimbursement & Benefits AI Agent</strong>. Upload your expense bills and I will read them, show what can be
      reimbursed and send the claim to your manager, who approves each bill.
    </>
  ),
  quickPrompts: [{ text: '🧾 Submit an Expense Claim', action: 'submit_claim' }],
};

/** No scripted answers: the live and simulated runs play the real journey. */
export function respond() {
  return null;
}
