# Ergänzungen zum Konzept 0.1

Stand: 10. Oktober 2026. Grundlage: Konzept in `Ohne Titel.rtf` und anschließende Klärung mit dem Nutzer. Diese Ergänzung dokumentiert die geklärten Anforderungen; sie startet noch keine Implementierung. Bei Abweichungen haben die hier dokumentierten neueren Nutzerentscheidungen Vorrang.

## Erstes Etappenziel und Generierung

- Zunächst Eichenfurt als vernetztes Weltenbauwerkzeug mit ungefähr 30 Einwohnern, Haushalten, Familien, Berufen, POIs und Übersichten entwickeln.
- Danach folgt eine einfache spielbare Solo-Session. Vollständige Regelautomatisierung ist dafür noch keine Voraussetzung.
- Offline-Generierung beginnt mit strukturierten Einstellungen, Vorlagen und editierbaren Tabellen. Freitext beschreibt die Welt; seine automatische Übersetzung in Generatorvorgaben ist zunächst keine Anforderung.
- Optional kann später KI bei der Übersetzung von Beschreibungen in vorgeschlagene Einstellungen helfen. Die Generierung bleibt unabhängig davon nutzbar.

## Beziehungen und manuelle Bearbeitung

- Ein Button „Beziehungen anpassen“ soll die Auswahl des Beziehungstyps und vorhandener passender Entitäten aus der jeweiligen Welt beziehungsweise Kampagne ermöglichen.
- Änderungen werden in den betroffenen Notizen konsistent nachgeführt. Direkte YAML-Bearbeitung bleibt unterstützt und wird ebenfalls abgeglichen.
- Gegenbeziehungen richten sich nach dem Beziehungstyp. Eltern/Kind ist eine Gegenbeziehung; einseitige Zuneigung wird nicht automatisch erwidert.
- Bei widersprüchlichen Angaben fragt ein Dialog nach, statt stillschweigend vorhandene Informationen zu überschreiben.
- Der Abgleich gilt innerhalb des jeweiligen Welt- oder Kampagnenstandes. Er darf keine getrennten Kampagnenstände unbeabsichtigt verändern.
- Die technische Speicherung maßgeblicher Beziehungen und abgeleiteter Gegenreferenzen ist noch festzulegen.

## Welten, Kampagnen und zeitliche Einordnung

- Kampagnen können unabhängig voneinander sein und unterschiedliche Spielercharaktere haben.
- Eine Kampagne kann zeitlich vor, nach oder parallel zu einer anderen spielen. Zeitliche Reihenfolge bedeutet keine automatische Datenabhängigkeit.
- Eine Fortsetzung kann ausdrücklich einen gespeicherten Stand einer vorherigen Kampagne als Ausgangspunkt übernehmen. Das ist eine Option, keine Pflicht.
- Änderungen in einer Folgekampagne verändern die Quellkampagne nicht rückwirkend. Stirbt eine Figur erst in B, bleibt sie im früheren gespeicherten Stand von A am Leben.
- Eine direkte Fortsetzung übernimmt den gewählten Ausgangszustand, einschließlich bereits geschehener Ereignisse.
- Ein zeitlich früherer Kampagnenbeginn bedeutet nicht, dass das Plugin automatisch aus einem späteren Zustand die gesamte Vergangenheit rekonstruieren muss. Das Verfahren zur Auswahl beziehungsweise Vorbereitung des Ausgangszustands bleibt eine spätere Ausarbeitungsfrage.
- Die technische Entscheidung zwischen vollständigen Kopien, gemeinsamen Vorlagen und kampagnenspezifischen Abweichungen ist noch offen.

## Gezieltes Neuwürfeln

- Bezug: Abschnitt 9.2 des Ausgangskonzepts nennt ausdrücklich Vorschauen und gezieltes Neuwürfeln.
- Manuell bearbeitete Inhalte bleiben standardmäßig geschützt.
- Änderungen sollen vor Übernahme sichtbar sein; Auswirkungen auf verknüpfte Inhalte müssen berücksichtigt und notwendige Folgeänderungen angezeigt werden.

## Geheimnisse und Wissensstände

- Nutzerpräferenz: Callouts verwenden, wo sinnvoll, insbesondere für verborgenes Wissen.
- Gemäß Ausgangskonzept dient der Callout der Darstellung; die Unterscheidung zwischen Weltwissen und Charakterwissen bleibt erforderlich.
- Öffentliche Kurzbeschreibungen und Übersichten sollen keine verborgenen Informationen vorwegnehmen.
- Der genaue Aufbau der Wissensdaten und die Darstellung in der späteren Spieleransicht bleiben auszuarbeiten.

## Plattformen, Builds und Synchronisation

- Konkrete Ziel- und Testplattformen sind Windows, macOS und Android.
- Verbindliche Vorgabe: Builds erfolgen ausschließlich auf GitHub, niemals lokal auf dem MacBook. Grund ist der begrenzte Speicherplatz.
- Bei der Umsetzung ist eine entsprechende GitHub-Build-Pipeline vorzusehen. Auch Probe-, Debug- oder Release-Builds dürfen nicht lokal auf dem MacBook ausgeführt werden.
- Obsidian Sync steht dem Nutzer zur Verfügung. Das konkrete Synchronisations- und Konfliktverhalten der Plugin-Daten ist bei der Umsetzung zu berücksichtigen.
- iOS war Teil der allgemeinen Vision; es ist aktuell keine vom Nutzer benannte Testplattform. Daraus folgt keine Entscheidung für einen dauerhaften Ausschluss.

## Sprache und Nutzung

- Oberfläche und generierte Inhalte zunächst auf Deutsch.
- Einheitliche englische YAML-Feldnamen sind akzeptiert.
- Das Plugin ist zunächst für die persönliche Nutzung vorgesehen. Eine Veröffentlichung ist aktuell kein Entwicklungsziel.

## Beispiel-Vaults und Referenzen

- Die Dateien unter `Obsidian - BSP/` dienen ausschließlich als Inspiration für Inhalte, Aufbau und Bedienung.
- Es besteht kein Auftrag, deren Figuren, Orte oder Kampagnen zu importieren oder weiterzuspielen.
- Der allgemeine spätere Import vorhandener Vaults bleibt Teil der langfristigen Vision; die Beispiel-Vaults sind dafür keine zu migrierenden Nutzerdaten.
- Die im Gespräch bereitgestellten Projektlinks sind Referenzen. Daraus folgt weder eine Pflichtabhängigkeit noch eine Entscheidung zur Codeübernahme.
- Vor konkreter Codeübernahme werden technische Eignung und Lizenz geprüft, wie im Ausgangskonzept vorgesehen.

## Später zu konkretisieren

- GitHub-Repository und Einrichtung der Build-Pipeline vor dem ersten Build.
- Installierte Obsidian-Versionen und konkrete Testumgebung vor Plattformtests.
- Speicherformat, Konfliktbehandlung und Wiederherstellung für verknüpfte Dateiänderungen.
- Bedienung und Ausgangszustände für unabhängige, frühere und aufeinanderfolgende Kampagnen.

Diese Punkte sind Ausarbeitungsaufgaben und ändern die oben geklärten Produktentscheidungen nicht.
