import { App, ItemView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf, normalizePath } from "obsidian";
import { entityMarkdown, relationshipsMarkdown } from "./core/markdown.ts";
import { generateSettlement } from "./core/settlement-generator.ts";
import type { RelationshipType } from "./core/types.ts";
import { validateEntities } from "./core/validator.ts";
import { rollDice } from "./core/dice.ts";
import { askOracle, oracleCategories, randomEvent } from "./core/oracle.ts";
import { performCheck, STANDARD_RULESET, type CheckResult } from "./core/rules.ts";
import { generateHexMap, hexKey, moveHex, type HexDirection, type HexCell } from "./core/map.ts";
import { forkCampaign, type CampaignSnapshot } from "./core/campaign.ts";
import { generateDungeon } from "./core/dungeon.ts";

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
    this.log("Plugin geladen");
    this.addSettingTab(new SoloSidianSettingTab(this.app, this));
    this.registerView(DASHBOARD_VIEW_TYPE, (leaf) => new DashboardView(leaf, this));
    this.addCommand({ id: "generate-settlement", name: "Siedlung generieren", callback: () => new SettlementModal(this.app, this).open() });
    this.addCommand({ id: "edit-relationship", name: "Beziehung anpassen", callback: () => new RelationshipModal(this.app, this).open() });
    this.addCommand({ id: "validate-vault", name: "Datenintegrität prüfen", callback: () => this.validateVault() });
    this.addCommand({ id: "open-dashboard", name: "Dashboard öffnen", callback: () => { void this.activateDashboard(); } });
    this.addCommand({ id: "create-campaign", name: "Kampagne anlegen", callback: () => new CampaignModal(this.app, this).open() });
    this.addCommand({ id: "continue-campaign", name: "Kampagne fortsetzen", callback: () => new CampaignContinuationModal(this.app, this).open() });
    this.addCommand({ id: "create-journal-entry", name: "Journal-Eintrag anlegen", callback: () => new JournalModal(this.app, this).open() });
    this.addCommand({ id: "roll-dice", name: "Würfel werfen", callback: () => new DiceModal(this.app).open() });
    this.addCommand({ id: "ask-oracle", name: "Orakel fragen", callback: () => new OracleModal(this.app, this).open() });
    this.addCommand({ id: "npc-interaction", name: "NPC-Interaktion dokumentieren", callback: () => new InteractionModal(this.app, this).open() });
    this.addCommand({ id: "edit-campaign-state", name: "Kampagnenzustand bearbeiten", callback: () => new CampaignStateModal(this.app, this).open() });
    this.addCommand({ id: "run-check", name: "Probe durchführen", callback: () => new CheckModal(this.app, this).open() });
    this.addCommand({ id: "explore-map", name: "Karte erkunden", callback: () => new MapModal(this.app, this).open() });
    this.addCommand({ id: "generate-dungeon", name: "Dungeon generieren", callback: () => new DungeonModal(this.app, this).open() });
    this.addRibbonIcon("network", "SoloSidian: Siedlung generieren", () => new SettlementModal(this.app, this).open());
    this.addRibbonIcon("home", "SoloSidian: Dashboard öffnen", () => { void this.activateDashboard(); });
    this.registerEvent(this.app.metadataCache.on("changed", (file) => { void this.reconcileRelationshipFile(file); }));
    this.app.workspace.onLayoutReady(() => { void this.initializeRelationshipData(); });
  }

  async loadSettings(): Promise<void> { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
  async saveSettings(): Promise<void> { await this.saveData(this.settings); }

  private log(message: string): void {
    console.debug(`[SoloSidian] ${message}`);
  }

  private wikilink(file: TFile): string {
    return `"[[${normalizePath(file.path).replace(/\.md$/, "")}|${file.basename}]]"`;
  }

  async activateDashboard(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(DASHBOARD_VIEW_TYPE)[0];
    const leaf = existing ?? this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: DASHBOARD_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  async createCampaign(name: string, world: TFile | null, character: TFile | null = null): Promise<void> {
    const safeName = name.trim().replace(/[\\/:*?"<>|]/g, "-") || "Meine Kampagne";
    const root = normalizePath(`${this.settings.rootFolder}/Campaigns/${safeName}`);
    for (const directory of [root, `${root}/Journal`, `${root}/State`, `${root}/Rulesets`]) {
      if (!this.app.vault.getAbstractFileByPath(directory)) await this.app.vault.createFolder(directory);
    }
    const id = `rpg-campaign-${safeName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    const worldLink = world ? this.wikilink(world) : "null";
    const characterLink = character ? this.wikilink(character) : "null";
    const path = normalizePath(`${root}/Campaign.md`);
    if (!this.app.vault.getAbstractFileByPath(path)) {
      await this.app.vault.create(path, `---\nid: ${id}\ntype: campaign\nname: ${JSON.stringify(safeName)}\nsummary: ${JSON.stringify(`Unabhängige Solo-Kampagne ${safeName}.`)}\nworld: ${worldLink}\ncharacter: ${characterLink}\nstatus: active\nturn: 0\n---\n\n# ${safeName}\n\nDiese Kampagne besitzt einen eigenen Spielstand. Änderungen bleiben auf diese Kampagne begrenzt.\n\n## Journal\n\n`);
    }
    const statePath = normalizePath(`${root}/State/Spielstand.md`);
    if (!this.app.vault.getAbstractFileByPath(statePath)) {
      await this.app.vault.create(statePath, `---\ntype: campaign-state\ncampaign: "[[Campaign]]"\ncharacter: ${characterLink}\nturn: 0\nposition: "0,0"\nlocation: null\nhit-points: null\nconditions: []\nresources: []\n---\n\n# Spielstand\n\nDer Zustand dieser Kampagne wird unabhängig von anderen Kampagnen gespeichert.\n`);
    }
    const rulesetPath = normalizePath(`${root}/Rulesets/${STANDARD_RULESET.id}.md`);
    if (!this.app.vault.getAbstractFileByPath(rulesetPath)) {
      await this.app.vault.create(rulesetPath, `---\ntype: ruleset\nid: ${STANDARD_RULESET.id}\nname: ${JSON.stringify(STANDARD_RULESET.name)}\ndice: ${STANDARD_RULESET.dice}\nsuccess-label: ${JSON.stringify(STANDARD_RULESET.successLabel)}\n---\n\n# ${STANDARD_RULESET.name}\n\nEine Probe addiert Attributwert, Ausrüstungsbonus und Würfelergebnis und vergleicht die Summe mit der Schwierigkeit.\n`);
    }
    const mapPath = normalizePath(`${root}/State/Karte.md`);
    if (!this.app.vault.getAbstractFileByPath(mapPath)) {
      const pois = world ? this.app.vault.getMarkdownFiles().filter((file) => file.path.startsWith(`${world.path.replace(/\/World\.md$/, "")}/POIs/`)).map((file) => file.basename) : [];
      const cells = generateHexMap(`${safeName}-map`, 2, pois);
      await this.app.vault.create(mapPath, this.mapMarkdown(cells, safeName));
    }
    new Notice(`Kampagne „${safeName}“ wurde angelegt.`);
  }

  async continueCampaign(source: TFile, name: string, character: TFile | null = null): Promise<void> {
    const sourceRoot = source.path.replace(/\/Campaign\.md$/, "");
    const sourceState = this.app.vault.getAbstractFileByPath(normalizePath(`${sourceRoot}/State/Spielstand.md`));
    const sourceFrontmatter = sourceState instanceof TFile ? this.app.metadataCache.getFileCache(sourceState)?.frontmatter ?? {} : {};
    const sourceCampaign = this.app.metadataCache.getFileCache(source)?.frontmatter;
    const snapshot: CampaignSnapshot = {
      id: String(sourceCampaign?.id ?? source.basename),
      name: source.basename,
      turn: Number(sourceFrontmatter.turn ?? sourceCampaign?.turn ?? 0),
      status: String(sourceCampaign?.status ?? "active") === "completed" ? "completed" : "active",
      state: { ...sourceFrontmatter },
    };
    const id = `rpg-campaign-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    const fork = forkCampaign(snapshot, id, name);
    const sourceCharacter = character ?? this.campaignCharacter(source);
    await this.createCampaign(name, null, sourceCharacter);
    const created = this.app.vault.getAbstractFileByPath(normalizePath(`${this.settings.rootFolder}/Campaigns/${name}/Campaign.md`));
    const createdState = this.app.vault.getAbstractFileByPath(normalizePath(`${this.settings.rootFolder}/Campaigns/${name}/State/Spielstand.md`));
    if (created instanceof TFile) await this.app.fileManager.processFrontMatter(created, (frontmatter) => { frontmatter.sourceCampaign = `[[${source.basename}]]`; frontmatter.sourceTurn = fork.sourceTurn ?? 0; });
    if (createdState instanceof TFile) await this.app.fileManager.processFrontMatter(createdState, (frontmatter) => Object.assign(frontmatter, fork.state));
  }

  async createDungeon(name: string, seed: string): Promise<void> {
    const safeName = name.trim() || "Dungeon";
    const safeSeed = seed.trim() || safeName.toLowerCase();
    const dungeon = generateDungeon(safeSeed);
    const folder = normalizePath(`${this.settings.rootFolder}/Dungeons`);
    if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
    const path = normalizePath(`${folder}/${safeName}.md`);
    if (this.app.vault.getAbstractFileByPath(path)) throw new Error(`Dungeon '${safeName}' existiert bereits.`);
    const rooms = dungeon.rooms.map((room) => `- **${room.id}** (${room.x}, ${room.y}) ${room.width}×${room.height}`).join("\n");
    const corridors = dungeon.corridors.map(([from, to]) => `- [[${from}]] ↔ [[${to}]]`).join("\n");
    await this.app.vault.create(path, `---\ntype: dungeon\nid: rpg-dungeon-${safeSeed.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}\nseed: ${JSON.stringify(safeSeed)}\nwidth: ${dungeon.width}\nheight: ${dungeon.height}\n---\n\n# ${safeName}\n\n## Räume\n${rooms}\n\n## Verbindungen\n${corridors}\n`);
    new Notice(`Dungeon '${safeName}' erstellt.`);
  }

  async createJournalEntry(campaign: TFile, text: string): Promise<void> {
    const content = text.trim();
    if (!content) { new Notice("Der Journal-Eintrag ist leer."); return; }
    const campaignRoot = campaign.path.replace(/\/Campaign\.md$/, "");
    const journalFolder = normalizePath(`${campaignRoot}/Journal`);
    if (!this.app.vault.getAbstractFileByPath(journalFolder)) await this.app.vault.createFolder(journalFolder);
    const created = new Date().toISOString();
    const baseStamp = created.replace(/[:.]/g, "-");
    let stamp = baseStamp;
    let sequence = 2;
    while (this.app.vault.getAbstractFileByPath(normalizePath(`${journalFolder}/${stamp}.md`))) stamp = `${baseStamp}-${sequence++}`;
    await this.app.vault.create(normalizePath(`${journalFolder}/${stamp}.md`), `---\ntype: journal\ncampaign: "[[${campaign.basename}]]"\ncreated: ${created}\nsummary: ${JSON.stringify(content.slice(0, 120))}\n---\n\n# ${stamp}\n\n${content}\n`);
    await this.advanceCampaignTurn(campaign);
    new Notice(`Journal-Eintrag in ${campaign.basename} gespeichert.`);
  }

  async recordInteraction(campaign: TFile, npc: TFile, action: string, outcome: string): Promise<void> {
    const actor = this.campaignCharacter(campaign);
    const actorName = actor?.basename ?? "Die Spielfigur";
    const cleanAction = action.trim();
    const cleanOutcome = outcome.trim() || "Keine unmittelbare Reaktion festgelegt.";
    if (!cleanAction) { new Notice("Beschreibe zuerst die Aktion."); return; }
    await this.createJournalEntry(campaign, `## Interaktion: ${actorName} und ${npc.basename}\n\n**Aktion:** ${cleanAction}\n\n**Reaktion:** ${cleanOutcome}\n\nBeteiligte: [[${actorName}]], [[${npc.basename}]]`);
  }

  async askOracle(question: string): Promise<string> {
    const result = askOracle(question);
    return `${result.answer} (Wurf ${result.roll}/5)`;
  }

  async performCampaignCheck(campaign: TFile, action: string, attribute: string, equipmentBonus: string, difficulty: string): Promise<CheckResult | null> {
    const parsed = [attribute, equipmentBonus, difficulty].map((value) => Number(value.trim()));
    try {
      const character = this.campaignCharacter(campaign);
      const characterFrontmatter = character ? this.app.metadataCache.getFileCache(character)?.frontmatter : undefined;
      const root = campaign.path.replace(/\/Campaign\.md$/, "");
      const state = this.app.vault.getAbstractFileByPath(normalizePath(`${root}/State/Spielstand.md`));
      const stateFrontmatter = state instanceof TFile ? this.app.metadataCache.getFileCache(state)?.frontmatter : undefined;
      const result = performCheck({ action, attribute: parsed[0], equipmentBonus: parsed[1], difficulty: parsed[2], character: characterFrontmatter, state: stateFrontmatter });
      const outcome = `${result.success ? result.ruleset.successLabel : "Kein Erfolg"}: ${result.total} gegen Schwierigkeit ${result.difficulty}. Wurf ${result.dice.expression} (${result.dice.rolls.join(", ")}) + Attribut ${result.attribute} + Ausrüstung ${result.equipmentBonus}.`;
      await this.createJournalEntry(campaign, `## Probe: ${result.action}\n\n${outcome}`);
      return result;
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Die Probe konnte nicht durchgeführt werden.");
      return null;
    }
  }

  private mapMarkdown(cells: HexCell[], campaignName: string): string {
    const rows = cells.map((cell) => `| ${hexKey(cell)} | ${cell.terrain} | ${cell.poi ? `[[${cell.poi}]]` : "–"} |`).join("\n");
    return `---\ntype: campaign-map\ncampaign: "[[Campaign]]"\nname: ${JSON.stringify(`${campaignName} Karte`)}\n---\n\n# ${campaignName} – Karte\n\n| Hex | Gelände | POI |\n| --- | --- | --- |\n${rows}\n`;
  }

  async moveCampaign(campaign: TFile, direction: HexDirection): Promise<string | null> {
    const root = campaign.path.replace(/\/Campaign\.md$/, "");
    const statePath = normalizePath(`${root}/State/Spielstand.md`);
    const mapPath = normalizePath(`${root}/State/Karte.md`);
    const state = this.app.vault.getAbstractFileByPath(statePath);
    const map = this.app.vault.getAbstractFileByPath(mapPath);
    if (!(state instanceof TFile) || !(map instanceof TFile)) return null;
    const currentPosition = this.app.metadataCache.getFileCache(state)?.frontmatter?.position;
    const nextPosition = moveHex(typeof currentPosition === "string" ? currentPosition : "0,0", direction);
    const mapContent = await this.app.vault.cachedRead(map);
    const row = mapContent.split("\n").find((line) => line.startsWith(`| ${nextPosition} |`));
    if (!row) return "Kartenrand erreicht.";
    await this.app.fileManager.processFrontMatter(state, (frontmatter) => {
      frontmatter.position = nextPosition;
      frontmatter.location = `Hex ${nextPosition}`;
    });
    const summary = row ? row.replace(/^\|\s*|\s*\|$/g, "").split("|").map((part) => part.trim()) : [];
    const destination = summary[1] ? `Hex ${nextPosition}: ${summary[1]}${summary[2] && summary[2] !== "–" ? `, POI ${summary[2]}` : ""}` : `Hex ${nextPosition}`;
    await this.createJournalEntry(campaign, `## Bewegung\n\nDie Gruppe bewegt sich nach **${direction.toUpperCase()}**.\n\n${destination}`);
    return destination;
  }

  async advanceCampaignTurn(campaign: TFile): Promise<void> {
    const root = campaign.path.replace(/\/Campaign\.md$/, "");
    const statePath = normalizePath(`${root}/State/Spielstand.md`);
    const state = this.app.vault.getAbstractFileByPath(statePath);
    if (!(state instanceof TFile)) return;
    await this.app.fileManager.processFrontMatter(state, (frontmatter) => {
      const current = Number(frontmatter.turn);
      frontmatter.turn = Number.isFinite(current) ? current + 1 : 1;
    });
  }

  async updateCampaignState(campaign: TFile, location: string, hitPoints: string, conditions: string, resources: string): Promise<void> {
    const root = campaign.path.replace(/\/Campaign\.md$/, "");
    const statePath = normalizePath(`${root}/State/Spielstand.md`);
    const state = this.app.vault.getAbstractFileByPath(statePath);
    if (!(state instanceof TFile)) return;
    await this.app.fileManager.processFrontMatter(state, (frontmatter) => {
      frontmatter.location = location.trim() ? `[[${location.trim()}]]` : null;
      const parsedHitPoints = Number(hitPoints.trim());
      frontmatter["hit-points"] = hitPoints.trim() && Number.isFinite(parsedHitPoints) ? parsedHitPoints : null;
      frontmatter.conditions = conditions.split(",").map((value) => value.trim()).filter(Boolean);
      frontmatter.resources = resources.split(",").map((value) => value.trim()).filter(Boolean);
    });
    new Notice(`Spielstand für ${campaign.basename} gespeichert.`);
  }

  campaignCharacter(campaign: TFile): TFile | null {
    const value = this.app.metadataCache.getFileCache(campaign)?.frontmatter?.character;
    if (typeof value !== "string") return null;
    const match = /^\[\[([^|\]]+)/.exec(value);
    const reference = match?.[1] ?? value;
    return this.resolveEntity(reference);
  }

  validateVault(): void {
    const root = normalizePath(this.settings.rootFolder).replace(/\/$/, "");
    const files = this.app.vault.getMarkdownFiles()
      .filter((file) => file.path.startsWith(`${root}/`))
      .map((file) => ({ path: file.path, frontmatter: this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined }));
    const issues = validateEntities(files);
    this.log(`Datenintegrität geprüft: ${files.length} Dateien, ${issues.length} Problem(e)`);
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
    generated.settlement.frontmatter.world = "[[World]]";
    for (const [entity, path] of paths) {
      if (!this.app.vault.getAbstractFileByPath(normalizePath(path))) await this.app.vault.create(normalizePath(path), entityMarkdown(entity));
    }
    const worldFile = this.app.vault.getAbstractFileByPath(worldPath);
    if (worldFile instanceof TFile) {
      await this.app.fileManager.processFrontMatter(worldFile, (frontmatter) => {
        const settlements = Array.isArray(frontmatter.settlements) ? frontmatter.settlements as string[] : [];
        if (!settlements.includes(`[[${safeName}]]`)) settlements.push(`[[${safeName}]]`);
        frontmatter.settlements = settlements;
      });
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
    this.log(`Siedlung generiert: ${entities.length} Entitäten`);
  }

  async addRelationship(from: TFile, to: TFile, role: RelationshipRole, reciprocalRole?: RelationshipRole): Promise<void> {
    if (!this.sameRelationshipScope(from, to)) {
      new Notice("Beziehungen können nur innerhalb derselben Welt oder Kampagne synchronisiert werden.");
      return;
    }
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
      const invalidResidents = !["person", "household", "settlement"].includes(String(frontmatter.type)) && frontmatter.residents !== undefined;
      if (entries.size === 0 && !Array.isArray(frontmatter.relationships) && !inferredGender && !invalidResidents) continue;
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
    const canOwnResidents = ["person", "household", "settlement"].includes(String(frontmatter.type));
    for (const property of RELATIONSHIP_PROPERTIES) {
      if (property === "residents" && !canOwnResidents) continue;
      const role = PROPERTY_ROLES[property];
      for (const value of this.asList(frontmatter[property])) {
        const target = this.resolveEntityFromValue(value, file);
        if (target) entries.set(this.entityId(target), { id: this.entityId(target), role });
      }
    }
    if (frontmatter.type === "person") {
      for (const property of ["household", "settlement"]) {
        for (const value of this.asList(frontmatter[property])) {
          const target = this.resolveEntityFromValue(value, file);
          if (target) entries.set(this.entityId(target), { id: this.entityId(target), role: "resident" });
        }
      }
    }
    const raw = frontmatter.relationships;
    if (Array.isArray(raw)) {
      for (const value of raw) {
        const entry = this.parseLegacyRelationshipEntry(value, file);
        if (entry && (entry.role !== "resident" || canOwnResidents)) entries.set(entry.id, entry);
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
        if (id && type in RECIPROCAL_TYPES) return this.normalizeRoleEntry({ id, role: this.legacyRole(type as RelationshipType) }, file);
      }
      const linkMatch = /^\[\[([^|\]]+)(?:\|[^\]]+)?\]\]$/.exec(value.trim());
      if (linkMatch) {
        const target = this.resolveEntity(linkMatch[1], file);
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
        return this.normalizeRoleEntry({ id: candidate.id, role: this.legacyRole(candidate.type as RelationshipType) }, file);
      }
    }
    return null;
  }

  private legacyRole(type: RelationshipType): RelationshipRole {
    return type === "parent-child" ? "parent" : type;
  }

  private normalizeRoleEntry(entry: RoleEntry, owner?: TFile): RoleEntry {
    const target = this.resolveEntity(entry.id, owner);
    return target ? { id: this.entityId(target), role: entry.role } : entry;
  }

  private resolveEntityFromValue(value: unknown, owner?: TFile): TFile | null {
    if (typeof value !== "string") return null;
    const linkMatch = /^\[\[([^|\]]+)(?:\|[^\]]+)?\]\]$/.exec(value.trim());
    const target = this.resolveEntity(linkMatch ? linkMatch[1] : value, owner);
    return target && (!owner || this.sameRelationshipScope(owner, target)) ? target : null;
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
      if (entry.role === "resident" && owner && !["person", "household", "settlement"].includes(String(this.app.metadataCache.getFileCache(owner)?.frontmatter?.type))) continue;
      const target = this.resolveEntity(entry.id);
      if (!target) continue;
      const property = this.propertyForEntry(entry.role, owner, target);
      const values = grouped.get(property) ?? [];
      values.push(this.entityLink(target));
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

  private entityLink(file: TFile): string {
    return `[[${normalizePath(file.path).replace(/\.md$/, "")}|${file.basename}]]`;
  }

  private resolveEntity(reference: string, owner?: TFile): TFile | null {
    const normalized = normalizePath(reference.replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0]);
    const files = this.app.vault.getMarkdownFiles();
    const exact = files.find((file) => this.entityId(file) === reference || file.path === reference || file.path.replace(/\.md$/, "") === normalized);
    if (exact) return exact;
    const candidates = files.filter((file) => file.basename === normalized || file.path.replace(/\.md$/, "") === normalized);
    if (!owner) return candidates[0] ?? null;
    return candidates.find((file) => this.sameRelationshipScope(owner, file)) ?? candidates[0] ?? null;
  }

  private relationshipScope(file: TFile): string {
    const normalized = normalizePath(file.path);
    const match = /(?:^|\/)(worlds|campaigns)\/([^/]+)/i.exec(normalized);
    return match ? `${match[1].toLowerCase()}/${match[2]}` : "global";
  }

  private sameRelationshipScope(from: TFile, to: TFile): boolean {
    return this.relationshipScope(from) === this.relationshipScope(to);
  }

  private async reconcileRelationshipFile(file: TFile): Promise<void> {
    const current = this.readRelationshipEntries(file);
    const previous = this.relationshipSnapshot.get(file.path) ?? new Map<string, RelationshipRole>();
    const references = new Set([...previous.keys(), ...current.keys()]);
    this.relationshipSnapshot.set(file.path, current);
    for (const reference of references) {
      const target = this.resolveEntity(reference, file);
      if (!target || target.path === file.path || !this.sameRelationshipScope(file, target)) continue;
      const nextRole = current.get(reference);
      if (nextRole) {
        const reciprocalRole = this.reciprocalRole(nextRole, file, target);
        const previousRole = previous.get(reference);
        const targetRole = this.readRelationshipEntries(target).get(this.entityId(file));
        const changedRole = previousRole !== undefined && previousRole !== nextRole;
        const contradictoryTarget = targetRole !== undefined && targetRole !== reciprocalRole;
        if (!changedRole && targetRole === reciprocalRole) continue;
        if ((changedRole || contradictoryTarget) && !await this.confirmRelationshipConflict(file, target, previousRole, nextRole, targetRole)) {
          if (previousRole) await this.syncRelationshipPair(file, target, previousRole, this.reciprocalRole(previousRole, file, target));
          else await this.syncRelationshipPair(file, target, nextRole, reciprocalRole, true);
          continue;
        }
        await this.syncRelationshipPair(file, target, nextRole, reciprocalRole);
      } else if (previous.has(reference)) {
        const previousRole = previous.get(reference)!;
        await this.syncRelationshipPair(file, target, previousRole, this.reciprocalRole(previousRole, file, target), true);
      }
    }
  }

  private confirmRelationshipConflict(file: TFile, target: TFile, previousRole: RelationshipRole | undefined, nextRole: RelationshipRole, targetRole: RelationshipRole | undefined): Promise<boolean> {
    return new Promise((resolve) => new RelationshipConflictModal(this.app, file, target, previousRole, nextRole, targetRole, resolve).open());
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
    const existing = this.readRelationshipEntries(file).get(targetId);
    if (remove ? !existing : existing === role) return;
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
    this.addButton(actions, "Orakel fragen", () => new OracleModal(this.app, this.plugin).open());
    this.addButton(actions, "NPC-Interaktion", () => new InteractionModal(this.app, this.plugin).open());
    this.addButton(actions, "Spielstand bearbeiten", () => new CampaignStateModal(this.app, this.plugin).open());
    this.addButton(actions, "Probe durchführen", () => new CheckModal(this.app, this.plugin).open());
    this.addButton(actions, "Karte erkunden", () => new MapModal(this.app, this.plugin).open());
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
      const relationshipFields = ["relationships", "mother", "father", "parents", "sons", "daughters", "children", "siblings", "partners", "friends", "rivals", "colleagues", "residents"];
      relationships += relationshipFields.reduce((count, field) => {
        const value = frontmatter[field];
        return count + (Array.isArray(value) ? value.length : value === undefined ? 0 : 1);
      }, 0);
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
    let character: TFile | null = null;
    new Setting(this.contentEl).setName("Name").addText((text) => text.setValue(name).onChange((value) => { name = value; }));
    new Setting(this.contentEl).setName("Welt (optional)").addDropdown((dropdown) => {
      dropdown.addOption("", "Unabhängig");
      worlds.forEach((file) => dropdown.addOption(file.path, file.basename));
      dropdown.setValue(world?.path ?? "").onChange((value) => { world = worlds.find((file) => file.path === value) ?? null; });
    });
    const characters = this.app.vault.getMarkdownFiles().filter((file) => this.app.metadataCache.getFileCache(file)?.frontmatter?.type === "person");
    new Setting(this.contentEl).setName("Spielercharakter (optional)").addDropdown((dropdown) => {
      dropdown.addOption("", "Später festlegen");
      characters.forEach((file) => dropdown.addOption(file.path, file.basename));
      dropdown.setValue("").onChange((value) => { character = characters.find((file) => file.path === value) ?? null; });
    });
    new Setting(this.contentEl).addButton((button) => button.setButtonText("Anlegen").setCta().onClick(async () => {
      const selectedWorld = world;
      await this.plugin.createCampaign(name, selectedWorld, character);
      this.close();
    }));
  }
  onClose(): void { this.contentEl.empty(); }
}

