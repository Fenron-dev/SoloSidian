import { rollDice, type DiceResult } from "./dice.ts";

export interface Ruleset {
  id: string;
  name: string;
  dice: string;
  successLabel: string;
  variables?: Record<string, number>;
  modifiers?: Record<string, number>;
}

export interface CheckInput {
  action: string;
  attribute: number;
  equipmentBonus: number;
  difficulty: number;
  ruleset?: Ruleset;
  character?: Record<string, unknown>;
  state?: Record<string, unknown>;
}

export interface CheckResult {
  action: string;
  attribute: number;
  equipmentBonus: number;
  difficulty: number;
  dice: DiceResult;
  total: number;
  success: boolean;
  ruleset: Ruleset;
}

export const STANDARD_RULESET: Ruleset = {
  id: "standard",
  name: "SoloSidian Standard",
  dice: "1d20",
  successLabel: "Erfolg",
};

export function performCheck(input: CheckInput, random: () => number = Math.random): CheckResult {
  const ruleset = input.ruleset ?? STANDARD_RULESET;
  if (!input.action.trim()) throw new Error("Eine Probe braucht eine beschriebene Aktion.");
  for (const value of [input.attribute, input.equipmentBonus, input.difficulty]) {
    if (!Number.isFinite(value)) throw new Error("Attribut, Bonus und Schwierigkeit müssen Zahlen sein.");
  }
  if (input.difficulty < 0 || input.difficulty > 100) throw new Error("Die Schwierigkeit muss zwischen 0 und 100 liegen.");
  const dice = rollDice(ruleset.dice, random);
  const automaticModifier = resolveModifier(ruleset, input.character, input.state);
  const total = dice.total + input.attribute + input.equipmentBonus + automaticModifier;
  return { ...input, action: input.action.trim(), dice, total, success: total >= input.difficulty, ruleset };
}

export function resolveModifier(ruleset: Ruleset, character: Record<string, unknown> = {}, state: Record<string, unknown> = {}): number {
  const variables = { ...(ruleset.variables ?? {}), ...numberVariables(character), ...numberVariables(state) };
  return Object.entries(ruleset.modifiers ?? {}).reduce((sum, [name, factor]) => sum + (variables[name] ?? 0) * factor, 0);
}

function numberVariables(values: Record<string, unknown>): Record<string, number> {
  return Object.fromEntries(Object.entries(values).flatMap(([key, value]) => typeof value === "number" && Number.isFinite(value) ? [[key, value]] : []));
}
