import { isSamePath } from "../utils/projectTree";
import type {
  DocumentTab,
  TextDocument,
  TextEditorViewportState,
} from "../types";

export type ReconciledSavedDocumentTabs = {
  tabs: DocumentTab[];
  activeSavedMarkdown: string | null;
};

/**
 * Reflect a document that has already been persisted by a compound file operation.
 *
 * The active document's saved text is returned separately so callers can update
 * their editor-side saved-value reference before React effects inspect the tabs.
 */
export function reconcileSavedDocumentTabs(
  tabs: DocumentTab[],
  activeTabId: string,
  document: TextDocument,
  options: { viewportState?: TextEditorViewportState | null } = {},
): ReconciledSavedDocumentTabs {
  let activeSavedMarkdown: string | null = null;
  const nextTabs = tabs.map((tab) => {
    if (tab.path !== document.path) return tab;
    if (tab.id === activeTabId) {
      activeSavedMarkdown = document.content;
    }
    return {
      ...tab,
      markdown: document.content,
      savedMarkdown: document.content,
      editorRevision: null,
      name: document.name,
      fileId: document.fileId ?? tab.fileId,
      contentHash: document.contentHash ?? tab.contentHash,
      saveStatus: "saved" as const,
      ...(options.viewportState === undefined
        ? {}
        : { viewportState: options.viewportState }),
    };
  });

  return {
    tabs: nextTabs,
    activeSavedMarkdown,
  };
}

export const scratchFileName = "無題.txt";

export function createScratchDocumentTab(
  markdown = "",
  options: Partial<
    Pick<DocumentTab, "id" | "documentKey" | "name" | "saveStatus" | "savedMarkdown">
  > = {},
): DocumentTab {
  const id = options.id ?? `scratch-${Date.now()}`;
  return {
    id,
    kind: "scratch",
    path: null,
    fileId: null,
    contentHash: null,
    name: options.name ?? scratchFileName,
    markdown,
    savedMarkdown: options.savedMarkdown ?? "",
    editorRevision: null,
    saveStatus: options.saveStatus ?? "dirty",
    documentKey: options.documentKey ?? id,
    activeOutlineLine: null,
    viewportState: null,
  };
}

export function isDirtyDocumentTab(tab: DocumentTab): boolean {
  return (
    tab.saveStatus === "dirty" ||
    tab.saveStatus === "error" ||
    tab.markdown !== tab.savedMarkdown
  );
}

/** 閉じたタブを開き直すときのための記録。保存先のあるファイルタブだけを残す。 */
export type ClosedDocumentTab = {
  workspacePath: string | null;
  path: string;
  index: number;
  viewportState: DocumentTab["viewportState"];
};

/** 文書を一つも開いていない状態を表すタブ。タブ帯には出ない。 */
export function createEmptyDocumentTab(): DocumentTab {
  const id = `empty-${Date.now()}`;
  return {
    ...createScratchDocumentTab("", { id, documentKey: id, saveStatus: "saved" }),
    kind: "empty",
    name: "",
  };
}

export const withoutEmptyTabs = (tabs: DocumentTab[]) => tabs.filter((tab) => tab.kind !== "empty");

/** 新しいタブは、アクティブなタブのすぐ右に置く。基準が見つからなければ末尾。 */
export function insertTabAfter(tabs: DocumentTab[], nextTab: DocumentTab, anchorTabId: string | null) {
  const visible = withoutEmptyTabs(tabs);
  const anchorIndex = anchorTabId ? visible.findIndex((tab) => tab.id === anchorTabId) : -1;
  if (anchorIndex < 0) return [...visible, nextTab];
  return [...visible.slice(0, anchorIndex + 1), nextTab, ...visible.slice(anchorIndex + 1)];
}

/**
 * 作業中のタブを、別のファイル（保存・名前を付けて保存・復元で読んだもの）で置き換えた一覧。
 * 作業中のタブがあればその場所に、なければ同じファイルのタブの場所に、どちらもなければ末尾に置く。
 * 同じファイルのほかのタブは畳む。タブの ID はパスから作るので、ID でなくパスで見分ける。
 */
export function replaceDocumentTab(tabs: DocumentTab[], activeTabId: string, nextTab: DocumentTab) {
  const samePath = (tab: DocumentTab) =>
    Boolean(tab.path && nextTab.path && isSamePath(tab.path, nextTab.path));
  const activeIndex = tabs.findIndex((tab) => tab.id === activeTabId);
  const index = activeIndex >= 0 ? activeIndex : tabs.findIndex(samePath);
  const placed = index >= 0
    ? tabs.flatMap((tab, position) => (position === index ? [nextTab] : samePath(tab) ? [] : [tab]))
    : [...tabs, nextTab];
  return withoutEmptyTabs(placed);
}

export const CLOSED_DOCUMENT_TAB_LIMIT = 10;

export function isClosedTabInWorkspace(record: ClosedDocumentTab, workspacePath: string | null) {
  if (!record.workspacePath || !workspacePath) return record.workspacePath === workspacePath;
  return isSamePath(record.workspacePath, workspacePath);
}

export function createFileDocumentTab(document: TextDocument): DocumentTab {
  return {
    id: `file:${document.path}`,
    kind: "file",
    path: document.path,
    fileId: document.fileId ?? null,
    contentHash: document.contentHash ?? null,
    name: document.name,
    markdown: document.content,
    savedMarkdown: document.content,
    editorRevision: null,
    saveStatus: "saved",
    documentKey: document.path,
    activeOutlineLine: null,
    viewportState: null,
  };
}