class CampaignContinuationModal extends Modal {
  private plugin: SoloSidianPlugin;
  constructor(app: App, plugin: SoloSidianPlugin) { super(app); this.plugin = plugin; }
  onOpen(): void {
    this.contentEl.createEl("h2", { text: "Kampagne fortsetzen" });
    const campaigns = this.app.vault.getMarkdownFiles().filter((file) => this.app.metadataCache.getFileCache(file)?.frontmatter?.type === "campaign");
    let source: TFile | null = campaigns[0] ?? null;
    let name = source ? `${source.basename} – Fortsetzung` : "Neue Fortsetzung";
    let character: TFile | null = null;
    new Setting(this.contentEl).setName("Quellkampagne").addDropdown((dropdown) => {
      campaigns.forEach((file) => dropdown.addOption(file.path, file.basename));
      dropdown.setValue(source?.path ?? "").onChange((value) => { source = campaigns.find((file) => file.path === value) ?? null; });
    });
    new Setting(this.contentEl).setName("Name").addText((text) => text.setValue(name).onChange((value) => { name = value; }));
    const characters = this.app.vault.getMarkdownFiles().filter((file) => this.app.metadataCache.getFileCache(file)?.frontmatter?.type === "person");
    new Setting(this.contentEl).setName("Spielercharakter").addDropdown((dropdown) => {
      dropdown.addOption("", "Aus Quelle übernehmen");
      characters.forEach((file) => dropdown.addOption(file.path, file.basename));
      dropdown.setValue("").onChange((value) => { character = characters.find((file) => file.path === value) ?? null; });
    });
    new Setting(this.contentEl).addButton((button) => button.setButtonText("Fortsetzen").setCta().onClick(async () => {
      if (!source || !name.trim()) { new Notice("Wähle eine Quelle und gib einen Namen ein."); return; }
      await this.plugin.continueCampaign(source, name.trim(), character);
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

class OracleModal extends Modal {
  private plugin: SoloSidianPlugin;
  constructor(app: App, plugin: SoloSidianPlugin) { super(app); this.plugin = plugin; }
  onOpen(): void {
    this.contentEl.createEl("h2", { text: "Orakel und Zufallstabelle" });
    const campaigns = this.app.vault.getMarkdownFiles().filter((file) => this.app.metadataCache.getFileCache(file)?.frontmatter?.type === "campaign");
    let campaign: TFile | null = campaigns[0] ?? null;
    let question = "Wird die Spur gefunden?";
    let category = oracleCategories()[0] ?? "Begegnung";
    let lastResult = "";
    const result = this.contentEl.createEl("p", { text: "Bereit." });
    new Setting(this.contentEl).setName("Kampagne für Journal").addDropdown((dropdown) => {
      dropdown.addOption("", "Nicht speichern");
      campaigns.forEach((file) => dropdown.addOption(file.path, file.basename));
      dropdown.setValue(campaign?.path ?? "").onChange((value) => { campaign = campaigns.find((file) => file.path === value) ?? null; });
    });
    new Setting(this.contentEl).setName("Frage").addText((text) => text.setValue(question).onChange((value) => { question = value; }));
    new Setting(this.contentEl).setName("Zufallstabelle").addDropdown((dropdown) => {
      oracleCategories().forEach((value) => dropdown.addOption(value, value));
      dropdown.setValue(category).onChange((value) => { category = value; });
    });
    new Setting(this.contentEl).addButton((button) => button.setButtonText("Orakel fragen").setCta().onClick(async () => {
      lastResult = `Orakel: ${await this.plugin.askOracle(question)}`;
      result.setText(lastResult);
    })).addButton((button) => button.setButtonText("Ereignis erzeugen").onClick(() => {
      const event = randomEvent(category);
      lastResult = `Zufallsereignis (${event.category}): ${event.text}`;
      result.setText(lastResult);
    })).addButton((button) => button.setButtonText("Im Journal speichern").onClick(async () => {
      if (!campaign) { new Notice("Wähle eine Kampagne zum Speichern aus."); return; }
      if (!lastResult) { new Notice("Erzeuge zuerst eine Orakelantwort oder ein Ereignis."); return; }
      await this.plugin.createJournalEntry(campaign, lastResult);
      result.setText(`${lastResult} — im Journal gespeichert.`);
    }));
  }
  onClose(): void { this.contentEl.empty(); }
}

class InteractionModal extends Modal {
  private plugin: SoloSidianPlugin;
  constructor(app: App, plugin: SoloSidianPlugin) { super(app); this.plugin = plugin; }
  onOpen(): void {
    this.contentEl.createEl("h2", { text: "NPC-Interaktion" });
    const campaigns = this.app.vault.getMarkdownFiles().filter((file) => this.app.metadataCache.getFileCache(file)?.frontmatter?.type === "campaign");
    const npcs = this.app.vault.getMarkdownFiles().filter((file) => this.app.metadataCache.getFileCache(file)?.frontmatter?.type === "person");
    let campaign: TFile | null = campaigns[0] ?? null;
    let npc: TFile | null = npcs[0] ?? null;
    let action = "";
    let outcome = "";
    new Setting(this.contentEl).setName("Kampagne").addDropdown((dropdown) => {
      campaigns.forEach((file) => dropdown.addOption(file.path, file.basename));
      dropdown.setValue(campaign?.path ?? "").onChange((value) => { campaign = campaigns.find((file) => file.path === value) ?? null; });
    });
    new Setting(this.contentEl).setName("NPC").addDropdown((dropdown) => {
      npcs.forEach((file) => dropdown.addOption(file.path, file.basename));
      dropdown.setValue(npc?.path ?? "").onChange((value) => { npc = npcs.find((file) => file.path === value) ?? null; });
    });
    new Setting(this.contentEl).setName("Aktion").addTextArea((area) => area.setPlaceholder("Was tut die Spielfigur?").onChange((value) => { action = value; }));
    new Setting(this.contentEl).setName("Reaktion / Ergebnis").addTextArea((area) => area.setPlaceholder("Ergebnis oder Orakelantwort").onChange((value) => { outcome = value; }));
    new Setting(this.contentEl).addButton((button) => button.setButtonText("Orakel für Reaktion").onClick(async () => {
      outcome = await this.plugin.askOracle(`Reagiert ${npc?.basename ?? "der NPC"} positiv auf die Aktion?`);
      const outcomeField = this.contentEl.querySelectorAll("textarea")[1] as HTMLTextAreaElement | undefined;
      if (outcomeField) outcomeField.value = outcome;
    })).addButton((button) => button.setButtonText("Im Journal speichern").setCta().onClick(async () => {
      const selectedCampaign = campaign;
      const selectedNpc = npc;
      if (selectedCampaign && selectedNpc) await this.plugin.recordInteraction(selectedCampaign, selectedNpc, action, outcome);
      else new Notice("Lege zuerst eine Kampagne und einen NPC an.");
      this.close();
    }));
  }
  onClose(): void { this.contentEl.empty(); }
}

class CampaignStateModal extends Modal {
  private plugin: SoloSidianPlugin;
  constructor(app: App, plugin: SoloSidianPlugin) { super(app); this.plugin = plugin; }
  onOpen(): void {
    this.contentEl.createEl("h2", { text: "Kampagnenzustand bearbeiten" });
    const campaigns = this.app.vault.getMarkdownFiles().filter((file) => this.app.metadataCache.getFileCache(file)?.frontmatter?.type === "campaign");
    let campaign: TFile | null = campaigns[0] ?? null;
    let location = "";
    let hitPoints = "";
    let conditions = "";
    let resources = "";
    new Setting(this.contentEl).setName("Kampagne").addDropdown((dropdown) => {
      campaigns.forEach((file) => dropdown.addOption(file.path, file.basename));
      dropdown.setValue(campaign?.path ?? "").onChange((value) => { campaign = campaigns.find((file) => file.path === value) ?? null; });
    });
    new Setting(this.contentEl).setName("Ort").setDesc("Dateiname oder Anzeigename einer Ortsnotiz.").addText((text) => text.onChange((value) => { location = value; }));
    new Setting(this.contentEl).setName("Trefferpunkte").addText((text) => text.setPlaceholder("z. B. 8").onChange((value) => { hitPoints = value; }));
    new Setting(this.contentEl).setName("Zustände").setDesc("Kommagetrennte Liste.").addText((text) => text.onChange((value) => { conditions = value; }));
    new Setting(this.contentEl).setName("Ressourcen").setDesc("Kommagetrennte Liste.").addText((text) => text.onChange((value) => { resources = value; }));
    new Setting(this.contentEl).addButton((button) => button.setButtonText("Speichern").setCta().onClick(async () => {
      const selectedCampaign = campaign;
      if (selectedCampaign) await this.plugin.updateCampaignState(selectedCampaign, location, hitPoints, conditions, resources);
      else new Notice("Lege zuerst eine Kampagne an.");
      this.close();
    }));
  }
  onClose(): void { this.contentEl.empty(); }
}

class CheckModal extends Modal {
  private plugin: SoloSidianPlugin;
  constructor(app: App, plugin: SoloSidianPlugin) { super(app); this.plugin = plugin; }
  onOpen(): void {
    this.contentEl.createEl("h2", { text: "Probe durchführen" });
    this.contentEl.createEl("p", { text: "Standardprofil: 1d20 + Attribut + Ausrüstungsbonus gegen Schwierigkeit." });
    const campaigns = this.app.vault.getMarkdownFiles().filter((file) => this.app.metadataCache.getFileCache(file)?.frontmatter?.type === "campaign");
    let campaign: TFile | null = campaigns[0] ?? null;
    let action = "";
    let attribute = "0";
    let equipmentBonus = "0";
    let difficulty = "10";
    const result = this.contentEl.createEl("p", { text: "Bereit." });
    new Setting(this.contentEl).setName("Kampagne").addDropdown((dropdown) => {
      campaigns.forEach((file) => dropdown.addOption(file.path, file.basename));
      dropdown.setValue(campaign?.path ?? "").onChange((value) => { campaign = campaigns.find((file) => file.path === value) ?? null; });
    });
    new Setting(this.contentEl).setName("Aktion").addText((text) => text.setPlaceholder("Eine verschlossene Tür öffnen").onChange((value) => { action = value; }));
    new Setting(this.contentEl).setName("Attributwert").addText((text) => text.setValue(attribute).onChange((value) => { attribute = value; }));
    new Setting(this.contentEl).setName("Ausrüstungsbonus").addText((text) => text.setValue(equipmentBonus).onChange((value) => { equipmentBonus = value; }));
    new Setting(this.contentEl).setName("Schwierigkeit").addText((text) => text.setValue(difficulty).onChange((value) => { difficulty = value; }));
    new Setting(this.contentEl).addButton((button) => button.setButtonText("Würfeln und speichern").setCta().onClick(async () => {
      const selectedCampaign = campaign;
      if (!selectedCampaign) { new Notice("Lege zuerst eine Kampagne an."); return; }
      const check = await this.plugin.performCampaignCheck(selectedCampaign, action, attribute, equipmentBonus, difficulty);
      if (check) result.setText(`${check.success ? "Erfolg" : "Kein Erfolg"}: ${check.total} gegen ${check.difficulty} (Wurf ${check.dice.rolls.join(", ")}). Im Journal gespeichert.`);
    }));
  }
  onClose(): void { this.contentEl.empty(); }
}

class MapModal extends Modal {
  private plugin: SoloSidianPlugin;
  constructor(app: App, plugin: SoloSidianPlugin) { super(app); this.plugin = plugin; }
  onOpen(): void {
    this.contentEl.createEl("h2", { text: "Karte erkunden" });
    const campaigns = this.app.vault.getMarkdownFiles().filter((file) => this.app.metadataCache.getFileCache(file)?.frontmatter?.type === "campaign");
    let campaign: TFile | null = campaigns[0] ?? null;
    const status = this.contentEl.createEl("p", { text: "Wähle eine Kampagne und eine Bewegungsrichtung." });
    new Setting(this.contentEl).setName("Kampagne").addDropdown((dropdown) => {
      campaigns.forEach((file) => dropdown.addOption(file.path, file.basename));
      dropdown.setValue(campaign?.path ?? "").onChange((value) => { campaign = campaigns.find((file) => file.path === value) ?? null; });
    });
    const directions: Array<[HexDirection, string]> = [["n", "Norden"], ["ne", "Nordost"], ["se", "Südost"], ["s", "Süden"], ["sw", "Südwest"], ["nw", "Nordwest"]];
    for (const [direction, label] of directions) {
      new Setting(this.contentEl).addButton((button) => button.setButtonText(label).onClick(async () => {
        const selectedCampaign = campaign;
        if (!selectedCampaign) { new Notice("Lege zuerst eine Kampagne an."); return; }
        const destination = await this.plugin.moveCampaign(selectedCampaign, direction);
        status.setText(!destination ? "Für diese Kampagne ist keine Karte vorhanden." : destination.startsWith("Kartenrand") ? destination : `${destination}. Bewegung im Journal gespeichert.`);
      }));
    }
  }
  onClose(): void { this.contentEl.empty(); }
}

class DungeonModal extends Modal {
  private plugin: SoloSidianPlugin;
  constructor(app: App, plugin: SoloSidianPlugin) { super(app); this.plugin = plugin; }
  onOpen(): void {
    this.contentEl.createEl("h2", { text: "Dungeon generieren" });
    let name = "Verlassene Ruinen";
    let seed = "dungeon-001";
    new Setting(this.contentEl).setName("Name").addText((text) => text.setValue(name).onChange((value) => { name = value; }));
    new Setting(this.contentEl).setName("Seed").addText((text) => text.setValue(seed).onChange((value) => { seed = value; }));
    new Setting(this.contentEl).addButton((button) => button.setButtonText("Generieren").setCta().onClick(async () => {
      try { await this.plugin.createDungeon(name, seed); this.close(); } catch (error) { new Notice(error instanceof Error ? error.message : "Dungeon konnte nicht erstellt werden."); }
    }));
  }
  onClose(): void { this.contentEl.empty(); }
}

class RelationshipConflictModal extends Modal {
  private readonly file: TFile;
  private readonly target: TFile;
  private readonly previousRole: RelationshipRole | undefined;
  private readonly nextRole: RelationshipRole;
  private readonly targetRole: RelationshipRole | undefined;
  private readonly resolveDecision: (accepted: boolean) => void;
  private settled = false;

  constructor(app: App, file: TFile, target: TFile, previousRole: RelationshipRole | undefined, nextRole: RelationshipRole, targetRole: RelationshipRole | undefined, resolveDecision: (accepted: boolean) => void) {
    super(app);
    this.file = file;
    this.target = target;
    this.previousRole = previousRole;
    this.nextRole = nextRole;
    this.targetRole = targetRole;
    this.resolveDecision = resolveDecision;
  }

  onOpen(): void {
    this.contentEl.createEl("h2", { text: "Widersprüchliche Beziehung" });
    this.contentEl.createEl("p", { text: `${this.file.basename} und ${this.target.basename} enthalten unterschiedliche Beziehungsangaben.` });
    this.contentEl.createEl("p", { text: `Neue Angabe: ${this.nextRole}. Bisher: ${this.previousRole ?? "keine"}. Gegenangabe: ${this.targetRole ?? "keine"}.` });
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("Neue Angabe übernehmen").setCta().onClick(() => this.finish(true)))
      .addButton((button) => button.setButtonText("Bestehende Angabe beibehalten").onClick(() => this.finish(false)));
  }

  private finish(accepted: boolean): void {
    if (this.settled) return;
    this.settled = true;
    this.resolveDecision(accepted);
    this.close();
  }

  onClose(): void {
    if (!this.settled) {
      this.settled = true;
      this.resolveDecision(false);
    }
    this.contentEl.empty();
  }
}

class RelationshipModal extends Modal {
  private plugin: SoloSidianPlugin;
  constructor(app: App, plugin: SoloSidianPlugin) { super(app); this.plugin = plugin; }
  onOpen(): void {
    this.contentEl.createEl("h2", { text: "Beziehung anpassen" });
    const root = normalizePath(this.plugin.settings.rootFolder).replace(/\/$/, "");
    const files = this.app.vault.getMarkdownFiles().filter((file) => {
      if (!file.path.startsWith(`${root}/`)) return false;
      const type = this.app.metadataCache.getFileCache(file)?.frontmatter?.type;
      return ["person", "family", "household", "settlement", "poi"].includes(String(type));
    });
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
