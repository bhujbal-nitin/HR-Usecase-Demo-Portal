// A very small PDF writer for the simulated run's sample documents (one A4 page: text, boxes, lines and one PNG logo), no library.
// Coordinates are PDF points measured from the bottom-left corner. Text uses the standard Helvetica fonts, so only plain ASCII is drawn.

export const A4 = { width: 595, height: 842 };

// Character widths (1/1000 em) of Helvetica and Helvetica-Bold for ASCII 32..126, to right-align and centre text.
const REGULAR = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015,
  667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333,
  556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975,
  722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333,
  556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];

/** Width of the text in points. */
export function textWidth(text, size, bold = false) {
  const widths = bold ? BOLD : REGULAR;
  let total = 0;
  for (const ch of String(text)) total += widths[ch.charCodeAt(0) - 32] ?? 556;
  return (total * size) / 1000;
}

const escapeText = (text) => String(text).replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, '?');
const num = (n) => Number(n.toFixed(2));
const colour = (hex) => [1, 3, 5].map((i) => num(parseInt(hex.slice(i, i + 2), 16) / 255)).join(' ');

/** The PNG's size and its zlib data (the IDAT chunks joined), which a PDF can embed as it is (8-bit RGB, not interlaced). */
export function readPng(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const chunks = [];
  for (let at = 8; at < bytes.length;) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.slice(at + 4, at + 8));
    if (type === 'IDAT') chunks.push(bytes.slice(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const data = new Uint8Array(chunks.reduce((sum, c) => sum + c.length, 0));
  let offset = 0;
  for (const c of chunks) { data.set(c, offset); offset += c.length; }
  return { width, height, data };
}

export class PdfPage {
  constructor() {
    this.ops = [];
    this.image = null;
  }

  /** Draw text with its baseline at y; `align` says what x means (left edge, right edge or centre). */
  text(x, y, text, { size = 8.5, bold = false, italic = false, align = 'left', color = '#0F2A6B' } = {}) {
    const width = textWidth(text, size, bold);
    const left = align === 'right' ? x - width : align === 'center' ? x - width / 2 : x;
    this.ops.push(`BT /${bold ? 'F2' : italic ? 'F3' : 'F1'} ${size} Tf ${colour(color)} rg ${num(left)} ${num(y)} Td (${escapeText(text)}) Tj ET`);
  }

  rect(x, y, width, height, { fill = null, stroke = true, color = '#1F2F7A', lineWidth = 0.8 } = {}) {
    if (fill) this.ops.push(`${colour(fill)} rg ${num(x)} ${num(y)} ${num(width)} ${num(height)} re f`);
    if (stroke) this.ops.push(`${lineWidth} w ${colour(color)} RG ${num(x)} ${num(y)} ${num(width)} ${num(height)} re S`);
  }

  line(x0, y0, x1, y1) {
    this.ops.push(`0.8 w ${colour('#1F2F7A')} RG ${num(x0)} ${num(y0)} m ${num(x1)} ${num(y1)} l S`);
  }

  /** A filled circle (used for the head on the sample photos). */
  circle(cx, cy, radius, { fill = '#000000' } = {}) {
    const k = radius * 0.5523;
    const [x, y] = [num(cx), num(cy)];
    this.ops.push(`${colour(fill)} rg ${num(cx + radius)} ${y} m `
      + `${num(cx + radius)} ${num(cy + k)} ${num(cx + k)} ${num(cy + radius)} ${x} ${num(cy + radius)} c `
      + `${num(cx - k)} ${num(cy + radius)} ${num(cx - radius)} ${num(cy + k)} ${num(cx - radius)} ${y} c `
      + `${num(cx - radius)} ${num(cy - k)} ${num(cx - k)} ${num(cy - radius)} ${x} ${num(cy - radius)} c `
      + `${num(cx + k)} ${num(cy - radius)} ${num(cx + radius)} ${num(cy - k)} ${num(cx + radius)} ${y} c f`);
  }

  /** A filled shape through the given [x, y] points. */
  polygon(points, { fill = '#000000' } = {}) {
    const [[x0, y0], ...rest] = points;
    this.ops.push(`${colour(fill)} rg ${num(x0)} ${num(y0)} m ${rest.map(([x, y]) => `${num(x)} ${num(y)} l`).join(' ')} f`);
  }

  /** The logo (a png read with readPng), its lower-left corner at x, y. */
  logo(png, x, y, width, height) {
    this.image = png;
    this.ops.push(`q ${num(width)} 0 0 ${num(height)} ${num(x)} ${num(y)} cm /Im1 Do Q`);
  }

  /** The finished file, as a Blob. */
  toBlob() {
    const encoder = new TextEncoder();
    const content = encoder.encode(this.ops.join('\n'));
    const png = this.image;
    const font = (name) => `<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`;
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.width} ${A4.height}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 8 0 R >>${png ? ' /XObject << /Im1 7 0 R >>' : ''} >> >>`,
      { head: `<< /Length ${content.length} >>`, data: content },
      font('Helvetica'),
      font('Helvetica-Bold'),
      png ? null : '<< >>', // object 7 is the image when there is one
      font('Helvetica-Oblique'),
    ];
    if (png) {
      objects[6] = {
        head: `<< /Type /XObject /Subtype /Image /Width ${png.width} /Height ${png.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode `
          + `/DecodeParms << /Predictor 15 /Colors 3 /BitsPerComponent 8 /Columns ${png.width} >> /Length ${png.data.length} >>`,
        data: png.data,
      };
    }

    const parts = [];
    const offsets = [];
    let size = 0;
    const push = (bytes) => { parts.push(bytes); size += bytes.length; };
    push(encoder.encode('%PDF-1.4\n'));
    objects.forEach((object, i) => {
      offsets.push(size);
      if (typeof object === 'string') {
        push(encoder.encode(`${i + 1} 0 obj\n${object}\nendobj\n`));
      } else {
        push(encoder.encode(`${i + 1} 0 obj\n${object.head}\nstream\n`));
        push(object.data);
        push(encoder.encode('\nendstream\nendobj\n'));
      }
    });
    const xref = size;
    const table = offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
    push(encoder.encode(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${table}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
    return new Blob(parts, { type: 'application/pdf' });
  }
}
