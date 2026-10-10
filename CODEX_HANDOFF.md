# SoloSidian – Übergabe an Codex

## Auftrag

SoloSidian ist ein persönliches, deutschsprachiges Obsidian-Plugin für vernetzten Weltenbau und Solo-RPGs. Zielplattformen sind Windows, macOS und Android. Builds dürfen wegen des knappen MacBook-Speichers **nicht lokal**, sondern ausschließlich über GitHub Actions laufen.

Repository: `https://github.com/Fenron-dev/SoloSidian`

Der lokale Test-Vault liegt in `Beispielvault/`. Dieser Ordner ist absichtlich in `.gitignore` eingetragen und wird nach erfolgreichen GitHub-Builds mit dem erzeugten Plugin-Artefakt aktualisiert.

## Aktueller Stand

- Aktueller Commit: `93dc69a` (`fix: guard resident migration for unsupported entities`)
- Plugin-Version des letzten öffentlichen Stands: `0.2.6`; der lokale Entwicklungsstand wird als `0.2.7` veröffentlicht.
- Letzter erfolgreicher Build: GitHub Actions Run `38071453616`
- Build-Link: `https://github.com/Fenron-dev/SoloSidian/actions/runs/38071453616`
- Artefakt enthält `main.js` und `manifest.json` und wurde in `Beispielvault/.obsidian/plugins/solosidian/` kopiert.
- `npm run typecheck` und `node --check Beispielvault/.obsidian/plugins/solosidian/main.js` waren erfolgreich.

Nach dem Kopieren muss Obsidian neu geladen werden (`Cmd/Ctrl+P` → **Reload app without saving**), damit nicht noch der alte Plugin-Code im Speicher läuft.

## Bisher implementiert

- Dashboard-Befehl zum Öffnen der Plugin-Ansicht.
- Reproduzierbare Siedlungsgenerierung für Eichenfurt mit stabilen IDs.
- Markdown-Entitäten für Siedlungen, Haushalte, Familien, Personen und POIs.
- Kampagnen-/Journal-Grundfunktionen und Würfeldialog.
- Datenintegritätsprüfung.
- Beziehungsauswahl über „Beziehungen anpassen“.
- Direkte YAML-Änderungen werden erkannt und Gegenbeziehungen nachgeführt.
- Beziehungseigenschaften sind lesbar aufgeteilt:
  `mother`, `father`, `parents`, `sons`, `daughters`, `children`, `siblings`, `partners`, `friends`, `rivals`, `colleagues`, `residents`.
- Alte `relationships`-Objekt-/Stringlisten und der frühere versteckte Beziehungstyp-Kommentar werden migriert.
- Personendateien besitzen `gender`, damit Mutter/Vater beziehungsweise Sohn/Tochter sinnvoll bestimmt werden können.

## Letzter Fehler und Fix

Frühere Versionen behandelten jedes `settlement`-Feld so, als wäre es eine `residents`-Beziehung. Dadurch bekamen Familien und POIs beispielsweise:

```yaml
settlement: "[[Eichenfurt]]"
residents:
  - "[[Eichenfurt]]"
```

Das löste wiederholte Änderungen und teils Endlossynchronisierung aus.

Der aktuelle Code in `src/main.ts` behebt das so:

- `household` und `settlement` werden nur bei `person` als strukturelle Resident-Beziehung ausgewertet.
- Ein eigenes `residents`-Feld ist nur für `person`, `household` und `settlement` gültig.
- Ungültige `residents`-Felder werden bei der Migration gelöscht.
- Auch alte generische `relationships`-Daten dürfen bei Familien/POIs kein `residents`-Feld erneut erzeugen.

Erwartetes Ergebnis für eine Familie: `settlement: [[Eichenfurt]]`, aber kein `residents`-Feld. Der neue Code muss nach dem Reload noch mit dem geöffneten Obsidian-Vault praktisch geprüft werden.

## Wichtige Dateien

