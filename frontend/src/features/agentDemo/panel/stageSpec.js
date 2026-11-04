import { SIMULATED_PROCESSES } from '../../agents/process/simulatedProcesses';
import { WORKFLOW_KEYS } from '../engine/phases/mirror';

// Everything the right-hand panel needs to *draw* a step: which map nodes it touches, which icon and which
// animation to show. It is keyed on the step's stable `name`, so no journey/flow code has to know about it.

// ---- System map ---------------------------------------------------------------------------------------------------

const ONBOARDING_MAP = {
  nodes: {
    cand: { x: 48, y: 116, icon: 'chat', label: 'Candidate', sub: 'WhatsApp', t: 'person' },
    orch: { x: 190, y: 116, icon: 'sparkle', label: 'Orchestrator', t: 'agent' },
    prov: { x: 385, y: 116, icon: 'laptop', label: 'Onboarding Agent', t: 'agent' },
    docs: { x: 620, y: 30, icon: 'file', label: 'Documents', sub: 'ID, PAN, salary slip', t: 'system' },
    servicenow: { x: 620, y: 74, icon: 'ticket', label: 'ServiceNow', t: 'system' },
    ad: { x: 620, y: 118, icon: 'server', label: 'Active Directory', t: 'system' },
    o365: { x: 620, y: 162, icon: 'windows', label: 'Microsoft 365', t: 'system' },
    ohrm: { x: 620, y: 206, icon: 'db', label: 'OrangeHRM', t: 'system' },
  },
  edges: [
    ['cand', 'orch'], ['orch', 'prov'],
    ['prov', 'docs'], ['prov', 'servicenow'], ['prov', 'ad'], ['prov', 'o365'], ['prov', 'ohrm'],
  ],
  // The steps still say which part of the work they are (document, verification, provisioning); on the map it is all one agent.
  alias: { doc: 'prov', ver: 'prov' },
};

// Offboarding (Manual · Live): AutomationEdge workflows, then the backend's own calls to ServiceNow, Microsoft 365, OrangeHRM and e-mail.
const OFFBOARDING_MAP = {
  nodes: {
    cand: { x: 48, y: 116, icon: 'chat', label: 'Employee', sub: 'WhatsApp', t: 'person' },
    orch: { x: 190, y: 116, icon: 'sparkle', label: 'Orchestrator', t: 'agent' },
    prov: { x: 385, y: 116, icon: 'laptop', label: 'Offboarding Agent', t: 'agent' },
    servicenow: { x: 620, y: 30, icon: 'ticket', label: 'ServiceNow', t: 'system' },
    ad: { x: 620, y: 74, icon: 'server', label: 'Active Directory', t: 'system' },
    o365: { x: 620, y: 118, icon: 'windows', label: 'Microsoft 365', t: 'system' },
    ohrm: { x: 620, y: 162, icon: 'db', label: 'OrangeHRM', t: 'system' },
    mail: { x: 620, y: 206, icon: 'mail', label: 'E-mail', t: 'system' },
  },
  edges: [
    ['cand', 'orch'], ['orch', 'prov'], ['orch', 'servicenow'], ['prov', 'servicenow'],
    ['prov', 'ad'], ['prov', 'o365'], ['prov', 'ohrm'], ['prov', 'mail'],
  ],
};

// Leave & attendance: the agent reads balances, holidays and punches in OrangeHRM (and records approved requests there),
// and sends each request to the manager. Each step is preceded by its AutomationEdge workflow.
const LEAVE_MAP = {
  nodes: {
    cand: { x: 48, y: 116, icon: 'chat', label: 'Employee', sub: 'WhatsApp', t: 'person' },
    orch: { x: 190, y: 116, icon: 'sparkle', label: 'Orchestrator', t: 'agent' },
    leave: { x: 385, y: 116, icon: 'users', label: 'Leave & Attendance Agent', t: 'agent' },
    ohrm: { x: 620, y: 80, icon: 'db', label: 'OrangeHRM', t: 'system' },
    mgr: { x: 620, y: 150, icon: 'user', label: 'Manager', sub: 'Approvals', t: 'person' },
  },
  edges: [['cand', 'orch'], ['orch', 'leave'], ['orch', 'ohrm'], ['leave', 'ohrm'], ['leave', 'mgr']],
};

