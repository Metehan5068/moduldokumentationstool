import { createHash } from 'node:crypto';
import { relative } from 'node:path';
import { mkdir, open, readFile, stat } from 'node:fs/promises';
import { setImmediate as yieldToRequests } from 'node:timers/promises';
import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from './config.js';
import { cachedMeta, type Registry } from './registry.js';
import type { NotesStore } from './notes-store.js';
import type { StateStore } from './state-store.js';
import { containedPath, safePath, writeAtomic, writeJson } from './files.js';
import type { WriteQueue } from './write-queue.js';
import { extractPdf, sourceMarkdown, SOURCE_TEXT_VERSION } from './pdf-text.js';
import type { OrphanSummary } from '../shared/api.js';

type Lecture = NonNullable<ReturnType<Registry['get']>>;
const backupNotice = 'notes/.relink-backups/ und notes/.relink-staging/ sind Sicherungskopien. Bei Inhaltsfragen ignorieren.';
const guide = `# Studiennotizen – Hinweise für KI-Agenten

Die Dateien bleiben lokal. Beantworte Inhaltsfragen mit Fundstelle, z. B. „IDS-3, Folie 12“.

- PDFs liegen unter module/<Modul>/*.pdf. module/ ist schreibgeschützt; PDFs niemals ändern.
- notes/<Modul>/<Vorlesung>/notes.md enthält die eigenen Notizen und gehört dem Nutzer.
  Nur auf ausdrückliche Bitte ändern. Marker-Zeilen niemals verändern.
  Ein Block <!-- lecture-note:page=N --> bis <!-- /lecture-note --> gehört zu PDF-Seite N (1-basiert).
  Marker im Nutzertext sind mit Backslash geschützt. Die Folienüberschrift direkt nach dem Marker ist generiert.
- source.md im selben Ordner enthält automatisch extrahierten Folientext unter „## Seite N“.
  Seite N in source.md, Folie N in notes.md und PDF-Seite N gehören zusammen.
  Bilder/Diagramme und Seiten ohne extrahierbaren Text bitte im PDF nachschlagen; es gibt kein OCR.
  Maßgeblich ist das PDF. Prüfe bei Quellenänderungen sha256 in source.md gegen sourceSha256 in meta.json.
- meta.json, state.json, source.md und INDEX.md sind generiert. state.json speichert Leseposition und Fortschritt.
- INDEX.md ist die Gesamtübersicht mit Modul, Seiten, Notizanzahl, Fortschritt und relativen Dateilinks.
- ${backupNotice}
- Falls source.md noch fehlt, kann die Hintergrundextraktion noch laufen. Fehler stehen im Server-Log.

Diese CLAUDE.md wird nur einmal angelegt und niemals von der App überschrieben. Der Nutzer darf sie erweitern.
`;
const cell = (text: string) => text.replaceAll('\\', '\\\\').replaceAll('|', '\\|').replace(/[\r\n]/g, ' ');
const link = (path: string) => path.split('/').map(encodeURIComponent).join('/');

export class KnowledgeService {
  private snapshot: Lecture[] = [];
  private pending = new Map<string, Lecture>();
  private runner?: Promise<void>;
  private scheduled?: NodeJS.Immediate;
  private indexTimer?: ReturnType<typeof setTimeout>;
  private indexRunner?: Promise<void>;
  private indexDirty = false;
  private closing = false;
  private guideChecked = false;
  constructor(private readonly config: AppConfig, private readonly logger: Pick<FastifyBaseLogger, 'error' | 'warn'>,
    private readonly writes: WriteQueue, private readonly notes: NotesStore, private readonly states: StateStore,
    private readonly extract: typeof extractPdf = extractPdf, private readonly getOrphans?: () => Promise<OrphanSummary[]>) {}

