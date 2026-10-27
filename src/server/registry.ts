import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import type { FastifyBaseLogger } from 'fastify';
import type { OverviewResponse, LectureSummary } from '../shared/api.js';
import type { AppConfig } from './config.js';
import { containedPath, safePath, writeJson } from './files.js';

const collator = new Intl.Collator('de', { numeric: true });
export const naturalCompare = (a: string, b: string): number => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
export const lectureId = (path: string): string => createHash('sha256').update(path.replaceAll('\\', '/').normalize('NFC')).digest('hex').slice(0, 16);

interface Metadata {
  schemaVersion: 1;
  module: string;
  lecture: string;
  sourcePdf: string;
  sourceSha256: string;
  acceptedSha256: string;
  pageCount: number;
  pagesWithoutText: number[];
  completed: boolean;
  sourceSize: number;
  sourceMtimeMs: number;
}

async function entries(path: string): Promise<Dirent[]> {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function cachedMeta(path: string): Promise<Metadata | undefined> {
  try {
    const meta = JSON.parse(await readFile(path, 'utf8')) as Metadata;
    if (meta.schemaVersion === 1 && /^[a-f0-9]{64}$/.test(meta.sourceSha256)
      && typeof meta.acceptedSha256 === 'string' && typeof meta.completed === 'boolean'
      && Number.isInteger(meta.pageCount) && meta.pageCount > 0) return meta;
  } catch (error) {
    if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export class Registry {
  private queue: Promise<unknown> = Promise.resolve();
  private lectures = new Map<string, { pdfPath: string; summary: LectureSummary }>();

  constructor(private readonly config: AppConfig, private readonly logger: Pick<FastifyBaseLogger, 'error'>) {}

  get(id: string) { return this.lectures.get(id); }

  scan(): Promise<OverviewResponse> {
    const scan = this.queue.then(() => this.scanFiles());
    this.queue = scan.catch(() => undefined);
    return scan;
  }

  private async scanFiles(): Promise<OverviewResponse> {
    const result: OverviewResponse = { modules: [] };
    const next = new Map<string, { pdfPath: string; summary: LectureSummary }>();
    await safePath(this.config.dataRoot, this.config.moduleRoot);
    await safePath(this.config.dataRoot, this.config.notesRoot);
    const modules = (await entries(this.config.moduleRoot)).filter((entry) => entry.isDirectory()).sort((a, b) => naturalCompare(a.name, b.name));
    for (const module of modules) {
      const modulePath = containedPath(this.config.moduleRoot, module.name);
      await safePath(this.config.moduleRoot, modulePath);
      const lectures: LectureSummary[] = [];
      const files = (await entries(modulePath)).filter((entry) => entry.isFile() && /\.pdf$/i.test(entry.name)).sort((a, b) => naturalCompare(a.name, b.name));
      for (const file of files) {
        const sourcePdf = `module/${module.name}/${file.name}`;
        const pdfPath = containedPath(modulePath, file.name);
        const title = file.name.slice(0, -4);
        const summary: LectureSummary = { id: lectureId(sourcePdf), title, pageCount: null };
        try {
          if (!title || title === '.' || title === '..') throw new Error('Ungültiger PDF-Dateiname.');
          await safePath(this.config.moduleRoot, pdfPath);
          const metaPath = containedPath(this.config.notesRoot, module.name, title, 'meta.json');
          await safePath(this.config.notesRoot, metaPath);
          const previous = await cachedMeta(metaPath);
          const info = await stat(pdfPath);
          if (previous?.sourcePdf === sourcePdf && previous.sourceSize === info.size && previous.sourceMtimeMs === info.mtimeMs) {
            summary.pageCount = previous.pageCount;
          } else {
            const data = await readFile(pdfPath);
            const sourceSha256 = createHash('sha256').update(data).digest('hex');
            const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
            const task = getDocument({ data: new Uint8Array(data), useSystemFonts: false });
            try {
              const pdf = await task.promise;
              summary.pageCount = pdf.numPages;
            } finally {
              await task.destroy();
            }
            const meta: Metadata = {
              ...previous,
              schemaVersion: 1, module: module.name, lecture: title, sourcePdf, sourceSha256,
              acceptedSha256: previous?.acceptedSha256 ?? sourceSha256,
              pageCount: summary.pageCount, pagesWithoutText: [], completed: previous?.completed ?? false,
              sourceSize: info.size, sourceMtimeMs: info.mtimeMs,
            };
            try {
              await writeJson(this.config.notesRoot, metaPath, meta);
            } catch (err) {
              this.logger.error({ err, lectureId: summary.id, sourcePdf }, 'Metadaten konnten nicht gespeichert werden');
              summary.error = 'Metadaten konnten nicht gespeichert werden. Zugriffsrechte prüfen.';
            }
          }
        } catch (err) {
          this.logger.error({ err, lectureId: summary.id, sourcePdf }, 'PDF konnte nicht eingelesen werden');
          summary.pageCount = null;
          summary.error = 'PDF konnte nicht eingelesen werden. Datei und Zugriffsrechte prüfen (ggf. passwortgeschützt).';
        }
        lectures.push(summary);
        next.set(summary.id, { pdfPath, summary });
      }
      result.modules.push({ name: module.name, lectures });
    }
    this.lectures = next;
    return result;
  }
}
