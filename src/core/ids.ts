export function stableId(type: string, seed: string, index: number): string {
  const normalizedSeed = seed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `rpg-${type}-${normalizedSeed || "generated"}-${String(index).padStart(3, "0")}`;
}

export function relationshipId(type: string, from: string, to: string): string {
  return `rpg-rel-${type}-${from}-${to}`;
}