// Payroll & salary: the agent reads the employee's salary record in OrangeHRM and works out the payslip and the tax itself.
// Each document is preceded by its AutomationEdge workflows, drawn as the link between the agent and OrangeHRM.
const PAYROLL_MAP = {
  nodes: {
    cand: { x: 48, y: 116, icon: 'chat', label: 'Employee', sub: 'WhatsApp', t: 'person' },
    orch: { x: 190, y: 116, icon: 'sparkle', label: 'Orchestrator', t: 'agent' },
    pay: { x: 385, y: 116, icon: 'bank', label: 'Payroll & Salary Agent', t: 'agent' },
    ohrm: { x: 620, y: 116, icon: 'db', label: 'OrangeHRM', t: 'system' },
  },
  edges: [['cand', 'orch'], ['orch', 'pay'], ['orch', 'ohrm'], ['pay', 'ohrm']],
};

// Reimbursement & benefits: the agent scans each bill, sends the claim to the manager and records the approved claim in
// OrangeHRM. Each step is followed by its AutomationEdge workflow.
const REIMBURSEMENT_MAP = {
  nodes: {
    cand: { x: 48, y: 116, icon: 'chat', label: 'Employee', sub: 'WhatsApp', t: 'person' },
    orch: { x: 190, y: 116, icon: 'sparkle', label: 'Orchestrator', t: 'agent' },
    reimb: { x: 385, y: 116, icon: 'bank', label: 'Reimbursement & Benefits Agent', t: 'agent' },
    scan: { x: 620, y: 50, icon: 'eye', label: 'Document Scanning', sub: 'reads the bills', t: 'system' },
    ohrm: { x: 620, y: 110, icon: 'db', label: 'OrangeHRM', sub: 'Claim', t: 'system' },
    mgr: { x: 620, y: 170, icon: 'user', label: 'Manager', sub: 'Approvals', t: 'person' },
  },
  edges: [['cand', 'orch'], ['orch', 'reimb'], ['orch', 'ohrm'], ['reimb', 'scan'], ['reimb', 'ohrm'], ['reimb', 'mgr']],
};

// HR policy & documents: the agent finds policies, asks the knowledge base and makes the letters from the HR documents folder. Each step is followed by its AutomationEdge workflow.
const HR_POLICY_MAP = {
  nodes: {
    cand: { x: 48, y: 116, icon: 'chat', label: 'Employee', sub: 'WhatsApp', t: 'person' },
    orch: { x: 190, y: 116, icon: 'sparkle', label: 'Orchestrator', t: 'agent' },
    policy: { x: 385, y: 116, icon: 'file', label: 'HR Policy & Document Agent', t: 'agent' },
    km: { x: 620, y: 80, icon: 'search', label: 'Knowledge base', sub: 'policy answers', t: 'system' },
    docs: { x: 620, y: 150, icon: 'file', label: 'HR documents', sub: 'policies and letters', t: 'system' },
  },
  edges: [['cand', 'orch'], ['orch', 'policy'], ['policy', 'km'], ['policy', 'docs']],
};

