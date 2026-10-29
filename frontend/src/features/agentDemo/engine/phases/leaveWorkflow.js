// The AutomationEdge workflow that runs just before a leave & attendance step. The workflows are showcase runs (no inputs, nothing
// returned): the portal's backend does the real work, but the chat only goes on once the workflow reached Complete.

/** The workflow each step of the leave journey runs first: URL key, AutomationEdge name, and what it stands for. */
export const LEAVE_WORKFLOWS = {
  balance: { name: 'HR Demo Get Leave Balance', title: 'Run the leave balance workflow', note: 'AutomationEdge runs “HR Demo Get Leave Balance”; the next step starts when it is Complete.' },
  check: { name: 'HR Demo Check Leave Request', title: 'Run the leave check workflow', note: 'AutomationEdge runs “HR Demo Check Leave Request”; the next step starts when it is Complete.' },
  'assign-leave': { name: 'HR Demo Assign Leave OrangeHRM', title: 'Run the assign leave workflow', note: 'AutomationEdge runs “HR Demo Assign Leave OrangeHRM”; the next step starts when it is Complete.' },
  attendance: { name: 'HR Demo Get Attendance Records', title: 'Run the attendance records workflow', note: 'AutomationEdge runs “HR Demo Get Attendance Records”; the next step starts when it is Complete.' },
  'punch-in': { name: 'HR Demo Add Punch In OrangeHRM', title: 'Run the punch-in workflow', note: 'AutomationEdge runs “HR Demo Add Punch In OrangeHRM” to set up the sample day; the next step starts when it is Complete.' },
  'punch-out': { name: 'HR Demo Punch Out OrangeHRM', title: 'Run the punch-out workflow', note: 'AutomationEdge runs “HR Demo Punch Out OrangeHRM”; the next step starts when it is Complete.' },
};

/** What the step card shows for a finished workflow run. */
export function workflowPayload(run) {
  return {
    status: run.status, message: run.message,
    automationEdge: [{ workflowName: run.workflowName, requestId: run.automationRequestId, status: run.status, agent: run.agent, message: run.message }],
  };
}

/**
 * A step that runs one showcase workflow and turns green only when it is Complete (otherwise the runner offers Rerun / Skip).
 * @param run  optional replacement for the call, so a step can decide whether the workflow is needed at all
 */
export function leaveWorkflowStep(S, key, run = () => S.api.runLeaveWorkflow(key)) {
  const wf = LEAVE_WORKFLOWS[key];
  return {
    kind: 'api', agent: 'leave', title: wf.title, name: wf.name, live: !S.api.simulated, note: wf.note,
    run: async () => {
      const result = await run();
      if (!result) return { payload: { status: 'Not needed', message: 'The workflow was not needed for this run.' } };
      if (!result.ok) throw new Error(`“${wf.name}” ended with status ${result.status}. ${result.message ?? ''}`.trim());
      return { payload: workflowPayload(result) };
    },
  };
}
