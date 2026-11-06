import { describe, expect, it, vi } from 'vitest';

// No backend in this test: the candidate comes from the built-in fallback profile.
vi.mock('../../../api/system', () => ({ getAutofillProfile: () => Promise.reject(new Error('offline')) }));

const { buildCandidate } = await import('./candidate');
const { runJourney } = await import('./index');
const { CANCELLED, createRunner } = await import('./runner');

/** Plays the simulated onboarding journey instantly and records the phases and steps in the order they appear. */
async function playSimulated() {
  const phases = [];
  const steps = [];
  let stopped = false;
  const dispatch = (action) => {
    if (action.type === 'phase') phases.push(action.phase.title);
    if (action.type === 'step') steps.push(action.step.title);
    if (action.type === 'set' && action.patch.stage === 'review') stopped = true; // the file is with HR: the approval part is not part of this check
  };
  const r = createRunner({
    dispatch, isCurrent: () => !stopped, gateRef: { current: null }, askRef: { current: null },
    timing: { stepScale: 0, messageGapMs: 0, phaseGapMs: 0, approvalWaitMs: 0 },
  });
  const S = {};
  try {
    await runJourney({ r, D: await buildCandidate(), S, set: (patch) => dispatch({ type: 'set', patch }), live: false });
  } catch (error) {
    if (error !== CANCELLED) throw error;
  }
  return { phases, steps, S };
}

describe('the onboarding journey order', () => {
  it('raises the ServiceNow request first, then attaches each document to it, then completes the file', async () => {
    const { phases, steps, S } = await playSimulated();

    const at = (title) => phases.indexOf(title);
    expect(phases.filter((p) => ['Form intake', 'Create the onboarding record and the ServiceNow request', 'Aadhaar check', 'PAN check', 'Salary slip check', 'Complete the candidate file'].includes(p)))
      .toEqual(['Form intake', 'Create the onboarding record and the ServiceNow request', 'Aadhaar check', 'PAN check', 'Salary slip check', 'Complete the candidate file']);
    expect(at('Create the onboarding record and the ServiceNow request')).toBeLessThan(at('Aadhaar check'));

    const raised = steps.indexOf('Raise the ServiceNow request');
    const attached = steps.filter((s) => s.startsWith('Attach the '));
    expect(raised).toBeGreaterThan(-1);
    expect(attached).toEqual([
      'Attach the Aadhaar card to the ServiceNow request',
      'Attach the PAN card to the ServiceNow request',
      'Attach the latest salary slip to the ServiceNow request',
    ]);
    expect(raised).toBeLessThan(steps.indexOf(attached[0]));
    expect(steps.indexOf('Run the candidate-details workflow')).toBeGreaterThan(steps.indexOf(attached[2]));
    expect(S.requestNumber).toBe('REQ0010001');
  });
});