/** Map for the scripted agents: their own systems, taken from their scripted processes. */
function genericMap(agentId) {
  const systems = [];
  Object.entries(SIMULATED_PROCESSES)
    .filter(([key]) => key.startsWith(`${agentId}.`))
    .forEach(([, spec]) => spec.systems.forEach((name) => !systems.includes(name) && systems.push(name)));
  const nodes = {
    cand: { x: 48, y: 116, icon: 'chat', label: 'User', sub: 'WhatsApp', t: 'person' },
    orch: { x: 190, y: 116, icon: 'sparkle', label: 'Orchestrator', t: 'agent' },
    spec: { x: 385, y: 76, icon: 'users', label: 'Specialist Agent', t: 'agent' },
    sys: { x: 385, y: 156, icon: 'laptop', label: 'Integration Agent', t: 'agent' },
  };
  const gap = Math.min(44, 190 / Math.max(systems.length, 1));
  const top = 116 - ((systems.length - 1) * gap) / 2;
  systems.forEach((name, i) => {
    nodes[`s${i}`] = { x: 620, y: Math.round(top + i * gap), icon: /mail/i.test(name) ? 'mail' : /365|microsoft/i.test(name) ? 'windows' : /servicenow/i.test(name) ? 'ticket' : /automation/i.test(name) ? 'bolt' : /bank|finance|payroll/i.test(name) ? 'bank' : /policy|index/i.test(name) ? 'file' : 'db', label: name, t: 'system' };
  });
  const edges = [['cand', 'orch'], ['orch', 'spec'], ['orch', 'sys']];
  systems.forEach((_, i) => { edges.push(['spec', `s${i}`], ['sys', `s${i}`]); });
  return { nodes, edges, systemCount: systems.length };
}

const MAPS = { onboarding: ONBOARDING_MAP, 'offboarding-live': OFFBOARDING_MAP, leave_attendance: LEAVE_MAP, payroll_salary: PAYROLL_MAP, reimbursement_benefits: REIMBURSEMENT_MAP, hr_policy: HR_POLICY_MAP };
export const mapFor = (agentId) => MAPS[agentId] ?? genericMap(agentId);

// ---- Hops (which edges light up) ------------------------------------------------------------------------------------

const BOTH = (a, b) => [[a, b], [b, a]];

/** A request that goes out and comes back: the dot travels there and returns. */
const ROUND = (a, b) => BOTH(a, b);

/** Onboarding: the Orchestrator hands the work to the Onboarding Agent, which goes to the system and back, and the answer returns the same way. */
const THROUGH = (system) => [['orch', 'prov'], ['prov', system], [system, 'prov'], ['prov', 'orch']];

// Steps with no entry here (rules, planning, packaging, the portal's own record) happen inside the agent itself:
// the agent lights up but no line is drawn, because nothing leaves it.
const HOPS = {
  'POST /webhook/whatsapp': [['cand', 'orch']],
  'whatsapp.send_flow()': [['orch', 'cand']],
  'whatsapp.send_text()': [['orch', 'cand']],
  'whatsapp.send_template()': [['prov', 'orch'], ['orch', 'cand']],
  'hrms.find_candidate()': THROUGH('ohrm'),
  'hrms.create_employee()': THROUGH('ohrm'),
  'hrms.update_status()': THROUGH('ohrm'),
  // Every document step (scan, read, check, compare with the form) works on the candidate's document.
  'media.fetch_and_store()': THROUGH('docs'),
  'llm.vision_classify()': THROUGH('docs'),
  'llm.vision_extract()': THROUGH('docs'),
  'llm.document_extract()': THROUGH('docs'),
  'ocr.extract()': THROUGH('docs'),
  'file.validate()': THROUGH('docs'),
  'onboarding.stash()': THROUGH('docs'),
  'scanner.verify_document()': THROUGH('docs'),
  'HR Demo Document Verification': THROUGH('docs'),
  'verhoeff.validate()': THROUGH('docs'),
  'compare_identity()': THROUGH('docs'),
  'pii_guard.apply()': THROUGH('docs'),
  'pan.validate_format()': THROUGH('docs'),
  'epfo.lookup()': THROUGH('docs'),
  'payslip.sanity_check()': THROUGH('docs'),
  'servicenow.create_request()': THROUGH('servicenow'),
  'directory.create_user()': ROUND('prov', 'ad'),
  'itsm.create_request()': ROUND('prov', 'servicenow'),
  // Real chains (live run): what the backend actually calls, in order.
  servicenow_request: THROUGH('servicenow'),
  candidate_details: [],
  servicenow_approval: ROUND('prov', 'servicenow'),
  management_approval: [],
  active_directory: ROUND('prov', 'ad'),
  office365: ROUND('prov', 'o365'),
  orangehrm: ROUND('prov', 'ohrm'),
  laptop: ROUND('prov', 'servicenow'),
  'HR Demo Get Employee Details': [],
};

