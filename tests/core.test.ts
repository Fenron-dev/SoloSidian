import assert from "node:assert/strict";
import test from "node:test";
import { rollDice } from "../src/core/dice.ts";
import { askOracle, randomEvent } from "../src/core/oracle.ts";
import { generateSettlement } from "../src/core/settlement-generator.ts";
import { validateEntities } from "../src/core/validator.ts";
import { performCheck } from "../src/core/rules.ts";
import { generateHexMap, moveHex } from "../src/core/map.ts";

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
