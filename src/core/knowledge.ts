export interface KnowledgeRecord {
  publicText: string;
  characterText?: string;
  discoveredBy?: string[];
}

export function knowledgeCallout(record: KnowledgeRecord): string {
  const lines = [`> [!info]- Verborgenes Wissen`, `> ${record.characterText?.trim() || "Noch nicht entdeckt."}`];
  if (record.discoveredBy?.length) lines.push(`> Entdeckt von: ${record.discoveredBy.map((id) => `[[${id}]]`).join(", ")}`);
  return `${record.publicText.trim()}\n\n${lines.join("\n")}\n`;
}

export function visibleKnowledge(record: KnowledgeRecord, characterId?: string): string {
  if (!characterId || !record.discoveredBy?.includes(characterId)) return record.publicText;
  return `${record.publicText}\n\n${record.characterText ?? ""}`.trim();
}
