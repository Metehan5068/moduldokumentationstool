import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, dirname, relative, resolve } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import type { Citation, CryptographyContent, SourceDocument } from '../shared/api.js';
import { citationReferences } from '../shared/citations.js';
import type { AppConfig } from './config.js';
import { containedPath, safePath, writeJson } from './files.js';
import { cachedMeta, lectureId, type RegisteredLecture } from './registry.js';
import type { WriteQueue } from './write-queue.js';

interface Document extends SourceDocument { path: string; relativePath: string; cache: RegisteredLecture }
export interface CryptoLecture extends RegisteredLecture { crypto: CryptographyContent; markdownPath?: string }
const number = (name: string) => {
  const match = /^Lecture\s+(\d+)(?=\s|[.\-_]|$)/i.exec(name);
  const value = match ? Number(match[1]) : 0;
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
};
const nameKey = (name: string) => name.normalize('NFC').toLowerCase();
const aliasKey = (name: string) => nameKey(name).replace(/ - summary(?=\.pdf$)/, '');

export class CryptographyService {
  documents = new Map<string, Document>();
  constructor(private config: AppConfig, private logger: Pick<FastifyBaseLogger, 'error'>, private writes: WriteQueue) {}

  private async files(root: string): Promise<string[]> {
    await safePath(this.config.moduleRoot, root);
    try { return (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => containedPath(root, entry.name)); }
    catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []; throw err; }
  }
  private async document(path: string, kind: SourceDocument['kind']): Promise<Document> {
    await safePath(this.config.moduleRoot, path);
    const sourcePdf = `module/${relative(this.config.moduleRoot, path).replaceAll('\\', '/')}`;
    const id = lectureId(sourcePdf);
    const cache: RegisteredLecture = { module: '.documents', pdfPath: path, summary: { id, title: id, pageCount: null } };
    const doc: Document = { id, title: basename(path), kind, pageCount: null, path, relativePath: sourcePdf, cache };
    const metaPath = containedPath(this.config.notesRoot, '.documents', id, 'meta.json');
    try {
      await safePath(this.config.notesRoot, metaPath);
      await this.writes.run(id, async () => {
        const previous = await cachedMeta(metaPath);
        const info = await stat(path);
        let meta = previous;
        if (!meta || meta.sourceSize !== info.size || meta.sourceMtimeMs !== info.mtimeMs) {
          const data = await readFile(path);
          const hash = createHash('sha256').update(data).digest('hex');
          const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
          const task = getDocument({ data: new Uint8Array(data), useSystemFonts: false });
          let pageCount: number;
          try { pageCount = (await task.promise).numPages; } finally { await task.destroy(); }
          meta = { ...previous, schemaVersion: 1, module: '.documents', lecture: id, sourcePdf, sourceSha256: hash,
            acceptedSha256: previous?.acceptedSha256 ?? hash, acceptedPageCount: previous?.acceptedPageCount ?? pageCount,
            pageCount, completed: false, pagesWithoutText: [], sourceSize: info.size, sourceMtimeMs: info.mtimeMs };
          doc.pageCount = pageCount; doc.sourceSha256 = hash; doc.sourceChanged = hash !== meta.acceptedSha256;
          await writeJson(this.config.notesRoot, metaPath, meta);
        }
        doc.pageCount = meta.pageCount; doc.sourceSha256 = meta.sourceSha256;
        doc.sourceChanged = meta.sourceSha256 !== meta.acceptedSha256;
      });
    } catch (err) {
      this.logger.error({ err, documentId: id }, 'Cryptography-Quelle konnte nicht eingelesen werden');
      doc.error = `${doc.title}: ${doc.pageCount === null ? 'PDF konnte nicht eingelesen werden.' : 'Metadaten konnten nicht gespeichert werden.'}`;
    }
    cache.summary.pageCount = doc.pageCount;
    return doc;
  }
  async scan(module: string): Promise<CryptoLecture[]> {
    const root = containedPath(this.config.moduleRoot, module);
    const main = await this.files(root);
    const whiteboards = [...await this.files(containedPath(root, 'whiteboard')), ...await this.files(containedPath(root, 'Summary'))].filter((p) => /\.pdf$/i.test(p));
    const markdowns = (await this.files(containedPath(root, 'mds'))).filter((p) => /\.md$/i.test(p));
    const scripts = main.filter((p) => /^mini-script\.pdf$/i.test(basename(p)));
    const documents = new Map<string, Document>();
    for (const path of [...whiteboards, ...scripts]) {
      const doc = await this.document(path, scripts.includes(path) ? 'script' : 'whiteboard'); documents.set(doc.id, doc);
    }
    this.documents = documents;
    const script = scripts.length === 1 ? [...documents.values()].find((d) => d.path === scripts[0]) : undefined;
    const numbers = new Set([...whiteboards, ...markdowns].map((p) => number(basename(p))).filter((n): n is number => n !== undefined));
    const result: CryptoLecture[] = [];
    for (const n of [...numbers].sort((a, b) => a - b)) {
      const title = `Lecture ${n}`;
      const id = lectureId(`module/${module}/lecture/${n}`);
      const boards = [...documents.values()].filter((d) => d.kind === 'whiteboard' && number(d.title) === n);
      const mds = markdowns.filter((p) => number(basename(p)) === n);
      const board = boards.length === 1 ? boards[0] : undefined;
      const warnings: string[] = [];
      if (boards.length > 1) warnings.push(`Mehrere Whiteboards für ${title}; Zuordnung bitte im Datenordner korrigieren.`);
      if (!board && boards.length === 0) warnings.push('Für diese Lecture fehlt das Whiteboard.');
      if (scripts.length !== 1) warnings.push(scripts.length ? 'Mehrere Mini-Skripte gefunden.' : 'mini-script.pdf fehlt.');
      for (const doc of [board, script]) if (doc?.error) warnings.push(doc.error);
      if (mds.length > 1) warnings.push(`Mehrere Markdown-Dateien für ${title}; Zuordnung bitte korrigieren.`);
      let markdown: string | undefined;
      if (mds.length === 1) {
        try { await safePath(root, mds[0]!); markdown = await readFile(mds[0]!, 'utf8'); }
        catch { warnings.push('Markdown-Datei konnte nicht gelesen werden.'); }
      }
      const citations: Citation[] = [];
      if (markdown !== undefined) {
        const parsed = citationReferences(markdown); warnings.push(...parsed.warnings);
        for (const ref of new Set([...parsed.used, ...parsed.definitions.keys()])) {
          const target = parsed.definitions.get(ref);
          const citation: Citation = { id: ref };
          try {
            if (!target) throw new Error('Referenzdefinition fehlt.');
            const match = /^(.*)#page=([1-9]\d*)$/.exec(target);
            if (!match) throw new Error('PDF-Seitenverweis mit #page=N fehlt.');
            const path = decodeURIComponent(match[1]!).replaceAll('\\', '/');
            if (/^(?:[a-z][a-z\d+.-]*:|\/)/i.test(path)) throw new Error('Nur lokale Quellen innerhalb dieses Moduls sind erlaubt.');
            const absolute = containedPath(root, resolve(dirname(mds[0]!), path));
            await safePath(root, absolute);
            let candidates = [...documents.values()].filter((d) => d.path === absolute);
            if (!candidates.length) candidates = [...documents.values()].filter((d) => nameKey(basename(d.path)) === nameKey(basename(path)));
            if (!candidates.length) candidates = [...documents.values()].filter((d) => aliasKey(basename(d.path)) === aliasKey(basename(path)));
            if (candidates.length !== 1) throw new Error(candidates.length ? 'Quelldokument ist mehrdeutig.' : 'Quelldokument wurde nicht gefunden.');
            const doc = candidates[0]!; const page = Number(match[2]);
            if (doc.pageCount === null || page > doc.pageCount || !Number.isSafeInteger(page)) throw new Error('PDF-Seite ist nicht verfügbar.');
            citation.documentId = doc.id; citation.page = page;
          } catch (err) { citation.error = err instanceof Error ? err.message : 'Quelle konnte nicht aufgelöst werden.'; }
          citations.push(citation);
        }
      }
      const crypto: CryptographyContent = { documents: [...documents.values()].map(({ path: _p, relativePath: _r, cache: _c, ...doc }) => doc),
        whiteboardId: board?.id, scriptId: script?.id, markdown, citations, warnings };
      const lecture: CryptoLecture = { module, pdfPath: board?.path ?? script?.path ?? root, markdownPath: mds.length === 1 ? mds[0] : undefined, crypto,
        summary: { id, title, viewKind: 'cryptography', lectureNumber: n, markdownAvailable: markdown !== undefined, pageCount: board?.pageCount ?? 0,
          sourceChanged: [board, script].some((d) => d?.sourceChanged), ...(warnings.length ? { error: warnings.join(' ') } : {}) } };
      const metaPath = containedPath(this.config.notesRoot, module, title, 'meta.json');
      try {
        await safePath(this.config.notesRoot, metaPath);
        await this.writes.run(id, async () => {
          const previous = await cachedMeta(metaPath);
          const hash = board?.sourceSha256 ?? '0'.repeat(64);
          const meta = { ...previous, schemaVersion: 1, module, lecture: title, sourcePdf: board?.relativePath ?? '', sourceSha256: hash,
            acceptedSha256: hash, pageCount: Math.max(1, board?.pageCount ?? 0), pagesWithoutText: [], completed: previous?.completed ?? false,
            sourceSize: 0, sourceMtimeMs: 0 };
          if (JSON.stringify(previous) !== JSON.stringify(meta)) await writeJson(this.config.notesRoot, metaPath, meta);
        });
      } catch (err) {
        this.logger.error({ err, lectureId: id }, 'Cryptography-Metadaten konnten nicht gespeichert werden');
        warnings.push('Lecture-Metadaten konnten nicht gespeichert werden. Zugriffsrechte prüfen.');
        lecture.summary.error = warnings.join(' ');
      }
      result.push(lecture);
    }
    return result;
  }
  async accept(documentId: string, expectedHash: string): Promise<boolean> {
    const doc = this.documents.get(documentId);
    if (!doc) return false;
    return this.writes.run(documentId, async () => {
      await safePath(this.config.moduleRoot, doc.path);
      const actual = createHash('sha256').update(await readFile(doc.path)).digest('hex');
      const path = containedPath(this.config.notesRoot, '.documents', documentId, 'meta.json');
      await safePath(this.config.notesRoot, path);
      const meta = await cachedMeta(path);
      if (!meta || actual !== expectedHash || meta.sourceSha256 !== expectedHash) return false;
      await writeJson(this.config.notesRoot, path, { ...meta, acceptedSha256: expectedHash, acceptedPageCount: meta.pageCount });
      return true;
    });
  }
}
