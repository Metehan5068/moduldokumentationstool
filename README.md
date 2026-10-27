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
| `npm run test:e2e` | Build und Browser-Abnahme mit Playwright/Chromium |

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
Vorlesungen werden über stabile IDs identifiziert. Fehler beim Einlesen werden
mit Ursache im Server-Log protokolliert. Scheitert nur das Schreiben des
Metadaten-Caches, bleibt die Seitenzahl sichtbar und die PDF lässt sich öffnen.

## Vorlesungsansicht (Phase 2)

Ein Klick auf eine Vorlesung öffnet ihre Folien links und je ein Notizfeld rechts.
Beide stehen in derselben Zeile und scrollen gemeinsam. Lange Notizen scrollen
innerhalb des Felds, sodass das Zeilenlayout stabil bleibt. Der Trenner lässt sich
mit der Maus oder per Tastatur (Links/Rechts, Pos1/Ende) verschieben; das
Spaltenverhältnis wird lokal im Browser gespeichert.

- `Alt+↓` / `Alt+↑`: nächste/vorherige Folie mit Fokus im Notizfeld.
- `Esc`: Notizfeld verlassen; Pfeiltasten scrollen wieder die Ansicht.
- `Strg+G` oder der Folienzähler: zu einer Foliennummer springen.

**Notizen sind in Phase 2 nur vorläufige Entwürfe in der geöffneten Ansicht.**
Sie überleben Scrollen und Spaltenänderungen, werden aber noch nicht gespeichert.
Autosave einschließlich `Strg+S` folgt in Phase 3, Resume und Fortschritt in Phase 4.

Der PDF-Endpunkt `/api/lectures/:id/pdf` unterstützt HTTP-Range-Requests. PDF.js,
Worker, Schriften und Decoder werden lokal gebündelt. Nur sichtbare Folien plus
zwei Nachbarseiten je Richtung erhalten Canvas-Flächen. Beim Verlassen dieses
Bereichs werden Renderaufträge abgebrochen und die Bitmaps freigegeben; die
Notizfelder bleiben eingebunden.

Für die Browser-Abnahme einmal `npx playwright install chromium`, danach
`npm run test:e2e` ausführen. Die Tests erzeugen eine nummerierte PDF mit 132 Seiten
und wechselnden Seitenverhältnissen in `tests/fixtures/.generated/`, prüfen
Zuordnung, Navigation, Trenner, HiDPI, Resize und zweimaliges Durchscrollen
aller Seiten mit begrenzter Canvas-Anzahl und Speicherprüfung. Testdaten und
Ergebnisse werden nicht committed; echte Vorlesungs-PDFs werden nicht verwendet.
