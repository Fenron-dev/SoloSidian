export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  dependencies?: string[];
  rules?: Record<string, unknown>;
  content?: Record<string, unknown>;
}

export function validateExtensionManifest(manifest: ExtensionManifest): string[] {
  const errors: string[] = [];
  if (!/^[a-z0-9][a-z0-9-]*$/.test(manifest.id)) errors.push("id muss aus Kleinbuchstaben, Ziffern und Bindestrichen bestehen.");
  if (!manifest.name.trim()) errors.push("name darf nicht leer sein.");
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) errors.push("version muss SemVer entsprechen.");
  return errors;
}

export function resolveExtensions(manifests: ExtensionManifest[]): ExtensionManifest[] {
  const byId = new Map(manifests.map((manifest) => [manifest.id, manifest]));
  const result: ExtensionManifest[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (manifest: ExtensionManifest): void => {
    if (visited.has(manifest.id)) return;
    if (visiting.has(manifest.id)) throw new Error(`Zirkuläre Erweiterungsabhängigkeit: ${manifest.id}`);
    visiting.add(manifest.id);
    for (const dependency of manifest.dependencies ?? []) {
      const target = byId.get(dependency);
      if (!target) throw new Error(`Fehlende Erweiterungsabhängigkeit: ${dependency}`);
      visit(target);
    }
    visiting.delete(manifest.id);
    visited.add(manifest.id);
    result.push(manifest);
  };
  for (const manifest of manifests) visit(manifest);
  return result;
}