const OFFBOARDING_HOPS = {
  'POST /webhook/whatsapp': [['cand', 'orch']],
  'whatsapp.send_text()': [['orch', 'cand']],
  servicenow_ticket: ROUND('orch', 'servicenow'),
  exit_details: [],
  exit_approval: [],
  ad_disable: ROUND('prov', 'ad'),
  o365_block: ROUND('prov', 'o365'),
  hrm_terminate: ROUND('prov', 'ohrm'),
  asset_return: ROUND('prov', 'servicenow'),
  clearances: ROUND('prov', 'servicenow'),
  relieving_letter: ROUND('prov', 'mail'),
  servicenow_close: ROUND('prov', 'servicenow'),
};

const LEAVE_HOPS = {
  'HR Demo Get Leave Balance': ROUND('leave', 'ohrm'),
  'HR Demo Check Leave Request': ROUND('leave', 'ohrm'),
  'HR Demo Assign Leave OrangeHRM': ROUND('leave', 'ohrm'),
  'HR Demo Get Attendance Records': ROUND('leave', 'ohrm'),
  'HR Demo Add Punch In OrangeHRM': ROUND('leave', 'ohrm'),
  'HR Demo Punch Out OrangeHRM': ROUND('leave', 'ohrm'),
  'POST /webhook/whatsapp': [['cand', 'orch']],
  'whatsapp.send_text()': [['leave', 'orch'], ['orch', 'cand']],
  'employees.lookup()': ROUND('orch', 'ohrm'),
  'orangehrm.leave_types()': ROUND('leave', 'ohrm'),
  'orangehrm.leave_balances()': ROUND('leave', 'ohrm'),
  'orangehrm.holidays()': ROUND('leave', 'ohrm'),
  'orangehrm.check_leave()': ROUND('leave', 'ohrm'),
  'POST /api/leave/requests': [['leave', 'mgr']],
  'hr.approve()': ROUND('leave', 'mgr'),
  'orangehrm.assign_leave()': ROUND('leave', 'ohrm'),
  'orangehrm.punch_log()': ROUND('leave', 'ohrm'),
  'orangehrm.record_attendance()': ROUND('leave', 'ohrm'),
};

const PAYROLL_HOPS = {
  'POST /webhook/whatsapp': [['cand', 'orch']],
  'whatsapp.send_text()': [['pay', 'orch'], ['orch', 'cand']],
  'employees.lookup()': ROUND('orch', 'ohrm'),
  'payroll.payslip()': ROUND('pay', 'ohrm'),
  'payroll.ctc()': ROUND('pay', 'ohrm'),
  'payroll.form16()': ROUND('pay', 'ohrm'),
  'HR Demo Fetch Salary Details': ROUND('pay', 'ohrm'),
  'HR Demo Generate Payslip': ROUND('pay', 'ohrm'),
  'HR Demo Generate CTC Statement': ROUND('pay', 'ohrm'),
  'HR Demo Generate Form 16': ROUND('pay', 'ohrm'),
};

const REIMBURSEMENT_HOPS = {
  'HR Demo Read Bill': ROUND('reimb', 'scan'),
  'HR Demo Check Reimbursement Policy': [], // the policy rules: no system
  'HR Demo Submit Expense Claim': [['reimb', 'mgr']],
  'HR Demo Create Claim OrangeHRM': ROUND('reimb', 'ohrm'),
  'POST /webhook/whatsapp': [['cand', 'orch']],
  'whatsapp.send_text()': [['reimb', 'orch'], ['orch', 'cand']],
  'employees.lookup()': ROUND('orch', 'ohrm'),
  'scanner.read_bill()': ROUND('reimb', 'scan'),
  'POST /api/reimbursement/claims': [['reimb', 'mgr']],
  'hr.approve()': ROUND('reimb', 'mgr'),
  'orangehrm.record_claim()': ROUND('reimb', 'ohrm'),
};

