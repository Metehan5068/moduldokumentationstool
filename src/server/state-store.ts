import { readFile } from 'node:fs/promises';
import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from './config.js';
import { cachedMeta, type Registry } from './registry.js';
import { containedPath, safePath, writeJson } from './files.js';
import { WriteQueue } from './write-queue.js';
import { INITIAL_STATE, isLectureState, normalizeState, type LectureState } from '../shared/state.js';

type Lecture = NonNullable<ReturnType<Registry['get']>>;
export class StateStore {
  constructor(private readonly config: AppConfig, private readonly logger: Pick<FastifyBaseLogger, 'warn'>, private readonly writes: WriteQueue) {}
  private async path(lecture: Lecture, name: string) {
    const path = containedPath(this.config.notesRoot, lecture.module, lecture.summary.title, name);
    await safePath(this.config.dataRoot, this.config.notesRoot);
    await safePath(this.config.notesRoot, path);
    return path;
  }
  async read(lecture: Lecture): Promise<{ state: LectureState; exists: boolean; error?: string }> {
    try {
      const raw: unknown = JSON.parse(await readFile(await this.path(lecture, 'state.json'), 'utf8'));
      if (!isLectureState(raw)) throw new Error('Ungültiges state.json');
      return { state: normalizeState(raw, lecture.summary.pageCount ?? 1), exists: true };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { state: { ...INITIAL_STATE, selection: { start: 0, end: 0 } }, exists: false };
      this.logger.warn({ err, lectureId: lecture.summary.id }, 'Leseposition konnte nicht gelesen werden');
      return { state: { ...INITIAL_STATE, selection: { start: 0, end: 0 } }, exists: false, error: 'Leseposition konnte nicht gelesen werden. Beim Weiterlesen wird sie neu angelegt.' };
    }
  }
  write(lecture: Lecture, input: LectureState): Promise<LectureState> {
    return this.writes.run(lecture.summary.id, async () => {
      const previous = await this.read(lecture);
      const incoming = normalizeState(input, lecture.summary.pageCount ?? 1);
      // Ein verspäteter Request (z. B. vor pagehide) darf den neueren Stand nicht zurücksetzen.
      const latest = previous.exists && Date.parse(previous.state.updatedAt) > Date.parse(incoming.updatedAt) ? previous.state : incoming;
      const state = { ...latest, maxPageVisited: Math.max(previous.state.maxPageVisited, incoming.maxPageVisited) };
      await writeJson(this.config.notesRoot, await this.path(lecture, 'state.json'), state);
      return state;
    });
  }
  async completed(lecture: Lecture): Promise<boolean> {
    try { return (await cachedMeta(await this.path(lecture, 'meta.json')))?.completed ?? false; }
    catch (err) { this.logger.warn({ err, lectureId: lecture.summary.id }, 'Erledigt-Status konnte nicht gelesen werden'); return false; }
  }
  markEdited(lecture: Lecture, page: number): Promise<void> {
    return this.writes.run(lecture.summary.id, async () => {
      const previous = await this.read(lecture);
      if (previous.state.maxPageVisited >= page) return;
      const state = { ...previous.state, maxPageVisited: page,
        ...(!previous.exists ? { lastPage: page, activeNotePage: page } : {}) };
      await writeJson(this.config.notesRoot, await this.path(lecture, 'state.json'), state);
    });
  }
  setCompleted(lecture: Lecture, completed: boolean): Promise<boolean> {
    return this.writes.run(lecture.summary.id, async () => {
      const path = await this.path(lecture, 'meta.json');
      const meta = await cachedMeta(path);
      if (!meta) throw new Error('Metadaten fehlen oder sind ungültig. Bitte neu einlesen.');
      if (completed && lecture.summary.pageCount !== null) {
        const previous = await this.read(lecture);
        const maxPageVisited = Math.max(previous.state.maxPageVisited, lecture.summary.pageCount);
        if (maxPageVisited !== previous.state.maxPageVisited) {
          await writeJson(this.config.notesRoot, await this.path(lecture, 'state.json'), { ...previous.state, maxPageVisited });
        }
      }
      await writeJson(this.config.notesRoot, path, { ...meta, completed });
      return completed;
    });
  }
}
