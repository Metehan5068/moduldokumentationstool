import { randomUUID } from 'node:crypto';
import { mkdir, open, realpath, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { setTimeout } from 'node:timers/promises';

export function containedPath(root: string, ...parts: string[]): string {
  const target = resolve(root, ...parts);
  const rel = relative(resolve(root), target);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error('Pfad liegt außerhalb des Datenordners.');
  }
  return target;
}

/** Auch vorhandene Symlinks/Junctions dürfen nicht aus der Datenwurzel führen. */
export async function safePath(root: string, target: string): Promise<void> {
  containedPath(root, target);
  let existing = target;
  for (;;) {
    try {
      containedPath(await realpath(root), await realpath(existing));
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (existing === resolve(root)) return;
      existing = dirname(existing);
    }
  }
}

export async function writeJson(root: string, target: string, value: unknown): Promise<void> {
  return writeAtomic(root, target, `${JSON.stringify(value, null, 2)}\n`);
}

export async function writeAtomic(root: string, target: string, text: string): Promise<void> {
  await safePath(root, target);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, 'wx');
    try {
      await file.writeFile(text, 'utf8');
      await file.sync();
    } finally {
      await file.close();
    }
    await renameWithRetry(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}
export async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      break;
    } catch (error) {
      if (attempt >= 4 || !['EPERM', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      await setTimeout(25 * (attempt + 1));
    }
  }
}
