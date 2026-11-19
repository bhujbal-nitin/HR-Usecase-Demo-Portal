// The Pre-Onboarding agent runs from features/agentDemo (preOnboardingJourney.jsx): the candidate's offer, personal information and seven documents are read and checked, a background verification runs and
// HR approve on the Approvals page, and the offer letter is made and e-mailed. This file only describes the agent on its card.

export const config = {
  id: 'pre_onboarding',
  name: 'Pre-Onboarding Agent',
  catalogName: 'Pre-Onboarding',
  category: 'lifecycle',
  description:
    'Runs the candidate’s pre-onboarding lifecycle: releases the offer letter, records the acceptance and joining date, takes the personal information and seven documents (10th and 12th marksheets, degree, Aadhaar, PAN, photo and resume), reads each one and compares the names, runs a background verification, gets HR’s approval, then e-mails the joining instructions.',
  tags: ['Offer Letter', '7-Document Intake', 'Name Cross-Check', 'Background Verification', 'HR Approval', 'Joining Letter'],
  badge: 'Document Review & Approval',
  greeting: (
    <>
      👋 Hello! I am your <strong>Pre-Onboarding AI Agent</strong>. I take you from your offer to your joining: your acceptance, personal information and seven documents (I check that the names match), and once HR approves I
      will e-mail your joining instructions.
    </>
  ),
  quickPrompts: [{ text: '📂 Start my pre-onboarding', action: 'start' }],
};

/** No scripted answers: the live and simulated runs play the real journey. */
export function respond() {
  return null;
}
