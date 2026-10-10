import { parseFrontmatter } from "./markdown.ts";

export interface ImportedNote { path: string; frontmatter: Record<string, unknown>; body: string; }

export function importMarkdown(path: string, content: string): ImportedNote {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content);
  if (!match) return { path, frontmatter: {}, body: content };
  return { path, frontmatter: parseFrontmatter(match[1]), body: match[2] };
}
