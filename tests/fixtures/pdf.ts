/** Kleine, selbst erzeugte PDFs; keine Vorlesungsdaten oder Binärdateien im Repo. */
export function testPdf(pageCount: number): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${pageCount} /Kids [${Array.from({ length: pageCount }, (_, i) => `${i + 3} 0 R`).join(' ')}] >>`,
    ...Array.from({ length: pageCount }, () => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> >>'),
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

/** Sichtbar nummerierte Folien mit wechselnden Seitenverhältnissen für Browser-Abnahmen. */
export function lecturePdf(pageCount: number): Buffer {
  const font = 2 * pageCount + 3;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${pageCount} /Kids [${Array.from({ length: pageCount }, (_, i) => `${i + 3} 0 R`).join(' ')}] >>`,
    ...Array.from({ length: pageCount }, (_, i) => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${i % 10 === 9 ? '400 600' : '600 338'}] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${pageCount + i + 3} 0 R >>`),
    ...Array.from({ length: pageCount }, (_, i) => {
      const content = `0.85 0.92 0.88 rg 20 20 350 220 re f\n0 0 0 rg BT /F1 32 Tf 40 160 Td (Folie ${i + 1}) Tj ET\n`;
      return `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`;
    }),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

/** Kleine Text-/Leerseiten für die KI-Lesbarkeitsabnahme (WinAnsi/Latin-1). */
export function textPdf(pages: string[][]): Buffer {
  return positionedPdf(pages.map((lines) => lines.map((text, index) => ({ text, x: 40, y: 280 - index * 24, size: 16 }))));
}
export function positionedPdf(pages: { text: string; x: number; y: number; size: number }[][]): Buffer {
  const count = pages.length; const font = count * 2 + 3;
  const escape = (text: string) => text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${count} /Kids [${pages.map((_, index) => `${index + 3} 0 R`).join(' ')}] >>`,
    ...pages.map((_, index) => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 338] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${count + index + 3} 0 R >>`),
    ...pages.map((lines) => {
      const content = lines.map((line) => `BT /F1 ${line.size} Tf ${line.x} ${line.y} Td (${escape(line.text)}) Tj ET\n`).join('');
      return `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}endstream`;
    }),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(pdf, 'latin1')); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
  return Buffer.from(`${pdf}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`, 'latin1');
}

export const fixtureFooter = '© PADS (use only with permission & acknowledgements)';
export function boilerplatePdf(): Buffer {
  return positionedPdf(Array.from({ length: 10 }, (_, index) => [
    { text: fixtureFooter, x: 20, y: 12, size: 8 }, // Absichtlich erste Textzeile im Content-Stream.
    ...(index < 3 ? [{ text: 'Lehrstuhl', x: 20, y: 320, size: 10 }] : []),
    ...(index === 3 || index === 4 ? [{ text: 'Nur zweimal', x: 20, y: 315, size: 9 }] : []),
    ...(index < 9 ? [{ text: `Kapitel ${index + 1}`, x: 30, y: 305, size: 12 }, { text: `Thema ${index + 1}`, x: 30, y: 260, size: 28 }] : []),
    { text: `Inhalt ${index + 1}`, x: 30, y: 80, size: 16 },
  ]));
}
