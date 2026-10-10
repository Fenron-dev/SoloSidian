export interface BattleToken { id: string; x: number; y: number; label: string; }
export interface BattleMap { width: number; height: number; fog: boolean[][]; tokens: BattleToken[]; }

export function createBattleMap(width: number, height: number, tokens: BattleToken[] = []): BattleMap {
  if (width < 1 || height < 1) throw new Error("Eine Battlemap braucht positive Abmessungen.");
  return { width, height, fog: Array.from({ length: height }, () => Array.from({ length: width }, () => true)), tokens: tokens.map((token) => ({ ...token })) };
}

export function reveal(map: BattleMap, x: number, y: number, radius = 0): BattleMap {
  const fog = map.fog.map((row) => [...row]);
  for (let row = 0; row < map.height; row += 1) for (let column = 0; column < map.width; column += 1) if (Math.abs(column - x) + Math.abs(row - y) <= radius) fog[row][column] = false;
  return { ...map, fog };
}
