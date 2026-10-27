# Moduldokumentationstool

Lokale Web-App, um Notizen zu Vorlesungsfolien zu schreiben: links die PDF-Folie, rechts die Notiz dazu, Zeile für Zeile.
Alle Daten bleiben lokal und liegen als Markdown/JSON vor, damit sie auch ohne die App (z. B. von einem KI-Agenten) gelesen werden können.

## Voraussetzungen

- Node.js ≥ 22.12 (`node -v`)
- Ein Datenordner **außerhalb dieses Repos**, z. B.:

```text
Uni-Projekte\
├─ moduldokumentationstool\      ← dieses Repo
└─ moduldokumentation-daten\     ← Daten (nie committen)
   ├─ module\<Modul>\*.pdf
   └─ notes\                     ← legt die App an
```

## Einrichtung

```powershell
copy .env.example .env    # DATA_ROOT bei Bedarf anpassen
npm install
```

## Starten

- **Normal:** `start.cmd` doppelklicken. Baut die App und öffnet http://127.0.0.1:3000.
- **Entwicklung:** `npm run dev` → http://127.0.0.1:5173 (Hot Reload, `/api` wird an :3000 weitergeleitet).

## Befehle

| Befehl | Zweck |
|---|---|
| `npm run dev` | Server (tsx watch) + Vite-Devserver |
| `npm run build` | Server nach `dist/node`, Web nach `dist/web` |
| `npm start` | gebaute App auf 127.0.0.1:3000 |
| `npm run typecheck` | TypeScript-Prüfung (Web + Server) |
| `npm test` | Vitest |

## Datenschutz

PDFs und Notizen gehören nicht in dieses Repo. `.gitignore` schließt `module/`, `notes/` und `*.pdf` zusätzlich aus.
