import { resolveExtensions, validateExtensionManifest, type ExtensionManifest } from "./extensions.ts";

export class ExtensionManager {
  private readonly installed = new Map<string, ExtensionManifest>();
  private readonly active = new Set<string>();

  install(manifest: ExtensionManifest): void {
    const errors = validateExtensionManifest(manifest);
    if (errors.length) throw new Error(errors.join(" "));
    this.installed.set(manifest.id, { ...manifest });
  }

  uninstall(id: string): void {
    if ([...this.installed.values()].some((manifest) => manifest.dependencies?.includes(id))) throw new Error(`Erweiterung '${id}' wird noch benötigt.`);
    this.active.delete(id);
    this.installed.delete(id);
  }

  activate(id: string): void {
    const manifest = this.installed.get(id);
    if (!manifest) throw new Error(`Erweiterung '${id}' ist nicht installiert.`);
    for (const dependency of manifest.dependencies ?? []) {
      if (!this.active.has(dependency)) throw new Error(`Abhängigkeit '${dependency}' ist nicht aktiviert.`);
    }
    this.active.add(id);
  }

  deactivate(id: string): void {
    if ([...this.active].some((activeId) => this.installed.get(activeId)?.dependencies?.includes(id))) throw new Error(`Erweiterung '${id}' wird noch verwendet.`);
    this.active.delete(id);
  }

  activationOrder(): ExtensionManifest[] { return resolveExtensions([...this.active].map((id) => this.installed.get(id)).filter((manifest): manifest is ExtensionManifest => Boolean(manifest))); }
  isActive(id: string): boolean { return this.active.has(id); }
  installedManifests(): ExtensionManifest[] { return [...this.installed.values()]; }
}
