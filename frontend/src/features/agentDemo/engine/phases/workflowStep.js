import { runVerificationWorkflow } from '../../../../api/documents';

/**
 * A live step that runs the AutomationEdge "HR Demo Document Verification" workflow. It only turns green when the workflow
 * instance reaches Complete; on any other status the runner shows Rerun / Stop (Stop ends the run with the failure shown).
 * Without AutomationEdge credentials the backend reports "skipped" and the step shows a warning instead.
 */
export function documentWorkflowStep(label, { live = true } = {}) {
  // Simulated runs show the same step, in the same place, with a scripted "Complete" answer (nothing is called).
  if (!live) {
    return {
      kind: 'api', agent: 'ver', title: 'Run the document verification workflow', name: 'HR Demo Document Verification', lat: 900,
      note: `Simulated: AutomationEdge would run "HR Demo Document Verification" for the ${label}; the next step starts only after it is Complete.`,
      payload: {
        status: 'Complete', message: 'Document verified',
        automationEdge: [{ workflowName: 'HR Demo Document Verification', status: 'Complete', message: 'Document verified' }],
      },
    };
  }
  return {
    kind: 'api', agent: 'ver', title: 'Run the document verification workflow', name: 'HR Demo Document Verification', live: true,
    note: `AutomationEdge runs "HR Demo Document Verification" for the ${label}; this step waits until it is Complete before the next one starts.`,
    // A workflow that does not end Complete throws; the runner then offers Rerun / Stop for this step.
    run: async () => {
      const run = await runVerificationWorkflow();
      if (run.skipped) return { warn: true, payload: { status: 'Skipped', message: 'Not run: AutomationEdge is not configured' } };
      if (!run.ok) throw new Error(`The document verification workflow ended with status ${run.status}. ${run.message}`.trim());
      return {
        payload: {
          status: run.status, message: run.message,
          automationEdge: [{ workflowName: run.workflowName, requestId: run.automationRequestId, status: run.status, agent: run.agent, message: run.message }],
        },
      };
    },
  };
}
