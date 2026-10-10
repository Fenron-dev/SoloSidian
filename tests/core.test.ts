import assert from "node:assert/strict";
import test from "node:test";
import { rollDice } from "../src/core/dice.ts";
import { askOracle, randomEvent } from "../src/core/oracle.ts";
import { generateSettlement } from "../src/core/settlement-generator.ts";
import { validateEntities } from "../src/core/validator.ts";
import { performCheck, resolveModifier } from "../src/core/rules.ts";
import { generateHexMap, moveHex } from "../src/core/map.ts";
import { EntityRegistry } from "../src/core/registry.ts";
import { forkCampaign, orderCampaigns } from "../src/core/campaign.ts";
import { knowledgeCallout, visibleKnowledge } from "../src/core/knowledge.ts";
import { previewChanges, applyReroll } from "../src/core/preview.ts";
import { validateExtensionManifest, resolveExtensions } from "../src/core/extensions.ts";
import { familyTree, sortTimeline } from "../src/core/timeline.ts";
import { generateDungeon } from "../src/core/dungeon.ts";
import { createBattleMap, reveal } from "../src/core/battlemap.ts";
import { importMarkdown } from "../src/core/importer.ts";
import { decideRelationshipSync } from "../src/core/relationship-sync.ts";
import { generateRegion } from "../src/core/region.ts";
import { AudioLibrary } from "../src/core/audio.ts";
import { OfflineAiProvider } from "../src/core/ai.ts";
import { ExtensionManager } from "../src/core/pack-manager.ts";

test("dice rolls are bounded and reproducible with an injected random source", () => {
  const result = rollDice("2d6+1", () => 0.5);
  assert.deepEqual(result.rolls, [4, 4]);
  assert.equal(result.total, 9);
  assert.throws(() => rollDice("0d20"));
});

test("oracle and random tables handle edge values", () => {
  assert.equal(askOracle("", () => 1).answer, "Ja");
  assert.equal(randomEvent("Entdeckung", () => 1).category, "Entdeckung");
  assert.ok(randomEvent("Unbekannt", () => 0).text.length > 0);
});

test("settlement generation is deterministic and complete", () => {
  const first = generateSettlement("test-seed", "Eichenfurt");
  const second = generateSettlement("test-seed", "Eichenfurt");
  assert.deepEqual(first.people.map((person) => person.id), second.people.map((person) => person.id));
  assert.equal(first.people.length, 30);
  assert.equal(first.households.length, 6);
  assert.equal(first.pois.length, 4);
  assert.equal(new Set(first.people.map((person) => person.frontmatter.gender)).size, 2);
});

test("validator accepts valid links and reports missing targets", () => {
  const files = [
    { path: "RPG/A.md", frontmatter: { id: "a", type: "person", name: "A", summary: "A", friends: ["[[B]]"] } },
    { path: "RPG/B.md", frontmatter: { id: "b", type: "person", name: "B", summary: "B" } },
  ];
  assert.deepEqual(validateEntities(files), []);
  const invalid = [{ ...files[0], frontmatter: { ...files[0].frontmatter, friends: ["[[Fehlt]]"] } }, files[1]];
  assert.equal(validateEntities(invalid).length, 1);
});

test("standard checks expose their full calculation", () => {
  const success = performCheck({ action: "Tür öffnen", attribute: 3, equipmentBonus: 2, difficulty: 10 }, () => 0.5);
  assert.equal(success.total, 16);
  assert.equal(success.success, true);
  assert.throws(() => performCheck({ action: "", attribute: 0, equipmentBonus: 0, difficulty: 10 }));
});

test("hex maps and movement are deterministic", () => {
  const map = generateHexMap("map-seed", 2, ["Schrein"]);
  assert.equal(map.length, 19);
  assert.deepEqual(map, generateHexMap("map-seed", 2, ["Schrein"]));
  assert.equal(moveHex("0,0", "ne"), "1,-1");
});