const HR_POLICY_HOPS = {
  'HR Demo Search Policy': ROUND('policy', 'docs'),
  'HR Demo Get Policy Document': ROUND('policy', 'docs'),
  'HR Demo Ask Policy Question': ROUND('policy', 'km'),
  'HR Demo Generate Address Proof Letter': ROUND('policy', 'docs'),
  'HR Demo Generate Bank Account Opening Letter': ROUND('policy', 'docs'),
  'POST /webhook/whatsapp': [['cand', 'orch']],
  'whatsapp.send_text()': [['policy', 'orch'], ['orch', 'cand']],
  'km.query()': ROUND('policy', 'km'),
  'hr_documents.list()': ROUND('policy', 'docs'),
  'hr_documents.search_policies()': ROUND('policy', 'docs'),
  'hr_documents.get_policy()': ROUND('policy', 'docs'),
  'hr_documents.get_letter()': ROUND('policy', 'docs'),
};

/**
 * The AutomationEdge workflow a step runs, or null. The map shows it on the link between the agent and the system it works on (there is no AutomationEdge box:
 * AutomationEdge is what carries out the process), tagged with the workflow's name.
 */
export function aeWorkflowOf(step, config) {
  if (!step) return null;
  const agent = config?.alias?.[step.agent] ?? step.agent;
  if (step.name.startsWith("HR Demo ")) return { label: step.name, agent };
  if (WORKFLOW_KEYS.has(step.name)) return { label: 'AutomationEdge workflow', agent };
  return null;
}

/** Edges to animate for a step. Scripted agents spread their steps over the agent's own systems. */
export function hopsFor(step, agentId, stepIndex = 0, systemCount = 0) {
  if (agentId === 'onboarding') return HOPS[step.name] ?? [];
  if (agentId === 'offboarding-live') return OFFBOARDING_HOPS[step.name] ?? [];
  if (agentId === 'leave_attendance') return LEAVE_HOPS[step.name] ?? [];
  if (agentId === 'payroll_salary') return PAYROLL_HOPS[step.name] ?? [];
  if (agentId === 'reimbursement_benefits') return REIMBURSEMENT_HOPS[step.name] ?? [];
  if (agentId === 'hr_policy') return HR_POLICY_HOPS[step.name] ?? [];
  const sys = systemCount ? `s${stepIndex % systemCount}` : null;
  switch (step.kind) {
    case 'trigger': return [['cand', 'orch']];
    case 'notify': return [['orch', 'cand']];
    case 'agent': return [['orch', 'spec']];
    case 'api': return sys ? [['orch', 'sys'], ['sys', sys], [sys, 'sys']] : [['orch', 'sys']];
    default: return sys ? [['orch', 'spec'], ['spec', sys]] : [['orch', 'spec']];
  }
}

// ---- Stage: icon and animation per step ----------------------------------------------------------------------------------------

