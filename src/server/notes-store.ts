import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import type { AppConfig } from './config.js';
import { cachedMeta, type Registry } from './registry.js';
import { containedPath, safePath, writeAtomic } from './files.js';
import { newNotes, normalizeNote, NotesParseError, parseNotes, serializeNotes, type NotesDocument } from '../shared/notes.js';
import type { NoteValue } from '../shared/api.js';
import { WriteQueue } from './write-queue.js';
import type { FastifyBaseLogger } from 'fastify';

type Lecture = NonNullable<ReturnType<Registry['get']>>;
export const noteHash = (text: string): string => createHash('sha256').update(normalizeNote(text)).digest('hex');
export class NoteConflictError extends Error {
  constructor(readonly currentText: string) { super('Notiz wurde außerhalb dieser Ansicht geändert.'); }
}

export class NotesStore {
  constructor(private readonly config: AppConfig, private readonly writes = new WriteQueue(), private readonly logger?: Pick<FastifyBaseLogger, 'warn'>) {}

  private async path(lecture: Lecture, name = 'notes.md'): Promise<string> {
    const path = containedPath(this.config.notesRoot, lecture.module, lecture.summary.title, name);
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
      const titles = await this.titles(lecture);
      if (typeof titles[page] === 'string' && titles[page]) document.titles[page] = titles[page]!;
      await writeAtomic(this.config.notesRoot, await this.path(lecture), serializeNotes(document));
      return { text: normalized, hash: noteHash(normalized) };
    });
  }
  private async titles(lecture: Lecture): Promise<Record<number, string>> {
    try {
      const meta = await cachedMeta(await this.path(lecture, 'meta.json'));
      if (!meta || meta.sourceTextSha256 !== meta.sourceSha256) return {};
      const header = (await readFile(await this.path(lecture, 'source.md'), 'utf8')).split('\n').slice(0, 8);
      return header.includes(`sha256: ${meta.sourceSha256}`) ? meta.sourcePageTitles ?? {} : {};
    } catch (err) { this.logger?.warn({ err, lectureId: lecture.summary.id }, 'Folientitel konnten nicht gelesen werden'); return {}; }
  }
  retitle(lecture: Lecture): Promise<void> {
    return this.writes.run(lecture.summary.id, async () => {
      const path = await this.path(lecture);
      let raw: string;
      try { raw = await readFile(path, 'utf8'); }
      catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return; throw err; }
      const document = parseNotes(raw);
      const titles = await this.titles(lecture);
      let changed = false;
      for (const page of Object.keys(document.notes).map(Number)) {
        if (typeof titles[page] === 'string' && titles[page] && document.titles[page] !== titles[page]) {
          document.titles[page] = titles[page]!; changed = true;
        }
      }
      if (changed) await writeAtomic(this.config.notesRoot, path, serializeNotes(document));
    });
  }
}
export { NotesParseError };
