export interface DungeonRoom { id: string; x: number; y: number; width: number; height: number; }
export interface DungeonMap { width: number; height: number; rooms: DungeonRoom[]; corridors: Array<[string, string]>; }

function hash(seed: string): number { return [...seed].reduce((value, char) => ((value * 31) + char.charCodeAt(0)) >>> 0, 2166136261); }

export function generateDungeon(seed: string, roomCount = 6): DungeonMap {
  let state = hash(seed);
  const rooms: DungeonRoom[] = [];
  for (let i = 0; i < roomCount; i += 1) {
    state = (1664525 * state + 1013904223) >>> 0;
    rooms.push({ id: `room-${i + 1}`, x: 2 + (state % 40), y: 2 + ((state >>> 8) % 24), width: 3 + (state % 5), height: 3 + ((state >>> 12) % 4) });
  }
  const corridors = rooms.slice(1).map((room, index) => [rooms[index].id, room.id] as [string, string]);
  return { width: 48, height: 32, rooms, corridors };
}
