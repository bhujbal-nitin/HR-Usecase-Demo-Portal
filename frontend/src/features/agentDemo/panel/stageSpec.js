import { SIMULATED_PROCESSES } from '../../agents/process/simulatedProcesses';

// Everything the right-hand panel needs to *draw* a step: which map nodes it touches, which icon and which
// animation to show. It is keyed on the step's stable `name`, so no journey/flow code has to know about it.

// ---- System map ---------------------------------------------------------------------------------------------------

const ONBOARDING_MAP = {
  nodes: {
    cand: { x: 48, y: 116, icon: 'chat', label: 'Candidate', sub: 'WhatsApp', t: 'person' },
    orch: { x: 190, y: 116, icon: 'sparkle', label: 'Orchestrator', t: 'agent' },
    doc: { x: 385, y: 46, icon: 'scan', label: 'Document Agent', t: 'agent' },
    ver: { x: 385, y: 116, icon: 'shield', label: 'Verification Agent', t: 'agent' },
    prov: { x: 385, y: 186, icon: 'laptop', label: 'Provisioning Agent', t: 'agent' },
    servicenow: { x: 620, y: 22, icon: 'ticket', label: 'ServiceNow', t: 'system' },
    ae: { x: 620, y: 62, icon: 'bolt', label: 'AutomationEdge', t: 'system' },
    ad: { x: 620, y: 102, icon: 'server', label: 'Active Directory', t: 'system' },
    o365: { x: 620, y: 142, icon: 'windows', label: 'Microsoft 365', t: 'system' },
    ohrm: { x: 620, y: 182, icon: 'db', label: 'OrangeHRM', t: 'system' },
    mail: { x: 620, y: 218, icon: 'mail', label: 'E-mail', t: 'system' },
  },
  edges: [
    ['cand', 'orch'], ['orch', 'doc'], ['orch', 'ver'], ['orch', 'prov'], ['orch', 'servicenow'], ['orch', 'ae'], ['orch', 'ohrm'],
    ['ver', 'ae'], ['prov', 'ae'], ['prov', 'ad'], ['prov', 'o365'], ['prov', 'ohrm'], ['prov', 'servicenow'], ['prov', 'mail'],
  ],
};

// Offboarding (Manual · Live): AutomationEdge workflows, then the backend's own calls to ServiceNow, Microsoft 365, OrangeHRM and e-mail.
const OFFBOARDING_MAP = {
  nodes: {
    cand: { x: 48, y: 116, icon: 'chat', label: 'Employee', sub: 'WhatsApp', t: 'person' },
    orch: { x: 190, y: 116, icon: 'sparkle', label: 'Orchestrator', t: 'agent' },
    prov: { x: 385, y: 116, icon: 'laptop', label: 'Offboarding Agent', t: 'agent' },
    servicenow: { x: 620, y: 22, icon: 'ticket', label: 'ServiceNow', t: 'system' },
    ae: { x: 620, y: 62, icon: 'bolt', label: 'AutomationEdge', t: 'system' },
    ad: { x: 620, y: 102, icon: 'server', label: 'Active Directory', t: 'system' },
    o365: { x: 620, y: 142, icon: 'windows', label: 'Microsoft 365', t: 'system' },
    ohrm: { x: 620, y: 182, icon: 'db', label: 'OrangeHRM', t: 'system' },
    mail: { x: 620, y: 218, icon: 'mail', label: 'E-mail', t: 'system' },
  },
  edges: [
    ['cand', 'orch'], ['orch', 'prov'], ['orch', 'servicenow'], ['orch', 'ae'], ['prov', 'ae'], ['prov', 'servicenow'],
    ['ae', 'ad'], ['prov', 'o365'], ['prov', 'ohrm'], ['prov', 'mail'],
  ],
};

