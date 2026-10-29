// Real, local identity checks used by the demo (no network): name similarity and PAN format.

/** Upper-case, strip punctuation, collapse spaces - so "Priya  Sharma." equals "PRIYA SHARMA". */
export function normaliseName(name) {
  return name.toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

function levenshtein(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = temp;
    }
  }
  return row[b.length];
}

/** 0..1 similarity (1 = identical after normalisation). */
export function nameSimilarity(a, b) {
  const x = normaliseName(a);
  const y = normaliseName(b);
  const longest = Math.max(x.length, y.length);
  return longest === 0 ? 1 : Number((1 - levenshtein(x, y) / longest).toFixed(2));
}

// 4th character of a PAN = holder type.
const PAN_HOLDER = { P: 'individual', C: 'company', H: 'HUF', F: 'firm', A: 'association', T: 'trust', B: 'body of individuals', L: 'local authority', J: 'artificial juridical person', G: 'government' };

/** Structural check of a PAN, plus whether the 5th letter matches the holder's surname initial. */
export function checkPan(pan, surname) {
  const formatOk = /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan);
  const holder = PAN_HOLDER[pan[3]];
  return {
    formatOk: formatOk && Boolean(holder),
    holder: holder ?? 'unknown',
    fourthChar: pan[3],
    fifthChar: pan[4],
    surnameInitialMatches: pan[4] === surname.trim()[0]?.toUpperCase(),
  };
}

/** Build a plausible fictional PAN for an individual: AAA + P + surname initial + 4 digits + letter. */
export function makePan(surname) {
  const digits = String(1000 + Math.floor(Math.random() * 9000));
  const letter = 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)];
  return `ABCP${surname.trim()[0].toUpperCase()}${digits}${letter}`;
}
