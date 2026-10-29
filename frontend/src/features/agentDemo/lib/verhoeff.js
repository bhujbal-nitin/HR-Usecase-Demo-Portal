// Verhoeff checksum, the check-digit scheme used by the 12-digit Aadhaar number.
const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
const INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

const digitsReversed = (value) => value.split('').reverse().map(Number);

/** Check digit to append to `payload` (all digits). */
export function verhoeffCheckDigit(payload) {
  let c = 0;
  digitsReversed(payload).forEach((digit, i) => {
    c = D[c][P[(i + 1) % 8][digit]];
  });
  return INV[c];
}

/** True if the full number (payload + check digit) is valid. */
export function verhoeffValid(value) {
  if (!/^\d+$/.test(value)) return false;
  let c = 0;
  digitsReversed(value).forEach((digit, i) => {
    c = D[c][P[i % 8][digit]];
  });
  return c === 0;
}

/** Turn any 12-digit string into a checksum-valid Aadhaar-style number (keeps the first 11 digits). */
export function toValidAadhaar(twelveDigits) {
  const body = twelveDigits.replace(/\D/g, '').padEnd(11, '3').slice(0, 11);
  return `${body}${verhoeffCheckDigit(body)}`;
}
