import { listEmployees } from '../../../api/employees';
import { listOffboardings } from '../../../api/offboardings';

const SAMPLE_COUNT = 2;

/**
 * The onboarded and approved employees a demo can be run for. For offboarding only those with no offboarding yet; for leave and
 * reimbursement not those who have already left (OrangeHRM has terminated them). `kind` is 'offboarding', 'leave', 'reimbursement',
 * 'payroll' or 'hr_policy'.
 */
export async function eligibleEmployees(kind) {
  const offboarding = kind === 'offboarding';
  const needsOffboardings = offboarding || kind === 'leave' || kind === 'reimbursement';
  const [employees, offboardings] = await Promise.all([listEmployees(), needsOffboardings ? listOffboardings() : Promise.resolve([])]);
  const hidden = new Set(offboardings.filter((o) => (offboarding ? o.status !== 'Rejected' : o.status === 'Completed')).map((o) => o.employeeId));
  return employees.filter((e) => e.status === 'Approved' && !hidden.has(e.id));
}

/** The employee IDs offered as one-tap samples in a Manual demo. Empty if the records cannot be read, so typing still works. */
export async function sampleEmployeeIds(kind) {
  try {
    return (await eligibleEmployees(kind)).slice(0, SAMPLE_COUNT).map((e) => e.id);
  } catch {
    return [];
  }
}
