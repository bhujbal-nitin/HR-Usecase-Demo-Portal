import { getEmployee } from '../../../../api/employees';

const POLL_MS = 1500;
// Steps in which an AutomationEdge workflow does the work.
export const WORKFLOW_KEYS = new Set([
  'candidate_details', 'management_approval', 'active_directory', 'office365', 'orangehrm', 'laptop',
  'exit_details', 'exit_approval', 'ad_disable', 'o365_block', 'hrm_terminate', 'asset_return', 'clearances', 'relieving_letter',
]);
const STEP_STATUS = { pending: 'queued', running: 'running', success: 'done', failed: 'failed', skipped: 'skipped' };
const STEP_KIND = { 'E-mail': 'notify' };

/** What each real step produced, shown in the card's data. Includes the AutomationEdge status and response. */
export function stepPayload(step, e) {
  const extra = {
    servicenow_request: { request: e.serviceNow.reqNumber, item: e.serviceNow.ritmNumber, approval: e.serviceNow.approvalStatus, attachments: e.serviceNow.attachedDocuments, warnings: step.details?.warnings },
    servicenow_approval: { request: e.serviceNow.reqNumber, approval: e.serviceNow.approvalStatus },
    office365: e.office365 && { userPrincipalName: e.office365.userPrincipalName, displayName: e.office365.displayName },
    orangehrm: e.orangeHrm && { empNumber: e.orangeHrm.empNumber, profile: e.orangeHrm.profileUrl },
    laptop: e.laptop && { incident: e.laptop.ticketNumber, hardware: e.laptop.hardware },
  }[step.key];
  return { status: step.status, message: step.message, ...(step.details?.workflows ? { automationEdge: step.details.workflows } : {}), ...extra };
}

/**
 * Mirrors a backend step chain into the timeline. The backend runs the steps strictly one after another (each
 * AutomationEdge workflow must reach Complete before the next starts); this only watches and draws it, so a card
 * turns green exactly when the real step finished.
 *
 * @param pick     (employee) => steps array to mirror (employee.intake or employee.pipeline)
 * @param load     (id) => Promise<record>; defaults to the onboarding record
 * @param describe (step, record) => the data shown on the step's card; defaults to the onboarding description
 * @param isDone   (employee) => true once the chain has finished (successfully or not)
 */
export async function mirrorSteps({
  r, phaseId, employeeId, pick, isDone, agent, timeoutMs, timeoutMessage, load = getEmployee, describe = stepPayload,
  memo = { cards: {}, counted: new Set() },
}) {
  r.dispatch({ type: 'agent', agent });
  const { cards, counted } = memo; // kept across reruns so the same cards are updated, not duplicated
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const employee = await load(employeeId);
    pick(employee).forEach((step) => {
      if (!cards[step.key]) {
        cards[step.key] = r.addStep(phaseId, {
          kind: STEP_KIND[step.system] ?? 'api', agent, title: step.label, note: WORKFLOW_KEYS.has(step.key) ? 'An AutomationEdge workflow performs this step. The next step starts only after the workflow is Complete.' : `${step.system}: the next step starts only after this one succeeds.`, name: step.key, live: true,
        });
      }
      const ms = step.startedAt && step.finishedAt ? new Date(step.finishedAt) - new Date(step.startedAt) : 0;
      const finished = !['pending', 'running'].includes(step.status);
      r.patchStep(cards[step.key], {
        status: STEP_STATUS[step.status],
        payload: describe(step, employee),
        live: !step.details?.simulated, // a step the backend only pretends to do (not connected yet) is tagged Simulated
        latLabel: !finished ? '' : step.status === 'skipped' ? 'skipped' : `${ms} ms`,
      });
      const stamp = `${step.key}:${step.finishedAt}`; // a rerun of a step finishes again with a new timestamp
      if (finished && !counted.has(stamp)) {
        counted.add(stamp);
        r.dispatch({ type: 'stat', delta: { steps: 1, lat: ms, tools: 1 } });
      }
    });
    if (isDone(employee)) return employee;
    if (Date.now() > deadline) throw new Error(timeoutMessage);
    await r.wait(POLL_MS);
  }
}

/**
 * mirrorSteps + the rerun loop. When a step fails the chain has stopped on the backend; the failed card offers
 * "Rerun from this step" (the backend keeps everything that already succeeded) or "Stop here".
 *
 * @param retry   (employeeId) => Promise: asks the backend to re-run from the failed step
 * @param skip    (employeeId) => Promise: asks the backend to skip the failed step and carry on with the next
 * @param failed  (employee) => the failed step, if any
 * @returns {{ employee, stopped }}
 */
export async function mirrorWithRerun({ r, set, retry, skip, failed, label, ...options }) {
  const memo = { cards: {}, counted: new Set() };
  for (;;) {
    const employee = await mirrorSteps({ ...options, r, memo });
    const failedStep = failed(employee);
    if (!failedStep) return { employee, stopped: false };

    r.patchStep(memo.cards[failedStep.key], { rerun: true });
    set({ error: `${label} stopped at “${failedStep.label}”: ${failedStep.message ?? 'see the card for details'}` });
    const choice = await r.waitForGate();
    r.patchStep(memo.cards[failedStep.key], { rerun: false });
    if (choice === 'skip' && skip) {
      set({ error: null });
      await skip(options.employeeId);
      continue;
    }
    if (choice !== 'rerun') {
      set({ error: `${label} stopped at “${failedStep.label}”: ${failedStep.message ?? 'see the card for details'}` });
      return { employee, stopped: true, failedStep };
    }
    set({ error: null });

    await retry(options.employeeId);
  }
}
