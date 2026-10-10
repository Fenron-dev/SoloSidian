import { stableId, relationshipId } from "./ids.ts";
import type { GeneratedEntity, GeneratedSettlement, RelationshipRecord } from "./types.ts";

const firstNames = [
  { name: "Mara", gender: "female" }, { name: "Jorin", gender: "male" }, { name: "Lio", gender: "male" },
  { name: "Nela", gender: "female" }, { name: "Tomas", gender: "male" }, { name: "Elsa", gender: "female" },
  { name: "Rika", gender: "female" }, { name: "Bram", gender: "male" }, { name: "Hedi", gender: "female" }, { name: "Oskar", gender: "male" },
] as const;
const familyNames = ["Hartmann", "Falk", "Keller", "Morgen", "Stein", "Waldner", "Eber", "Lind"];
const occupations = ["Bauer", "Schmied", "Händlerin", "Wirt", "Fischer", "Heilerin", "Wächter", "Bäcker"];

class Random {
  private state: number;

  constructor(seed: string) {
    this.state = [...seed].reduce((value, character) => ((value * 31) + character.charCodeAt(0)) >>> 0, 2166136261);
  }

  next(max: number): number {
    this.state = (1664525 * this.state + 1013904223) >>> 0;
    return this.state % max;
  }

  pick<T>(values: readonly T[]): T {
    return values[this.next(values.length)];
  }
}

function entity(
  type: GeneratedEntity["type"],
  id: string,
  name: string,
  summary: string,
  frontmatter: GeneratedEntity["frontmatter"],
  body: string,
): GeneratedEntity {
  return { id, type, name, summary, frontmatter, body };
}

function link(id: string, name: string): string {
  // Stable IDs identify entities internally; the initial vault layout uses
  // human-readable filenames so normal Obsidian links remain useful.
  void id;
  return `[[${name}]]`;
}

export function generateSettlement(seed: string, name = "Eichenfurt", population = 30): GeneratedSettlement {
  const random = new Random(seed);
  const settlementId = stableId("settlement", seed, 1);
  const settlement = entity(
    "settlement",
    settlementId,
    name,
    `Kleine, vernetzte Siedlung mit ${population} Bewohnern.`,
    { id: settlementId, type: "settlement", name, summary: `Kleine, vernetzte Siedlung mit ${population} Bewohnern.`, seed },
    "## Überblick\n\nDiese Siedlung wurde reproduzierbar aus einem Seed erzeugt. Alle Entitäten können anschließend manuell bearbeitet werden.\n",
  );

  const pois = ["Zum Kübel", "Alte Schmiede", "Südliche Felder", "Schrein der Quelle"].map((poiName, index) => {
    const id = stableId("poi", seed, index + 1);
    return entity("poi", id, poiName, `${poiName} in ${name}.`, {
      id, type: "poi", name: poiName, summary: `${poiName} in ${name}.`, settlement: link(settlementId, name), seed,
    }, `## Beschreibung\n\nEin wichtiger Ort in ${link(settlementId, name)}.\n`);
  });

  const people: GeneratedEntity[] = [];
  const families: GeneratedEntity[] = [];
  const households: GeneratedEntity[] = [];
  const relationships: RelationshipRecord[] = [];
  const usedFamilyNames = new Set<string>();
  const usedPersonNames = new Set<string>();
  const familyCount = Math.max(4, Math.ceil(population / 5));
  const baseMembers = Math.floor(population / familyCount);
  const extraMembers = population % familyCount;
  let personIndex = 1;

  for (let familyIndex = 1; familyIndex <= familyCount; familyIndex += 1) {
    let surname = random.pick(familyNames);
    if (usedFamilyNames.has(surname)) surname = `${surname} ${familyIndex}`;
    usedFamilyNames.add(surname);
    const familyId = stableId("family", seed, familyIndex);
    const householdId = stableId("household", seed, familyIndex);
    const familyName = `Familie ${surname}`;
    const householdName = `${surnames(surname)} Hof`;
    families.push(entity("family", familyId, familyName, `${familyName} aus ${name}.`, {
      id: familyId, type: "family", name: familyName, summary: `${familyName} aus ${name}.`, settlement: link(settlementId, name), seed,
    }, `## Mitglieder\n\nDie Mitglieder dieser Familie leben teilweise im ${link(householdId, householdName)}.\n`));
    households.push(entity("household", householdId, householdName, `Haushalt der ${familyName}.`, {
      id: householdId, type: "household", name: householdName, summary: `Haushalt der ${familyName}.`, settlement: link(settlementId, name), family: link(familyId, familyName), seed,
    }, `## Bewohner\n\nDieser Haushalt gehört zur ${link(familyId, familyName)}.\n`));

    const members = baseMembers + (familyIndex <= extraMembers ? 1 : 0);
    const familyPeople: GeneratedEntity[] = [];
    for (let memberIndex = 0; memberIndex < members && people.length < population; memberIndex += 1) {
      const personId = stableId("person", seed, personIndex);
      const firstName = random.pick(firstNames);
      let personName = `${firstName.name} ${surname}`;
      if (usedPersonNames.has(personName)) personName = `${personName} ${memberIndex + 2}`;
      usedPersonNames.add(personName);
      const occupation = random.pick(occupations);
      const person = entity("person", personId, personName, `${occupation} aus ${name}.`, {
        id: personId, type: "person", name: personName, summary: `${occupation} aus ${name}.`, settlement: link(settlementId, name), family: link(familyId, familyName), household: link(householdId, householdName), occupation, gender: firstName.gender, seed,
      }, `## Kurzprofil\n\n${personName} arbeitet als ${occupation} und lebt im ${link(householdId, householdName)}.\n\n> [!info]- Verborgenes Wissen\n> Noch nicht festgelegt.\n`);
      people.push(person);
      familyPeople.push(person);
      relationships.push({ id: relationshipId("resident", personId, householdId), type: "resident", from: personId, to: householdId, reciprocalType: "resident", worldId: seed });
      personIndex += 1;
    }
    if (familyPeople.length > 1) {
      for (let i = 1; i < familyPeople.length; i += 1) {
        relationships.push({ id: relationshipId("sibling", familyPeople[0].id, familyPeople[i].id), type: "sibling", from: familyPeople[0].id, to: familyPeople[i].id, reciprocalType: "sibling", worldId: seed });
      }
    }
  }

  for (const person of people) {
    relationships.push({ id: relationshipId("resident", person.id, settlementId), type: "resident", from: person.id, to: settlementId, reciprocalType: "resident", worldId: seed });
  }
  return { settlement, families, households, people, pois, relationships };
}

function surnames(surname: string): string {
  return surname.endsWith("s") ? `${surname}'` : `${surname}s`;
}