test("registry, campaign forks and timeline preserve identity and order", () => {
  const registry = new EntityRegistry();
  registry.register({ id: "a", type: "person", name: "Ada", summary: "", worldId: "w" });
  assert.equal(registry.rename("a", "Ada Neu").name, "Ada Neu");
  assert.equal(registry.findByName("Ada Neu", { worldId: "w" }).length, 1);
  const fork = forkCampaign({ id: "a", name: "Alt", turn: 3, status: "active", state: { hp: 4 } }, "b", "Fortsetzung");
  assert.equal(fork.sourceCampaignId, "a");
  assert.deepEqual(orderCampaigns([{ ...fork, startOrder: 2 }, { ...fork, id: "c", name: "Früher", startOrder: 1 }]).map((item) => item.id), ["c", "b"]);
  assert.deepEqual([...familyTree([{ parent: "a", child: "b" }, { parent: "a", child: "b" }]).get("a") ?? []], ["b"]);
  assert.deepEqual(sortTimeline([{ id: "2", title: "B", order: 2 }, { id: "1", title: "A", order: 1 }]).map((event) => event.id), ["1", "2"]);
});

test("rules, knowledge, preview and extension dependencies are deterministic", () => {
  assert.equal(resolveModifier({ id: "r", name: "R", dice: "1d20", successLabel: "ok", modifiers: { strength: 2 } }, { strength: 3 }), 6);
  assert.equal(performCheck({ action: "Test", attribute: 1, equipmentBonus: 0, difficulty: 10, character: { strength: 2 }, ruleset: { id: "r", name: "R", dice: "1d20", successLabel: "ok", modifiers: { strength: 2 } } }, () => 0.5).total, 16);
  const record = { publicText: "Öffentlich", characterText: "Geheim", discoveredBy: ["hero"] };
  assert.match(knowledgeCallout(record), /Geheim/);
  assert.match(visibleKnowledge(record, "hero"), /Geheim/);
  assert.equal(previewChanges({ "a.md": "alt" }, { "a.md": "neu" }).length, 1);
  assert.equal(applyReroll("manuell", "neu"), "manuell");
  assert.deepEqual(validateExtensionManifest({ id: "pack-a", name: "Pack", version: "1.0.0" }), []);
  assert.deepEqual(resolveExtensions([{ id: "base", name: "Base", version: "1.0.0" }, { id: "addon", name: "Addon", version: "1.0.0", dependencies: ["base"] }]).map((item) => item.id), ["base", "addon"]);
});

test("dungeon, battlemap and markdown import provide safe foundations", () => {
  const dungeon = generateDungeon("seed", 4);
  assert.equal(dungeon.rooms.length, 4);
  const map = reveal(createBattleMap(4, 4), 1, 1, 1);
  assert.equal(map.fog[1][1], false);
  assert.deepEqual(importMarkdown("x.md", "---\ntype: person\nname: Ada\n---\nText").frontmatter, { type: "person", name: "Ada" });
});

test("relationship bot remains idempotent across repeated metadata events", () => {
  const state = { source: "a", target: "b", role: "friend", reciprocalRole: "friend" };
  const first = decideRelationshipSync(state, undefined, undefined);
  assert.equal(first.writeSource, true);
  assert.equal(first.writeTarget, true);
  const stable = decideRelationshipSync(state, state, "friend");
  assert.deepEqual(stable, { writeSource: false, writeTarget: false, reason: "stable" });
  const repeated = Array.from({ length: 20 }, () => decideRelationshipSync(state, state, "friend"));
  assert.equal(repeated.filter((decision) => decision.writeSource || decision.writeTarget).length, 0);
});

test("region, audio and offline AI extensions stay bounded and credential-free", async () => {
  const region = generateRegion("region-seed", "Nordmark", 3, ["Eichenfurt"]);
  assert.equal(region.cells.length, 37);
  const audio = new AudioLibrary();
  audio.register({ id: "ambience", label: "Ambiente", volume: 0.5, enabled: true });
  assert.equal(audio.list().length, 1);
  const suggestion = await new OfflineAiProvider().suggest("eine verlassene Mine");
  assert.equal(suggestion.source, "offline");
  assert.match(suggestion.text, /verlassene Mine/);
});

test("extension manager enforces dependency activation and safe removal", () => {
  const manager = new ExtensionManager();
  manager.install({ id: "base", name: "Base", version: "1.0.0" });
  manager.install({ id: "addon", name: "Addon", version: "1.0.0", dependencies: ["base"] });
  assert.throws(() => manager.activate("addon"));
  manager.activate("base");
  manager.activate("addon");
  assert.deepEqual(manager.activationOrder().map((manifest) => manifest.id), ["base", "addon"]);
  assert.throws(() => manager.uninstall("base"));
});
