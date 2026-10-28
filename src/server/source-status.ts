import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { cachedMeta, type Registry } from './registry.js';
import type { AppConfig } from './config.js';
import type { WriteQueue } from './write-queue.js';
import { containedPath, safePath, writeJson } from './files.js';
type Lecture = NonNullable<ReturnType<Registry['get']>>;
export class ChangedAgainError extends Error {}
export class SourceStatus {
  constructor(private readonly config: AppConfig, private readonly writes: WriteQueue) {}
  private async path(lecture: Lecture) {
    const path = containedPath(this.config.notesRoot, lecture.module, lecture.summary.title, 'meta.json');
    await safePath(this.config.dataRoot, this.config.notesRoot); await safePath(this.config.notesRoot, path); return path;
  }
  async read(lecture: Lecture) {
    const meta = await cachedMeta(await this.path(lecture));
    return { sourceChanged: Boolean(meta && meta.sourceSha256 !== meta.acceptedSha256),
      ...(meta ? { sourceSha256: meta.sourceSha256, previousPageCount: meta.acceptedPageCount } : {}) };
  }
  accept(lecture: Lecture, expectedHash: string) {
    return this.writes.run(lecture.summary.id, async () => {
      const path = await this.path(lecture); const meta = await cachedMeta(path);
      await safePath(this.config.dataRoot, this.config.moduleRoot); await safePath(this.config.moduleRoot, lecture.pdfPath);
      const actual = createHash('sha256').update(await readFile(lecture.pdfPath)).digest('hex');
      if (!meta || meta.sourceSha256 !== expectedHash || actual !== expectedHash) throw new ChangedAgainError('Die PDF wurde erneut geändert. Bitte neu öffnen und die Zuordnung erneut prüfen.');
      await writeJson(this.config.notesRoot, path, { ...meta, acceptedSha256: expectedHash, acceptedPageCount: meta.pageCount });
      return { sourceChanged: false };
    });
  }
}
