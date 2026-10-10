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
    const values: unknown[] = [];
    if (Array.isArray(file.frontmatter?.relationships)) values.push(...file.frontmatter.relationships as unknown[]);
    for (const field of ["mother", "father", "parents", "sons", "daughters", "children", "siblings", "partners", "friends", "rivals", "colleagues", "residents"]) {
      const value = file.frontmatter?.[field];
      if (Array.isArray(value)) values.push(...value);
      else if (value !== undefined) values.push(value);
    }
    for (const relationship of values) {
      const targetId = typeof relationship === "string"
        ? relationship.startsWith("[[") ? relationship.replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0] : relationship.split("::", 2)[1] ?? relationship
        : relationship && typeof relationship === "object" && typeof (relationship as { id?: unknown }).id === "string"
          ? (relationship as { id: string }).id
          : undefined;
      const target = targetId && files.find((candidate) => candidate.path === targetId || candidate.path.replace(/\.md$/, "") === targetId || candidate.frontmatter?.name === targetId);
      if (targetId && !ids.has(targetId) && !target) {
        issues.push({ path: file.path, message: `Beziehung verweist auf '${targetId}', diese Entität fehlt.` });
      }
    }
  }
  return issues;
}
