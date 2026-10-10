import { App, ItemView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf, normalizePath } from "obsidian";
import { entityMarkdown, relationshipsMarkdown } from "./core/markdown";
import { generateSettlement } from "./core/settlement-generator";
import type { RelationshipType } from "./core/types";
import { validateEntities } from "./core/validator";
import { rollDice } from "./core/dice";

interface SoloSidianSettings {
  rootFolder: string;
}

const DEFAULT_SETTINGS: SoloSidianSettings = { rootFolder: "RPG" };
const DASHBOARD_VIEW_TYPE = "solosidian-dashboard";
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
    this.registerView(DASHBOARD_VIEW_TYPE, (leaf) => new DashboardView(leaf, this));
    this.addCommand({ id: "generate-settlement", name: "Siedlung generieren", callback: () => new SettlementModal(this.app, this).open() });
    this.addCommand({ id: "edit-relationship", name: "Beziehung anpassen", callback: () => new RelationshipModal(this.app, this).open() });
    this.addCommand({ id: "validate-vault", name: "Datenintegrität prüfen", callback: () => this.validateVault() });
    this.addCommand({ id: "open-dashboard", name: "Dashboard öffnen", callback: () => { void this.activateDashboard(); } });
    this.addCommand({ id: "create-campaign", name: "Kampagne anlegen", callback: () => new CampaignModal(this.app, this).open() });
    this.addCommand({ id: "create-journal-entry", name: "Journal-Eintrag anlegen", callback: () => new JournalModal(this.app, this).open() });
    this.addCommand({ id: "roll-dice", name: "Würfel werfen", callback: () => new DiceModal(this.app).open() });
    this.addRibbonIcon("network", "SoloSidian: Siedlung generieren", () => new SettlementModal(this.app, this).open());
    this.addRibbonIcon("home", "SoloSidian: Dashboard öffnen", () => { void this.activateDashboard(); });
    this.registerEvent(this.app.metadataCache.on("changed", (file) => { void this.reconcileRelationshipFile(file); }));
    this.app.workspace.onLayoutReady(() => this.captureRelationshipSnapshot());
  }

  async loadSettings(): Promise<void> { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
  async saveSettings(): Promise<void> { await this.saveData(this.settings); }

  async activateDashboard(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(DASHBOARD_VIEW_TYPE)[0];
    const leaf = existing ?? this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: DASHBOARD_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  async createCampaign(name: string, world: TFile | null): Promise<void> {
    const safeName = name.trim().replace(/[\\/:*?"<>|]/g, "-") || "Meine Kampagne";
    const root = normalizePath(`${this.settings.rootFolder}/Campaigns/${safeName}`);
    for (const directory of [root, `${root}/Journal`, `${root}/State`]) {
      if (!this.app.vault.getAbstractFileByPath(directory)) await this.app.vault.createFolder(directory);
    }
    const id = `rpg-campaign-${safeName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    const worldLink = world ? `"[[${world.basename}]]"` : "null";
    const path = normalizePath(`${root}/Campaign.md`);
    if (!this.app.vault.getAbstractFileByPath(path)) {
      await this.app.vault.create(path, `---\nid: ${id}\ntype: campaign\nname: ${JSON.stringify(safeName)}\nsummary: ${JSON.stringify(`Unabhängige Solo-Kampagne ${safeName}.`)}\nworld: ${worldLink}\nstatus: active\n---\n\n# ${safeName}\n\nDiese Kampagne besitzt einen eigenen Spielstand. Änderungen bleiben auf diese Kampagne begrenzt.\n\n## Journal\n\n`);
    }
    new Notice(`Kampagne „${safeName}“ wurde angelegt.`);
  }

  async createJournalEntry(campaign: TFile, text: string): Promise<void> {
    const content = text.trim();
    if (!content) { new Notice("Der Journal-Eintrag ist leer."); return; }
    const campaignRoot = campaign.path.replace(/\/Campaign\.md$/, "");
    const journalFolder = normalizePath(`${campaignRoot}/Journal`);
    if (!this.app.vault.getAbstractFileByPath(journalFolder)) await this.app.vault.createFolder(journalFolder);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await this.app.vault.create(normalizePath(`${journalFolder}/${stamp}.md`), `---\ntype: journal\ncampaign: "[[${campaign.basename}]]"\ncreated: ${new Date().toISOString()}\nsummary: ${JSON.stringify(content.slice(0, 120))}\n---\n\n# ${stamp}\n\n${content}\n`);
    new Notice(`Journal-Eintrag in ${campaign.basename} gespeichert.`);
  }

  validateVault(): void {
    const root = normalizePath(this.settings.rootFolder).replace(/\/$/, "");
    const files = this.app.vault.getMarkdownFiles()
      .filter((file) => file.path.startsWith(`${root}/`))
      .map((file) => ({ path: file.path, frontmatter: this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined }));
    const issues = validateEntities(files);
    if (issues.length === 0) {
      new Notice(`${files.length} Markdown-Dateien geprüft: Keine Datenintegritätsfehler gefunden.`);
      return;
    }
    const firstIssues = issues.slice(0, 3).map((issue) => `${issue.path}: ${issue.message}`).join(" | ");
    new Notice(`${issues.length} Datenintegritätsproblem(e). ${firstIssues}`, 10000);
  }

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
    const entityFiles = new Map(entities.map((entity, index) => [entity.id, this.app.vault.getAbstractFileByPath(normalizePath(paths[index][1]))]).filter((entry): entry is [string, TFile] => entry[1] instanceof TFile));
    const generatedRelationships = new Map<string, Array<{ id: string; type: RelationshipType }>>();
    for (const relationship of generated.relationships) {
      const from = generatedRelationships.get(relationship.from) ?? [];
      from.push({ id: relationship.to, type: relationship.type });
      generatedRelationships.set(relationship.from, from);
      const to = generatedRelationships.get(relationship.to) ?? [];
      to.push({ id: relationship.from, type: relationship.reciprocalType ?? relationship.type });
      generatedRelationships.set(relationship.to, to);
    }
    for (const [id, entries] of generatedRelationships) {
      const file = entityFiles.get(id);
      if (!file || this.app.metadataCache.getFileCache(file)?.frontmatter?.relationships) continue;
      await this.app.fileManager.processFrontMatter(file, (frontmatter) => { frontmatter.relationships = entries; });
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

class DashboardView extends ItemView {
  private plugin: SoloSidianPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: SoloSidianPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string { return DASHBOARD_VIEW_TYPE; }
  getDisplayText(): string { return "SoloSidian Dashboard"; }
  getIcon(): "home" { return "home"; }

  async onOpen(): Promise<void> {
    this.render();
  }

  private render(): void {
    this.contentEl.empty();
    this.contentEl.addClass("solosidian-dashboard");
    this.contentEl.createEl("h2", { text: "SoloSidian" });
    this.contentEl.createEl("p", { text: "Offline-Werkzeuge für Weltenbau und Solo-RPG." });
    const stats = this.getStats();
    this.contentEl.createEl("p", { text: `${stats.entities} Entitäten in ${this.plugin.settings.rootFolder}/ · ${stats.relationships} Beziehungseinträge` });

    const actions = this.contentEl.createDiv({ cls: "solosidian-dashboard-actions" });
    this.addButton(actions, "Siedlung generieren", () => new SettlementModal(this.app, this.plugin).open());
    this.addButton(actions, "Kampagne anlegen", () => new CampaignModal(this.app, this.plugin).open());
    this.addButton(actions, "Journal-Eintrag", () => new JournalModal(this.app, this.plugin).open());
    this.addButton(actions, "Würfel werfen", () => new DiceModal(this.app).open());
    this.addButton(actions, "Beziehung anpassen", () => new RelationshipModal(this.app, this.plugin).open());
    this.addButton(actions, "Datenintegrität prüfen", () => this.plugin.validateVault());
    this.contentEl.createEl("h3", { text: "Schnellstart" });
    const list = this.contentEl.createEl("ol");
    list.createEl("li", { text: "Erzeuge eine kleine Siedlung mit einem reproduzierbaren Seed." });
    list.createEl("li", { text: "Öffne eine NPC-Notiz und folge den Wikilinks zu Familie und Haushalt." });
    list.createEl("li", { text: "Passe eine Beziehung an und prüfe beide beteiligten YAML-Properties." });
  }

  private addButton(parent: HTMLElement, label: string, action: () => void): void {
    const button = parent.createEl("button", { text: label });
    button.addEventListener("click", action);
  }

  private getStats(): { entities: number; relationships: number } {
    const root = normalizePath(this.plugin.settings.rootFolder).replace(/\/$/, "");
    let entities = 0;
    let relationships = 0;
    for (const file of this.app.vault.getMarkdownFiles().filter((candidate) => candidate.path.startsWith(`${root}/`))) {
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!frontmatter || frontmatter.type === "relationship-index") continue;
      entities += 1;
      if (Array.isArray(frontmatter.relationships)) relationships += frontmatter.relationships.length;
    }
    return { entities, relationships };
  }
}

class CampaignModal extends Modal {
  private plugin: SoloSidianPlugin;
  constructor(app: App, plugin: SoloSidianPlugin) { super(app); this.plugin = plugin; }
  onOpen(): void {
    this.contentEl.createEl("h2", { text: "Kampagne anlegen" });
    let name = "Meine Erste Kampagne";
    const worlds = this.app.vault.getMarkdownFiles().filter((file) => this.app.metadataCache.getFileCache(file)?.frontmatter?.type === "world");
    let world: TFile | null = worlds[0] ?? null;
    new Setting(this.contentEl).setName("Name").addText((text) => text.setValue(name).onChange((value) => { name = value; }));
    new Setting(this.contentEl).setName("Welt (optional)").addDropdown((dropdown) => {
      dropdown.addOption("", "Unabhängig");
      worlds.forEach((file) => dropdown.addOption(file.path, file.basename));
      dropdown.setValue(world?.path ?? "").onChange((value) => { world = worlds.find((file) => file.path === value) ?? null; });
    });
    new Setting(this.contentEl).addButton((button) => button.setButtonText("Anlegen").setCta().onClick(async () => {
      const selectedWorld = world;
      await this.plugin.createCampaign(name, selectedWorld);
      this.close();
    }));
  }
  onClose(): void { this.contentEl.empty(); }
}

class JournalModal extends Modal {
  private plugin: SoloSidianPlugin;
  constructor(app: App, plugin: SoloSidianPlugin) { super(app); this.plugin = plugin; }
  onOpen(): void {
    this.contentEl.createEl("h2", { text: "Journal-Eintrag" });
    const campaigns = this.app.vault.getMarkdownFiles().filter((file) => this.app.metadataCache.getFileCache(file)?.frontmatter?.type === "campaign");
    let campaign: TFile | null = campaigns[0] ?? null;
    let text = "";
    new Setting(this.contentEl).setName("Kampagne").addDropdown((dropdown) => { campaigns.forEach((file) => dropdown.addOption(file.path, file.basename)); dropdown.setValue(campaign?.path ?? "").onChange((value) => { campaign = campaigns.find((file) => file.path === value) ?? null; }); });
    new Setting(this.contentEl).setName("Eintrag").addTextArea((area) => area.setPlaceholder("Was ist geschehen?").onChange((value) => { text = value; }));
    new Setting(this.contentEl).addButton((button) => button.setButtonText("Speichern").setCta().onClick(async () => {
      const selectedCampaign = campaign;
      if (selectedCampaign) await this.plugin.createJournalEntry(selectedCampaign, text);
      else new Notice("Lege zuerst eine Kampagne an.");
      this.close();
    }));
  }
  onClose(): void { this.contentEl.empty(); }
}

class DiceModal extends Modal {
  onOpen(): void {
    this.contentEl.createEl("h2", { text: "Würfel werfen" });
    let expression = "1d20+3";
    const result = this.contentEl.createEl("p", { text: "Bereit." });
    new Setting(this.contentEl).setName("Notation").setDesc("Beispiel: 1d20+3").addText((text) => text.setValue(expression).onChange((value) => { expression = value; }));
    new Setting(this.contentEl).addButton((button) => button.setButtonText("Würfeln").setCta().onClick(() => {
      try { const roll = rollDice(expression); result.setText(`${roll.expression}: ${roll.rolls.join(", ")} ${roll.modifier >= 0 ? "+" : ""}${roll.modifier} = ${roll.total}`); }
      catch (error) { result.setText(error instanceof Error ? error.message : "Ungültige Würfelnotation."); }
    }));
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
