# SoloSidian

SoloSidian ist ein offlinefähiges Obsidian-Plugin für vernetzten Weltenbau und Solo-Rollenspiele.

Der erste Prototyp konzentriert sich auf:

- stabile IDs und normale Markdown-Entitäten,
- eine kleine, reproduzierbare Siedlungsgenerierung,
- Haushalte, Familien, NPCs, POIs und Beziehungen,
- eine Beziehungspflege über eine Obsidian-Ansicht,
- synchronisierte Beziehungen auch bei direkten YAML-Änderungen,
- eine Grundlage für Bases-Übersichten.

## Entwicklung

Die Abhängigkeiten werden lokal nur für Editor-Unterstützung und Tests installiert. Builds für das Plugin werden über GitHub Actions erzeugt und als Artefakt bereitgestellt. Für die gewünschte Arbeitsweise wird auf dem MacBook kein Build ausgeführt.

```bash
npm install
npm run typecheck
```

Der Release-Build läuft in GitHub Actions mit `npm run build`.
