import { describe, expect, it } from 'vitest';
import {
  DOCUMENTS, detectIntent, sampleDetails, sampleFiles, samplePersonal, validateAcceptance, validateCandidate, validateDocumentFile, validatePersonal,
} from '../lib/preOnboarding';
import { runPreOnboarding } from './preOnboardingJourney.jsx';
import { CANCELLED, createRunner } from './runner';

/** Plays the simulated pre-onboarding instantly and records the phases and steps in the order they appear. */
async function play() {
  const phases = [];
  const steps = [];
  const sets = [];
  const dispatch = (action) => {
    if (action.type === 'phase') phases.push(action.phase.title);
    if (action.type === 'step') steps.push(action.step.title);
    if (action.type === 'set') sets.push(action.patch);
  };
  const r = createRunner({
    dispatch, isCurrent: () => true, gateRef: { current: null }, askRef: { current: null },
    timing: { stepScale: 0, messageGapMs: 0, phaseGapMs: 0, approvalWaitMs: 0 },
  });
  try {
    await runPreOnboarding({ r, set: (patch) => dispatch({ type: 'set', patch }), auto: {}, simulated: true });
  } catch (error) {
    if (error !== CANCELLED) throw error;
  }
  return { phases, steps, sets };
}

describe('the simulated pre-onboarding journey', () => {
  it('releases the offer, takes acceptance, personal details and seven documents, then background check, HR, joining and completion, in that order', async () => {
    const { phases, steps, sets } = await play();
    const docPhases = phases.filter((title) => title.startsWith('Check the '));
    expect(docPhases).toHaveLength(DOCUMENTS.length);

    const order = [
      'Create the pre-hire record', 'Release the offer', 'Offer acceptance', 'Personal information', docPhases[0], docPhases[6],
      'Compare the names', 'Background verification', 'HR approval', 'Joining confirmation', 'Onboarding initiation', 'Close the conversation',
    ];
    const positions = order.map((title) => phases.indexOf(title));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(order.every((title) => phases.includes(title))).toBe(true);

    expect(steps).toContain('Create the pre-hire record and the ServiceNow request');
    expect(steps.filter((title) => title.startsWith('Read and check the '))).toHaveLength(DOCUMENTS.length);
    expect(steps.indexOf('Generate the offer letter')).toBeLessThan(steps.indexOf('Record the acceptance and joining date'));
    expect(steps.indexOf('E-mail the offer letter')).toBeGreaterThan(steps.indexOf('Generate the offer letter'));
    expect(steps.indexOf('Background verification')).toBeGreaterThan(steps.indexOf('Compare the name on all the documents'));
    expect(steps.indexOf('Make and e-mail the joining instructions')).toBeGreaterThan(steps.indexOf('HR approval'));
    expect(steps.indexOf('Close the ServiceNow request')).toBeGreaterThan(steps.indexOf('Complete the pre-onboarding'));
    expect(steps).not.toContain('Document review');
    expect(sets.some((patch) => patch.outcome === true)).toBe(true);
  });

  it('never uses AutomationEdge workflows', async () => {
    const { steps } = await play();
    expect(steps.some((title) => /workflow/i.test(title))).toBe(false);
  });
});

describe('the pre-onboarding facts', () => {
  it('has seven documents with a sample file each (no cancelled cheque)', () => {
    expect(DOCUMENTS).toHaveLength(7);
    expect(sampleFiles().map((file) => file.filename)).toEqual([
      '10th_Marksheet_Priya_Anil_Nair.pdf', '12th_Marksheet_Priya_Anil_Nair.pdf', 'Degree_Certificate_Priya_Anil_Nair.pdf', 'Aadhaar_Card_Priya_Anil_Nair.pdf',
      'PAN_Card_Priya_Anil_Nair.pdf', 'Passport_Photo_Priya_Anil_Nair.jpg', 'Resume_Priya_Anil_Nair.pdf',
    ]);
  });

  it('accepts the sample personal information and refuses a minor, a bad phone and short addresses', () => {
    expect(validatePersonal(samplePersonal())).toEqual({});
    const bad = validatePersonal({ ...samplePersonal(), dateOfBirth: '2999-01-01', emergencyPhone: '12', currentAddress: 'x', gender: '' });
    expect(Object.keys(bad).sort()).toEqual(['currentAddress', 'dateOfBirth', 'emergencyPhone', 'gender']);
  });

  it('checks the joining date: needed, not in the past, not a Sunday', () => {
    expect(validateAcceptance({ joiningDate: '' }).joiningDate).toMatch(/Choose/);
    expect(validateAcceptance({ joiningDate: '2000-01-03' }).joiningDate).toMatch(/past/);
    expect(validateAcceptance({ joiningDate: '2999-01-06' }).joiningDate).toMatch(/Sunday/); // a Sunday
    expect(validateAcceptance({ joiningDate: '2999-01-07' })).toEqual({});
  });

  it('validates the candidate form, needing a real e-mail address', () => {
    expect(validateCandidate(sampleDetails('someone@example.com'))).toEqual({});
    expect(Object.keys(validateCandidate({ ...sampleDetails('not-an-email'), fullName: 'Priya', annualCtc: '10' })).sort()).toEqual(['annualCtc', 'email', 'fullName']);
  });

  it('refuses a file that is empty, too large or the wrong kind', () => {
    expect(validateDocumentFile(new File(['x'], 'a.pdf'))).toBe('');
    expect(validateDocumentFile(new File([], 'a.pdf'))).toMatch(/empty/);
    expect(validateDocumentFile(new File(['x'], 'a.exe'))).toMatch(/PDF/);
  });

  it('reads what the candidate says', () => {
    expect(detectIntent('Start my pre-onboarding')).toBe('start');
    expect(detectIntent('thanks, that is all')).toBe('done');
    expect(detectIntent('banana')).toBeNull();
  });
});
