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

Die +/−-Tasten an jeder Folie vergrößern ihren Inhalt direkt neben den Notizen
von 100 bis 400 %. Der Folienrahmen und die Notizzeile behalten beim Zoomen ihre
Größe. Ausschnitte lassen sich mit gedrückter Maustaste verschieben oder scrollen;
mit − geht es zurück bis 100 % (ganze Folie). Der Zoom gilt je Folie und bleibt beim
Scrollen innerhalb der geöffneten Vorlesung erhalten. Bei 100 % scrollt das
Mausrad weiterhin die Vorlesungsansicht. Die Bitmap ist je Folie auf etwa
8 Megapixel begrenzt und wird weiterhin nur im sichtbaren Umfeld gerendert.

„Vergrößern“ an einer Folie öffnet zusätzlich eine große Detailansicht. Mit +/− lässt sich
die Folie von 100 bis 400 % vergrößern; 100 % bedeutet die ganze Folie im Fenster.
Vergrößerte Bereiche lassen sich mit gedrückter Maustaste verschieben oder über
Scrollleisten, Mausrad und Pfeiltasten erkunden.
„Schließen“ oder `Esc` führt zur unveränderten Leseposition zurück. Die PDF wird
bei Zoom und Fensteränderungen neu gerendert; die zusätzliche Bitmap ist auf
etwa 16 Megapixel begrenzt.

- `Alt+↓` / `Alt+↑`: nächste/vorherige Folie mit Fokus im Notizfeld.
- `Esc`: Notizfeld verlassen; Pfeiltasten scrollen wieder die Ansicht.
- `Strg+G` oder der Folienzähler: zu einer Foliennummer springen.
- `Strg+S`: ausstehende Notizen sofort speichern.

Nach dem Laden liegt der Fokus im zuletzt aktiven Notizfeld mit der gespeicherten
Cursorauswahl. Bei einer erstmals geöffneten Vorlesung ist das Folie 1;
die Kürzel sind sofort nutzbar.

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

## Notizen und Autosave (Phase 3)

Notizen sind reiner Text. Sie werden 600 ms nach der letzten Eingabe sowie sofort
beim Verlassen des Notizfelds, bei Tastaturnavigation und mit `Strg+S` gespeichert.
Der Status zeigt „Ungespeichert“, „Speichert …“, „Gespeichert“ oder einen Fehler.
Bei Fehlern bleibt der Text im Browser; „Wiederholen“ oder ein automatischer
Versuch nach fünf Sekunden stößt das Speichern erneut an. Beim Ausblenden oder
Verlassen der Seite werden ausstehende Notizen per Keepalive-Request geflusht.
Ungespeicherte Änderungen lösen eine Warnung beim Schließen aus; ein Wechsel zur
Übersicht wartet auf die Speicherung und bleibt bei Fehlern oder Konflikten in
der Vorlesung.

„Stichpunkte“ über einem Notizfeld aktiviert den Listenmodus für dieses Feld und
ergänzt `- ` an der aktuellen Zeile. `Enter` setzt auch leere Punkte auf gleicher
Ebene fort; `Tab` rückt um vier Leerzeichen ein, `Umschalt+Tab` wieder aus.
Eine Textauswahl bleibt beim Ein-/Ausrücken erhalten. `Rücktaste` rückt einen
leeren Punkt aus; auf oberster Ebene bleibt sie ohne Wirkung und erhält den Marker.
`Umschalt+Enter` erzeugt eine Fortsetzungszeile innerhalb des Punktes.
Nur erneutes Anklicken von „Stichpunkte“ beendet den Modus, ohne Textänderung.
Außerhalb des Modus gelten die normalen Tastenfunktionen. Der Modus wird nicht
gespeichert; der eingegebene Text bleibt als einfache Markdown-Liste erhalten.

Lange Stichpunkte umbrechen im Notizeditor automatisch unter dem ersten Zeichen
nach dem Listenmarker – auch auf verschachtelten Ebenen und bei vorhandenen
Notizen, unabhängig vom Stichpunktmodus. Dieser hängende Einzug betrifft nur die
Anzeige: Weder zusätzliche Zeilenumbrüche noch Leerzeichen werden gespeichert.
Der lokal gebündelte CodeMirror-Editor unterstützt Klartext-Einfügen sowie
`Strg+Z` und `Strg+Umschalt+Z`/`Strg+Y` zum Rückgängig machen und Wiederholen.

