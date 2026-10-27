import { existsSync, mkdirSync } from 'node:fs';
import { loadConfig } from './config.js';
import { buildApp } from './app.js';

const config = loadConfig();

if (!existsSync(config.moduleRoot)) {
  console.warn(`⚠ Kein module/-Ordner gefunden unter: ${config.moduleRoot}\n  DATA_ROOT in .env prüfen.`);
}
// notes/ darf die App selbst anlegen, module/ nie.
if (existsSync(config.dataRoot) && !existsSync(config.notesRoot)) {
  mkdirSync(config.notesRoot);
}
if (!existsSync(config.webRoot)) {
  console.warn('⚠ dist/web fehlt – Oberfläche erst nach "npm run build" verfügbar (im Dev-Modus über Vite :5173).');
}

const app = await buildApp(config);

try {
  await app.listen({ host: config.host, port: config.port });
  console.log(`Moduldokumentationstool läuft auf http://${config.host}:${config.port}`);
  console.log(`Datenordner: ${config.dataRoot}`);
} catch (err) {
  console.error(err);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
