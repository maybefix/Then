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
