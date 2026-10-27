import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface AppConfig {
  /** Wurzel des Code-Repos (dort liegt package.json). */
  appRoot: string;
  /** Datenordner mit module/ und notes/. */
  dataRoot: string;
  moduleRoot: string;
  notesRoot: string;
  /** Gebaute SPA (dist/web). */
  webRoot: string;
  host: string;
  port: number;
}

/** Sucht ab dem Ordner dieser Datei aufwärts nach package.json (funktioniert für src/ und dist/). */
function findAppRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('package.json nicht gefunden – App-Wurzel unbekannt.');
    dir = parent;
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const appRoot = findAppRoot();

  const envFile = join(appRoot, '.env');
  if (env === process.env && existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }

  const rawDataRoot = env.DATA_ROOT?.trim();
  // Ohne DATA_ROOT: Repo-Wurzel selbst (./module, ./notes). Relative Pfade gelten ab Repo-Wurzel.
  const dataRoot = !rawDataRoot
    ? appRoot
    : isAbsolute(rawDataRoot)
      ? resolve(rawDataRoot)
      : resolve(appRoot, rawDataRoot);

  const port = Number.parseInt(env.PORT ?? '3000', 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Ungültiger PORT: ${env.PORT}`);
  }

  return {
    appRoot,
    dataRoot,
    moduleRoot: join(dataRoot, 'module'),
    notesRoot: join(dataRoot, 'notes'),
    webRoot: join(appRoot, 'dist', 'web'),
    // Bewusst fest: die App ist nur lokal erreichbar.
    host: '127.0.0.1',
    port,
  };
}
