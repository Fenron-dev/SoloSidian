export interface TimelineEvent { id: string; title: string; order: number; campaignId?: string; text?: string; }

export function sortTimeline(events: TimelineEvent[]): TimelineEvent[] {
  return [...events].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}

export function familyTree(edges: Array<{ parent: string; child: string }>): Map<string, string[]> {
  const tree = new Map<string, string[]>();
  for (const edge of edges) tree.set(edge.parent, [...(tree.get(edge.parent) ?? []), edge.child]);
  for (const [parent, children] of tree) tree.set(parent, [...new Set(children)].sort());
  return tree;
}
