// Draws the payslip and the CTC statement as one-page PDFs in the layout of the company's salary slip (logo, company, employee block, table).
// The same layout is drawn by the backend (app/services/payroll/pdf.py) for the live run; this copy serves the simulated run, which contacts nothing.
// Amounts show "Rs." because the standard PDF fonts have no rupee sign.

import { A4, PdfPage } from './pdf';

const LEFT = 40;
const RIGHT = 555;
const WIDTH = RIGHT - LEFT;
const TOP = A4.height - 40;
const BAND = '#D9E1F4';
const LINE_HEIGHT = 12.5;
const ROW = 19;
const PAD = 5;
const LOGO = { width: 150, height: 24.6 };

/** A page drawn top-down: `y` is the top edge of whatever is drawn next. */
class Sheet {
  constructor(logo) {
    this.page = new PdfPage();
    this.logo = logo;
    this.y = TOP;
  }

  text(x, baseline, text, options) { this.page.text(x, baseline, text, options); }

  rule() { this.page.line(LEFT, this.y, RIGHT, this.y); }

  cell(x0, x1, height, text = '', { bold = false, align = 'left', fill = null, size = 8.5 } = {}) {
    this.page.rect(x0, this.y - height, x1 - x0, height, { fill });
    if (text) {
      const x = { left: x0 + PAD, right: x1 - PAD, center: (x0 + x1) / 2 }[align];
      this.text(x, this.y - height / 2 - size * 0.35, text, { size, bold, align });
    }
  }

  /** The logo, the company, the title band and the employee block. Returns the top of the frame. */
  header(model) {
    const top = this.y;
    const middle = (LEFT + RIGHT) / 2;
    if (this.logo) this.page.logo(this.logo, middle - LOGO.width / 2, top - 14 - LOGO.height, LOGO.width, LOGO.height);
    this.text(middle, top - 62, model.company, { size: 12, bold: true, align: 'center' });
    this.text(middle, top - 76, model.address, { size: 8, align: 'center' });
    this.y = top - 84;
    this.rule();
    this.cell(LEFT, RIGHT, 20, model.title, { bold: true, align: 'center', fill: BAND, size: 9.5 });
    this.y -= 20;
    const lines = Math.max(model.left.length, model.right.length);
    for (let i = 0; i < lines; i += 1) {
      const baseline = this.y - 15 - i * LINE_HEIGHT;
      if (model.left[i]) this.text(LEFT + PAD, baseline, model.left[i]);
      if (model.right[i]) this.text(LEFT + WIDTH / 2 + PAD, baseline, model.right[i]);
    }
    this.y -= 15 + lines * LINE_HEIGHT;
    this.rule();
    return top;
  }

  finish(top) {
    this.page.rect(LEFT, this.y, WIDTH, top - this.y, { stroke: true });
    return this.page.toBlob();
  }
}

/** The payslip model -> a PDF Blob. `logo` is a png read with readPng (optional). */
export function payslipPdf(model, logo = null) {
  const sheet = new Sheet(logo);
  const top = sheet.header(model);
  const cols = [LEFT, LEFT + 130, LEFT + 258, LEFT + 388, RIGHT];
  ['Gross Earnings', 'Amount (Rs.)', 'Deductions', 'Amount (Rs.)'].forEach((head, i) => sheet.cell(cols[i], cols[i + 1], ROW - 1, head, { bold: true, align: 'center', fill: BAND }));
  sheet.y -= ROW - 1;

  const blank = ['', ''];
  const line = (left, right, bold = false) => {
    [[left[0], 'left'], [left[1], 'right'], [right[0], 'left'], [right[1], 'right']].forEach(([text, align], i) => sheet.cell(cols[i], cols[i + 1], ROW, text, { bold, align }));
    sheet.y -= ROW;
  };
  line(blank, blank);
  const count = Math.max(model.earnings.length, model.deductions.length);
  for (let i = 0; i < count; i += 1) line(model.earnings[i] ?? blank, model.deductions[i] ?? blank);
  line(blank, blank);
  line(['Amount Total:', `Rs. ${model.totalEarnings}`], ['Amount Total:', `Rs. ${model.totalDeductions}`], true);
  sheet.cell(cols[0], cols[3], ROW, 'Net Pay', { bold: true, align: 'right' });
  sheet.cell(cols[3], cols[4], ROW, `Rs. ${model.net}`, { bold: true, align: 'center', fill: BAND });
  sheet.y -= ROW;
  sheet.cell(LEFT, RIGHT, ROW, model.words, { bold: true });
  sheet.y -= ROW;
  return sheet.finish(top);
}

/** The CTC model -> a PDF Blob. */
export function ctcPdf(model, logo = null) {
  const sheet = new Sheet(logo);
  const top = sheet.header(model);
  const cols = [LEFT, LEFT + 235, LEFT + 375, RIGHT];
  const line = (cells, { bold = false, fill = null } = {}) => {
    cells.forEach((text, i) => sheet.cell(cols[i], cols[i + 1], ROW, text, { bold, align: ['left', 'right', 'right'][i], fill }));
    sheet.y -= ROW;
  };
  model.head.forEach((head, i) => sheet.cell(cols[i], cols[i + 1], ROW - 1, head, { bold: true, align: 'center', fill: BAND }));
  sheet.y -= ROW - 1;
  const [gross, takeHome] = model.totals;
  for (const [name, rows] of model.sections) {
    line([name, '', ''], { bold: true });
    rows.forEach((cells) => line(cells));
    if (name === 'Earnings') line(gross, { bold: true });
  }
  line(takeHome, { bold: true, fill: BAND });
  sheet.cell(LEFT, RIGHT, ROW, model.words, { bold: true });
  sheet.y -= ROW;
  return sheet.finish(top);
}
