// The HR policy & documents chat: what the employee can ask for, and the questions Auto-play asks.

/** What the assistant offers (the suggestion chips, in every mode). Auto-play taps them in this order. */
export const SCENARIOS = [
  { id: 'search', label: 'Policy search', intent: 'policy.search' },
  { id: 'ask', label: 'Ask a policy question', intent: 'policy.question' },
  { id: 'letter', label: 'Request a letter', intent: 'documents.letter' },
];

/** Auto-play picks the first policy whose name has this word from the dropdown. */
export const AUTO_POLICY_WORD = 'leave';

/** Questions offered as suggestion chips in every mode (the employee can also type their own). */
export const SUGGESTED_QUESTIONS = [
  'What is the leave policy?',
  'What is the health and safety policy?',
  'What is the code of conduct?',
  'Am I eligible for weekend allowance?',
  'What is the mediclaim insurance policy?',
  'What is the maternity policy?',
  'What is the paternity policy?',
  'What are the casual leave policies?',
];

/** The questions Auto-play asks: the first is the first suggestion (Auto-play taps the chip), the second is a follow-up that needs the chat history. */
export const AUTO_QUESTIONS = [SUGGESTED_QUESTIONS[0], 'what are the conditions for it?'];

const INTENTS = [
  ['done', /\b(bye|goodbye|thanks?|thank you|that['’]?s all|nothing else|no more)\b/i],
  ['letter', /letter|certificate|address proof|bank account|proof of/i],
  ['search', /search|find|look for|looking for|download|list|show .*polic|which polic/i],
  ['ask', /policy|policies|question|ask|eligible|rule|handbook|leave|promotion|benefit/i],
];

/** 'search' | 'ask' | 'letter' | 'done' | null, from what the employee typed. */
export function detectIntent(text) {
  return INTENTS.find(([, pattern]) => pattern.test(text ?? ''))?.[0] ?? null;
}

/** The letter whose title the employee chose or typed (by its title or a word in it), or null. */
export function findLetter(letters, text) {
  const wanted = (text ?? '').toLowerCase();
  return letters.find((letter) => letter.title.toLowerCase() === wanted)
    ?? letters.find((letter) => (letter.key === 'address-proof' && /address/.test(wanted)) || (letter.key === 'bank-account' && /bank|account/.test(wanted)))
    ?? null;
}

/** The two letters as the simulated run offers them for an employee (the live run asks the backend, which looks in the HR documents folder). */
export const simulatedLetters = (employeeName) => {
  const who = employeeName.trim().replace(/\s+/g, '_');
  return [
    { key: 'address-proof', title: 'Address proof letter', available: true, fileName: `Address_Proof_Letter_${who}.docx` },
    { key: 'bank-account', title: 'Bank account opening letter', available: true, fileName: `Bank_Account_Opening_Letter_${who}.docx` },
  ];
};

// ---- Policies ----------------------------------------------------------------------------------------------------------------------------

/** The policies as the simulated run lists them (the live run lists the PDFs in backend/hr_documents/Policies). */
export const SIMULATED_POLICIES = [
  'AE Code of Conduct Policy', 'AE Health and Safety Policy', 'AE Leave Policy', 'AE Maternity Benefit Act', 'AE Medi Assist', 'AE Paternity Leave Policy',
  'AE POSH Policy', 'AE Social Media Policy', 'AE Weekend Allowance Policy',
].map((title) => ({ key: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'), title, fileName: `${title}.pdf` }));
