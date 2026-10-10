export interface RelationshipState { source: string; target: string; role: string; reciprocalRole: string; }

export interface SyncDecision { writeSource: boolean; writeTarget: boolean; reason: "missing" | "changed" | "stable"; }

/** Pure decision helper used by the bot tests to guard against frontmatter write loops. */
export function decideRelationshipSync(current: RelationshipState, previous?: RelationshipState, targetRole?: string): SyncDecision {
  if (targetRole === current.reciprocalRole && previous?.role === current.role) return { writeSource: false, writeTarget: false, reason: "stable" };
  if (!previous || previous.role !== current.role) return { writeSource: true, writeTarget: targetRole !== current.reciprocalRole, reason: previous ? "changed" : "missing" };
  return { writeSource: false, writeTarget: targetRole !== current.reciprocalRole, reason: "changed" };
}
