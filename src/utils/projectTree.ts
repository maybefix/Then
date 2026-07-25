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

export type BreadcrumbFolderNavigation = {
  path: string;
  name: string;
  children: ProjectEntry[];
  parentPath: string | null;
  parentName: string | null;
};

export type WorkspaceFolderTreeRow = {
  entry: ProjectFolder | ProjectEntry;
  depth: number;
};

/**
 * Flatten the project tree for the workspace switcher while retaining depth.
 * Files are included so expanding a folder exposes something actionable
 * instead of only changing the focused destination folder.
 */
export function getVisibleWorkspaceFolderTreeRows(
  folder: ProjectFolder | null,
  collapsedPaths: ReadonlySet<string>,
): WorkspaceFolderTreeRow[] {
  if (!folder) return [];

  const rows: WorkspaceFolderTreeRow[] = [];
  const walk = (entry: ProjectFolder | ProjectEntry, depth: number) => {
    rows.push({ entry, depth });
    if (
      ("kind" in entry && entry.kind === "file") ||
      collapsedPaths.has(entry.path)
    ) {
      return;
    }
    for (const child of entry.children) {
      walk(child, depth + 1);
    }
  };

  walk(folder, 0);
  return rows;
}

/**
 * Resolve the folder shown inside a breadcrumb popover.
 *
 * The popover remains anchored to a folder in the current file's breadcrumb
 * trail while its contents can drill down into descendants. A stale or
 * out-of-branch browse path falls back to the anchor instead of producing an
 * unreachable menu.
 */
export function getBreadcrumbFolderNavigation(
  folder: ProjectFolder | null,
  anchorPath: string,
  browsePath: string | null,
): BreadcrumbFolderNavigation | null {
  if (!folder) return null;

  const anchorTrail = findPathToEntry(folder, anchorPath);
  const anchor = anchorTrail[anchorTrail.length - 1];
  const anchorIsFolder =
    anchor &&
    ("children" in anchor) &&
    (!("kind" in anchor) || anchor.kind === "folder");
  if (!anchorIsFolder) return null;

  const requestedTrail = browsePath ? findPathToEntry(folder, browsePath) : [];
  const anchorIndex = requestedTrail.findIndex((entry) => entry.path === anchorPath);
  const requested = requestedTrail[requestedTrail.length - 1];
  const requestedIsFolder =
    anchorIndex >= 0 &&
    requested &&
    ("children" in requested) &&
    (!("kind" in requested) || requested.kind === "folder");
  const trail = requestedIsFolder ? requestedTrail : anchorTrail;
  const current = trail[trail.length - 1];
  if (!current || !("children" in current)) return null;

  const currentAnchorIndex = trail.findIndex((entry) => entry.path === anchorPath);
  const parent =
    trail.length - 1 > currentAnchorIndex
      ? trail[trail.length - 2] ?? null
      : null;

  return {
    path: current.path,
    name: current.name,
    children: current.children,
    parentPath: parent?.path ?? null,
    parentName: parent?.name ?? null,
  };
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

export function movePathsToDropPosition(
  paths: string[],
  draggedPaths: string[],
  targetPath: string,
  position: "before" | "after",
): string[] | null {
  const dragged = new Set(draggedPaths);
  if (dragged.has(targetPath)) return null;

  const orderedDragged = paths.filter((path) => dragged.has(path));
  if (orderedDragged.length === 0) return null;
  const withoutDragged = paths.filter((path) => !dragged.has(path));
  const targetIndex = withoutDragged.indexOf(targetPath);
  if (targetIndex < 0) return null;

  const insertIndex = position === "before" ? targetIndex : targetIndex + 1;
  const next = [...withoutDragged];
  next.splice(insertIndex, 0, ...orderedDragged);
  return next.every((path, index) => path === paths[index]) ? null : next;
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

export function normalizePathForCompare(path: string): string {
  return path.replace(/[\\/]+/g, "\\").replace(/\\+$/, "").toLocaleLowerCase();
}

export function isPathInsideFolder(path: string, folderPath: string): boolean {
  const normalizedPath = normalizePathForCompare(path);
  const normalizedFolder = normalizePathForCompare(folderPath);
  return (
    normalizedPath !== normalizedFolder &&
    normalizedPath.startsWith(`${normalizedFolder}\\`)
  );
}

export function isPathSameOrInside(path: string, folderPath: string): boolean {
  return normalizePathForCompare(path) === normalizePathForCompare(folderPath)
    || isPathInsideFolder(path, folderPath);
}

export function removeNestedRecentWorkspaces(
  records: WorkspaceRecord[],
  rootPath: string,
): WorkspaceRecord[] {
  return records.filter((record) => !isPathInsideFolder(record.path, rootPath));
}
