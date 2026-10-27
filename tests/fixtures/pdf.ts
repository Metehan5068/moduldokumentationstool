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
