export interface PreviewChange { path: string; before: string; after: string; }

export function previewChanges(before: Record<string, string>, after: Record<string, string>): PreviewChange[] {
  const paths = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...paths].sort().flatMap((path) => before[path] === after[path] ? [] : [{ path, before: before[path] ?? "", after: after[path] ?? "" }]);
}

export function applyReroll<T>(manual: T, generated: T, overwriteManual = false): T {
  return overwriteManual ? generated : manual;
}
