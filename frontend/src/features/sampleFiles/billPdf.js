// Draws one sample bill (see sampleBills.js) as a one-page PDF that looks like a real receipt or invoice: a coloured header with the vendor's mark and name,
// the vendor's address and tax number, the bill's details, a table of items, the tax and the total, how it was paid and a footer. Amounts show "INR".

import { A4, PdfPage } from '../agentDemo/lib/pdf';
import { qrLook } from '../agentDemo/lib/sampleIdCards';
import { money, totals } from './sampleBills';

const LEFT = 40;
const RIGHT = 555;
const WIDTH = RIGHT - LEFT;
const INK = '#1F2937';
const MUTED = '#6B7280';
const RULE = '#D1D5DB';

/** The vendor's mark: a coloured disc with its first letter. */
function mark(page, bill, cx, cy) {
  page.circle(cx, cy, 20, { fill: '#FFFFFF' });
  page.text(cx, cy - 8, bill.vendor[0], { size: 22, bold: true, align: 'center', color: bill.color });
}

export function billPdf(bill) {
  const page = new PdfPage();
  const { subtotal, tax, total } = totals(bill.items, bill.gst);

  // Header band
  const bandTop = A4.height - 36;
  page.rect(0, bandTop - 70, A4.width, 106, { fill: bill.color, stroke: false });
  mark(page, bill, LEFT + 22, bandTop - 24);
  page.text(LEFT + 56, bandTop - 22, bill.vendor, { size: 17, bold: true, color: '#FFFFFF' });
  page.text(LEFT + 56, bandTop - 38, bill.legal, { size: 8.5, color: '#E5E7EB' });
  page.text(RIGHT, bandTop - 24, bill.title, { size: 11, bold: true, align: 'right', color: '#FFFFFF' });
  page.text(RIGHT, bandTop - 38, bill.fields.find(([label]) => label === bill.dateField)[1], { size: 9, align: 'right', color: '#E5E7EB' });

  // Vendor address and tax number
  let y = bandTop - 92;
  bill.address.forEach((line) => { page.text(LEFT, y, line, { size: 8.5, color: MUTED }); y -= 12; });

  // Details block
  y -= 12;
  const rows = Math.ceil(bill.fields.length / 2);
  const blockHeight = rows * 28 + 10;
  page.rect(LEFT, y - blockHeight, WIDTH - (bill.qr ? 100 : 0), blockHeight, { fill: '#F9FAFB', color: RULE, lineWidth: 0.6 });
  const columnWidth = (WIDTH - (bill.qr ? 100 : 0)) / 2;
  bill.fields.forEach(([label, value], i) => {
    const x = LEFT + 12 + (i % 2) * columnWidth;
    const baseline = y - 24 - Math.floor(i / 2) * 28;
    page.text(x, baseline + 7, label.toUpperCase(), { size: 6.5, color: MUTED });
    page.text(x, baseline - 4, value, { size: 9.5, bold: true, color: INK });
  });
  if (bill.qr) qrLook(page, RIGHT - 84, y - blockHeight + (blockHeight - 84) / 2, 84, `${bill.vendor}-${bill.fields[0][1]}`);
  y -= blockHeight + 26;

  // Items table
  page.rect(LEFT, y - 6, WIDTH, 22, { fill: '#F3F4F6', stroke: false });
  page.text(LEFT + 8, y, 'DESCRIPTION', { size: 8, bold: true, color: INK });
  page.text(RIGHT - 8, y, 'AMOUNT (INR)', { size: 8, bold: true, align: 'right', color: INK });
  y -= 24;
  bill.items.forEach(([description, amount]) => {
    page.text(LEFT + 8, y, description, { size: 10, color: INK });
    page.text(RIGHT - 8, y, money(amount), { size: 10, align: 'right', color: INK });
    page.line(LEFT, y - 8, RIGHT, y - 8);
    y -= 24;
  });

  // Totals
  y -= 2;
  if (tax) {
    page.text(RIGHT - 150, y, 'Sub total', { size: 10, color: MUTED });
    page.text(RIGHT - 8, y, money(subtotal), { size: 10, align: 'right', color: INK });
    y -= 17;
    page.text(RIGHT - 150, y, bill.gstLabel, { size: 10, color: MUTED });
    page.text(RIGHT - 8, y, money(tax), { size: 10, align: 'right', color: INK });
    y -= 12;
  }
  y -= tax ? 30 : 8;
  page.rect(RIGHT - 230, y - 10, 230, 32, { fill: bill.color, stroke: false });
  page.text(RIGHT - 220, y, 'AMOUNT PAYABLE', { size: 9, bold: true, color: '#FFFFFF' });
  page.text(RIGHT - 10, y, `INR ${money(total)}`, { size: 14, bold: true, align: 'right', color: '#FFFFFF' });

  // Payment
  y -= 46;
  page.rect(LEFT, y - 6, 92, 20, { fill: '#ECFDF5', color: '#059669', lineWidth: 0.8 });
  page.text(LEFT + 46, y, 'PAID', { size: 10, bold: true, align: 'center', color: '#047857' });
  page.text(LEFT + 104, y, bill.payment, { size: 9.5, color: MUTED });

  // Footer
  page.line(LEFT, 96, RIGHT, 96);
  page.text(A4.width / 2, 80, `Thank you for choosing ${bill.vendor}.`, { size: 9, bold: true, align: 'center', color: INK });
  page.text(A4.width / 2, 67, 'This is a computer generated document and does not need a signature.', { size: 8, align: 'center', color: MUTED });
  page.text(A4.width / 2, 40, 'HR portal demo - fictional data', { size: 7.5, align: 'center', color: '#9AA3B2' });
  return page.toBlob();
}
