import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, normalizePath } from "obsidian";
import { entityMarkdown, relationshipsMarkdown } from "./core/markdown";
import { generateSettlement } from "./core/settlement-generator";
import type { RelationshipType } from "./core/types";

interface SoloSidianSettings {
  rootFolder: string;
}

const DEFAULT_SETTINGS: SoloSidianSettings = { rootFolder: "RPG" };
type RelationshipEntry = { id: string; type: RelationshipType };

const RECIPROCAL_TYPES: Record<RelationshipType, RelationshipType> = {
  "parent-child": "parent-child",
  partner: "partner",
  sibling: "sibling",
  friend: "friend",
  rival: "rival",
  colleague: "colleague",
  resident: "resident",
};

export default class SoloSidianPlugin extends Plugin {
  settings: SoloSidianSettings = DEFAULT_SETTINGS;
  private relationshipSnapshot = new Map<string, Map<string, RelationshipType>>();
  private relationshipSyncGuard = new Set<string>();

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new SoloSidianSettingTab(this.app, this));
    this.addCommand({ id: "generate-settlement", name: "Siedlung generieren", callback: () => new SettlementModal(this.app, this).open() });
    this.addCommand({ id: "edit-relationship", name: "Beziehung anpassen", callback: () => new RelationshipModal(this.app, this).open() });
    this.addRibbonIcon("network", "SoloSidian: Siedlung generieren", () => new SettlementModal(this.app, this).open());
    this.registerEvent(this.app.metadataCache.on("changed", (file) => { void this.reconcileRelationshipFile(file); }));
    this.app.workspace.onLayoutReady(() => this.captureRelationshipSnapshot());
  }

  async loadSettings(): Promise<void> { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
  async saveSettings(): Promise<void> { await this.saveData(this.settings); }

  async writeSettlement(seed: string, name: string): Promise<void> {
    const safeName = name.trim().replace(/[\\/:*?"<>|]/g, "-") || "Eichenfurt";
    const generated = generateSettlement(seed.trim() || "eichenfurt-001", safeName);
    const root = normalizePath(`${this.settings.rootFolder}/Worlds/${safeName}`);
    const directories = [root, `${root}/Settlements`, `${root}/Familien`, `${root}/Haushalte`, `${root}/NPCs`, `${root}/POIs`, `${root}/State`];
    for (const directory of directories) if (!this.app.vault.getAbstractFileByPath(directory)) await this.app.vault.createFolder(directory);
    const entities = [generated.settlement, ...generated.families, ...generated.households, ...generated.people, ...generated.pois];
    const paths = [
      [generated.settlement, `${root}/Settlements/${safeName}.md`],
      ...generated.families.map((entity) => [entity, `${root}/Familien/${entity.name}.md`] as const),
      ...generated.households.map((entity) => [entity, `${root}/Haushalte/${entity.name}.md`] as const),
      ...generated.people.map((entity) => [entity, `${root}/NPCs/${entity.name}.md`] as const),
      ...generated.pois.map((entity) => [entity, `${root}/POIs/${entity.name}.md`] as const),
    ] as const;
    const worldPath = normalizePath(`${root}/World.md`);
    if (!this.app.vault.getAbstractFileByPath(worldPath)) {
      await this.app.vault.create(worldPath, `---\nid: rpg-world-${safeName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}\ntype: world\nname: ${JSON.stringify(safeName)}\nsummary: ${JSON.stringify(`Weltstand für ${safeName}.`)}\nseed: ${JSON.stringify(seed)}\n---\n\n# ${safeName}\n\nDiese Welt wurde mit SoloSidian angelegt.\n`);
    }
    for (const [entity, path] of paths) {
      if (!this.app.vault.getAbstractFileByPath(normalizePath(path))) await this.app.vault.create(normalizePath(path), entityMarkdown(entity));
    }
    const indexPath = normalizePath(`${root}/State/Beziehungen.md`);
    const names = new Map(entities.map((entity) => [entity.id, entity.name]));
    if (!this.app.vault.getAbstractFileByPath(indexPath)) await this.app.vault.create(indexPath, relationshipsMarkdown(generated.relationships, names));
    const basePath = normalizePath(`${root}/NPCs.base`);
    if (!this.app.vault.getAbstractFileByPath(basePath)) await this.app.vault.create(basePath, `views:\n  - type: table\n    name: Bewohner\n    filters:\n      and:\n        - file.inFolder("${root}/NPCs")\n    order:\n      - file.name\n`);
    new Notice(`${entities.length} Entitäten und ${generated.relationships.length} Beziehungen in ${root} erstellt.`);
  }

  async addRelationship(from: TFile, to: TFile, type: RelationshipType): Promise<void> {
    await this.syncRelationshipPair(from, to, type);
    new Notice(`Beziehung zwischen ${from.basename} und ${to.basename} gespeichert.`);
  }

  private captureRelationshipSnapshot(): void {
    for (const file of this.app.vault.getMarkdownFiles()) this.relationshipSnapshot.set(file.path, this.readRelationshipEntries(file));
  }

  private entityId(file: TFile): string {
    const id = this.app.metadataCache.getFileCache(file)?.frontmatter?.id;
    return typeof id === "string" ? id : file.path;
  }

  private readRelationshipEntries(file: TFile): Map<string, RelationshipType> {
    const raw = this.app.metadataCache.getFileCache(file)?.frontmatter?.relationships;
    const entries = new Map<string, RelationshipType>();
    if (!Array.isArray(raw)) return entries;
    for (const value of raw as RelationshipEntry[]) {
      if (value && typeof value.id === "string" && value.type in RECIPROCAL_TYPES) entries.set(value.id, value.type);
    }
    return entries;
  }

  private resolveEntity(reference: string): TFile | null {
    return this.app.vault.getMarkdownFiles().find((file) => file.path === reference || this.entityId(file) === reference) ?? null;
  }

  private async reconcileRelationshipFile(file: TFile): Promise<void> {
    const current = this.readRelationshipEntries(file);
    const previous = this.relationshipSnapshot.get(file.path) ?? new Map<string, RelationshipType>();
    const references = new Set([...previous.keys(), ...current.keys()]);
    this.relationshipSnapshot.set(file.path, current);
    for (const reference of references) {
      const target = this.resolveEntity(reference);
      if (!target || target.path === file.path) continue;
      const nextType = current.get(reference);
      if (nextType) {
        await this.syncRelationshipPair(file, target, nextType);
      } else if (previous.has(reference)) {
        await this.syncRelationshipPair(file, target, previous.get(reference)!, true);
      }
    }
  }

  private async syncRelationshipPair(from: TFile, to: TFile, type: RelationshipType, remove = false): Promise<void> {
    const key = [from.path, to.path].sort().join("::");
    if (this.relationshipSyncGuard.has(key)) return;
    this.relationshipSyncGuard.add(key);
    try {
      await this.setRelationshipEntry(from, to, type, remove);
      await this.setRelationshipEntry(to, from, RECIPROCAL_TYPES[type], remove);
      this.relationshipSnapshot.set(from.path, this.readRelationshipEntries(from));
      this.relationshipSnapshot.set(to.path, this.readRelationshipEntries(to));
    } finally {
      this.relationshipSyncGuard.delete(key);
    }
  }

  private async setRelationshipEntry(file: TFile, target: TFile, type: RelationshipType, remove: boolean): Promise<void> {
    const targetId = this.entityId(target);
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      const existing = Array.isArray(frontmatter.relationships) ? frontmatter.relationships as RelationshipEntry[] : [];
      const filtered = existing.filter((entry) => entry?.id !== targetId && entry?.id !== target.path);
      if (!remove) filtered.push({ id: targetId, type });
      frontmatter.relationships = filtered;
    });
  }
}

