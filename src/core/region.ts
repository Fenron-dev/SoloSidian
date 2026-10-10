import { generateHexMap, type HexCell } from "./map.ts";

export interface Region { id: string; name: string; radius: number; cells: HexCell[]; settlements: string[]; }

export function generateRegion(seed: string, name: string, radius = 5, settlements: string[] = []): Region {
  if (radius < 1 || radius > 50) throw new Error("Der Regionsradius muss zwischen 1 und 50 liegen.");
  return { id: `region-${seed.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`, name, radius, cells: generateHexMap(seed, radius, settlements), settlements: [...settlements] };
}
