// The Aadhaar card, the PAN card and the previous employer's salary slip (PDF) that the Onboarding auto-play demo uploads for its fictional candidate. They are drawn
// to look like the real documents (photo, number, QR code, the labels the real cards carry) so that the document reader sees what it would see in real life.
// Everything on them is fictional; a small note at the foot of the page says so. Only ASCII is drawn (the standard PDF fonts have no Hindi), so the cards
// carry the English text only.

import { A4, PdfPage } from './pdf';
import { PAY, dmy, inr } from './sampleDocuments';
import { payslipPdf } from './slipPdf';

const CARD = { width: 400, height: 252 };
const CARD_X = (A4.width - CARD.width) / 2;
const NOTE = 'HR portal demo - fictional data';

const footnote = (page) => page.text(A4.width / 2, 40, NOTE, { size: 7.5, align: 'center', color: '#9AA3B2' });

/** A grey passport photo with a head and shoulders. */
function photo(page, x, y, width, height) {
  page.rect(x, y, width, height, { fill: '#D5DCE6', color: '#8A97A8', lineWidth: 0.6 });
  page.circle(x + width / 2, y + height * 0.62, width * 0.2, { fill: '#8F9BAD' });
  page.polygon([
    [x + width * 0.1, y + 0.5], [x + width * 0.14, y + height * 0.24], [x + width * 0.3, y + height * 0.36], [x + width * 0.5, y + height * 0.39],
    [x + width * 0.7, y + height * 0.36], [x + width * 0.86, y + height * 0.24], [x + width * 0.9, y + 0.5],
  ], { fill: '#8F9BAD' });
}

/** A QR-looking square: the three corner marks and a pattern that depends only on the seed, so the same candidate always gets the same one. */
export function qrLook(page, x, y, size, seed) {
  const cells = 25;
  const cell = size / cells;
  let state = [...seed].reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const bit = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return (state >>> 16) % 2 === 1; };
  const inCorner = (cx, cy) => (cx < 8 && cy < 8) || (cx > cells - 9 && cy < 8) || (cx < 8 && cy > cells - 9);
  for (let cy = 0; cy < cells; cy += 1) {
    for (let cx = 0; cx < cells; cx += 1) {
      if (!inCorner(cx, cy) && bit()) page.rect(x + cx * cell, y + size - (cy + 1) * cell, cell, cell, { fill: '#111111', stroke: false });
    }
  }
  [[0, 0], [cells - 7, 0], [0, cells - 7]].forEach(([cx, cy]) => {
    const [px, py] = [x + cx * cell, y + size - (cy + 7) * cell];
    page.rect(px, py, cell * 7, cell * 7, { fill: '#111111', stroke: false });
    page.rect(px + cell, py + cell, cell * 5, cell * 5, { fill: '#FFFFFF', stroke: false });
    page.rect(px + cell * 2, py + cell * 2, cell * 3, cell * 3, { fill: '#111111', stroke: false });
  });
}

/** Breaks an address into lines no wider than `limit` characters. */
function wrap(text, limit) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    if (line && `${line} ${word}`.length > limit) { lines.push(line); line = word; } else { line = line ? `${line} ${word}` : word; }
  }
  return line ? [...lines, line] : lines;
}

/**
 * The Aadhaar card: the front (photo, name, date of birth, QR code, the number) and the back (address). The number is shown masked, the way a
 * masked Aadhaar is issued, so only the last four digits are on the page.
 */
