// A small reader for the plain-text markdown the policy knowledge base answers with: paragraphs, "- " / "* " bullets, "1." lists and **bold**.
// It only builds data; components/RichText.jsx draws it (never as HTML, so nothing in an answer can inject markup).

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

/** "a **b** c" -> [{ text: 'a ' }, { text: 'b', bold: true }, { text: ' c' }] */
export function inline(text) {
  return String(text).split(/(\*\*[^*]+\*\*)/).filter(Boolean).map((part) => (
    /^\*\*[^*]+\*\*$/.test(part) ? { text: part.slice(2, -2), bold: true } : { text: part }
  ));
}

/**
 * The answer as blocks: { type: 'p', parts } | { type: 'ul' | 'ol', items: [parts] }.
 * A paragraph that introduces a list (it ends with a colon) is marked `lead` so it can be shown in bold.
 */
export function parseRich(text) {
  const blocks = [];
  let list = null;
  const flush = () => { list = null; };
  String(text ?? '').replace(/\r\n?/g, '\n').split('\n').forEach((raw) => {
    const line = raw.trim();
    if (!line) return; // a blank line between bullets does not end the list; only a paragraph does
    const bullet = line.match(BULLET);
    const numbered = bullet ? null : line.match(NUMBERED);
    const kind = bullet ? 'ul' : numbered ? 'ol' : null;
    if (kind) {
      if (!list || list.type !== kind) { list = { type: kind, items: [] }; blocks.push(list); }
      list.items.push(inline((bullet ?? numbered)[1]));
      return;
    }
    flush();
    blocks.push({ type: 'p', parts: inline(line), lead: line.endsWith(':') });
  });
  return blocks;
}

const ABBREVIATION = /\b(?:Pvt|No|Dr|Mr|Mrs|Ms|a\.m|p\.m|etc|vs)\.$/i;
const KEY_FIGURE = /(\d+(?:[.,:]\d+)*\s?(?:%|days?|months?|weeks?|years?|hours?|a\.m\.|p\.m\.|am|pm)?)/gi;

/** Sentences of a paragraph, without splitting after an abbreviation such as "Pvt." or "p.m.". */
export function sentences(text) {
  const out = [];
  String(text).trim().split(/(?<=[.!?])\s+(?=[A-Z"'(])/).forEach((piece) => {
    if (out.length && ABBREVIATION.test(out[out.length - 1])) out[out.length - 1] += ` ${piece}`;
    else out.push(piece);
  });
  return out;
}

/** Bold the figures (days, months, times, percentages) in a run of text. */
const boldFigures = (parts) => parts.flatMap((part) => (part.bold
  ? [part]
  : part.text.split(KEY_FIGURE).filter(Boolean).map((text) => (/^\d/.test(text) ? { text, bold: true } : { text }))));

/**
 * The blocks to draw for an answer. An answer that already has bullets or several paragraphs is shown as written; a single
 * plain paragraph of two or more sentences is split into one bullet per sentence, with its figures in bold.
 */
export function structure(text) {
  const blocks = parseRich(text);
  const plain = blocks.length === 1 && blocks[0].type === 'p';
  const parts = plain ? sentences(String(text)) : [];
  if (!plain || parts.length < 2) return blocks;
  return [{ type: 'ul', items: parts.map((sentence) => boldFigures(inline(sentence))) }];
}
