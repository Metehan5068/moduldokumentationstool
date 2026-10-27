import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import type { AppConfig } from './config.js';
import type { Registry } from './registry.js';
import { containedPath, safePath, writeAtomic } from './files.js';
import { newNotes, normalizeNote, NotesParseError, parseNotes, serializeNotes, type NotesDocument } from '../shared/notes.js';
import type { NoteValue } from '../shared/api.js';
import { WriteQueue } from './write-queue.js';

type Lecture = NonNullable<ReturnType<Registry['get']>>;
export const noteHash = (text: string): string => createHash('sha256').update(normalizeNote(text)).digest('hex');
export class NoteConflictError extends Error {
  constructor(readonly currentText: string) { super('Notiz wurde außerhalb dieser Ansicht geändert.'); }
}

export class NotesStore {
  constructor(private readonly config: AppConfig, private readonly writes = new WriteQueue()) {}

  private async path(lecture: Lecture): Promise<string> {
    const path = containedPath(this.config.notesRoot, lecture.module, lecture.summary.title, 'notes.md');
    await safePath(this.config.dataRoot, this.config.notesRoot);
    await safePath(this.config.notesRoot, path);
    return path;
  }
  private async readDocument(lecture: Lecture): Promise<NotesDocument> {
    const path = await this.path(lecture);
    try { return parseNotes(await readFile(path, 'utf8')); }
    catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      return newNotes(`module/${relative(this.config.moduleRoot, lecture.pdfPath).replaceAll('\\', '/')}`, lecture.summary.title, lecture.summary.pageCount ?? 0);
    }
  }
  async read(lecture: Lecture): Promise<Record<number, NoteValue>> {
    const document = await this.readDocument(lecture);
    return Object.fromEntries(Object.entries(document.notes).map(([page, text]) => [page, { text, hash: noteHash(text) }]));
  }
  write(lecture: Lecture, page: number, text: string, baseHash: string): Promise<NoteValue> {
    const id = lecture.summary.id;
    return this.writes.run(id, async () => {
      const document = await this.readDocument(lecture); // Innerhalb der Queue immer frisch lesen.
      const current = document.notes[page] ?? '';
      if (noteHash(current) !== baseHash) throw new NoteConflictError(current);
      const normalized = normalizeNote(text);
      document.notes[page] = normalized;
      // Titel aus vorhandenen Notizen erhalten; source.md-Titel folgen in Phase 5.
      await writeAtomic(this.config.notesRoot, await this.path(lecture), serializeNotes(document));
      return { text: normalized, hash: noteHash(normalized) };
    });
  }
}
export { NotesParseError };
