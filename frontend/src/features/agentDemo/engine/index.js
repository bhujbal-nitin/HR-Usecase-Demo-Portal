import { aadhaar, pan, payslips } from './phases/documents.jsx';
import { greeting, joiningForm } from './phases/intake.jsx';
import { record } from './phases/record.jsx';
import { setup } from './phases/setup.jsx';

/** The whole scripted journey, in order. Each phase adds chat messages and timeline cards. */
export async function runJourney(ctx) {
  const { r } = ctx;
  r.msg('sys', 'Demo chat. Messages and documents here are fictional.');
  await r.phaseGap();
  await greeting(ctx);
  await r.phaseGap();
  await joiningForm(ctx);
  for (const documentPhase of [aadhaar, pan, payslips]) {
    await r.phaseGap();
    await documentPhase(ctx);
  }
  await r.phaseGap();
  await record(ctx);
  if (ctx.S.stopped) return; // intake failed: the chain stopped, nothing further runs
  await r.phaseGap();
  await setup(ctx);
}
