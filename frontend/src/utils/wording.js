// Everything a person reads in the portal is worded as business actions ("AutomationEdge ran the workflow",
// "the request was refused"), never as developer terms (HTTP codes, endpoints, "the backend"). Messages that arrive
// from the server are passed through `plain()` right before they are shown.

const RULES = [
  // "POST pim/employees -> HTTP 422: Invalid Parameter"  ->  "Invalid Parameter"
  [/\b(?:GET|POST|PUT|PATCH|DELETE)\s+[\w/.\-{}?=&%:]+\s*->\s*/g, ''],
  [/\bHTTP\s*\d{3}\s*:?\s*/gi, ''],
  [/\(HTTP\s*\d{3}\)/gi, ''],
  [/The server returned an error\.?/gi, 'The request could not be completed.'],
  [/\bMicrosoft Graph\b/gi, 'Microsoft 365'],
  [/\bGraph\b(?=\s+(?:call|API|request))/g, 'Microsoft 365'],
  [/\bREST\s+API\b/gi, 'service'],
  [/\bREST\b/g, ''],
  [/\bSMTP\b/g, 'e-mail'],
  [/\b(?:back ?end|API)\b(?=\s+(?:call|calls|request|requests|endpoint))/gi, 'service'],
  [/\bthe back ?end\b/gi, 'the platform'],
  [/\bbackend\b/gi, 'platform'],
  [/\bAPI\b/g, 'service'],
  [/\s{2,}/g, ' '],
  [/\s+([.,;:)])/g, '$1'],
];

/** Developer wording out, business wording in. Safe on any value: non-strings come back unchanged. */
export function plain(text) {
  if (typeof text !== 'string') return text;
  return RULES.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text).trim();
}
