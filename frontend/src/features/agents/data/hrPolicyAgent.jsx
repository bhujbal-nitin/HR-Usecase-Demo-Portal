// The HR Policy & Document agent runs from features/agentDemo (hrPolicyJourney.jsx): its questions go to the knowledge base and its letters
// are Word files made from the templates in the HR documents folder. This file only describes the agent on its card.

export const config = {
  id: 'hr_policy',
  name: 'HR Policy & Document Agent',
  catalogName: 'HR Policy & Document',
  category: 'compliance',
  description: 'Lets the employee pick a company policy from a dropdown to download, answers questions about them from the knowledge base, and gives official letters on request as Word files with the employee’s own details: an address proof (bonafide) letter and a bank account opening letter.',
  tags: ['Policy Search · Dropdown Download', 'Policy Q&A (Knowledge Base)', 'Follow-up Questions', 'Address Proof Letter', 'Bank Account Opening Letter', 'AutomationEdge'],
  badge: '24/7 Available',
  greeting: (
    <>
      👋 Hello! I am your <strong>HR Policy & Document AI Assistant</strong>. Search for a company policy, ask me about the policies, or request an address
      proof letter or a bank account opening letter.
    </>
  ),
  quickPrompts: [
    { text: '🔎 Policy Search', action: 'search_policy' },
    { text: '📚 Ask a Policy Question', action: 'ask_policy' },
    { text: '📄 Request a Letter', action: 'request_letter' },
  ],
};

/** No scripted answers: the live and simulated runs play the real journey. */
export function respond() {
  return null;
}