- `src/main.ts`: Plugin, Dashboard, Beziehungslesen/-schreiben/-synchronisierung, Migration.
- `src/core/settlement-generator.ts`: Generierung von Eichenfurt und Frontmatter.
- `src/core/validator.ts`: Datenintegritätsprüfung.
- `src/core/types.ts`: gemeinsame Datentypen.
- `src/core/markdown.ts`: Markdown-/Frontmatter-Hilfen.
- `README.md`: Nutzer- und Entwicklungsnotizen.
- `Konzept/Entscheidungen-2026-10-10.md`: geklärte Produktentscheidungen.
- `.github/workflows/build.yml`: einziger Build-Weg.

## Entwicklungsablauf

Lokal erlaubt:

```bash
npm install
npm run typecheck
git diff --check
```

Kein lokales `npm run build` ausführen. Stattdessen committen und pushen; GitHub Actions führt `npm ci`, `npm run typecheck`, `npm run build` aus und lädt `solosidian-plugin-<sha>` hoch. Danach das Artefakt in den Beispielvault kopieren und die JavaScript-Syntax prüfen.

Beispiel:

```bash
gh run list --repo Fenron-dev/SoloSidian --limit 3
gh run watch <RUN_ID> --repo Fenron-dev/SoloSidian --exit-status
gh run download <RUN_ID> --repo Fenron-dev/SoloSidian --name solosidian-plugin-<SHA> --dir /private/tmp/solosidian-artifact
```

## Produktentscheidungen

- Kampagnen können unabhängig, zeitlich davor, danach oder parallel laufen.
- Eine Fortsetzung darf einen gespeicherten Stand übernehmen, verändert die Quellkampagne aber nicht rückwirkend.
- Beziehungen sollen bei Widersprüchen später per Dialog beziehungsweise auswählbarer Anpassung geklärt werden.
- Callouts sind für verborgenes Wissen vorgesehen.
- Beispiel-Vaults unter `Konzept/Obsidian - BSP/` waren nur Inspiration und dürfen nicht als Nutzerdaten importiert werden.
- Die UI und generierten Inhalte sollen zunächst deutsch sein; englische YAML-Feldnamen sind in Ordnung.

## Sinnvolle nächste Aufgabe

1. Mit Version 0.2.7 in Obsidian testen und beobachten, ob Familien-/POI-Dateien nach dem Reload stabil bleiben.
2. Prüfen, ob veraltete Einträge in `settlement.residents` nur einmalig bereinigt werden müssen oder ebenfalls aktiv entfernt werden sollten.
3. Beziehungssynchronisierung mit echten Änderungen testen: Person ↔ Haushalt/Siedlung sowie Mutter/Vater ↔ Sohn/Tochter.
4. Erst danach weitere UI- oder Kampagnenfunktionen ausbauen.

## Startprompt für eine neue Codex-Sitzung

> Arbeite im SoloSidian-Projekt. Lies zuerst `CODEX_HANDOFF.md`, `README.md` und `Konzept/Entscheidungen-2026-10-10.md`. Halte dich daran, dass Builds ausschließlich über GitHub Actions laufen und der ignorierte `Beispielvault` nach jedem erfolgreichen Build aktualisiert wird. Prüfe zuerst den aktuellen Stand und teste anschließend die Beziehungssynchronisierung, besonders `residents` bei Familien, POIs, Haushalten und Siedlungen. Ändere nur nach nachvollziehbarer Prüfung und dokumentiere Build sowie Teststatus auf Deutsch.

## Lokale Erweiterungen nach dem Handoff

Der lokale Entwicklungsstand ergänzt die erste spielbare Session um Orakel, Zufallstabellen, Spielercharakter-Zuordnung, Kampagnenzustand, NPC-Interaktionen, ein Standard-Regelprofil für Proben sowie eine kleine Hexmap mit Bewegung und Positionsspeicherung. Beziehung-Wikilinks werden innerhalb des Welt-/Kampagnenscopes aufgelöst und mit Pfadreferenz geschrieben, damit gleichnamige Entitäten getrennt bleiben. Direkte widersprüchliche YAML-Beziehungsänderungen öffnen vor der Gegenbeziehungssynchronisierung einen Auswahl-Dialog. `npm run typecheck` und `npm test` laufen erfolgreich; der Produktions-Build bleibt dem GitHub-Workflow vorbehalten.
