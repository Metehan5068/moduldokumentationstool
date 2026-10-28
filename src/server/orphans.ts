import { randomUUID, createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from './config.js';
import { cachedMeta, lectureId, naturalCompare, type Registry } from './registry.js';
import type { WriteQueue } from './write-queue.js';
import { containedPath, renameWithRetry, safePath, writeAtomic, writeJson } from './files.js';
import { normalizeState, isLectureState } from '../shared/state.js';
import { NotesParseError, parseNotes, serializeNotes } from '../shared/notes.js';
import type { OrphanSummary } from '../shared/api.js';

type Lecture = NonNullable<ReturnType<Registry['get']>>;
interface Orphan { id: string; module: string; title: string; directory: string }
const reserved = new Set(['.relink-backups', '.relink-staging']);
export class RelinkError extends Error { constructor(message: string, readonly status = 409) { super(message); } }
export class OrphanService {
  constructor(private readonly config: AppConfig, private readonly registry: Registry, private readonly writes: WriteQueue, private readonly logger: Pick<FastifyBaseLogger, 'error'>) {}
  private directory(module: string, title: string) { return containedPath(this.config.notesRoot, module, title); }
  private async safe(path: string) { await safePath(this.config.dataRoot, this.config.notesRoot); await safePath(this.config.notesRoot, path); }
  private async directories(path: string) {
    await this.safe(path);
    try { return (await readdir(path, { withFileTypes: true })).filter((entry) => entry.isDirectory() && !reserved.has(entry.name)).sort((a, b) => naturalCompare(a.name, b.name)); }
    catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []; throw err; }
  }
  private async discover(): Promise<Orphan[]> {
    const active = new Set(this.registry.all().map((lecture) => this.directory(lecture.module, lecture.summary.title)));
    const orphans: Orphan[] = [];
    for (const module of await this.directories(this.config.notesRoot)) {
      const modulePath = containedPath(this.config.notesRoot, module.name);
      for (const lecture of await this.directories(modulePath)) {
        const directory = this.directory(module.name, lecture.name); await this.safe(directory);
        if (!active.has(directory)) orphans.push({ id: lectureId(`notes/${module.name}/${lecture.name}`), module: module.name, title: lecture.name, directory });
      }
    }
    return orphans;
  }
  private async eligible(directory: string): Promise<boolean> {
    await this.safe(directory);
    try { return (await readdir(directory, { withFileTypes: true })).every((entry) => entry.isFile() && ['meta.json', 'source.md', 'state.json'].includes(entry.name)); }
    catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return true; throw err; }
  }
  async list(): Promise<OrphanSummary[]> {
    const result: OrphanSummary[] = [];
    for (const orphan of await this.discover()) {
      let noteCount: number | null = 0; let error: string | undefined;
      const metaPath = containedPath(orphan.directory, 'meta.json'); await this.safe(metaPath);
      const meta = await cachedMeta(metaPath).catch(() => undefined);
      try {
        const path = containedPath(orphan.directory, 'notes.md'); await this.safe(path);
        noteCount = Object.values(parseNotes(await readFile(path, 'utf8')).notes).filter(Boolean).length;
      } catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') { noteCount = null; error = 'Notizdatei prüfen'; } }
      const candidates: OrphanSummary['candidates'] = [];
      if (meta) for (const lecture of this.registry.all()) {
        if (lecture.summary.pageCount === null) continue;
        await this.writes.run(lecture.summary.id, async () => {
          if (!await this.eligible(this.directory(lecture.module, lecture.summary.title))) return;
          const path = containedPath(this.directory(lecture.module, lecture.summary.title), 'meta.json'); await this.safe(path);
          const target = await cachedMeta(path).catch(() => undefined);
          if (target?.sourceSha256 === meta.sourceSha256) candidates.push({ id: lecture.summary.id, module: lecture.module, title: lecture.summary.title });
        });
      }
      result.push({ id: orphan.id, module: orphan.module, title: orphan.title, noteCount, candidates, ...(error ? { error } : {}) });
    }
    return result;
  }
  private async checkTree(directory: string): Promise<void> {
    await this.safe(directory);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = containedPath(directory, entry.name); await this.safe(path);
      if (entry.isSymbolicLink()) throw new RelinkError('Verknüpfungen im Notizordner bitte vor dem Zuordnen auflösen.');
      if (entry.isDirectory()) await this.checkTree(path);
    }
  }
  link(orphanId: string, targetId: string): Promise<void> {
    return this.registry.exclusive(async () => {
      const orphan = (await this.discover()).find((item) => item.id === orphanId);
      const target = this.registry.get(targetId);
      if (!orphan || !target || target.summary.pageCount === null) throw new RelinkError('Notizordner oder PDF nicht mehr vorhanden. Bitte neu einlesen.', 404);
      const oldMetaPath = containedPath(orphan.directory, 'meta.json'); await this.safe(oldMetaPath);
      const oldMeta = await cachedMeta(oldMetaPath).catch(() => undefined);
      const oldId = oldMeta ? lectureId(oldMeta.sourcePdf) : orphan.id;
      const job = () => this.move(orphan, target);
      await this.writes.run(targetId, () => oldId === targetId ? job() : this.writes.run(oldId, job));
    });
  }
  private async move(orphan: Orphan, target: Lecture) {
    const destination = this.directory(target.module, target.summary.title);
    if (!await this.eligible(destination)) throw new RelinkError('Die Zielvorlesung enthält bereits Notizen oder eigene Dateien. Es wird nichts überschrieben.');
    await this.checkTree(orphan.directory);
    const targetMetaPath = containedPath(destination, 'meta.json'); await this.safe(targetMetaPath);
    const targetMeta = await cachedMeta(targetMetaPath);
    if (!targetMeta) throw new RelinkError('Metadaten der Ziel-PDF fehlen. Bitte neu einlesen.');
    await safePath(this.config.dataRoot, this.config.moduleRoot); await safePath(this.config.moduleRoot, target.pdfPath);
    if (createHash('sha256').update(await readFile(target.pdfPath)).digest('hex') !== targetMeta.sourceSha256) throw new RelinkError('Die Ziel-PDF wurde geändert. Bitte neu einlesen.');
    const uuid = randomUUID(); const stageParent = containedPath(this.config.notesRoot, '.relink-staging');
    const backups = containedPath(this.config.notesRoot, '.relink-backups', uuid); const stage = containedPath(stageParent, uuid);
    await this.safe(stage); await this.safe(backups); await mkdir(stageParent, { recursive: true }); await mkdir(stage); await mkdir(backups, { recursive: true });
    let oldMoved = false; let targetMoved = false; let committed = false;
    const oldBackup = containedPath(backups, 'original'); const targetBackup = containedPath(backups, 'ziel');
    try {
      for (const name of await readdir(orphan.directory)) {
        await cp(containedPath(orphan.directory, name), containedPath(stage, name), { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true });
      }
      await this.checkTree(stage);
      const oldMeta = await cachedMeta(containedPath(stage, 'meta.json')).catch(() => undefined);
      let originalNotes: string | undefined;
      try {
        originalNotes = await readFile(containedPath(stage, 'notes.md'), 'utf8');
        try {
          const document = parseNotes(originalNotes);
          const front = /^---\n[\s\S]*?\n---(?:\n|$)/.exec(document.preamble);
          if (front) {
            const header = front[0].replace(/^quelle:.*$/m, `quelle: ${JSON.stringify(targetMeta.sourcePdf)}`);
            const rest = document.preamble.slice(front[0].length).split('\n');
            const heading = rest.findIndex((line) => line.trim() !== '');
            if (heading >= 0 && rest[heading] === `# ${orphan.title}`) rest[heading] = `# ${target.summary.title}`;
            document.preamble = header + rest.join('\n');
          }
          await writeAtomic(this.config.notesRoot, containedPath(stage, 'notes.md'), serializeNotes(document));
        } catch (err) { if (!(err instanceof NotesParseError)) throw err; /* Beschädigte Nutzerdateien bleiben bytegenau erhalten. */ }
      } catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err; }
      await writeJson(this.config.notesRoot, containedPath(stage, 'meta.json'), { ...targetMeta,
        completed: Boolean(oldMeta?.completed || targetMeta.completed), acceptedSha256: oldMeta?.acceptedSha256 ?? 'unbekannt',
        acceptedPageCount: oldMeta?.acceptedPageCount ?? oldMeta?.pageCount,
        sourceTextSha256: undefined, sourceTextVersion: undefined, sourcePageTitles: undefined,
      });
      const states = [];
      for (const directory of [stage, destination]) {
        const path = containedPath(directory, 'state.json'); await this.safe(path);
        try { const raw: unknown = JSON.parse(await readFile(path, 'utf8')); if (isLectureState(raw)) states.push(raw); } catch { /* Flüchtige Daten sind optional. */ }
      }
      if (states.length) {
        states.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
        const state = normalizeState({ ...states[0]!, maxPageVisited: Math.max(...states.map((value) => value.maxPageVisited)) }, targetMeta.pageCount);
        await writeJson(this.config.notesRoot, containedPath(stage, 'state.json'), state);
      }
      const sourceNotes = containedPath(orphan.directory, 'notes.md'); await this.safe(sourceNotes);
      const currentNotes = await readFile(sourceNotes, 'utf8').catch((err: NodeJS.ErrnoException) => { if (err.code === 'ENOENT') return undefined; throw err; });
      if (currentNotes !== originalNotes || !await this.eligible(destination)) throw new RelinkError('Notizen wurden während der Verknüpfung geändert. Bitte erneut versuchen.');
      await this.safe(destination); await this.safe(orphan.directory);
      try { await stat(destination); await renameWithRetry(destination, targetBackup); targetMoved = true; }
      catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err; }
      await renameWithRetry(orphan.directory, oldBackup); oldMoved = true;
      await mkdir(containedPath(this.config.notesRoot, target.module), { recursive: true });
      await renameWithRetry(stage, destination); committed = true;
    } catch (err) {
      try {
        if (oldMoved) await renameWithRetry(oldBackup, orphan.directory);
        if (targetMoved) await renameWithRetry(targetBackup, destination);
      } catch (rollbackError) { this.logger.error({ err: rollbackError, backups }, 'Relink konnte nicht vollständig zurückgesetzt werden; Originaldateien liegen in der Sicherung'); }
      throw err;
    } finally {
      if (!committed) { await this.safe(stage); await rm(stage, { recursive: true, force: true }); }
    }
  }
}
