export interface DiceResult {
  expression: string;
  rolls: number[];
  modifier: number;
  total: number;
}

export function rollDice(expression: string, random: () => number = Math.random): DiceResult {
  const normalized = expression.trim().replace(/\s+/g, "").toLowerCase();
  const match = /^(\d*)d(\d+)([+-]\d+)?$/.exec(normalized);
  if (!match) throw new Error("Ungültige Würfelnotation. Beispiel: 1d20+3");
  const count = Number(match[1] || 1);
  const sides = Number(match[2]);
  const modifier = Number(match[3] || 0);
  if (!Number.isInteger(count) || !Number.isInteger(sides) || count < 1 || count > 100 || sides < 2 || sides > 1000) {
    throw new Error("Erlaubt sind 1–100 Würfel mit 2–1000 Seiten.");
  }
  const rolls = Array.from({ length: count }, () => Math.floor(random() * sides) + 1);
  return { expression: normalized, rolls, modifier, total: rolls.reduce((sum, value) => sum + value, modifier) };
}