// Leave & attendance: the agent reads balances, holidays and punches in OrangeHRM (and records approved requests there),
// and sends each request to the manager. Each step is preceded by its AutomationEdge workflow.
const LEAVE_MAP = {
  nodes: {
    cand: { x: 48, y: 116, icon: 'chat', label: 'Employee', sub: 'WhatsApp', t: 'person' },
    orch: { x: 190, y: 116, icon: 'sparkle', label: 'Orchestrator', t: 'agent' },
    leave: { x: 385, y: 116, icon: 'users', label: 'Leave & Attendance Agent', t: 'agent' },
    ae: { x: 620, y: 40, icon: 'bolt', label: 'AutomationEdge', t: 'system' },
    ohrm: { x: 620, y: 90, icon: 'db', label: 'OrangeHRM', t: 'system' },
    mgr: { x: 620, y: 150, icon: 'user', label: 'Manager', sub: 'HR Approvals', t: 'person' },
  },
  edges: [['cand', 'orch'], ['orch', 'leave'], ['orch', 'ohrm'], ['leave', 'ae'], ['leave', 'ohrm'], ['leave', 'mgr']],
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

const MAPS = { onboarding: ONBOARDING_MAP, 'offboarding-live': OFFBOARDING_MAP, leave_attendance: LEAVE_MAP };
export const mapFor = (agentId) => MAPS[agentId] ?? genericMap(agentId);

// ---- Hops (which edges light up) ------------------------------------------------------------------------------------

const BOTH = (a, b) => [[a, b], [b, a]];

/** A request that goes out and comes back: the dot travels there and returns. */
const ROUND = (a, b) => BOTH(a, b);
/** An AutomationEdge workflow: dispatched by an agent, run by AutomationEdge against a system, result returned. */
const VIA_AE = (agent, system) => [[agent, 'ae'], ['ae', system], [system, 'ae'], ['ae', agent]];

// Steps with no entry here (rules, planning, packaging, the portal's own record) happen inside the agent itself:
// the agent lights up but no line is drawn, because nothing leaves it.
const HOPS = {
  'POST /webhook/whatsapp': [['cand', 'orch']],
  'whatsapp.send_flow()': [['orch', 'cand']],
  'whatsapp.send_text()': [['orch', 'cand']],
  'whatsapp.send_template()': [['prov', 'orch'], ['orch', 'cand']],
  'hrms.find_candidate()': ROUND('orch', 'ohrm'),
  'hrms.create_employee()': ROUND('orch', 'ohrm'),
  'hrms.update_status()': ROUND('orch', 'ohrm'),
  'media.fetch_and_store()': ROUND('orch', 'doc'),
  'llm.vision_classify()': ROUND('orch', 'doc'),
  'llm.vision_extract()': ROUND('orch', 'doc'),
  'llm.document_extract()': ROUND('orch', 'doc'),
  'ocr.extract()': ROUND('orch', 'doc'),
  'file.validate()': ROUND('orch', 'doc'),
  'onboarding.stash()': ROUND('orch', 'doc'),
  'openai.verify_document()': ROUND('orch', 'doc'),
  'HR Demo Document Verification': ROUND('ver', 'ae'),
  'verhoeff.validate()': ROUND('orch', 'ver'),
  'compare_identity()': ROUND('orch', 'ver'),
  'kyc.offline_verify()': ROUND('orch', 'ver'),
  'pii_guard.apply()': ROUND('orch', 'ver'),
  'pan.validate_format()': ROUND('orch', 'ver'),
  'pan.verify()': ROUND('orch', 'ver'),
  'epfo.lookup()': ROUND('orch', 'ver'),
  'payslip.sanity_check()': ROUND('orch', 'ver'),
  'servicenow.create_request()': ROUND('orch', 'servicenow'),
  'directory.create_user()': ROUND('prov', 'ad'),
  'itsm.create_request()': ROUND('prov', 'servicenow'),
  // Real chains (live run): what the backend actually calls, in order.
  servicenow_request: ROUND('orch', 'servicenow'),
  candidate_details: ROUND('orch', 'ae'),
  servicenow_approval: ROUND('prov', 'servicenow'),
  management_approval: ROUND('prov', 'ae'),
  active_directory: VIA_AE('prov', 'ad'),
  office365: [...ROUND('prov', 'ae'), ...ROUND('prov', 'o365')], // workflow, then Microsoft Graph directly
  orangehrm: [...ROUND('prov', 'ae'), ...ROUND('prov', 'ohrm')], // workflow, then the PIM profile directly
  laptop: [...ROUND('prov', 'ae'), ...ROUND('prov', 'servicenow')], // workflow, then the hardware incident
  offer_letter: [['prov', 'mail'], ['mail', 'prov'], ...ROUND('prov', 'servicenow')],
  'HR Demo Get Employee Details': ROUND('orch', 'ae'),
};

const OFFBOARDING_HOPS = {
  'POST /webhook/whatsapp': [['cand', 'orch']],
  'whatsapp.send_text()': [['orch', 'cand']],
  servicenow_ticket: ROUND('orch', 'servicenow'),
  exit_details: ROUND('orch', 'ae'),
  exit_approval: ROUND('prov', 'ae'),
  ad_disable: VIA_AE('prov', 'ad'), // workflow only
  o365_block: [...ROUND('prov', 'ae'), ...ROUND('prov', 'o365')], // workflow, then Microsoft Graph
  hrm_terminate: [...ROUND('prov', 'ae'), ...ROUND('prov', 'ohrm')], // workflow, then the OrangeHRM API
  asset_return: [...ROUND('prov', 'ae'), ...ROUND('prov', 'servicenow')], // workflow, then the ServiceNow ticket
  clearances: [...ROUND('prov', 'ae'), ...ROUND('prov', 'servicenow')],
  relieving_letter: [['prov', 'mail'], ['mail', 'prov'], ...ROUND('prov', 'ae')], // e-mail the letter, then the send-mail workflow
  servicenow_close: ROUND('prov', 'servicenow'),
};

const LEAVE_HOPS = {
  'HR Demo Get Leave Balance': ROUND('leave', 'ae'),
  'HR Demo Check Leave Request': ROUND('leave', 'ae'),
  'HR Demo Assign Leave OrangeHRM': ROUND('leave', 'ae'),
  'HR Demo Get Attendance Records': ROUND('leave', 'ae'),
  'HR Demo Add Punch In OrangeHRM': ROUND('leave', 'ae'),
  'HR Demo Punch Out OrangeHRM': ROUND('leave', 'ae'),
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
  'orangehrm.punch_out()': ROUND('leave', 'ohrm'),
};

/** Edges to animate for a step. Scripted agents spread their steps over the agent's own systems. */
export function hopsFor(step, agentId, stepIndex = 0, systemCount = 0) {
  if (agentId === 'onboarding') return HOPS[step.name] ?? [];
  if (agentId === 'offboarding-live') return OFFBOARDING_HOPS[step.name] ?? [];
  if (agentId === 'leave_attendance') return LEAVE_HOPS[step.name] ?? [];
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
  'llm.document_extract()': 'eye', 'ocr.extract()': 'scan', 'openai.verify_document()': 'eye', 'HR Demo Document Verification': 'bolt', 'verhoeff.validate()': 'key', 'compare_identity()': 'compare',
  'kyc.offline_verify()': 'idcard', 'pan.verify()': 'bank', 'epfo.lookup()': 'bank', 'pii_guard.apply()': 'lock', 'pan.validate_format()': 'key',
  'payslip.sanity_check()': 'gauge', 'file.validate()': 'file', 'onboarding.stash()': 'cloud', 'onboarding.package()': 'file', 'signature.capture()': 'pen',
  'POST /api/employees': 'db', 'servicenow.create_request()': 'ticket', 'hr.approve()': 'user', 'buddy.match()': 'users',
  servicenow_request: 'ticket', servicenow_approval: 'ticket', candidate_details: 'bolt', management_approval: 'bolt', active_directory: 'server',
  office365: 'windows', orangehrm: 'db', laptop: 'laptop', offer_letter: 'mail', 'HR Demo Get Employee Details': 'bolt',
  'employees.lookup()': 'search', 'POST /api/offboardings': 'db', servicenow_ticket: 'ticket', exit_details: 'bolt', exit_approval: 'bolt', ad_disable: 'server', o365_block: 'windows', hrm_terminate: 'db',
  asset_return: 'laptop', clearances: 'clipboard', settlement: 'gauge', relieving_letter: 'mail', servicenow_close: 'ticket',
  'directory.create_user()': 'server', 'itsm.create_request()': 'ticket', 'hrms.update_status()': 'db',
  'orangehrm.leave_types()': 'clipboard', 'orangehrm.leave_balances()': 'gauge', 'orangehrm.holidays()': 'file', 'orangehrm.check_leave()': 'gauge', 'policy.check_leave()': 'shield',
  'HR Demo Get Leave Balance': 'bolt', 'HR Demo Check Leave Request': 'bolt', 'HR Demo Assign Leave OrangeHRM': 'bolt',
  'HR Demo Get Attendance Records': 'bolt', 'HR Demo Add Punch In OrangeHRM': 'bolt', 'HR Demo Punch Out OrangeHRM': 'bolt',
  'POST /api/leave/requests': 'ticket', 'orangehrm.assign_leave()': 'db', 'orangehrm.punch_log()': 'search', 'orangehrm.punch_out()': 'db',
};
const ICON_BY_KIND = { trigger: 'chat', agent: 'sparkle', tool: 'clipboard', api: 'cloud', human: 'user', notify: 'send' };

export const iconFor = (step) => ICON_BY_NAME[step.name] ?? ICON_BY_KIND[step.kind] ?? 'sparkle';

const VIZ_BY_NAME = {
  'POST /webhook/whatsapp': 'inbound', 'llm.classify_intent()': 'intent', 'llm.plan()': 'plan', 'hrms.find_candidate()': 'record',
  'whatsapp.send_flow()': 'sent', 'whatsapp.send_text()': 'sent', 'whatsapp.send_template()': 'sent', 'validators.run()': 'checks',
  'media.fetch_and_store()': 'storage', 'llm.vision_classify()': 'classify', 'llm.vision_extract()': 'classify', 'llm.document_extract()': 'classify',
  'ocr.extract()': 'ocr', 'openai.verify_document()': 'checks', 'HR Demo Document Verification': 'workflow', 'verhoeff.validate()': 'checksum', 'compare_identity()': 'compare', 'kyc.offline_verify()': 'external',
  'pan.verify()': 'external', 'epfo.lookup()': 'external', 'pii_guard.apply()': 'record', 'pan.validate_format()': 'checks',
  'payslip.sanity_check()': 'range', 'file.validate()': 'checks', 'onboarding.stash()': 'record', 'onboarding.package()': 'package',
  'signature.capture()': 'record', 'POST /api/employees': 'external', 'policy.evaluate()': 'gauge', 'hr.approve()': 'approval', 'buddy.match()': 'buddy',
  'employees.lookup()': 'record', 'POST /api/offboardings': 'record', settlement: 'record', relieving_letter: 'record',
  servicenow_request: 'workflow', candidate_details: 'workflow', servicenow_approval: 'workflow', management_approval: 'workflow',
  active_directory: 'workflow', office365: 'workflow', orangehrm: 'workflow', laptop: 'workflow', offer_letter: 'workflow',
  'HR Demo Get Employee Details': 'workflow', 'servicenow.create_request()': 'external',
  exit_details: 'workflow', exit_approval: 'workflow', ad_disable: 'workflow', o365_block: 'workflow', hrm_terminate: 'workflow', asset_return: 'workflow', clearances: 'workflow',
  'orangehrm.leave_balances()': 'gauge', 'orangehrm.check_leave()': 'gauge', 'policy.check_leave()': 'checks', 'POST /api/leave/requests': 'record',
  'HR Demo Get Leave Balance': 'workflow', 'HR Demo Check Leave Request': 'workflow', 'HR Demo Assign Leave OrangeHRM': 'workflow',
  'HR Demo Get Attendance Records': 'workflow', 'HR Demo Add Punch In OrangeHRM': 'workflow', 'HR Demo Punch Out OrangeHRM': 'workflow',
  'orangehrm.assign_leave()': 'external', 'orangehrm.punch_out()': 'external',
};
const VIZ_BY_KIND = { trigger: 'inbound', agent: 'think', tool: 'record', api: 'external', human: 'approval', notify: 'sent' };

export const vizFor = (step) => VIZ_BY_NAME[step.name] ?? VIZ_BY_KIND[step.kind] ?? 'record';

export const VERB = { trigger: 'Receiving', agent: 'Thinking', tool: 'Running', api: 'Running', human: 'Waiting for a person', notify: 'Sending' };