  afterScan(lectures: Lecture[]) {
    this.snapshot = lectures;
    for (const lecture of lectures) if (lecture.summary.pageCount !== null) this.pending.set(lecture.summary.id, lecture);
    this.start(); this.requestIndex(true);
  }
  private start() {
    if (this.runner || this.scheduled || !this.pending.size) return;
    this.scheduled = setImmediate(() => {
      this.scheduled = undefined;
      this.runner = this.work().finally(() => { this.runner = undefined; this.start(); });
    });
  }
  private async work() {
    while (this.pending.size) {
      const [id, lecture] = this.pending.entries().next().value!;
      this.pending.delete(id);
      try { await this.generate(lecture); }
      catch (err) { this.logger.error({ err, lectureId: id }, 'Folientext konnte nicht erzeugt werden'); }
      this.requestIndex();
      await yieldToRequests();
    }
  }
  private async notePath(lecture: Lecture, name: string) {
    const path = containedPath(this.config.notesRoot, lecture.module, lecture.summary.title, name);
    await safePath(this.config.dataRoot, this.config.notesRoot); await safePath(this.config.notesRoot, path);
    return path;
  }
  private async generate(lecture: Lecture) {
    const metaPath = await this.notePath(lecture, 'meta.json');
    const meta = await cachedMeta(metaPath);
    if (!meta) return;
    const sourcePath = await this.notePath(lecture, 'source.md');
    let cached = false;
    if (meta.sourceTextSha256 === meta.sourceSha256 && meta.sourceTextVersion === SOURCE_TEXT_VERSION) {
      try { cached = (await readFile(sourcePath, 'utf8')).split('\n').slice(0, 8).includes(`sha256: ${meta.sourceSha256}`); }
      catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err; }
    }
    if (!cached) {
      await safePath(this.config.dataRoot, this.config.moduleRoot); await safePath(this.config.moduleRoot, lecture.pdfPath);
      const data = await readFile(lecture.pdfPath);
      const hash = createHash('sha256').update(data).digest('hex');
      if (hash !== meta.sourceSha256) return; // Wurde während des Scans ersetzt; nächster Scan nimmt die neue Quelle auf.
      const extracted = await this.extract(new Uint8Array(data));
      const committed = await this.writes.run(lecture.summary.id, async () => {
        await safePath(this.config.dataRoot, this.config.moduleRoot);
        await safePath(this.config.moduleRoot, lecture.pdfPath);
        const current = await cachedMeta(await this.notePath(lecture, 'meta.json'));
        const info = await stat(lecture.pdfPath);
        if (!current || current.sourceSha256 !== hash || info.size !== meta.sourceSize || info.mtimeMs !== meta.sourceMtimeMs) return false;
        await writeAtomic(this.config.notesRoot, await this.notePath(lecture, 'source.md'), sourceMarkdown(current.sourcePdf, lecture.summary.title, hash, extracted.pages, undefined, extracted.boilerplate));
        await writeJson(this.config.notesRoot, metaPath, { ...current, sourceTextSha256: hash, sourceTextVersion: SOURCE_TEXT_VERSION,
          sourcePageTitles: extracted.titles, pagesWithoutText: extracted.pagesWithoutText });
        return true;
      });
      if (!committed) return;
    }
    try { await this.notes.retitle(lecture); }
    catch (err) { this.logger.warn({ err, lectureId: lecture.summary.id }, 'Folientitel in Notizen konnten nicht aktualisiert werden; Notizdatei bleibt unverändert'); }
  }
  requestIndex(immediate = false) {
    this.indexDirty = true;
    if (this.closing || this.indexRunner) return;
    if (immediate) { clearTimeout(this.indexTimer); this.indexTimer = undefined; }
    if (this.indexTimer === undefined) this.indexTimer = setTimeout(() => { this.indexTimer = undefined; void this.flushIndex(); }, immediate ? 0 : 1000);
  }
  async ensureGuide() {
    if (this.guideChecked) return;
    const path = containedPath(this.config.dataRoot, 'CLAUDE.md');
    await safePath(this.config.dataRoot, path); await mkdir(this.config.dataRoot, { recursive: true });
    try {
      const file = await open(path, 'wx'); // Exklusiv anlegen: auch bei konkurrierenden Starts niemals überschreiben.
      try { await file.writeFile(guide, 'utf8'); await file.sync(); } finally { await file.close(); }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      const existing = await readFile(path, 'utf8');
      const hasNotice = existing.split(/\r?\n\s*\r?\n/).some((paragraph) =>
        paragraph.includes('notes/.relink-backups/') && paragraph.includes('notes/.relink-staging/')
        && /Sicherungskopien/i.test(paragraph) && /ignorier/i.test(paragraph));
      if (!hasNotice) this.logger.warn({ path }, `Vorhandene CLAUDE.md enthält keinen Hinweis auf Relink-Sicherungen. Bitte ergänzen: ${backupNotice} Die Datei wird nicht überschrieben.`);
    }
    this.guideChecked = true;
  }
  private async indexMarkdown(lectures: Lecture[]): Promise<string> {
    const lines = ['# Übersicht Studiennotizen', `_Automatisch generiert. Stand: ${new Date().toISOString()}_`, ''];
    let module: string | undefined;
    for (const lecture of lectures) {
      if (module !== lecture.module) {
        module = lecture.module;
        lines.push(`## ${cell(module)}`, '| Vorlesung | Seiten | Notizen | Fortschritt | Zuletzt bearbeitet | Dateien |', '|---|---|---|---|---|---|');
      }
      const [bookmark, completed, notes] = await Promise.all([this.states.read(lecture), this.states.completed(lecture), this.notes.read(lecture).catch(() => undefined)]);
      let updated = bookmark.exists && Date.parse(bookmark.state.updatedAt) > 0 ? bookmark.state.updatedAt : '';
      try { const file = await stat(await this.notePath(lecture, 'notes.md')); if (file.mtime.toISOString() > updated) updated = file.mtime.toISOString(); }
      catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') this.logger.warn({ err, lectureId: lecture.summary.id }, 'Bearbeitungszeit konnte nicht gelesen werden'); }
      const directory = `notes/${module}/${lecture.summary.title}/`;
      const pdf = `module/${relative(this.config.moduleRoot, lecture.pdfPath).replaceAll('\\', '/')}`;
      const progress = completed ? '✓ erledigt' : bookmark.state.maxPageVisited ? `bis Folie ${bookmark.state.maxPageVisited}` : '–';
      lines.push(`| ${cell(lecture.summary.title)} | ${lecture.summary.pageCount ?? 'Fehler beim Einlesen'} | ${notes ? Object.values(notes).filter((note) => note.text.length).length : 'Notizdatei prüfen'} | ${progress} | ${updated ? updated.slice(0, 10) : '–'} | [${cell(directory)}](${link(directory)}) · [PDF](${link(pdf)}) |`);
    }
    if (!lectures.length) lines.push('Noch keine Vorlesungs-PDFs gefunden.');
    const orphans = await this.getOrphans?.() ?? [];
    if (orphans.length) {
      lines.push('', '## Notizen ohne PDF', '| Vorlesung | Notizen | Dateien |', '|---|---|---|');
      for (const orphan of orphans) {
        const directory = `notes/${orphan.module}/${orphan.title}/`;
        lines.push(`| ${cell(`${orphan.module}/${orphan.title}`)} | ${orphan.noteCount ?? 'Notizdatei prüfen'} | [${cell(directory)}](${link(directory)}) |`);
      }
    }
    return `${lines.join('\n')}\n`;
  }
  private flushIndex(): Promise<void> {
    if (this.indexRunner) return this.indexRunner;
    clearTimeout(this.indexTimer); this.indexTimer = undefined;
    if (!this.indexDirty) return Promise.resolve();
    this.indexDirty = false;
    const snapshot = [...this.snapshot];
    this.indexRunner = (async () => {
      try {
        await this.ensureGuide();
        const path = containedPath(this.config.dataRoot, 'INDEX.md'); await safePath(this.config.dataRoot, path);
        await writeAtomic(this.config.dataRoot, path, await this.indexMarkdown(snapshot));
      } catch (err) { this.logger.error({ err }, 'KI-Übersicht konnte nicht geschrieben werden'); }
    })().finally(() => { this.indexRunner = undefined; if (this.indexDirty && !this.closing) this.requestIndex(); });
    return this.indexRunner;
  }
  async idle() {
    this.start();
    while (this.scheduled || this.runner || this.pending.size) {
      if (this.runner) await this.runner; else await yieldToRequests();
      this.start();
    }
    if (this.indexRunner) await this.indexRunner;
    while (this.indexDirty) await this.flushIndex();
  }
  async close() {
    this.closing = true; clearTimeout(this.indexTimer); this.indexTimer = undefined;
    await this.idle();
  }
}