„Nicht relevant“ ersetzt das Notizfeld durch „Keine relevanten Informationen
enthalten“. Vorhandener Text wird erst nach einer eigenen Bestätigung verworfen;
Abbrechen oder `Esc` erhält ihn. Erneutes Anklicken öffnet ein leeres Notizfeld.
Gespeichert wird der Klartextmarker `- Nicht relevant`. Bereits vorhandene Notizen,
die ausschließlich diesen Marker enthalten (unabhängig von Groß-/Kleinschreibung),
erscheinen beim Laden automatisch in dieser Ansicht, ohne Datenmigration.
Stichpunkte sind dort deaktiviert; Speicherfehler und Konflikte bleiben sichtbar.

„Kopieren“ öffnet die Auswahl einer Quellfolie derselben Vorlesung und übernimmt
deren aktuellen Notiztext, einschließlich lokaler Entwürfe. Vorhandener Zieltext
wird erst beim ausdrücklich beschrifteten Bestätigen ersetzt. Die Kopie bleibt
unabhängig von späteren Änderungen an der Quelle. Leere Quellen, dieselbe Folie
und Quellen mit ungelöstem Konflikt werden abgewiesen. Auch „Nicht relevant“-Notizen
lassen sich kopieren; die passende Ansicht wird automatisch gewählt.

Die Datei `notes/<Modul>/<Vorlesung>/notes.md` ist die Quelle der Notizen. Sie
enthält nur nicht-leere Notizblöcke, numerisch nach Seite sortiert. Marker stehen
jeweils auf einer eigenen Zeile. Marker im Nutzertext werden mit einem zusätzlichen
Backslash geschützt; Zeilenenden werden zu LF normalisiert. Generierte
Folienüberschriften bestimmen nicht die Zuordnung; maßgeblich ist der Marker.

Externe Bearbeitung ist möglich: Der Server liest die Datei bei jedem Schreiben
innerhalb einer Queue pro Vorlesung frisch ein und verändert nur die gewählte
Seite. Ein Hash des zuvor geladenen Seitentexts erkennt Konflikte auf derselben
Seite (`409`). Die Oberfläche zeigt beide Fassungen und bietet „Eigene behalten“,
„Datei übernehmen“ und „Beide zusammenfügen“. Änderungen an anderen Seiten bleiben
erhalten. Bei kaputten Markern erscheint eine Fehlermeldung mit Zeilennummer;
die Vorlesung bleibt bis zur Reparatur und „Datei erneut prüfen“ schreibgeschützt.
Bereits eingegebener Text bleibt dabei sichtbar und kopierbar.

Schreibvorgänge verwenden eine zufällige temporäre Datei im selben Verzeichnis,
`fsync` und anschließend `rename`. Bei Windows-Fehlern `EPERM`/`EBUSY` gibt es
höchstens fünf Versuche mit kurzem Backoff. PDFs werden ausschließlich gelesen.

`npm test` prüft die Roundtrips einschließlich Marker-Escaping, Leerzeilen,
CRLF und Umlauten sowie 20 parallele PUTs, externe Änderungen an derselben und
anderen Seiten und simulierte Windows-Schreibfehler. Die Browsertests prüfen
zusätzlich Autosave über Reload, Konfliktentscheidungen, Fehlerwiederholung,
Reparatur und die sofort nutzbaren Tastaturkürzel.

## Resume und Fortschritt (Phase 4)

Die App speichert `state.json` neben `notes.md`: sichtbare Folie und relativen
Versatz in der gemeinsamen Folienzeile, zuletzt aktives Notizfeld, Cursor bzw.
Textauswahl und höchste besuchte Seite (`maxPageVisited`). Beim Öffnen entsteht
zuerst das vollständige Seitenlayout; danach wird gescrollt und das gespeicherte
Notizfeld mit `preventScroll` fokussiert. Auch bei geänderter Fensterbreite bleibt
der relative Versatz erhalten. Cursorpositionen werden auf den vorhandenen Text
begrenzt, Seiten auf den gültigen PDF-Bereich.

Beim Scrollen, Fokussieren und Ändern der Auswahl wird höchstens alle 1,5 Sekunden
geschrieben, mit Nachlauf für den letzten Stand. `pagehide` und Ausblenden der
Seite lösen sofort einen Keepalive-Request aus; der Wechsel zur Übersicht wartet
auf den letzten Stand. State-Dateien werden atomar mit derselben Schreib-Queue
wie Notizen und Metadaten geschrieben. Zeitstempel verhindern, dass verspätete
Requests neuere Positionen überschreiben. Fehler erscheinen separat von
Notiz-Speicherfehlern und können erneut versucht werden.