class SettlementModal extends Modal {
  private plugin: SoloSidianPlugin;
  constructor(app: App, plugin: SoloSidianPlugin) { super(app); this.plugin = plugin; }
  onOpen(): void {
    this.contentEl.createEl("h2", { text: "Siedlung generieren" });
    let name = "Eichenfurt"; let seed = "eichenfurt-001";
    new Setting(this.contentEl).setName("Name").addText((text) => text.setValue(name).onChange((value) => { name = value; }));
    new Setting(this.contentEl).setName("Seed").setDesc("Derselbe Seed erzeugt dieselben Ergebnisse.").addText((text) => text.setValue(seed).onChange((value) => { seed = value; }));
    new Setting(this.contentEl).addButton((button) => button.setButtonText("Generieren").setCta().onClick(async () => { await this.plugin.writeSettlement(seed, name); this.close(); }));
  }
  onClose(): void { this.contentEl.empty(); }
}

class RelationshipModal extends Modal {
  private plugin: SoloSidianPlugin;
  constructor(app: App, plugin: SoloSidianPlugin) { super(app); this.plugin = plugin; }
  onOpen(): void {
    this.contentEl.createEl("h2", { text: "Beziehung anpassen" });
    const root = normalizePath(this.plugin.settings.rootFolder).replace(/\/$/, "");
    const files = this.app.vault.getMarkdownFiles().filter((file) => file.path.startsWith(`${root}/`));
    let from = files[0]; let to = files[1]; let type: RelationshipType = "friend";
    new Setting(this.contentEl).setName("Von").addDropdown((dropdown) => { files.forEach((file) => dropdown.addOption(file.path, file.basename)); dropdown.setValue(from?.path ?? "").onChange((value) => { const selected = files.find((file) => file.path === value); if (selected) from = selected; }); });
    new Setting(this.contentEl).setName("Zu").addDropdown((dropdown) => { files.forEach((file) => dropdown.addOption(file.path, file.basename)); dropdown.setValue(to?.path ?? "").onChange((value) => { const selected = files.find((file) => file.path === value); if (selected) to = selected; }); });
    new Setting(this.contentEl).setName("Typ").addDropdown((dropdown) => { ["friend", "partner", "parent-child", "sibling", "rival", "colleague", "resident"].forEach((value) => dropdown.addOption(value, value)); dropdown.setValue(type).onChange((value) => { type = value as RelationshipType; }); });
    new Setting(this.contentEl).addButton((button) => button.setButtonText("Speichern").setCta().onClick(async () => { if (from && to && from.path !== to.path) await this.plugin.addRelationship(from, to, type); this.close(); }));
  }
  onClose(): void { this.contentEl.empty(); }
}

class SoloSidianSettingTab extends PluginSettingTab {
  private plugin: SoloSidianPlugin;
  constructor(app: App, plugin: SoloSidianPlugin) { super(app, plugin); this.plugin = plugin; }
  display(): void {
    this.containerEl.empty();
    new Setting(this.containerEl).setName("RPG-Ordner").setDesc("Wurzelordner für erzeugte Welten und Kampagnen.").addText((text) => text.setValue(this.plugin.settings.rootFolder).onChange(async (value) => { this.plugin.settings.rootFolder = value.trim() || DEFAULT_SETTINGS.rootFolder; await this.plugin.saveSettings(); }));
  }
}