const ICON_BY_NAME = {
  'POST /webhook/whatsapp': 'chat', 'whatsapp.send_flow()': 'send', 'whatsapp.send_text()': 'send', 'whatsapp.send_template()': 'send',
  'llm.classify_intent()': 'sparkle', 'llm.plan()': 'sparkle', 'policy.evaluate()': 'gauge', 'hrms.find_candidate()': 'search',
  'validators.run()': 'clipboard', 'media.fetch_and_store()': 'lock', 'llm.vision_classify()': 'eye', 'llm.vision_extract()': 'eye',
  'llm.document_extract()': 'eye', 'ocr.extract()': 'scan', 'scanner.verify_document()': 'eye', 'HR Demo Document Verification': 'bolt', 'verhoeff.validate()': 'key', 'compare_identity()': 'compare',
  'epfo.lookup()': 'bank', 'pii_guard.apply()': 'lock', 'pan.validate_format()': 'key',
  'payslip.sanity_check()': 'gauge', 'file.validate()': 'file', 'onboarding.stash()': 'cloud', 'onboarding.package()': 'file', 'signature.capture()': 'pen',
  'POST /api/employees': 'db', 'servicenow.create_request()': 'ticket', 'hr.approve()': 'user', 'buddy.match()': 'users',
  servicenow_request: 'ticket', servicenow_approval: 'ticket', candidate_details: 'bolt', management_approval: 'bolt', active_directory: 'server',
  office365: 'windows', orangehrm: 'db', laptop: 'laptop', 'HR Demo Get Employee Details': 'bolt',
  'employees.lookup()': 'search', 'POST /api/offboardings': 'db', servicenow_ticket: 'ticket', exit_details: 'bolt', exit_approval: 'bolt', ad_disable: 'server', o365_block: 'windows', hrm_terminate: 'db',
  asset_return: 'laptop', clearances: 'clipboard', settlement: 'gauge', relieving_letter: 'mail', servicenow_close: 'ticket',
  'directory.create_user()': 'server', 'itsm.create_request()': 'ticket', 'hrms.update_status()': 'db',
  'orangehrm.leave_types()': 'clipboard', 'orangehrm.leave_balances()': 'gauge', 'orangehrm.holidays()': 'file', 'orangehrm.check_leave()': 'gauge', 'policy.check_leave()': 'shield',
  'HR Demo Get Leave Balance': 'bolt', 'HR Demo Check Leave Request': 'bolt', 'HR Demo Assign Leave OrangeHRM': 'bolt',
  'HR Demo Get Attendance Records': 'bolt', 'HR Demo Add Punch In OrangeHRM': 'bolt', 'HR Demo Punch Out OrangeHRM': 'bolt',
  'POST /api/leave/requests': 'ticket', 'orangehrm.assign_leave()': 'db', 'orangehrm.punch_log()': 'search', 'orangehrm.record_attendance()': 'db',
  'HR Demo Read Bill': 'bolt', 'HR Demo Check Reimbursement Policy': 'bolt', 'HR Demo Submit Expense Claim': 'bolt', 'HR Demo Create Claim OrangeHRM': 'bolt',
  'HR Demo Search Policy': 'bolt', 'HR Demo Get Policy Document': 'bolt', 'HR Demo Ask Policy Question': 'bolt', 'HR Demo Generate Address Proof Letter': 'bolt', 'HR Demo Generate Bank Account Opening Letter': 'bolt',
  'HR Demo Fetch Salary Details': 'bolt', 'HR Demo Generate Payslip': 'bolt', 'HR Demo Generate CTC Statement': 'bolt', 'HR Demo Generate Form 16': 'bolt',
  'km.query()': 'search', 'hr_documents.list()': 'clipboard', 'hr_documents.get_letter()': 'file', 'hr_documents.search_policies()': 'search', 'hr_documents.get_policy()': 'file',
  'scanner.read_bill()': 'eye', 'policy.check_eligibility()': 'shield', 'POST /api/reimbursement/claims': 'ticket', 'orangehrm.record_claim()': 'db',
  'payroll.options()': 'clipboard', 'payroll.payslip()': 'file', 'payroll.ctc()': 'file', 'payroll.form16()': 'file',
};
const ICON_BY_KIND = { trigger: 'chat', agent: 'sparkle', tool: 'clipboard', api: 'cloud', human: 'user', notify: 'send' };

export const iconFor = (step) => ICON_BY_NAME[step.name] ?? ICON_BY_KIND[step.kind] ?? 'sparkle';