Der Haken „erledigt“ speichert eine manuelle Markierung in `meta.json`. Er setzt
keine besuchte Seite voraus und bleibt bei erneutem Scan erhalten. Ein Fehler
setzt den Haken zurück und zeigt eine Meldung. Die Startseite zeigt die höchste
besuchte Folie getrennt von der Zahl nicht-leerer Notizen sowie unter „Weiter mit“
die zuletzt geöffnete oder bearbeitete Vorlesung. Zurückscrollen verringert den
Fortschritt nicht. Eine Folie zählt erst nach mindestens drei Sekunden
ununterbrochener Sichtbarkeit im sichtbaren Tab oder sobald ihre Notiz bearbeitet
wurde. Kurzes Durchscrollen, Fokus und Sprünge per `Strg+G` zählen allein nicht.

Die Phase-4-Browser-Abnahme schließt den Tab bei Folie 13 mit halbem Seitenversatz
und Cursorposition 84, beendet den echten Node-Serverprozess, startet ihn mit
demselben Datenordner neu und öffnet die Vorlesung über „Weiter mit“. Zusätzlich
werden unabhängige Scroll- und Fokuspositionen, andere Fensterbreiten, der
Scroll-Throttle und Fehler beim Erledigt-Speichern geprüft.

## KI-Lesbarkeit (Phase 5)

Nach einem Scan läuft die Textextraktion für alle PDFs im Hintergrund, jeweils
eine PDF zur Zeit. Sie wartet nicht darauf, dass eine Vorlesung geöffnet wird,
und blockiert die Übersicht nicht. Unter `notes/<Modul>/<Vorlesung>/source.md`
steht der Folientext mit eindeutigen Überschriften `## Seite N`, SHA-256,
Erzeugungszeitpunkt und einem Hinweis auf das maßgebliche PDF. Textfragmente werden
über Zeilenenden und ihre vertikale Position zu Zeilen zusammengesetzt.
Leere bzw. nicht als Text lesbare Seiten erhalten einen Platzhalter; deren Nummern
stehen in `meta.json` unter `pagesWithoutText`. Es gibt kein OCR.

Unveränderte Quellen werden auch nach Neustart nicht erneut extrahiert. Der Cache
ist an den PDF-Hash gebunden; eine fehlende generierte Quelldatei wird wieder
angelegt. Wird die PDF während der Extraktion ersetzt, verwirft die App den
veralteten Stand. Fehler werden mit Ursache geloggt, weitere PDFs bleiben in der
Queue. Worker, Schriften und Decoder kommen ausschließlich aus lokalen Dateien.

Die Zeile mit der größten Schrifthöhe in der oberen Seitenhälfte wird als Folientitel in den generierten
`## Folie N · Titel`-Überschriften verwendet. Bestehende Notizen erhalten die Titel
nach der Extraktion; neue bzw. bearbeitete Notizen beim Speichern. Der Nutzertext
bleibt erhalten, auch bei parallelem Schreiben. Kaputte Notizdateien werden
unverändert gelassen und müssen vor einer Aktualisierung repariert werden.
Bei ungeprüfter Quellenänderung (`sourceSha256` ≠ `acceptedSha256`) bleiben die
bisherigen Notiztitel erhalten, auch beim Autosave. Erst „Zuordnung geprüft“
stößt ihre Aktualisierung an; eine noch laufende Extraktion liefert die Titel
anschließend nach. `source.md` wird unabhängig davon weiter aktualisiert.

Identische Zeilen auf mindestens 30 % der Seiten (mindestens zwei verschiedenen
Seiten) gelten als Boilerplate. Sie stehen nur einmal im Kopf von `source.md`
unter „Wiederkehrende Kopf-/Fußzeilen“ und werden nie als Titel verwendet.
Ohne Kandidaten in der oberen Hälfte bleibt die Folienüberschrift ohne Titel.
`meta.json` enthält `sourceTextVersion`; ein veralteter oder unversionierter Cache
wird beim nächsten Serverstart samt vorhandenen generierten Notiztiteln erneuert,
auch wenn der PDF-Hash gleich bleibt. Nutzertext und eigene `CLAUDE.md` bleiben erhalten.

Im Datenordner entstehen zusätzlich:

