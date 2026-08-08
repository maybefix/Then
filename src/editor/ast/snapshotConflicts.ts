export type SnapshotConflictSource = {
  id: string;
  files: Array<{ path: string; textHash: string }>;
};

export function collectSnapshotConflictPaths(
  snapshots: readonly SnapshotConflictSource[],
  currentTextHashes: ReadonlyMap<string, string>,
  normalizePath: (path: string) => string,
): Map<string, Set<string>> {
  return new Map(
    snapshots.map((snapshot) => {
      const conflicts = new Set<string>();
      for (const file of snapshot.files) {
        const key = normalizePath(file.path);
        const currentHash = currentTextHashes.get(key);
        if (currentHash && currentHash !== file.textHash) conflicts.add(key);
      }
      return [snapshot.id, conflicts] as const;
    }),
  );
}
