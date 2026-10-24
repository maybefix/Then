import type { ReferenceFileInfo, ReferenceScope } from "./types";

export function referenceKey(sourcePath: string, scope: ReferenceScope = "project"): string {
  return `${scope}:${sourcePath.replace(/[\\]+/g, "/").toLocaleLowerCase()}`;
}

export function referenceFileKey(file: Pick<ReferenceFileInfo, "sourcePath" | "scope">): string {
  return referenceKey(file.sourcePath, file.scope);
}

export function mergeReferenceFiles(...groups: ReferenceFileInfo[][]): ReferenceFileInfo[] {
  const merged = new Map<string, ReferenceFileInfo>();
    for (const group of groups) {
    for (const file of group) {
      const key = referenceFileKey(file);
      if (!merged.has(key)) merged.set(key, file);
    }
  }
  return [...merged.values()];
}
