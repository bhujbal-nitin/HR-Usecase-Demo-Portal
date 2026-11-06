import { aadhaar, pan, payslips } from './phases/documents.jsx';
import { askForAadhaar, greeting, joiningForm } from './phases/intake.jsx';
import { finishIntake, openRequest } from './phases/record.jsx';
import { setup } from './phases/setup.jsx';

/** The whole scripted journey, in order. Each phase adds chat messages and timeline cards. */
export async function runJourney(ctx) {
  const { r } = ctx;
  r.msg('sys', 'Demo chat. Messages and documents here are fictional.');
  await r.phaseGap();
  await greeting(ctx);
  await r.phaseGap();
  await joiningForm(ctx);
  // The ServiceNow request is raised first; each document is then attached to it as it arrives.
  await r.phaseGap();
  await openRequest({ ...ctx, ask: () => askForAadhaar(ctx) });
  if (ctx.S.stopped) return; // the request could not be raised: nothing further runs
  for (const documentPhase of [aadhaar, pan, payslips]) {
    await r.phaseGap();
    await documentPhase(ctx);
  }
  await r.phaseGap();
  await finishIntake(ctx);
  if (ctx.S.stopped) return; // intake failed: the chain stopped, nothing further runs
  await r.phaseGap();
  await setup(ctx);
}
