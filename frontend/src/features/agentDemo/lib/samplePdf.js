// Builds a tiny, valid, single-page PDF in the browser (no library) for the demo's sample documents.
// All content is fictional and every page is stamped "SAMPLE".

const escapePdf = (text) => text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/[^\x20-\x7E]/g, '?');

/**
 * @param {string} title  heading band text
 * @param {string[]} lines  body lines (ASCII)
 * @returns {Blob} application/pdf
 */
export function makeSamplePdf(title, lines) {
  const content = [
    '0.11 0.31 0.66 rg 36 740 540 36 re f', // blue header band
    'BT /F1 14 Tf 1 1 1 rg 48 752 Td (' + escapePdf(title.toUpperCase()) + ') Tj ET',
    'BT /F1 11 Tf 0.1 0.1 0.15 rg 48 700 Td 18 TL',
    ...lines.map((line, i) => `${i === 0 ? '' : 'T* '}(${escapePdf(line)}) Tj`),
    'ET',
    'BT /F1 9 Tf 0.45 0.45 0.5 rg 48 40 Td (SAMPLE DOCUMENT - FICTIONAL DATA - GENERATED FOR THE HR PORTAL DEMO) Tj ET',
  ].join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const offset = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xrefAt = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  return new Blob([pdf], { type: 'application/pdf' });
}
