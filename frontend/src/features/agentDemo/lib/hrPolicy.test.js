import { describe, expect, it } from 'vitest';
import { AUTO_POLICY_WORD, AUTO_QUESTIONS, SIMULATED_POLICIES, SUGGESTED_QUESTIONS, detectIntent, findLetter, simulatedLetters } from './hrPolicy';

const SIMULATED_LETTERS = simulatedLetters('Aditi Rao');

describe('detectIntent', () => {
  it('tells a policy question, a letter request and goodbye apart', () => {
    expect(detectIntent('I have a question about the leave policy')).toBe('ask');
    expect(detectIntent('Ask a policy question')).toBe('ask');
    expect(detectIntent('Policy search')).toBe('search');
    expect(detectIntent('find the maternity policy')).toBe('search');
    expect(detectIntent('Request a letter')).toBe('letter');
    expect(detectIntent('I need an address proof')).toBe('letter');
    expect(detectIntent('thanks, that is all')).toBe('done');
    expect(detectIntent('That’s all')).toBe('done'); // with the curly apostrophe of the chip
    expect(detectIntent('what is the weather')).toBeNull();
  });
});

describe('findLetter', () => {
  it('finds a letter by its title or by a word in it', () => {
    expect(findLetter(SIMULATED_LETTERS, 'Address proof letter').key).toBe('address-proof');
    expect(findLetter(SIMULATED_LETTERS, 'bank account opening letter').key).toBe('bank-account');
    expect(findLetter(SIMULATED_LETTERS, 'i need the bank one').key).toBe('bank-account');
    expect(findLetter(SIMULATED_LETTERS, 'my address please').key).toBe('address-proof');
    expect(findLetter(SIMULATED_LETTERS, 'salary certificate')).toBeNull();
  });
});

describe('simulatedLetters', () => {
  it('are two Word files named after the employee', () => {
    expect(SIMULATED_LETTERS.map((l) => l.fileName)).toEqual(['Address_Proof_Letter_Aditi_Rao.docx', 'Bank_Account_Opening_Letter_Aditi_Rao.docx']);
  });
});

describe('the simulated policies', () => {
  it('are the nine policy documents, each with a key and a PDF file name', () => {
    expect(SIMULATED_POLICIES).toHaveLength(9);
    expect(SIMULATED_POLICIES.find((p) => p.title === 'AE Leave Policy')).toEqual({ key: 'ae-leave-policy', title: 'AE Leave Policy', fileName: 'AE Leave Policy.pdf' });
  });
});

describe('Auto-play', () => {
  it('asks the first suggested question, then a follow-up', () => {
    expect(AUTO_QUESTIONS).toEqual(['What is the leave policy?', 'what are the conditions for it?']);
    expect(SUGGESTED_QUESTIONS).toHaveLength(8);
    expect(SUGGESTED_QUESTIONS[0]).toBe(AUTO_QUESTIONS[0]);
    expect(SIMULATED_POLICIES.some((p) => p.title.toLowerCase().includes(AUTO_POLICY_WORD))).toBe(true); // the dropdown has the policy Auto-play picks
  });
});
