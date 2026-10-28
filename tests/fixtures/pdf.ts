/** Kleine, selbst erzeugte PDFs; keine Vorlesungsdaten oder Binärdateien im Repo. */
import { createHash } from 'node:crypto';
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

/** Selbst erzeugte, tatsächlich entschlüsselbare Standard-Security-PDF (R2, Benutzerpasswort geheim). */
export function passwordPdf(): Buffer {
  const padding = Buffer.from('28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a', 'hex');
  const padded = (password: string) => Buffer.concat([Buffer.from(password, 'latin1'), padding]).subarray(0, 32);
  const rc4 = (key: Buffer, data: Buffer) => {
    const s = Array.from({ length: 256 }, (_, index) => index); let j = 0;
    for (let i = 0; i < 256; i++) { j = (j + s[i]! + key[i % key.length]!) % 256; [s[i], s[j]] = [s[j]!, s[i]!]; }
    const output = Buffer.alloc(data.length); let i = 0; j = 0;
    for (let n = 0; n < data.length; n++) { i = (i + 1) % 256; j = (j + s[i]!) % 256; [s[i], s[j]] = [s[j]!, s[i]!]; output[n] = data[n]! ^ s[(s[i]! + s[j]!) % 256]!; }
    return output;
  };
  const md5 = (data: Buffer) => createHash('md5').update(data).digest();
  const documentId = md5(Buffer.from('self-generated-protected-fixture'));
  const owner = rc4(md5(padded('owner')).subarray(0, 5), padded('geheim'));
  const permissions = Buffer.alloc(4); permissions.writeInt32LE(-4);
  const key = md5(Buffer.concat([padded('geheim'), owner, permissions, documentId])).subarray(0, 5);
  const user = rc4(key, padding);
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> >>',
    `<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${owner.toString('hex')}> /U <${user.toString('hex')}> /P -4 >>`];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
  return Buffer.from(`${pdf}trailer\n<< /Size ${offsets.length} /Root 1 0 R /Encrypt 4 0 R /ID [<${documentId.toString('hex')}> <${documentId.toString('hex')}>] >>\nstartxref\n${xref}\n%%EOF\n`);
}
