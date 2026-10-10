# SoloSidian

SoloSidian ist ein offlinefähiges Obsidian-Plugin für vernetzten Weltenbau und Solo-Rollenspiele.

Der erste Prototyp konzentriert sich auf:

- stabile IDs und normale Markdown-Entitäten,
- eine kleine, reproduzierbare Siedlungsgenerierung,
- Haushalte, Familien, NPCs, POIs und Beziehungen,
- eine Beziehungspflege über eine Obsidian-Ansicht,
- synchronisierte Beziehungen auch bei direkten YAML-Änderungen,
- Obsidian-kompatible Beziehungen als einfache Property-Liste mit automatischer Migration älterer YAML-Objektlisten,
- getrennte Beziehungs-Properties für Mutter, Vater, Eltern, Söhne, Töchter, Geschwister, Partner, Freunde, Rivalen und Kollegen,
- eine lokale Datenintegritätsprüfung für Entitäten und Beziehungen,
- ein Dashboard als Einstiegspunkt für Generierung, Beziehungen und Prüfungen,
- unabhängige Kampagnen mit eigenem Journal,
- ein einfacher Würfel-Dialog für Solo-Szenen,
- ein Standardorakel und drei lokale Zufallstabellen,
- NPC-Interaktionen mit Journal-Eintrag und automatisch fortgeschriebenem Kampagnenspielstand,
- ein transparentes Standard-Regelprofil für Proben mit Attribut-, Ausrüstungs- und Schwierigkeitswerten,
- eine kleine deterministische Hexmap mit POI-Links, Bewegung und Positionsspeicherung,
- eine Grundlage für Bases-Übersichten.

## Erster Testablauf

Nach dem Aktivieren des Plugins den Befehl `SoloSidian: Dashboard öffnen` starten. Dort können eine Siedlung und eine Kampagne mit optionalem Spielercharakter angelegt, Journal-Einträge geschrieben, Würfel geworfen, Orakelfragen gestellt, Zufallsereignisse erzeugt, NPC-Interaktionen dokumentiert und Beziehungen bearbeitet werden. Der Kampagnenzustand wird unter `State/Spielstand.md` geführt. Der Befehl `SoloSidian: Datenintegrität prüfen` prüft anschließend alle unterstützten Entitäten im RPG-Ordner.

## Entwicklung

Die Abhängigkeiten werden lokal nur für Editor-Unterstützung und Tests installiert. Builds für das Plugin werden über GitHub Actions erzeugt und als Artefakt bereitgestellt. Für die gewünschte Arbeitsweise wird auf dem MacBook kein Build ausgeführt.

```bash
npm install
npm run typecheck
npm test
```

Der Release-Build läuft in GitHub Actions mit `npm run build`.