- `INDEX.md`: Gesamtübersicht mit Seitenzahl, Notizanzahl, Fortschritt, Datum und
  relativen Links. Sie wird nach Scans und gedrosselt nach Speichervorgängen atomar
  aktualisiert.
- `CLAUDE.md`: Hinweise zur Dateistruktur, Seitenzuordnung, Eigentümerschaft der
  Notizen und Antworten mit Fundstellen. Die App legt diese Datei ausschließlich
  mit exklusivem Erstellen an. Eine vorhandene Datei wird **nie überschrieben**,
  auch wenn `DATA_ROOT` das Code-Repo selbst ist.

Die Vorlage weist darauf hin, `notes/.relink-backups/` und
`notes/.relink-staging/` als Sicherungskopien bei Inhaltsfragen zu ignorieren.
Fehlt dieser Hinweis in einer vorhandenen `CLAUDE.md`, nennt das Server-Log
beim Start den Dateipfad und den zu ergänzenden Hinweis.

Für Inhaltsfragen kann ein KI-Agent direkt im Datenordner gestartet werden.
`notes.md` und `source.md` sind über dieselbe 1-basierte Seitennummer zugeordnet.
Diagramme und Seiten ohne extrahierbaren Text müssen im PDF nachgeschlagen werden.
Die Browser-Abnahme prüft offene Fragen und Folientexte anhand der erzeugten
Dateien, einschließlich PDFs, die nie geöffnet wurden, sowie eigene Ergänzungen
an der Datenordner-`CLAUDE.md`.

## Robustheit (Phase 6)

Beim Öffnen und erneuten Einlesen erkennt die App ersetzte PDFs. Weicht deren
Hash von der zuletzt bestätigten Quelle ab, zeigt sie „Quelle geändert“ mit
vorheriger und aktueller Seitenzahl. Notizen behalten ihre Seitennummern.
„Zuordnung geprüft“ bestätigt genau die angezeigte PDF-Version; eine inzwischen
erneut ersetzte PDF wird mit einer Fehlermeldung abgewiesen. `acceptedPageCount`
in `meta.json` hält die zuletzt bestätigte Seitenzahl fest.

Notizen oberhalb der aktuellen Seitenzahl stehen unter „Notizen ohne Folie“.
Sie lassen sich weiter bearbeiten und kopieren, einschließlich Autosave und
Konfliktauflösung. Der separate Schreibendpunkt `detached-notes/:page` erlaubt
ausschließlich bereits vorhandene Notizseiten außerhalb der PDF.

Umbenannte, verschobene oder gelöschte PDFs hinterlassen „Notizen ohne PDF“ in
der Übersicht und im `INDEX.md`. Ein identischer PDF-Hash erzeugt den Vorschlag
„umbenannt?“. „Mit PDF verknüpfen…“ ordnet den Ordner erst nach Auswahl und
Bestätigung einer PDF zu. Ziele mit Notizen oder eigenen Dateien werden nicht
überschrieben. Eigene Dateien im ursprünglichen Ordner bleiben erhalten.
Der Relink bereitet die neue Zuordnung separat vor, prüft zwischenzeitliche
Notizänderungen und bewahrt Original- und Zielordner unter
`notes/.relink-backups/<Kennung>/` auf. Bei einem fehlgeschlagenen Verschieben
werden die Ordner zurückgesetzt; Sicherungen bleiben auch bei einem
fehlgeschlagenen Zurücksetzen erhalten. PDFs werden dabei ausschließlich gelesen.

Alle HTTP-Anfragen benötigen einen lokalen `Host` mit dem tatsächlichen
Server-Port. Schreibende Anfragen benötigen außerdem `Content-Type:
application/json` und einen `Origin` wie `http://127.0.0.1:3000` oder
`http://localhost:3000` (bei geändertem Port entsprechend angepasst).
Fehlende oder fremde Origins und Hosts werden abgewiesen; weitergeleitete
Host-Header ersetzen diese Prüfung nicht. Der Vite-Proxy übersetzt ausschließlich
den eigenen lokalen Entwicklungs-Origin auf den Backend-Origin. Eigene
API-Clients müssen die Header ebenfalls explizit setzen.

Die Tests prüfen außerdem defekte und tatsächlich passwortgeschützte PDFs,
beschädigte Notizdateien, parallele Änderungen, Relink-Rollback und Pfadgrenzen.
Die Browser-Abnahme ersetzt, benennt um und löscht Fixture-PDFs und prüft dabei
Notizerhalt, Bearbeitung verwaister Seiten, Bestätigung und Origin-/Host-Schutz.
