import type { GeneratedEntity, RelationshipRecord } from "./types";

function yamlValue(value: string | string[]): string {
  if (Array.isArray(value)) return `[${value.map((item) => JSON.stringify(item)).join(", ")}]`;
  return JSON.stringify(value);
}

export function entityMarkdown(entity: GeneratedEntity): string {
  const frontmatter = Object.entries(entity.frontmatter)
    .map(([key, value]) => `${key}: ${yamlValue(value)}`)
    .join("\n");
  return `---\n${frontmatter}\n---\n\n${entity.body.trim()}\n`;
}

export function relationshipsMarkdown(records: RelationshipRecord[], names: Map<string, string>): string {
  const rows = records.map((record) => `| ${record.type} | [[${names.get(record.from) ?? record.from}]] | [[${names.get(record.to) ?? record.to}]] |`).join("\n");
  return `---\ntype: relationship-index\n---\n\n# Beziehungen\n\n| Typ | Von | Zu |\n| --- | --- | --- |\n${rows}\n`;
}
