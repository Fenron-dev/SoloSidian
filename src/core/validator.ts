export interface ValidationFile {
  path: string;
  frontmatter?: Record<string, unknown>;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export function validateEntities(files: ValidationFile[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const ids = new Map<string, string[]>();
  const entityTypes = new Set(["world", "settlement", "person", "family", "household", "poi", "relationship", "campaign"]);

  for (const file of files) {
    const frontmatter = file.frontmatter;
    if (!frontmatter || typeof frontmatter.type !== "string" || !entityTypes.has(frontmatter.type)) continue;
    const id = frontmatter.id;
    if (typeof id !== "string" || id.length === 0) {
      issues.push({ path: file.path, message: "Entität besitzt keine stabile id." });
    } else {
      ids.set(id, [...(ids.get(id) ?? []), file.path]);
    }
    for (const field of ["type", "name", "summary"]) {
      if (typeof frontmatter[field] !== "string" || (frontmatter[field] as string).trim().length === 0) {
        issues.push({ path: file.path, message: `Pflichtfeld '${field}' fehlt.` });
      }
    }
  }

  for (const [id, paths] of ids) {
    if (paths.length > 1) issues.push({ path: paths.join(", "), message: `ID '${id}' ist doppelt vergeben.` });
  }

  for (const file of files) {
    const raw = file.frontmatter?.relationships;
    if (!Array.isArray(raw)) continue;
    for (const relationship of raw as Array<{ id?: unknown }>) {
      if (typeof relationship?.id === "string" && !ids.has(relationship.id) && !files.some((candidate) => candidate.path === relationship.id)) {
        issues.push({ path: file.path, message: `Beziehung verweist auf '${relationship.id}', diese Entität fehlt.` });
      }
    }
  }
  return issues;
}
