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
type RelationshipRole = "mother" | "father" | "parent" | "son" | "daughter" | "child" | "sibling" | "partner" | "friend" | "rival" | "colleague" | "resident";
type RoleEntry = { id: string; role: RelationshipRole };
const RELATIONSHIP_SEPARATOR = "::";
const RELATIONSHIP_METADATA_PATTERN = /<!-- solosidian-relationship-types:\s*(\{[\s\S]*?\})\s*-->/;
const RELATIONSHIP_PROPERTIES = ["mother", "father", "parents", "sons", "daughters", "children", "siblings", "partners", "friends", "rivals", "colleagues", "residents"] as const;
type RelationshipProperty = typeof RELATIONSHIP_PROPERTIES[number];
const FEMALE_FIRST_NAMES = new Set(["Mara", "Nela", "Elsa", "Rika", "Hedi"]);
const MALE_FIRST_NAMES = new Set(["Jorin", "Lio", "Tomas", "Bram", "Oskar"]);
const PROPERTY_ROLES: Record<RelationshipProperty, RelationshipRole> = {
  mother: "mother", father: "father", parents: "parent", sons: "son", daughters: "daughter", children: "child",
  siblings: "sibling", partners: "partner", friends: "friend", rivals: "rival", colleagues: "colleague", residents: "resident",
};

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
  private relationshipSnapshot = new Map<string, Map<string, RelationshipRole>>();
  private relationshipTypeCache = new Map<string, Map<string, RelationshipRole>>();
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
    this.app.workspace.onLayoutReady(() => { void this.initializeRelationshipData(); });
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
    const generatedRelationships = new Map<string, RoleEntry[]>();
    for (const relationship of generated.relationships) {
      const from = generatedRelationships.get(relationship.from) ?? [];
      from.push({ id: relationship.to, role: this.legacyRole(relationship.type) });
      generatedRelationships.set(relationship.from, from);
      const to = generatedRelationships.get(relationship.to) ?? [];
      to.push({ id: relationship.from, role: this.legacyRole(relationship.reciprocalType ?? relationship.type) });
      generatedRelationships.set(relationship.to, to);
    }
    for (const [id, entries] of generatedRelationships) {
      const file = entityFiles.get(id);
      if (!file) continue;
      await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
        const existing = this.readRoleEntries(file, frontmatter);
        for (const entry of entries) existing.set(entry.id, entry);
        this.writeRoleProperties(frontmatter, existing, file);
      });
    }
    const indexPath = normalizePath(`${root}/State/Beziehungen.md`);
    const names = new Map(entities.map((entity) => [entity.id, entity.name]));
    if (!this.app.vault.getAbstractFileByPath(indexPath)) await this.app.vault.create(indexPath, relationshipsMarkdown(generated.relationships, names));
    const basePath = normalizePath(`${root}/NPCs.base`);
    if (!this.app.vault.getAbstractFileByPath(basePath)) await this.app.vault.create(basePath, `views:\n  - type: table\n    name: Bewohner\n    filters:\n      and:\n        - file.inFolder("${root}/NPCs")\n    order:\n      - file.name\n`);
    new Notice(`${entities.length} Entitäten und ${generated.relationships.length} Beziehungen in ${root} erstellt.`);
  }

  async addRelationship(from: TFile, to: TFile, role: RelationshipRole, reciprocalRole?: RelationshipRole): Promise<void> {
    await this.syncRelationshipPair(from, to, role, reciprocalRole ?? this.reciprocalRole(role, from, to));
    new Notice(`Beziehung zwischen ${from.basename} und ${to.basename} gespeichert.`);
  }

  private captureRelationshipSnapshot(): void {
    for (const file of this.app.vault.getMarkdownFiles()) this.relationshipSnapshot.set(file.path, this.readRelationshipEntries(file));
  }

  private async initializeRelationshipData(): Promise<void> {
    await this.loadRelationshipTypeMetadata();
    this.captureRelationshipSnapshot();
    await this.migrateRelationshipProperties();
  }

  private async loadRelationshipTypeMetadata(): Promise<void> {
    for (const file of this.app.vault.getMarkdownFiles()) {
      const content = await this.app.vault.cachedRead(file);
      const match = RELATIONSHIP_METADATA_PATTERN.exec(content);
      if (!match) continue;
      try {
        const parsed = JSON.parse(match[1]) as Record<string, unknown>;
        const types = new Map<string, RelationshipRole>();
        for (const [id, type] of Object.entries(parsed)) {
          if (typeof type === "string") types.set(id, this.legacyRole(type as RelationshipType));
        }
        this.relationshipTypeCache.set(file.path, types);
      } catch { /* Ignore malformed legacy metadata; the visible links remain usable. */ }
    }
  }

  private async migrateRelationshipProperties(): Promise<void> {
    for (const file of this.app.vault.getMarkdownFiles()) {
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!frontmatter) continue;
      const entries = this.readRoleEntries(file, frontmatter);
      const inferredGender = frontmatter.type === "person" && typeof frontmatter.gender !== "string" ? this.inferGender(frontmatter.name) : null;
      if (entries.size === 0 && !Array.isArray(frontmatter.relationships) && !inferredGender) continue;
      this.relationshipTypeCache.set(file.path, new Map([...entries].map(([id, entry]) => [id, entry.role])));
      await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
        if (inferredGender) frontmatter.gender = inferredGender;
        this.writeRoleProperties(frontmatter, entries, file);
      });
      await this.removeRelationshipTypeMetadata(file);
    }
  }

  private entityId(file: TFile): string {
    const id = this.app.metadataCache.getFileCache(file)?.frontmatter?.id;
    return typeof id === "string" ? id : file.path;
  }

  private readRelationshipEntries(file: TFile): Map<string, RelationshipRole> {
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    return frontmatter ? new Map([...this.readRoleEntries(file, frontmatter)].map(([id, entry]) => [id, entry.role])) : new Map();
  }

  private readRoleEntries(file: TFile, frontmatter: Record<string, unknown>): Map<string, RoleEntry> {
    const entries = new Map<string, RoleEntry>();
    for (const property of RELATIONSHIP_PROPERTIES) {
      const role = PROPERTY_ROLES[property];
      for (const value of this.asList(frontmatter[property])) {
        const target = this.resolveEntityFromValue(value);
        if (target) entries.set(this.entityId(target), { id: this.entityId(target), role });
      }
    }
    for (const property of ["household", "settlement"]) {
      for (const value of this.asList(frontmatter[property])) {
        const target = this.resolveEntityFromValue(value);
        if (target) entries.set(this.entityId(target), { id: this.entityId(target), role: "resident" });
      }
    }
    const raw = frontmatter.relationships;
    if (Array.isArray(raw)) {
      for (const value of raw) {
        const entry = this.parseLegacyRelationshipEntry(value, file);
        if (entry) entries.set(entry.id, entry);
      }
    }
    return entries;
  }

  private asList(value: unknown): unknown[] {
    return Array.isArray(value) ? value : value === undefined || value === null || value === "" ? [] : [value];
  }

  private parseLegacyRelationshipEntry(value: unknown, file?: TFile): RoleEntry | null {
    if (typeof value === "string") {
      const separator = value.indexOf(RELATIONSHIP_SEPARATOR);
      if (separator > 0) {
        const type = value.slice(0, separator);
        const id = value.slice(separator + RELATIONSHIP_SEPARATOR.length);
        if (id && type in RECIPROCAL_TYPES) return this.normalizeRoleEntry({ id, role: this.legacyRole(type as RelationshipType) });
      }
      const linkMatch = /^\[\[([^|\]]+)(?:\|[^\]]+)?\]\]$/.exec(value.trim());
      if (linkMatch) {
        const target = this.resolveEntity(linkMatch[1]);
        if (!target) return null;
        const targetId = this.entityId(target);
        const role = file ? this.relationshipTypeCache.get(file.path)?.get(targetId) : undefined;
        return { id: targetId, role: role ?? this.inferRelationshipRole(target) };
      }
      return null;
    }
    if (value && typeof value === "object") {
      const candidate = value as Partial<RelationshipEntry>;
      if (typeof candidate.id === "string" && typeof candidate.type === "string" && candidate.type in RECIPROCAL_TYPES) {
        return this.normalizeRoleEntry({ id: candidate.id, role: this.legacyRole(candidate.type as RelationshipType) });
      }
    }
    return null;
  }

  private legacyRole(type: RelationshipType): RelationshipRole {
    return type === "parent-child" ? "parent" : type;
  }

  private normalizeRoleEntry(entry: RoleEntry): RoleEntry {
    const target = this.resolveEntity(entry.id);
    return target ? { id: this.entityId(target), role: entry.role } : entry;
  }

  private resolveEntityFromValue(value: unknown): TFile | null {
    if (typeof value !== "string") return null;
    const linkMatch = /^\[\[([^|\]]+)(?:\|[^\]]+)?\]\]$/.exec(value.trim());
    return this.resolveEntity(linkMatch ? linkMatch[1] : value);
  }

  private inferRelationshipRole(target: TFile): RelationshipRole {
    const type = this.app.metadataCache.getFileCache(target)?.frontmatter?.type;
    return type === "household" || type === "settlement" ? "resident" : "friend";
  }

  private inferGender(name: unknown): "male" | "female" | null {
    if (typeof name !== "string") return null;
    const firstName = name.split(/\s+/)[0];
    if (FEMALE_FIRST_NAMES.has(firstName)) return "female";
    if (MALE_FIRST_NAMES.has(firstName)) return "male";
    return null;
  }

  private propertyForRole(role: RelationshipRole): RelationshipProperty {
    if (role === "mother" || role === "father" || role === "parent" || role === "son" || role === "daughter" || role === "child") return role === "parent" ? "parents" : role === "child" ? "children" : role === "son" ? "sons" : role === "daughter" ? "daughters" : role;
    if (role === "sibling") return "siblings";
    if (role === "partner") return "partners";
    if (role === "friend") return "friends";
    if (role === "rival") return "rivals";
    if (role === "colleague") return "colleagues";
    return "residents";
  }

  private writeRoleProperties(frontmatter: Record<string, unknown>, entries: Map<string, RoleEntry>, owner?: TFile): void {
    delete frontmatter.relationships;
    for (const property of RELATIONSHIP_PROPERTIES) delete frontmatter[property];
    const grouped = new Map<string, string[]>();
    for (const entry of entries.values()) {
      const target = this.resolveEntity(entry.id);
      if (!target) continue;
      const property = this.propertyForEntry(entry.role, owner, target);
      const values = grouped.get(property) ?? [];
      values.push(`[[${target.basename}]]`);
      grouped.set(property, values);
    }
    for (const [property, values] of grouped) frontmatter[property] = ["mother", "father", "household", "settlement"].includes(property) ? values[0] : values;
  }

  private propertyForEntry(role: RelationshipRole, owner: TFile | undefined, target: TFile): string {
    if (role === "resident" && owner) {
      const ownerType = this.app.metadataCache.getFileCache(owner)?.frontmatter?.type;
      const targetType = this.app.metadataCache.getFileCache(target)?.frontmatter?.type;
      if (ownerType === "person" && targetType === "household") return "household";
      if (ownerType === "person" && targetType === "settlement") return "settlement";
    }
    return this.propertyForRole(role);
  }

  private async removeRelationshipTypeMetadata(file: TFile): Promise<void> {
    await this.app.vault.process(file, (content) => {
      return content.replace(RELATIONSHIP_METADATA_PATTERN, "").replace(/\n{3,}/g, "\n\n");
    });
  }

  private resolveEntity(reference: string): TFile | null {
    const normalized = reference.replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0];
    return this.app.vault.getMarkdownFiles().find((file) => file.path === reference || this.entityId(file) === reference || file.basename === normalized || file.path.replace(/\.md$/, "") === normalized) ?? null;
  }

  private async reconcileRelationshipFile(file: TFile): Promise<void> {
    const current = this.readRelationshipEntries(file);
    const previous = this.relationshipSnapshot.get(file.path) ?? new Map<string, RelationshipRole>();
    const references = new Set([...previous.keys(), ...current.keys()]);
    this.relationshipSnapshot.set(file.path, current);
    for (const reference of references) {
      const target = this.resolveEntity(reference);
      if (!target || target.path === file.path) continue;
      const nextRole = current.get(reference);
      if (nextRole) {
        await this.syncRelationshipPair(file, target, nextRole, this.reciprocalRole(nextRole, file, target));
      } else if (previous.has(reference)) {
        const previousRole = previous.get(reference)!;
        await this.syncRelationshipPair(file, target, previousRole, this.reciprocalRole(previousRole, file, target), true);
      }
    }
  }

  private async syncRelationshipPair(from: TFile, to: TFile, role: RelationshipRole, reciprocalRole: RelationshipRole, remove = false): Promise<void> {
    const key = [from.path, to.path].sort().join("::");
    if (this.relationshipSyncGuard.has(key)) return;
    this.relationshipSyncGuard.add(key);
    try {
      await this.setRelationshipEntry(from, to, role, remove);
      await this.setRelationshipEntry(to, from, reciprocalRole, remove);
      this.relationshipSnapshot.set(from.path, this.readRelationshipEntries(from));
      this.relationshipSnapshot.set(to.path, this.readRelationshipEntries(to));
    } finally {
      this.relationshipSyncGuard.delete(key);
    }
  }

  private async setRelationshipEntry(file: TFile, target: TFile, role: RelationshipRole, remove: boolean): Promise<void> {
    const targetId = this.entityId(target);
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      const retained = this.readRoleEntries(file, frontmatter);
      retained.delete(targetId);
      if (!remove) retained.set(targetId, { id: targetId, role });
      this.writeRoleProperties(frontmatter, retained, file);
    });
    await this.removeRelationshipTypeMetadata(file);
  }

  private genderOf(file: TFile): "male" | "female" | null {
    const gender = this.app.metadataCache.getFileCache(file)?.frontmatter?.gender;
    return gender === "male" || gender === "female" ? gender : null;
  }

  private reciprocalRole(role: RelationshipRole, from: TFile, to: TFile): RelationshipRole {
    if (role === "mother" || role === "father") return this.genderOf(from) === "male" ? "son" : this.genderOf(from) === "female" ? "daughter" : "child";
    if (role === "son" || role === "daughter") return this.genderOf(from) === "male" ? "father" : this.genderOf(from) === "female" ? "mother" : "parent";
    if (role === "parent") return this.genderOf(from) === "male" ? "son" : this.genderOf(from) === "female" ? "daughter" : "child";
    if (role === "child") return this.genderOf(from) === "male" ? "father" : this.genderOf(from) === "female" ? "mother" : "parent";
    void to;
    return role;
  }

  relationshipRoles(selection: string, from: TFile, to: TFile): [RelationshipRole, RelationshipRole] {
    if (selection === "mother-of") return [this.childRole(to), "mother"];
    if (selection === "father-of") return [this.childRole(to), "father"];
    if (selection === "son-of") return [this.parentRole(to), "son"];
    if (selection === "daughter-of") return [this.parentRole(to), "daughter"];
    if (selection === "parent-of") return ["child", "parent"];
    if (selection === "child-of") return ["parent", "child"];
    const role = selection as RelationshipRole;
    return [role, this.reciprocalRole(role, from, to)];
  }

  private childRole(file: TFile): RelationshipRole {
    return this.genderOf(file) === "male" ? "son" : this.genderOf(file) === "female" ? "daughter" : "child";
  }

  private parentRole(file: TFile): RelationshipRole {
    return this.genderOf(file) === "male" ? "father" : this.genderOf(file) === "female" ? "mother" : "parent";
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
    let from = files[0]; let to = files[1]; let selection = "friend";
    new Setting(this.contentEl).setName("Von").addDropdown((dropdown) => { files.forEach((file) => dropdown.addOption(file.path, file.basename)); dropdown.setValue(from?.path ?? "").onChange((value) => { const selected = files.find((file) => file.path === value); if (selected) from = selected; }); });
    new Setting(this.contentEl).setName("Zu").addDropdown((dropdown) => { files.forEach((file) => dropdown.addOption(file.path, file.basename)); dropdown.setValue(to?.path ?? "").onChange((value) => { const selected = files.find((file) => file.path === value); if (selected) to = selected; }); });
    new Setting(this.contentEl).setName("Beziehung von A zu B").addDropdown((dropdown) => {
      const options: Record<string, string> = {
        friend: "Freund/in",
        partner: "Partner/in",
        sibling: "Geschwister",
        rival: "Rivale/in",
        colleague: "Kollege/Kollegin",
        resident: "Bewohner/in von",
        "mother-of": "A ist Mutter von B",
        "father-of": "A ist Vater von B",
        "son-of": "A ist Sohn von B",
        "daughter-of": "A ist Tochter von B",
        "parent-of": "A ist Elternteil von B",
        "child-of": "A ist Kind von B",
      };
      Object.entries(options).forEach(([value, label]) => dropdown.addOption(value, label));
      dropdown.setValue(selection).onChange((value) => { selection = value; });
    });
    new Setting(this.contentEl).addButton((button) => button.setButtonText("Speichern").setCta().onClick(async () => {
      if (from && to && from.path !== to.path) {
        const [role, reciprocalRole] = this.plugin.relationshipRoles(selection, from, to);
        await this.plugin.addRelationship(from, to, role, reciprocalRole);
      }
      this.close();
    }));
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