const VIZ_BY_NAME = {
  'POST /webhook/whatsapp': 'inbound', 'llm.classify_intent()': 'intent', 'llm.plan()': 'plan', 'hrms.find_candidate()': 'record',
  'whatsapp.send_flow()': 'sent', 'whatsapp.send_text()': 'sent', 'whatsapp.send_template()': 'sent', 'validators.run()': 'checks',
  'media.fetch_and_store()': 'storage', 'llm.vision_classify()': 'classify', 'llm.vision_extract()': 'classify', 'llm.document_extract()': 'classify',
  'ocr.extract()': 'ocr', 'scanner.verify_document()': 'checks', 'HR Demo Document Verification': 'workflow', 'verhoeff.validate()': 'checksum', 'compare_identity()': 'compare',
  'epfo.lookup()': 'external', 'pii_guard.apply()': 'record', 'pan.validate_format()': 'checks',
  'payslip.sanity_check()': 'range', 'file.validate()': 'checks', 'onboarding.stash()': 'record', 'onboarding.package()': 'package',
  'signature.capture()': 'record', 'POST /api/employees': 'external', 'policy.evaluate()': 'gauge', 'hr.approve()': 'approval', 'buddy.match()': 'buddy',
  'employees.lookup()': 'record', 'POST /api/offboardings': 'record', settlement: 'record', relieving_letter: 'record',
  servicenow_request: 'workflow', candidate_details: 'workflow', servicenow_approval: 'workflow', management_approval: 'workflow',
  active_directory: 'workflow', office365: 'workflow', orangehrm: 'workflow', laptop: 'workflow',
  'HR Demo Get Employee Details': 'workflow', 'servicenow.create_request()': 'external',
  exit_details: 'workflow', exit_approval: 'workflow', ad_disable: 'workflow', o365_block: 'workflow', hrm_terminate: 'workflow', asset_return: 'workflow', clearances: 'workflow',
  'orangehrm.leave_balances()': 'gauge', 'orangehrm.check_leave()': 'gauge', 'policy.check_leave()': 'checks', 'POST /api/leave/requests': 'record',
  'HR Demo Get Leave Balance': 'workflow', 'HR Demo Check Leave Request': 'workflow', 'HR Demo Assign Leave OrangeHRM': 'workflow',
  'HR Demo Get Attendance Records': 'workflow', 'HR Demo Add Punch In OrangeHRM': 'workflow', 'HR Demo Punch Out OrangeHRM': 'workflow',
  'orangehrm.assign_leave()': 'external', 'orangehrm.record_attendance()': 'external',
  'HR Demo Read Bill': 'workflow', 'HR Demo Check Reimbursement Policy': 'workflow', 'HR Demo Submit Expense Claim': 'workflow', 'HR Demo Create Claim OrangeHRM': 'workflow',
  'HR Demo Search Policy': 'workflow', 'HR Demo Get Policy Document': 'workflow', 'HR Demo Ask Policy Question': 'workflow', 'HR Demo Generate Address Proof Letter': 'workflow', 'HR Demo Generate Bank Account Opening Letter': 'workflow',
  'HR Demo Fetch Salary Details': 'workflow', 'HR Demo Generate Payslip': 'workflow', 'HR Demo Generate CTC Statement': 'workflow', 'HR Demo Generate Form 16': 'workflow',
  'km.query()': 'external', 'hr_documents.list()': 'record', 'hr_documents.get_letter()': 'package', 'hr_documents.search_policies()': 'record', 'hr_documents.get_policy()': 'package',
  'scanner.read_bill()': 'classify', 'policy.check_eligibility()': 'checks', 'POST /api/reimbursement/claims': 'record', 'orangehrm.record_claim()': 'external',
  'payroll.payslip()': 'package', 'payroll.ctc()': 'package', 'payroll.form16()': 'package',
};
const VIZ_BY_KIND = { trigger: 'inbound', agent: 'think', tool: 'record', api: 'external', human: 'approval', notify: 'sent' };

export const vizFor = (step) => VIZ_BY_NAME[step.name] ?? VIZ_BY_KIND[step.kind] ?? 'record';

export const VERB = { trigger: 'Receiving', agent: 'Thinking', tool: 'Running', api: 'Running', human: 'Waiting for a person', notify: 'Sending' };