export function aadhaarCardPdf(candidate) {
  const page = new PdfPage();
  const top = 740;
  const y0 = top - CARD.height;

  // Front
  page.rect(CARD_X, y0, CARD.width, CARD.height, { fill: '#FFFFFF', color: '#9AA3B2', lineWidth: 1 });
  page.rect(CARD_X, top - 6, CARD.width, 6, { fill: '#FF9933', stroke: false });
  page.rect(CARD_X, y0, CARD.width, 6, { fill: '#138808', stroke: false });
  page.rect(CARD_X + 14, top - 36, 22, 5, { fill: '#FF9933', stroke: false });
  page.rect(CARD_X + 14, top - 41, 22, 5, { fill: '#FFFFFF', color: '#9AA3B2', lineWidth: 0.4 });
  page.rect(CARD_X + 14, top - 46, 22, 5, { fill: '#138808', stroke: false });
  page.text(CARD_X + 46, top - 30, 'GOVERNMENT OF INDIA', { size: 11, bold: true, color: '#222222' });
  page.text(CARD_X + 46, top - 42, 'Unique Identification Authority of India', { size: 7, color: '#555555' });
  page.text(CARD_X + CARD.width - 14, top - 34, 'AADHAAR', { size: 14, bold: true, align: 'right', color: '#C8102E' });
  page.line(CARD_X + 14, top - 54, CARD_X + CARD.width - 14, top - 54);

  photo(page, CARD_X + 16, top - 160, 82, 98);
  page.text(CARD_X + 112, top - 80, candidate.fullName, { size: 13, bold: true, color: '#111111' });
  page.text(CARD_X + 112, top - 98, `Date of Birth: ${candidate.dobDisplay}`, { size: 9.5, color: '#222222' });
  page.text(CARD_X + 112, top - 114, 'Address on the back of the card', { size: 7.5, color: '#666666' });
  qrLook(page, CARD_X + CARD.width - 84, top - 150, 70, candidate.aadhaar);

  page.text(CARD_X + CARD.width / 2, y0 + 56, `XXXX XXXX ${candidate.aadhaar.slice(-4)}`, { size: 21, bold: true, align: 'center', color: '#111111' });
  page.line(CARD_X + 14, y0 + 40, CARD_X + CARD.width - 14, y0 + 40);
  page.text(CARD_X + CARD.width / 2, y0 + 20, 'Aadhaar - the right of the common man', { size: 8.5, italic: true, align: 'center', color: '#C8102E' });

  // Back
  const backTop = y0 - 30;
  const backY0 = backTop - CARD.height;
  page.rect(CARD_X, backY0, CARD.width, CARD.height, { fill: '#FFFFFF', color: '#9AA3B2', lineWidth: 1 });
  page.rect(CARD_X, backTop - 6, CARD.width, 6, { fill: '#FF9933', stroke: false });
  page.rect(CARD_X, backY0, CARD.width, 6, { fill: '#138808', stroke: false });
  page.text(CARD_X + 16, backTop - 32, 'Address:', { size: 10, bold: true, color: '#111111' });
  wrap(candidate.address, 40).forEach((line, i) => page.text(CARD_X + 16, backTop - 50 - i * 14, line, { size: 10, color: '#222222' }));
  qrLook(page, CARD_X + CARD.width - 94, backTop - 110, 78, `${candidate.aadhaar}-back`);
  page.line(CARD_X + 14, backY0 + 60, CARD_X + CARD.width - 14, backY0 + 60);
  page.text(CARD_X + CARD.width / 2, backY0 + 38, `XXXX XXXX ${candidate.aadhaar.slice(-4)}`, { size: 16, bold: true, align: 'center', color: '#111111' });
  page.text(CARD_X + CARD.width / 2, backY0 + 18, 'Aadhaar is proof of identity, not of citizenship or date of birth.', { size: 7.5, align: 'center', color: '#555555' });

  footnote(page);
  return page.toBlob();
}

