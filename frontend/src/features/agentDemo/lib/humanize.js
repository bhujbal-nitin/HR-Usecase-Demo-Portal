import { plain } from '../../../utils/wording';
/** Turn a step's technical payload into readable "Label: value" rows (no JSON, no code names). */

const LABELS = { id: 'ID', ae: 'AutomationEdge', ad: 'Active Directory', o365: 'Microsoft 365', hrms: 'HRMS', hr: 'HR', dob: 'Date of birth', uan: 'UAN', pan: 'PAN', ocr: 'Text reading', url: 'Link', sla: 'SLA', ip: 'IP address', ctc: 'CTC', api: 'API' };
const MAX_DEPTH = 2;
// Plumbing a user never needs to see: how the call was made, not what it did.
const HIDDEN = new Set(['request', 'endpoint', 'method', 'url', 'uri', 'path', 'headers', 'statuscode', 'httpstatus', 'tool', 'function', 'fn', 'api']);
const hidden = (key) => HIDDEN.has(String(key).replace(/[_\-\s]/g, '').toLowerCase());

const KEY_LABELS = { response_json: 'Answers', nfm_reply: 'Form reply' };

export function labelFor(key) {
  if (KEY_LABELS[key]) return KEY_LABELS[key];
  if (/\s/.test(String(key))) return String(key); // already written for people
  const words = String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_\-.]+/g, ' ').trim().split(/\s+/);
  return words.map((w, i) => LABELS[w.toLowerCase()] ?? (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join(' ');
}

function valueText(value) {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (value === null || value === undefined || value === '') return '-';
  return plain(String(value));
}

/** Returns [{ label, value, children? }] for any payload; nested objects become child rows. */
export function toRows(payload, depth = 0) {
  if (payload === null || payload === undefined) return [];
  if (typeof payload !== 'object') return [{ label: 'Details', value: valueText(payload) }];
  let entries = Array.isArray(payload) ? payload.map((v, i) => [`Item ${i + 1}`, v]) : Object.entries(payload);
  // A "response" wrapper adds nothing for the reader: show what is inside it.
  entries = entries.filter(([key]) => !hidden(key)).flatMap(([key, value]) => (
    String(key).toLowerCase() === 'response' && value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value).filter(([k]) => !hidden(k)) : [[key, value]]
  ));
  return entries.map(([key, value]) => {
    const label = Array.isArray(payload) ? key : labelFor(key);
    if (Array.isArray(value) && value.every((v) => v === null || typeof v !== 'object')) return { label, value: value.map(valueText).join(', ') || '-' };
    if (value && typeof value === 'object') {
      return depth >= MAX_DEPTH ? { label, value: Object.values(value).map((v) => valueText(typeof v === 'object' ? '' : v)).filter(Boolean).join(', ') } : { label, children: toRows(value, depth + 1) };
    }
    return { label, value: valueText(value) };
  });
}
