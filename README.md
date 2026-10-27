# Moduldokumentationstool

Lokale Web-App, um Notizen zu Vorlesungsfolien zu schreiben: links die PDF-Folie, rechts die Notiz dazu, Zeile für Zeile.
Alle Daten bleiben lokal und liegen als Markdown/JSON vor, damit sie auch ohne die App (z. B. von einem KI-Agenten) gelesen werden können.

## Voraussetzungen

- Node.js ≥ 22.13 (`node -v`, benötigt von PDF.js)
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

## Modulübersicht (Phase 1)

Die Startseite liest direkte Unterordner von `module/` als Module ein und zeigt deren
PDFs in natürlicher Reihenfolge (z. B. IDS-2 vor IDS-10). Leerzeichen, Kommas,
Umlaute und die Endung `.PDF` werden unterstützt. Unterordner innerhalb eines
Moduls werden nicht durchsucht. „Neu einlesen“ findet hinzugefügte, ersetzte und
entfernte PDFs ohne Server-Neustart.

Unter `notes/<Modul>/<PDF-Dateiname ohne Endung>/meta.json` speichert die App
SHA-256, Seitenzahl sowie Dateigröße und Änderungszeit als Cache. Unveränderte PDFs
werden auch nach einem Neustart nicht erneut gehasht oder geparst. Vorhandene
Notizen bleiben erhalten. Nicht lesbare PDFs erscheinen mit einem Fehlerhinweis.

`GET /api/overview` und `POST /api/rescan` liefern die aktualisierte Übersicht;
Vorlesungen werden über stabile IDs identifiziert. Die Vorlesungsansicht folgt
in Phase 2, Notizen und Fortschritt in den nachfolgenden Phasen.