/** The PAN card: the Income Tax Department card with the number, the name, the father's name, the date of birth, a photo and a signature line. */
export function panCardPdf(candidate) {
  const page = new PdfPage();
  const top = 740;
  const y0 = top - CARD.height;
  page.rect(CARD_X, y0, CARD.width, CARD.height, { fill: '#E3ECF7', color: '#7A8CA8', lineWidth: 1 });
  page.rect(CARD_X, top - 46, CARD.width, 46, { fill: '#C9D9EE', stroke: false });
  page.text(CARD_X + 16, top - 20, 'INCOME TAX DEPARTMENT', { size: 12, bold: true, color: '#1B2F66' });
  page.text(CARD_X + 16, top - 35, 'GOVT. OF INDIA', { size: 8.5, bold: true, color: '#1B2F66' });
  page.text(CARD_X + CARD.width - 16, top - 28, 'Permanent Account Number Card', { size: 8.5, bold: true, align: 'right', color: '#1B2F66' });

  page.text(CARD_X + 16, top - 68, 'Permanent Account Number', { size: 7.5, color: '#444444' });
  page.text(CARD_X + 16, top - 88, candidate.pan ?? '', { size: 19, bold: true, color: '#111111' });
  page.text(CARD_X + 16, top - 112, 'Name', { size: 7.5, color: '#444444' });
  page.text(CARD_X + 16, top - 126, candidate.panName, { size: 11, bold: true, color: '#111111' });
  page.text(CARD_X + 16, top - 148, "Father's Name", { size: 7.5, color: '#444444' });
  page.text(CARD_X + 16, top - 162, candidate.fatherName, { size: 11, bold: true, color: '#111111' });
  page.text(CARD_X + 16, top - 184, 'Date of Birth', { size: 7.5, color: '#444444' });
  page.text(CARD_X + 16, top - 198, candidate.dobDisplay, { size: 11, bold: true, color: '#111111' });

  photo(page, CARD_X + CARD.width - 102, top - 154, 82, 98);
  qrLook(page, CARD_X + CARD.width - 80, y0 + 14, 56, candidate.pan ?? candidate.fullName);
  page.line(CARD_X + 16, y0 + 34, CARD_X + 190, y0 + 34);
  page.text(CARD_X + 16, y0 + 22, 'Signature', { size: 7.5, color: '#444444' });

  footnote(page);
  return page.toBlob();
}

const PREVIOUS_EMPLOYER = { name: 'Nexora Systems Private Limited', address: 'Office Address: 12, Tech Park Road, Hinjewadi Phase 1, Pune 411057' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The previous employer's salary slip for the last full month, drawn from the candidate's previous monthly gross pay. */
export function salarySlipPdf(candidate, logo = null, today = new Date()) {
  const month = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const gross = candidate.previousMonthlyGross;
  const basic = Math.round(gross * 0.4);
  const hra = Math.round(basic * 0.5);
  const conveyance = PAY.conveyance;
  const special = gross - basic - hra - conveyance;
  const pf = Math.round(basic * 0.12);
  const deductions = pf + PAY.professionalTax;
  const label = `${MONTHS[month.getMonth()].slice(0, 3)} ${month.getFullYear()}`;
  const code = `NX${String(candidate.aadhaar).slice(-5)}`;
  return payslipPdf({
    company: PREVIOUS_EMPLOYER.name, address: PREVIOUS_EMPLOYER.address, title: `Salary Slip for ${label}`,
    left: [`Employee Code: ${code}`, `Employee Name: ${candidate.fullName}`, `Pay Date: ${dmy(new Date(month.getFullYear(), month.getMonth() + 1, 0))}`, `PAN: ${candidate.pan ?? '-'}`, `Days in Month: ${days}`],
    right: ['Designation: Software Engineer', `Department: ${candidate.department}`, 'Location: Pune', `Working Days: ${days}`, 'LOP Days: 0'],
    earnings: [['Basic', inr(basic)], ['Conveyance Allowance', inr(conveyance)], ['HRA', inr(hra)], ['Special Allowance', inr(special)]],
    deductions: [['PROV.FUND', inr(pf)], ['P.Tax', inr(PAY.professionalTax)]],
    totalEarnings: inr(gross), totalDeductions: inr(deductions), net: inr(gross - deductions), words: `Net Pay: Rs. ${inr(gross - deductions)}`,
  }, logo);
}
