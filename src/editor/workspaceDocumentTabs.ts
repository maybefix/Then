import type {
  DocumentTab,
  PersistedDocumentTab,
  ProjectEntry,
  ProjectFolder,
  TextEditorViewportState,
  WorkspaceDocumentTabs,
} from "../types";

export type RestoredWorkspaceTab = {
  savedTab: PersistedDocumentTab;
  entry: ProjectEntry;
  sourceIndex: number;
  match: "path" | "fileId" | "contentHash";
};

export type WorkspaceTabReconciliation = {
  restored: RestoredWorkspaceTab[];
  activeRestoredIndex: number;
  moved: Array<{ name: string; oldPath: string; newPath: string }>;
  missing: PersistedDocumentTab[];
};

export function normalizeWorkspacePath(path: string): string {
  return path.replace(/[\\/]+/g, "\\").replace(/\\+$/, "").toLocaleLowerCase();
}

export function workspaceDocumentTabsKey(workspacePath: string): string {
  return normalizeWorkspacePath(workspacePath);
}

function normalizeViewportState(value: unknown): TextEditorViewportState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const viewport = value as Partial<TextEditorViewportState>;
  if (
    typeof viewport.textLength !== "number" ||
    !Number.isFinite(viewport.textLength) ||
    (viewport.writingMode !== "horizontal-tb" && viewport.writingMode !== "vertical-rl") ||
    typeof viewport.anchorOffset !== "number" ||
    !Number.isFinite(viewport.anchorOffset) ||
    typeof viewport.anchorRatio !== "number" ||
    !Number.isFinite(viewport.anchorRatio)
  ) {
    return null;
  }
  return {
    textLength: Math.max(0, viewport.textLength),
    writingMode: viewport.writingMode,
    anchorOffset: Math.max(0, viewport.anchorOffset),
    anchorRatio: Math.min(1, Math.max(0, viewport.anchorRatio)),
  };
}

function normalizePersistedTab(value: unknown): PersistedDocumentTab | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const tab = value as Partial<PersistedDocumentTab>;
  if (typeof tab.path !== "string" || !tab.path || typeof tab.name !== "string") return null;
  return {
    path: tab.path,
    name: tab.name,
    fileId: typeof tab.fileId === "string" && tab.fileId ? tab.fileId : null,
    contentHash:
      typeof tab.contentHash === "string" && tab.contentHash ? tab.contentHash : null,
    activeOutlineLine:
      typeof tab.activeOutlineLine === "number" && Number.isFinite(tab.activeOutlineLine)
        ? tab.activeOutlineLine
        : null,
    viewportState: normalizeViewportState(tab.viewportState),
  };
}

export function normalizeWorkspaceDocumentTabs(
  value: unknown,
): Record<string, WorkspaceDocumentTabs> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, WorkspaceDocumentTabs> = {};
  for (const [workspacePath, rawSession] of Object.entries(value)) {
    if (!workspacePath || !rawSession || typeof rawSession !== "object" || Array.isArray(rawSession)) {
      continue;
    }
    const session = rawSession as Partial<WorkspaceDocumentTabs>;
    const tabs = Array.isArray(session.tabs)
      ? session.tabs.map(normalizePersistedTab).filter((tab): tab is PersistedDocumentTab => Boolean(tab))
      : [];
    result[workspaceDocumentTabsKey(workspacePath)] = {
      tabs,
      activeIndex:
        typeof session.activeIndex === "number" && Number.isInteger(session.activeIndex)
          ? Math.max(0, session.activeIndex)
          : 0,
      updatedAt:
        typeof session.updatedAt === "number" && Number.isFinite(session.updatedAt)
          ? session.updatedAt
          : 0,
    };
  }
  return result;
}

