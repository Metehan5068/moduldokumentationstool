/** Marker sind ausschließlich ganze Zeilen; Nutzertext bleibt abgesehen von LF-Normalisierung unverändert. */
export const normalizeNote = (text: string): string => text.replace(/\r\n?/g, '\n');
const startMarker = /^<!-- lecture-note:page=([1-9]\d*) -->$/;
const endMarker = '<!-- /lecture-note -->';
const escapedMarker = /^(\\*)(?:<!-- lecture-note:page=[1-9]\d* -->|<!-- \/lecture-note -->)$/;

export class NotesParseError extends Error {
  constructor(message: string, readonly line: number) {
    super(`Zeile ${line}: ${message}`);
    this.name = 'NotesParseError';
  }
}
export interface NotesDocument {
  preamble: string;
  notes: Record<number, string>;
  titles: Record<number, string>;
}
export function newNotes(sourcePdf: string, title: string, pageCount: number): NotesDocument {
  return { preamble: `---\nquelle: ${JSON.stringify(sourcePdf)}\nseiten: ${pageCount}\nschemaVersion: 1\n---\n# ${title}\n`, notes: {}, titles: {} };
}

export function parseNotes(markdown: string): NotesDocument {
  const lines = normalizeNote(markdown).replace(/^\uFEFF/, '').split('\n');
  const document: NotesDocument = { preamble: '', notes: {}, titles: {} };
  let firstBlock = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line === endMarker) throw new NotesParseError('Endmarker ohne Startmarker.', i + 1);
    const match = startMarker.exec(line);
    if (!match) {
      if (firstBlock >= 0 && line.trim() !== '') throw new NotesParseError('Text außerhalb eines Notizblocks. Bitte einem Folienblock zuordnen.', i + 1);
      continue;
    }
    if (firstBlock < 0) { firstBlock = i; document.preamble = lines.slice(0, i).join('\n'); }
    const page = Number(match[1]);
    if (!Number.isSafeInteger(page)) throw new NotesParseError('Ungültige Foliennummer.', i + 1);
    if (Object.hasOwn(document.notes, page)) throw new NotesParseError('Doppelter Notizblock für diese Folie.', i + 1);
    // Nur Marker tragen die Zuordnung. Eine editierte Überschrift darf sie nicht ändern.
    const heading = /^## Folie [1-9]\d*(?: · (.*))?$/.exec(lines[i + 1] ?? '');
    let contentStart = i + 1;
    if (heading) {
      contentStart++;
      if (lines[contentStart] === '') contentStart++;
    }
    let end = contentStart;
    for (; end < lines.length && lines[end] !== endMarker; end++) {
      if (startMarker.test(lines[end]!)) throw new NotesParseError('Verschachtelter Startmarker; Endmarker fehlt.', end + 1);
    }
    if (end === lines.length) throw new NotesParseError('Endmarker fehlt.', i + 1);
    const content = lines.slice(contentStart, end);
    if (content.at(-1) === '') content.pop(); // Genau eine strukturelle Leerzeile entfernen.
    document.notes[page] = content.map((text) => text.startsWith('\\') && escapedMarker.test(text) ? text.slice(1) : text).join('\n');
    document.titles[page] = heading?.[1] ?? '';
    i = end;
  }
  if (firstBlock < 0) document.preamble = lines.join('\n');
  return document;
}

export function serializeNotes(document: NotesDocument): string {
  const blocks = Object.entries(document.notes).sort(([a], [b]) => Number(a) - Number(b)).flatMap(([page, raw]) => {
    const text = normalizeNote(raw);
    if (!text) return [];
    if (!/^[1-9]\d*$/.test(page) || !Number.isSafeInteger(Number(page))) throw new Error('Ungültige Foliennummer.');
    const title = document.titles[Number(page)]?.replace(/[\r\n]/g, ' ');
    const escaped = text.split('\n').map((line) => escapedMarker.test(line) ? `\\${line}` : line).join('\n');
    return [`<!-- lecture-note:page=${page} -->\n## Folie ${page}${title ? ` · ${title}` : ''}\n\n${escaped}\n\n${endMarker}`];
  });
  const preamble = normalizeNote(document.preamble).replace(/\n*$/, '');
  return `${[preamble, ...blocks].filter(Boolean).join('\n\n')}\n`;
}
