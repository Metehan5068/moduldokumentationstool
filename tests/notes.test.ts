import { describe, expect, it } from 'vitest';
import { newNotes, normalizeNote, NotesParseError, parseNotes, serializeNotes } from '../src/shared/notes';

const texts = [
  '# Nutzerüberschrift\n## Noch eine Überschrift\nÄÖÜ äöü ß 📝',
  '<!-- Beliebiger HTML-Kommentar -->\nText mit <!-- lecture-note:page=4 --> mitten in einer Zeile.',
  '<!-- lecture-note:page=4 -->\n<!-- /lecture-note -->',
  '\\<!-- lecture-note:page=4 -->\n\\<!-- /lecture-note -->\n\\\\<!-- lecture-note:page=4 -->\n\\\\\\<!-- /lecture-note -->',
  ' <!-- lecture-note:page=4 -->\n<!-- /lecture-note --> \n<!-- lecture-note:page=abc -->\n<!-- lecture-note:page=0 -->',
  '\n\nLeerzeilen am Anfang und Ende\n\n',
  '\r\nCRLF\r\nmit Umlauten: Größe\r\n\r\n',
  '  Leerzeichen bleiben erhalten.  \n \n',
  '\n', '   ',
];
describe('notes.md Roundtrip nach Abschnitt 11', () => {
  it.each(texts)('erhält Nutzertext exakt (normalisiert nur Zeilenenden): %j', (text) => {
    const document = newNotes('module/ids/Test, Ä.pdf', 'Test, Ä', 20);
    document.notes[3] = text;
    document.notes[12] = 'Andere Seite\n';
    document.titles[3] = 'Generierter Folientitel';
    const markdown = serializeNotes(document);
    expect(markdown).not.toContain('\r');
    const first = parseNotes(markdown.replaceAll('\n', '\r\n'));
    const second = parseNotes(serializeNotes(first));
    expect(first.notes).toEqual({ 3: normalizeNote(text), 12: 'Andere Seite\n' });
    expect(second).toEqual(first);
    expect(second.notes[3]).not.toContain('Generierter Folientitel');
  });
  it('schreibt nur nicht-leere Notizen, sortiert numerisch und erhält verwaiste Seiten', () => {
    const document = newNotes('module/ids/Test.pdf', 'Test', 4);
    Object.assign(document.notes, { 20: 'Alte Folie', 3: 'Drei', 1: '', 2: 'Zwei' });
    const output = serializeNotes(document);
    expect(output.indexOf('page=2')).toBeLessThan(output.indexOf('page=3'));
    expect(output.indexOf('page=3')).toBeLessThan(output.indexOf('page=20'));
    expect(output).not.toContain('page=1 -->');
    expect(parseNotes(output).notes[20]).toBe('Alte Folie');
  });
  it('erhält manuell ergänzten Vorspann und ignoriert die erzeugte Titelzeile', () => {
    const document = newNotes('module/ids/Test.pdf', 'Test', 3);
    document.preamble += '\nEigene Einleitung bleibt erhalten.\n';
    document.notes[1] = 'Nur der Notiztext';
    const parsed = parseNotes(serializeNotes(document).replace('## Folie 1', '## Folie 99 · Von Hand ergänzt'));
    expect(parsed.notes[1]).toBe('Nur der Notiztext');
    expect(serializeNotes(parsed)).toContain('Eigene Einleitung bleibt erhalten.');
  });
  it('erhält Inhalt auch bei einer von Hand entfernten erzeugten Überschrift', () => {
    const source = '<!-- lecture-note:page=3 -->\n# Meine Überschrift\nNotiztext\n\n<!-- /lecture-note -->';
    expect(parseNotes(serializeNotes(parseNotes(source))).notes[3]).toBe('# Meine Überschrift\nNotiztext');
  });
});

describe('kaputte Marker verhindern Schreibzugriffe', () => {
  const block = '<!-- lecture-note:page=1 -->\n## Folie 1\n\nText\n\n<!-- /lecture-note -->';
  it.each([
    ['<!-- /lecture-note -->', 1],
    [block.replace('<!-- /lecture-note -->', ''), 1],
    [`${block}\n${block}`, 7],
    [block.replace('Text', '<!-- lecture-note:page=2 -->'), 4],
    [`${block}\nNicht zugeordneter Text`, 7],
  ])('meldet fehlerhafte Struktur mit Zeilennummer', (source, line) => {
    try { parseNotes(source as string); throw new Error('Parser hätte abbrechen müssen'); }
    catch (error) { expect(error).toBeInstanceOf(NotesParseError); expect((error as NotesParseError).line).toBe(line); }
  });
});