export function createWorkspaceDocumentTabs(
  openTabs: DocumentTab[],
  activeTabId: string,
  activeViewportState: TextEditorViewportState | null = null,
): WorkspaceDocumentTabs {
  const fileTabs = openTabs.filter(
    (tab): tab is DocumentTab & { path: string } => tab.kind === "file" && Boolean(tab.path),
  );
  const activeIndex = Math.max(0, fileTabs.findIndex((tab) => tab.id === activeTabId));
  return {
    tabs: fileTabs.map((tab) => ({
      path: tab.path,
      name: tab.name,
      fileId: tab.fileId,
      contentHash: tab.contentHash,
      activeOutlineLine: tab.activeOutlineLine,
      viewportState: tab.id === activeTabId && activeViewportState
        ? activeViewportState
        : tab.viewportState,
    })),
    activeIndex,
    updatedAt: Date.now(),
  };
}

export function collectWorkspaceFiles(folder: ProjectFolder): ProjectEntry[] {
  const files: ProjectEntry[] = [];
  const visit = (entries: ProjectEntry[]) => {
    for (const entry of entries) {
      if (entry.kind === "file") files.push(entry);
      else visit(entry.children);
    }
  };
  visit(folder.children);
  return files;
}

function uniqueUnusedMatch(
  candidates: ProjectEntry[],
  usedPaths: Set<string>,
): ProjectEntry | null {
  const unused = candidates.filter((entry) => !usedPaths.has(normalizeWorkspacePath(entry.path)));
  return unused.length === 1 ? unused[0] : null;
}

export function reconcileWorkspaceDocumentTabs(
  session: WorkspaceDocumentTabs,
  folder: ProjectFolder,
): WorkspaceTabReconciliation {
  const files = collectWorkspaceFiles(folder);
  const byPath = new Map(files.map((entry) => [normalizeWorkspacePath(entry.path), entry]));
  const byFileId = new Map<string, ProjectEntry[]>();
  const byContentHash = new Map<string, ProjectEntry[]>();
  for (const entry of files) {
    if (entry.fileId) byFileId.set(entry.fileId, [...(byFileId.get(entry.fileId) ?? []), entry]);
    if (entry.contentHash) {
      byContentHash.set(entry.contentHash, [...(byContentHash.get(entry.contentHash) ?? []), entry]);
    }
  }

  const usedPaths = new Set<string>();
  const restored: RestoredWorkspaceTab[] = [];
  const missing: PersistedDocumentTab[] = [];
  const moved: WorkspaceTabReconciliation["moved"] = [];

  session.tabs.forEach((savedTab, sourceIndex) => {
    let entry = byPath.get(normalizeWorkspacePath(savedTab.path)) ?? null;
    let match: RestoredWorkspaceTab["match"] = "path";
    if (entry && usedPaths.has(normalizeWorkspacePath(entry.path))) entry = null;

    if (!entry && savedTab.fileId) {
      entry = uniqueUnusedMatch(byFileId.get(savedTab.fileId) ?? [], usedPaths);
      match = "fileId";
    }
    if (!entry && savedTab.contentHash) {
      entry = uniqueUnusedMatch(byContentHash.get(savedTab.contentHash) ?? [], usedPaths);
      match = "contentHash";
    }
    if (!entry) {
      missing.push(savedTab);
      return;
    }

    usedPaths.add(normalizeWorkspacePath(entry.path));
    restored.push({ savedTab, entry, sourceIndex, match });
    if (normalizeWorkspacePath(savedTab.path) !== normalizeWorkspacePath(entry.path)) {
      moved.push({ name: savedTab.name, oldPath: savedTab.path, newPath: entry.path });
    }
  });

  let activeRestoredIndex = restored.findIndex((item) => item.sourceIndex === session.activeIndex);
  if (activeRestoredIndex < 0) {
    activeRestoredIndex = restored.findIndex((item) => item.sourceIndex > session.activeIndex);
  }
  if (activeRestoredIndex < 0 && restored.length) activeRestoredIndex = restored.length - 1;

  return { restored, activeRestoredIndex: Math.max(0, activeRestoredIndex), moved, missing };
}
