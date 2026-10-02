import type {
  AppState,
  ManuscriptSnapshot,
  ProjectEntry,
  ProjectFolder,
  WorkspaceDocumentTabs,
} from "../types";
import { workspaceDocumentTabsKey } from "../editor/workspaceDocumentTabs";
import { isPathSameOrInside, normalizePathForCompare, retargetFilesystemPath } from "./projectTree";

const isSameWorkspace = (left: string, right: string) =>
  normalizePathForCompare(left) === normalizePathForCompare(right);

function retarget(path: string, from: string, to: string): string {
  return retargetFilesystemPath(path, from, to) ?? path;
}

function copyPathKeyedEntries<T>(
  record: Record<string, T>,
  from: string,
  to: string,
  mapValue: (value: T) => T = (value) => value,
): Record<string, T> {
  const next = { ...record };
  for (const [path, value] of Object.entries(record)) {
    if (!isPathSameOrInside(path, from)) continue;
    next[retarget(path, from, to)] = mapValue(value);
  }
  return next;
}

function copyWorkspaceKeyedEntry<T>(
  record: Record<string, T>,
  keyOf: (path: string) => string,
  from: string,
  to: string,
  mapValue: (value: T) => T = (value) => value,
): Record<string, T> {
  const sourceKey = Object.keys(record).find((key) => isSameWorkspace(key, keyOf(from)));
  if (sourceKey === undefined) return record;
  return { ...record, [keyOf(to)]: mapValue(record[sourceKey]) };
}

function retargetEntry(entry: ProjectEntry, from: string, to: string): ProjectEntry {
  return {
    ...entry,
    path: retarget(entry.path, from, to),
    children: entry.children.map((child) => retargetEntry(child, from, to)),
  };
}

function retargetTree(tree: ProjectFolder, from: string, to: string, name: string): ProjectFolder {
  return {
    path: retarget(tree.path, from, to),
    name,
    children: tree.children.map((child) => retargetEntry(child, from, to)),
  };
}

/**
 * After a project folder is copied into a library, gives the copy the
 * device-local state the source had: tabs, folds, cursors, and any legacy
 * progress labels or checkpoints still waiting to be migrated into the project.
 * The source's own entries are kept.
 */
export function copyWorkspaceLocalState(
  state: AppState,
  from: string,
  to: string,
  targetName: string,
): AppState {
  const sameKey = (path: string) => path;
  const retargetPaths = (paths: string[]) => paths.map((path) => retarget(path, from, to));
  const sourceSnapshots = state.snapshots.filter((snapshot) =>
    isSameWorkspace(snapshot.workspacePath, from),
  );
  const copiedSnapshots: ManuscriptSnapshot[] = sourceSnapshots.map((snapshot) => ({
    ...snapshot,
    workspacePath: to,
    workspaceName: targetName,
    projectTree: retargetTree(snapshot.projectTree, from, to, targetName),
    files: snapshot.files.map((file) => ({ ...file, path: retarget(file.path, from, to) })),
  }));

  return {
    ...state,
    collapsedFolderPathsByWorkspace: copyWorkspaceKeyedEntry(
      state.collapsedFolderPathsByWorkspace, sameKey, from, to, retargetPaths,
    ),
    collapsedOutlinePathsByWorkspace: copyWorkspaceKeyedEntry(
      state.collapsedOutlinePathsByWorkspace, sameKey, from, to, retargetPaths,
    ),
    collapsedOutlineHeadingKeysByWorkspace: copyWorkspaceKeyedEntry(
      state.collapsedOutlineHeadingKeysByWorkspace, sameKey, from, to,
    ),
    fileProgress: copyPathKeyedEntries(state.fileProgress, from, to),
    fileProgressMigrationVersions: copyWorkspaceKeyedEntry(
      state.fileProgressMigrationVersions, workspaceDocumentTabsKey, from, to,
    ),
    checkpointMigrationVersions: copyWorkspaceKeyedEntry(
      state.checkpointMigrationVersions, workspaceDocumentTabsKey, from, to,
    ),
    cursorPositions: copyPathKeyedEntries(state.cursorPositions, from, to),
    documentTabsByWorkspace: copyWorkspaceKeyedEntry<WorkspaceDocumentTabs>(
      state.documentTabsByWorkspace,
      workspaceDocumentTabsKey,
      from,
      to,
      (session) => ({
        ...session,
        tabs: session.tabs.map((tab) => ({ ...tab, path: retarget(tab.path, from, to) })),
      }),
    ),
    snapshots: [...state.snapshots, ...copiedSnapshots],
  };
}
