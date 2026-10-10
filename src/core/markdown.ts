import type { GeneratedEntity, RelationshipRecord } from "./types.ts";

export function parseFrontmatter(source: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const line of source.split(/\r?\n/)) {
    const match = /^([^:#][^:]*):\s*(.*)$/.exec(line.trim());
    if (!match) continue;
    const raw = match[2].trim();
    if (raw.startsWith("[") && raw.endsWith("]")) {
      try { result[match[1].trim()] = JSON.parse(raw.replace(/'/g, '"')); continue; } catch { /* keep scalar */ }
    }
    result[match[1].trim()] = raw.replace(/^['"]|['"]$/g, "");
  }
  return result;
}

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
