# CLAUDE.md – Entwicklung

Lokale Web-App für Notizen zu Vorlesungs-PDFs (Folie links, Notiz rechts, eine Zeile pro Seite).

## Spezifikation

Die vollständige Spezifikation steht in `ENTWICKLUNGSPLAN.md` im Repo-Root. Die Datei ist absichtlich per `.gitignore` ausgeschlossen
(nicht auf GitHub) und taucht deshalb evtl. nicht in Suchergebnissen auf – **direkt per Pfad lesen**. Vor jeder Phase den passenden Abschnitt lesen
und am Ende die Abnahmekriterien der Phase prüfen.

Stand: **Phase 3 (Notizen und Autosave) erledigt.** Nächste: Phase 4 (Resume und Fortschritt).

## Struktur

```text
src/shared/   Typen und API-Verträge (von Server und Web genutzt)
src/server/   Fastify-Server (config.ts, app.ts, index.ts)
src/web/      React-SPA (Vite-Root)
tests/        Vitest
```

- Server: ESM mit `NodeNext` → relative Imports **mit `.js`-Endung** (`'./config.js'`, `'../shared/api.js'`).
- Web: Vite/Bundler-Auflösung → Imports ohne Endung.
- Konfiguration über `.env` (`DATA_ROOT`, `PORT`), geladen mit `process.loadEnvFile`. Host ist fest `127.0.0.1`.
- Testbarkeit: `buildApp(config)` erzeugt die App ohne zu lauschen → in Tests `app.inject()` nutzen.

## Befehle

`npm run dev` · `npm run build` · `npm start` · `npm run typecheck` · `npm test`

Vor jedem Abschluss: `npm run typecheck && npm test && npm run build` müssen grün sein.

## Harte Regeln

- **Niemals** PDFs, `module/`, `notes/`, `.env` oder `ENTWICKLUNGSPLAN.md` committen.
- Die App schreibt **nie** in `module/`. Notizen nur in `notes/`, atomar (siehe Plan 7.3).
- Der Client übergibt nie Dateipfade, nur IDs (Plan 7.2/7.5).
- Keine externen Requests zur Laufzeit (kein CDN, pdf.js lokal bündeln).
- UI-Texte auf Deutsch.
- Für Tests nur kleine, selbst erzeugte Test-PDFs in `tests/fixtures/`, nie echte Vorlesungen.
