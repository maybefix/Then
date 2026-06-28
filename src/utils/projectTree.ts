import type { ProjectEntry, ProjectFolder, WorkspaceRecord } from "../types";

export function findFirstTextFile(entries: ProjectEntry[]): ProjectEntry | null {
  for (const entry of entries) {
    if (entry.kind === "file") return entry;
    const child = findFirstTextFile(entry.children);
    if (child) return child;
  }
  return null;
}

export const findFirstMarkdownFile = findFirstTextFile;

export function findProjectEntry(entries: ProjectEntry[], path: string): ProjectEntry | null {
  for (const entry of entries) {
    if (entry.path === path) return entry;
    const child = findProjectEntry(entry.children, path);
    if (child) return child;
  }
  return null;
}

export function findPathToEntry(
  folder: ProjectFolder | null,
  path: string | null,
): Array<ProjectFolder | ProjectEntry> {
  if (!folder) return [];
  if (!path || folder.path === path) return [folder];

  const walk = (
    entries: ProjectEntry[],
    trail: Array<ProjectFolder | ProjectEntry>,
  ): Array<ProjectFolder | ProjectEntry> => {
    for (const entry of entries) {
      const nextTrail = [...trail, entry];
      if (entry.path === path) return nextTrail;
      if (entry.kind === "folder") {
        const match = walk(entry.children, nextTrail);
        if (match.length) return match;
      }
    }
    return [];
  };

  return walk(folder.children, [folder]);
}

export function getFolderChildren(
  folder: ProjectFolder | null,
  folderPath: string,
): ProjectEntry[] {
  if (!folder) return [];
  if (folder.path === folderPath) return folder.children;
  const entry = findProjectEntry(folder.children, folderPath);
  return entry?.kind === "folder" ? entry.children : [];
}

export function replaceFolderChildren(
  folder: ProjectFolder,
  folderPath: string,
  children: ProjectEntry[],
): ProjectFolder {
  if (folder.path === folderPath) {
    return { ...folder, children };
  }

  return {
    ...folder,
    children: replaceEntryChildren(folder.children, folderPath, children),
  };
}

export function replaceEntryChildren(
  entries: ProjectEntry[],
  folderPath: string,
  children: ProjectEntry[],
): ProjectEntry[] {
  return entries.map((entry) => {
    if (entry.path === folderPath && entry.kind === "folder") {
      return { ...entry, children };
    }
    if (entry.kind !== "folder" || entry.children.length === 0) {
      return entry;
    }
    return {
      ...entry,
      children: replaceEntryChildren(entry.children, folderPath, children),
    };
  });
}

export function findContainingFolderPath(
  folder: ProjectFolder | null,
  entryPath: string,
): string | null {
  if (!folder) return null;
  if (folder.children.some((entry) => entry.path === entryPath)) return folder.path;

  const walk = (entries: ProjectEntry[]): string | null => {
    for (const entry of entries) {
      if (entry.kind !== "folder") continue;
      if (entry.children.some((child) => child.path === entryPath)) return entry.path;
      const match = walk(entry.children);
      if (match) return match;
    }
    return null;
  };

  return walk(folder.children);
}

export function movePathInOrder(paths: string[], path: string, direction: -1 | 1): string[] | null {
  const index = paths.indexOf(path);
  const targetIndex = index + direction;
  if (index < 0 || targetIndex < 0 || targetIndex >= paths.length) return null;

  const next = [...paths];
  const [item] = next.splice(index, 1);
  next.splice(targetIndex, 0, item);
  return next;
}

export function movePathToDropPosition(
  paths: string[],
  draggedPath: string,
  targetPath: string,
  position: "before" | "after",
): string[] | null {
  if (draggedPath === targetPath) return null;
  const withoutDragged = paths.filter((path) => path !== draggedPath);
  const targetIndex = withoutDragged.indexOf(targetPath);
  if (targetIndex < 0 || withoutDragged.length === paths.length) return null;

  const insertIndex = position === "before" ? targetIndex : targetIndex + 1;
  const next = [...withoutDragged];
  next.splice(insertIndex, 0, draggedPath);
  return next;
}

export function getWorkspaceName(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).pop() || path;
}

export function getParentPath(path: string): string | null {
  const normalized = path.replace(/[\\/]+$/, "");
  const index = Math.max(normalized.lastIndexOf("\\"), normalized.lastIndexOf("/"));
  return index > 0 ? normalized.slice(0, index) : null;
}

export function upsertRecentWorkspace(
  records: WorkspaceRecord[],
  path: string,
  name = getWorkspaceName(path),
): WorkspaceRecord[] {
  const nextRecord = { path, name, lastOpenedAt: Date.now() };
  return [
    nextRecord,
    ...records.filter((record) => record.path !== path),
  ].slice(0, 12);
}

function normalizePathForCompare(path: string): string {
  return path.replace(/[\\/]+/g, "\\").replace(/\\+$/, "").toLocaleLowerCase();
}

function isPathInsideFolder(path: string, folderPath: string): boolean {
  const normalizedPath = normalizePathForCompare(path);
  const normalizedFolder = normalizePathForCompare(folderPath);
  return (
    normalizedPath !== normalizedFolder &&
    normalizedPath.startsWith(`${normalizedFolder}\\`)
  );
}

export function removeNestedRecentWorkspaces(
  records: WorkspaceRecord[],
  rootPath: string,
): WorkspaceRecord[] {
  return records.filter((record) => !isPathInsideFolder(record.path, rootPath));
}
