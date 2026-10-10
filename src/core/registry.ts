import type { EntityRecord } from "./types.ts";

export interface RegistryEntry extends EntityRecord {
  path?: string;
}

/** In-memory index used by generators, importers and adapters. */
export class EntityRegistry {
  private readonly entries = new Map<string, RegistryEntry>();

  register(entry: RegistryEntry): void {
    const existing = this.entries.get(entry.id);
    if (existing && existing.path !== entry.path) throw new Error(`Doppelte Entitäts-ID: ${entry.id}`);
    this.entries.set(entry.id, { ...entry });
  }

  registerMany(entries: Iterable<RegistryEntry>): void {
    for (const entry of entries) this.register(entry);
  }

  get(id: string): RegistryEntry | undefined { return this.entries.get(id); }

  findByName(name: string, scope?: Pick<EntityRecord, "worldId" | "campaignId">): RegistryEntry[] {
    return [...this.entries.values()].filter((entry) => entry.name === name
      && (!scope?.worldId || entry.worldId === scope.worldId)
      && (!scope?.campaignId || entry.campaignId === scope.campaignId));
  }

  rename(id: string, name: string): RegistryEntry {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`Unbekannte Entitäts-ID: ${id}`);
    const updated = { ...entry, name };
    this.entries.set(id, updated);
    return updated;
  }

  remove(id: string): boolean { return this.entries.delete(id); }
  values(): RegistryEntry[] { return [...this.entries.values()].map((entry) => ({ ...entry })); }
}
