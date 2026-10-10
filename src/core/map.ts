export type HexDirection = "n" | "ne" | "se" | "s" | "sw" | "nw";

export interface HexCell {
  q: number;
  r: number;
  terrain: string;
  poi?: string;
}

const terrains = ["Wald", "Wiese", "Hügel", "Moor", "Flussufer"];
const offsets: Record<HexDirection, [number, number]> = {
  n: [0, -1], ne: [1, -1], se: [1, 0], s: [0, 1], sw: [-1, 1], nw: [-1, 0],
};

function hash(seed: string): number {
  return [...seed].reduce((value, character) => ((value * 31) + character.charCodeAt(0)) >>> 0, 2166136261);
}

export function generateHexMap(seed: string, radius = 2, pois: string[] = []): HexCell[] {
  const cells: HexCell[] = [];
  let state = hash(seed);
  for (let q = -radius; q <= radius; q += 1) {
    for (let r = -radius; r <= radius; r += 1) {
      if (Math.abs(q + r) > radius) continue;
      state = (1664525 * state + 1013904223) >>> 0;
      const poi = (q === 0 && r === 0) ? pois[0] : pois[cells.length % Math.max(1, pois.length)];
      cells.push({ q, r, terrain: terrains[state % terrains.length], poi: q === 0 && r === 0 ? poi : poi && (state % 7 === 0) ? poi : undefined });
    }
  }
  return cells;
}

export function moveHex(position: string, direction: HexDirection): string {
  const match = /^(-?\d+),(-?\d+)$/.exec(position.trim());
  const q = Number(match?.[1] ?? 0);
  const r = Number(match?.[2] ?? 0);
  const [dq, dr] = offsets[direction];
  return `${q + dq},${r + dr}`;
}

export function hexKey(cell: Pick<HexCell, "q" | "r">): string {
  return `${cell.q},${cell.r}`;
}
