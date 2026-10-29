import { SIMULATED_PROCESSES } from '../process/simulatedProcesses';
import * as leaveAttendance from './leaveAttendanceAgent.jsx';
import * as offboarding from './offboardingAgent.jsx';
import * as onboarding from './onboardingAgent.jsx';
import * as hrPolicy from './hrPolicyAgent.jsx';
import * as payrollSalary from './payrollSalaryAgent.jsx';
import * as reimbursementBenefits from './reimbursementBenefitsAgent.jsx';

/** Look up a scripted process by key (`<agentId>.<action>`). Undefined if none is defined. */
export const getSimulatedProcess = (key) => SIMULATED_PROCESSES[key];

// Attach the scripted demo process for an action, if one exists. (The onboarding agent has no scripted
// responses: its journey runs from features/agentDemo.)
function withProcess(agentId, respond = () => null) {
  return (action, ctx) => {
    const response = respond(action, ctx);
    if (!response) return response;
    const process = getSimulatedProcess(`${agentId}.${action}`);
    return process ? { ...response, process } : response;
  };
}

// Catalog order matches the Piraji portal.
export const AGENTS = [onboarding, offboarding, leaveAttendance, payrollSalary, hrPolicy, reimbursementBenefits].map(
  (module) => ({ ...module.config, respond: withProcess(module.config.id, module.respond) }),
);

export const AGENT_BY_ID = Object.fromEntries(AGENTS.map((agent) => [agent.id, agent]));

export const CATEGORIES = [
  { id: 'all', label: 'All Agents' },
  { id: 'lifecycle', label: 'Talent & Lifecycle' },
  { id: 'core', label: 'Core HR & Payroll' },
  { id: 'compliance', label: 'Compliance & Benefits' },
];
