export type OracleAnswer = "Ja" | "Eher ja" | "Unklar" | "Eher nein" | "Nein";

export interface OracleResult {
  question: string;
  roll: number;
  answer: OracleAnswer;
}

export interface RandomEvent {
  category: string;
  text: string;
}

const answers: OracleAnswer[] = ["Nein", "Eher nein", "Unklar", "Eher ja", "Ja"];

const eventTables: Record<string, string[]> = {
  "Begegnung": [
    "Eine erschöpfte Reisende bittet um Hilfe.",
    "Ein vertrautes Gesicht bringt eine unerwartete Nachricht.",
    "Spuren führen von der Straße in unbekanntes Gelände.",
    "Ein Händler bietet eine seltene Ware an.",
    "Jemand beobachtet die Gruppe aus sicherer Entfernung.",
    "Ein Streit droht in der Nähe zu eskalieren.",
  ],
  "Entdeckung": [
    "Hinter einer losen Steinplatte liegt ein altes Zeichen.",
    "Ein bislang unbekannter Zugang wird sichtbar.",
    "Die Umgebung zeigt Spuren eines vergangenen Ereignisses.",
    "Eine Karte enthält einen widersprüchlichen Hinweis.",
    "Ein verschollen geglaubter Gegenstand taucht wieder auf.",
    "Die Gruppe entdeckt einen sicheren Rastplatz.",
  ],
  "Komplikation": [
    "Ein wichtiger Weg ist versperrt.",
    "Eine Zusage wird kurzfristig zurückgezogen.",
    "Ein Geräusch macht die weitere Reise riskant.",
    "Ein Vorrat reicht nicht so lange wie geplant.",
    "Eine falsche Information bringt die Gruppe auf eine Umleitung.",
    "Das Wetter verschlechtert sich unerwartet.",
  ],
};

export function askOracle(question: string, random: () => number = Math.random): OracleResult {
  const normalized = question.trim() || "Ist die Antwort positiv?";
  const roll = Math.min(answers.length, Math.max(1, Math.floor(random() * answers.length) + 1));
  return { question: normalized, roll, answer: answers[roll - 1] };
}

export function randomEvent(category = "Begegnung", random: () => number = Math.random): RandomEvent {
  const table = eventTables[category] ?? eventTables["Begegnung"];
  const index = Math.min(table.length - 1, Math.max(0, Math.floor(random() * table.length)));
  return { category: eventTables[category] ? category : "Begegnung", text: table[index] };
}

export function oracleCategories(): string[] {
  return Object.keys(eventTables);
}
