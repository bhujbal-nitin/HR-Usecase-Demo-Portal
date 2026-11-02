// Draws Form 16 as a one-page PDF. The same layout is drawn by the backend (app/services/payroll/pdf.py, form16_pdf) for the live run; this copy serves
// the simulated run, which contacts nothing. Amounts show "Rs." because the standard PDF fonts have no rupee sign.

import { A4, PdfPage, textWidth } from './pdf';

const LEFT = 40;
const RIGHT = 555;
const WIDTH = RIGHT - LEFT;
const NAVY = '#1F3864';
const HEADING = '#2F5496';
const INK = '#0F2A6B';
const GREY = '#7F7F7F';
const SMALL = 8;
const PAD = 5;
const LOGO = { width: 150, height: 24.6 };

/** The text broken into lines that fit the width. */
export function wrap(text, width, size, bold = false) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const trial = `${line} ${word}`.trim();
    if (line && textWidth(trial, size, bold) > width - 2 * PAD) {
      lines.push(line);
      line = word;
    } else {
      line = trial;
    }
  }
  if (line || !lines.length) lines.push(line);
  return lines;
}

/** The Form 16 model (see sampleForm16.js) -> a PDF Blob. `logo` is a png read with readPng (optional). */
export function form16Pdf(model, logo = null) {
  const page = new PdfPage();
  let y = A4.height - 40;
  const middle = (LEFT + RIGHT) / 2;
  if (logo) page.logo(logo, LEFT, y - LOGO.height, LOGO.width, LOGO.height);
  y -= LOGO.height + 14;
  page.text(middle, y - 22, 'FORM NO. 16', { size: 22, bold: true, align: 'center', color: NAVY });
  page.text(middle, y - 38, '[See rule 31(1)(a)]', { size: 8.5, italic: true, align: 'center', color: NAVY });
  page.text(middle, y - 54, 'Certificate under section 203 of the Income-tax Act, 1961', { size: 10, bold: true, align: 'center', color: NAVY });
  page.text(middle, y - 67, 'for tax deducted at source from salary', { size: 10, bold: true, align: 'center', color: NAVY });
  y -= 76;

  const heading = (text) => {
    y -= 8;
    page.text(LEFT, y - 11, text, { size: 11, bold: true, color: HEADING });
    y -= 20;
  };

  /** One table row; a cell whose text is too long for its column is wrapped and the row grows. */
  const row = (cols, cells, aligns, { bold = false, head = false } = {}) => {
    const wrapped = cells.map((text, i) => wrap(text, cols[i + 1] - cols[i], SMALL, bold || head));
    const height = Math.max(14, Math.max(...wrapped.map((w) => w.length)) * 10.5 + 5);
    wrapped.forEach((lines, i) => {
      const x0 = cols[i];
      const x1 = cols[i + 1];
      page.rect(x0, y - height, x1 - x0, height, { fill: head ? NAVY : null, color: GREY, lineWidth: 0.5 });
      lines.forEach((text, n) => {
        const right = aligns[i] === 'right';
        page.text(right ? x1 - PAD : x0 + PAD, y - 11 - n * 10.5, text, { size: SMALL, bold: bold || head, align: right ? 'right' : 'left', color: head ? '#FFFFFF' : INK });
      });
    });
    y -= height;
  };

  heading('PART A - Details of tax deducted and deposited');
  page.text(LEFT, y - 8, `Certificate period: Financial Year ${model.year}  |  Assessment Year ${model.assessment}`, { size: SMALL, bold: true });
  y -= 16;
  let cols = [LEFT, LEFT + 130, LEFT + 322, RIGHT];
  row(cols, ['Particulars', 'Deductor (Employer)', 'Deductee (Employee)'], ['left', 'left', 'left'], { head: true });
  model.parties.forEach((cells) => row(cols, cells, ['left', 'left', 'left']));

  heading('Summary of tax deducted and deposited');
  cols = [LEFT, LEFT + 130, LEFT + 295, LEFT + 405, RIGHT];
  row(cols, ['Quarter', 'Receipt / acknowledgement reference', 'Tax deducted (Rs.)', 'Tax deposited (Rs.)'], ['left', 'left', 'right', 'right'], { head: true });
  model.quarters.forEach((cells, i) => row(cols, cells, ['left', 'left', 'right', 'right'], { bold: i === model.quarters.length - 1 }));

  heading('PART B - Details of salary paid and other income / tax computation');
  cols = [LEFT, LEFT + 385, RIGHT];
  row(cols, ['Salary / income particulars', 'Amount (Rs.)'], ['left', 'right'], { head: true });
  model.computation.forEach(([label, amount, bold]) => row(cols, [label, amount], ['left', 'right'], { bold }));

  heading('Declaration / certification');
  wrap(model.certificate, WIDTH, SMALL).forEach((line) => {
    page.text(LEFT, y - 9, line, { size: SMALL });
    y -= 10.5;
  });
  y -= 14;
  cols = [LEFT, LEFT + 130, LEFT + 260, RIGHT];
  row(cols, ['Place', 'Date', 'Authorised signatory'], ['left', 'left', 'left'], { head: true });
  const box = 54;
  [model.place, model.date, ''].forEach((text, i) => {
    page.rect(cols[i], y - box, cols[i + 1] - cols[i], box, { color: GREY, lineWidth: 0.5 });
    if (text) page.text(cols[i] + PAD, y - 12, text, { size: SMALL, color: INK });
  });
  page.text(cols[2] + PAD, y - 12, model.signatoryFor, { size: SMALL });
  page.text(cols[2] + PAD, y - box + 7, 'Authorised Signatory', { size: SMALL, bold: true });
  return page.toBlob();
}
