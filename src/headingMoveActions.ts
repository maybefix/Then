import { invoke } from "@tauri-apps/api/core";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { SidebarHeadingSelection } from "./components/layout/WorkspaceSidebar";
import {
  extractHeadingSection,
  moveHeadingSections,
  type HeadingDropPosition,
} from "./editor/ast/headingMove";
import { upsertProjectAstDocument } from "./editor/ast/projectAst";
import type { ProjectAst } from "./editor/ast/types";
import { reconcileSavedDocumentTabs } from "./editor/documentTabState";
import type { AppState, DocumentTab, EditorSettings, ProjectFolder, TextDocument } from "./types";
import { parseFrontMatter } from "./utils/frontmatter";
import { logHeadingDnd } from "./utils/headingDndDiagnostics";
import { getParentPath } from "./utils/projectTree";
import type { TextEditorHandle } from "./VerticalTextEditor";

type ToastAction = {
  label: string;
  onClick: () => void;
};

type HeadingMoveDocuments = {
  documents: TextDocument[];
};

type HeadingExtractDocuments = {
  sourceDocument: TextDocument;
  extractedDocument: TextDocument;
};

function sourceTextExtension(sourcePath: string): string {
  return sourcePath.match(/(\.(?:md|txt))$/i)?.[1] ?? ".txt";
}

// 入れた名前に拡張子がなければ、元のファイルの拡張子を足す（Rust に任せると .txt になる）。
function headingFileNameWithExtension(fileName: string, sourcePath: string): string {
  const trimmed = fileName.trim();
  if (!trimmed || /\.(?:md|txt)$/i.test(trimmed)) return trimmed || fileName;
  return `${trimmed}${sourceTextExtension(sourcePath)}`;
}

function suggestedHeadingFileName(title: string, sourcePath: string): string {
  const extension = sourceTextExtension(sourcePath);
  const sanitized =
    title
      .replace(/[\\/:*?"<>|]/g, " ")
      .replace(/\s+/g, " ")
      .replace(/[.\s]+$/g, "")
      .trim() || "切り出した見出し";
  return `${sanitized}${extension}`;
}

export type HeadingMoveActionDeps = {
  projectFolder: ProjectFolder | null;
  currentFilePath: string | null;
  openTabs: DocumentTab[];
  setOpenTabs: Dispatch<SetStateAction<DocumentTab[]>>;
  settings: EditorSettings;
  headingMoveInProgressRef: MutableRefObject<boolean>;
  activeTabIdRef: MutableRefObject<string>;
  editorInstanceRef: MutableRefObject<TextEditorHandle | null>;
  lastSavedMarkdownRef: MutableRefObject<string>;
  setAppState: Dispatch<SetStateAction<AppState>>;
  setProjectAst: Dispatch<SetStateAction<ProjectAst | null>>;
  setLastError: Dispatch<SetStateAction<string>>;
  showToast: (message: string, action?: ToastAction | null) => void;
  requestChoice: (options: {
    title: string;
    message: string;
    detail?: string;
    primaryLabel: string;
    secondaryLabel: string;
  }) => Promise<"primary" | "secondary" | null>;
  requestInput: (options: {
    title: string;
    label: string;
    initialValue: string;
    confirmLabel: string;
    placeholder?: string;
    optional?: boolean;
  }) => Promise<string | null>;
  loadDocumentIntoEditor: (
    document: TextDocument,
    options?: {
      replaceActive?: boolean;
      index?: number;
      viewportState?: DocumentTab["viewportState"];
    },
  ) => void;
  refreshProjectFolder: (folderPath: string) => Promise<ProjectFolder | null>;
};

/**
 * ファイルツリーの見出しを、ドラッグで動かす操作と、別のファイルへ切り出す操作。値は App が持ち、
 * 描画のたびにその時点の値と書き換え用の関数を受け取る。移動中の札（headingMoveInProgressRef）は2つで共有する。
 */
export function createHeadingMoveActions(deps: HeadingMoveActionDeps) {
  const {
    projectFolder,
    currentFilePath,
    openTabs,
    setOpenTabs,
    settings,
    headingMoveInProgressRef,
    activeTabIdRef,
    editorInstanceRef,
    lastSavedMarkdownRef,
    setAppState,
    setProjectAst,
    setLastError,
    showToast,
    requestChoice,
    requestInput,
    loadDocumentIntoEditor,
    refreshProjectFolder,
  } = deps;

  const handleHeadingMove = async (
    sources: SidebarHeadingSelection[],
    targetPath: string,
    targetLine: number | null,
    targetBlockId: string | null,
    position: HeadingDropPosition,
  ) => {
    logHeadingDnd("reorder-handler-reached", {
      sources,
      targetPath,
      targetLine,
      targetBlockId,
      position,
    });
    if (!sources.length) return;
    if (headingMoveInProgressRef.current) {
      showToast("見出しを移動中です");
      return;
    }
    const affectedPaths = new Set([...sources.map((source) => source.path), targetPath]);
    const affectedTabs = openTabs.filter(
      (tab) => tab.path && affectedPaths.has(tab.path),
    );
    if (affectedTabs.some((tab) => tab.saveStatus === "saving")) {
      showToast("保存完了後に見出しを移動してください");
      return;
    }
    headingMoveInProgressRef.current = true;

    const readMarkdown = async (path: string) => {
      const openTab = openTabs.find((tab) => tab.path === path);
      if (openTab) return openTab.markdown;
      return (await invoke<TextDocument>("read_text_file", { path })).content;
    };

    try {
      const originalDocuments = await Promise.all(
        [...affectedPaths].map(async (path) => ({
          path,
          markdown: await readMarkdown(path),
        })),
      );
      const originalByPath = new Map(
        originalDocuments.map((document) => [document.path, document.markdown] as const),
      );
      const move = moveHeadingSections({
        documents: originalDocuments,
        sources: sources.map((source) => ({
          path: source.path,
          line: source.line,
        })),
        targetPath,
        targetLine,
        position,
      });
      logHeadingDnd("reorder-transform-complete", {
        sourceBlockIds: sources.map((source) => source.blockId),
        targetBlockId,
        changed: move.changed,
        movedTitles: move.movedTitles,
      });
      if (!move.changed) {
        showToast("見出しの移動先が同じため変更はありません");
        return;
      }

      const changedDocuments = move.documents.filter(
        (document) => document.markdown !== originalByPath.get(document.path),
      );
      logHeadingDnd("reorder-save-start", {
        sourceBlockIds: sources.map((source) => source.blockId),
        targetBlockId,
        paths: changedDocuments.map((document) => document.path),
      });
      const saved = await invoke<HeadingMoveDocuments>("save_heading_move", {
        documents: changedDocuments.map((document) => ({
          path: document.path,
          content: document.markdown,
        })),
      });
      const savedDocuments = saved.documents;
      logHeadingDnd("reorder-save-complete", {
        sourceBlockIds: sources.map((source) => source.blockId),
        targetBlockId,
        savedPaths: savedDocuments.map((document) => document.path),
      });
      const savedByPath = new Map(
        savedDocuments.map((document) => [document.path, document] as const),
      );

      setOpenTabs((current) =>
        current.map((tab) => {
          if (!tab.path) return tab;
          const document = savedByPath.get(tab.path);
          if (!document) return tab;
          return {
            ...tab,
            markdown: document.content,
            savedMarkdown: document.content,
            editorRevision: null,
            name: document.name,
            saveStatus: "saved",
          };
        }),
      );
      setProjectAst((current) => {
        if (!current || current.rootPath !== projectFolder?.path) return current;
        return savedDocuments.reduce(
          (next, document) =>
            upsertProjectAstDocument(next, {
              path: document.path,
              name: document.name,
              text: parseFrontMatter(document.content).body,
            }),
          current,
        );
      });

      const activeDocument = currentFilePath ? savedByPath.get(currentFilePath) : null;
      if (activeDocument) {
        lastSavedMarkdownRef.current = activeDocument.content;
        setAppState((current) => ({
          ...current,
          markdown: activeDocument.content,
          lastFilePath: activeDocument.path,
        }));
      }
      logHeadingDnd("state-update-scheduled", {
        sourceBlockIds: sources.map((source) => source.blockId),
        targetBlockId,
        updatedTabPaths: savedDocuments.map((document) => document.path),
      });
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          const outlineRows = Array.from(
            document.querySelectorAll<HTMLElement>("[data-outline-block-id]"),
          );
          const movedRows = outlineRows
            .filter((row) =>
              sources.some(
                (source) => row.dataset.outlineBlockId === source.blockId,
              ),
            )
            .map((row) => ({
              path: row.dataset.outlineFilePath ?? null,
              line: Number(row.dataset.outlineHeadingLine ?? 0),
            }));
          logHeadingDnd("state-dom-updated", {
            sourceBlockIds: sources.map((source) => source.blockId),
            targetBlockId,
            outlineRowCount: outlineRows.length,
            movedRows,
          });
        });
      });
      setLastError("");
      const sourcePaths = new Set(sources.map((source) => source.path));
      showToast(
        move.movedTitles.length === 1
          ? sourcePaths.size === 1 && sourcePaths.has(targetPath)
            ? `見出し「${move.movedTitles[0]}」を移動しました`
            : `見出し「${move.movedTitles[0]}」を別ファイルへ移動しました`
          : `${move.movedTitles.length}件の見出しを移動しました`,
      );
    } catch (error) {
      setLastError(String(error));
      showToast(error instanceof Error ? error.message : "見出しを移動できませんでした");
    } finally {
      headingMoveInProgressRef.current = false;
    }
  };

  const handleHeadingExtract = async (source: SidebarHeadingSelection) => {
    if (headingMoveInProgressRef.current) {
      showToast("見出しを移動中です");
      return;
    }
    const openSourceTab = openTabs.find((tab) => tab.path === source.path);
    if (openSourceTab?.saveStatus === "saving") {
      showToast("保存完了後に見出しを切り出してください");
      return;
    }

    const childChoice = await requestChoice({
      title: "見出しを別ファイルへ切り出す",
      message: `「${source.title}」の子階層も一緒に切り出しますか？`,
      detail: "「この見出しのみ」では、下位レベルの見出しを元ファイルに残します。",
      primaryLabel: "子階層も含める",
      secondaryLabel: "この見出しのみ",
    });
    if (!childChoice) return;

    const fileName = await requestInput({
      title: "切り出すファイル名",
      label: "テキストファイル名",
      initialValue: suggestedHeadingFileName(source.title, source.path),
      confirmLabel: "切り出す",
      placeholder: "例: 第一章.md",
    });
    if (!fileName) return;

    const sourceViewportBeforeExtract =
      openSourceTab?.id === activeTabIdRef.current
        ? editorInstanceRef.current?.getViewportState() ?? openSourceTab.viewportState
        : openSourceTab?.viewportState ?? null;
    headingMoveInProgressRef.current = true;
    try {
      const sourceMarkdown =
        openSourceTab?.markdown ??
        (await invoke<TextDocument>("read_text_file", { path: source.path })).content;
      const extraction = extractHeadingSection({
        sourceMarkdown,
        sourceLine: source.line,
        includeChildren: childChoice === "primary",
      });
      if (!extraction.changed || !extraction.extractedMarkdown) {
        showToast("切り出せる内容がありません");
        return;
      }

      const saved = await invoke<HeadingExtractDocuments>("extract_heading_to_file", {
        sourcePath: source.path,
        fileName: headingFileNameWithExtension(fileName, source.path),
        sourceContent: extraction.sourceMarkdown,
        extractedContent: extraction.extractedMarkdown,
      });
      const reconciledSource = reconcileSavedDocumentTabs(
        openTabs,
        activeTabIdRef.current,
        saved.sourceDocument,
      );
      const savedSourceBody = parseFrontMatter(saved.sourceDocument.content).body;
      const sourceCursorOffset = Math.min(
        extraction.sourceCursorOffset,
        savedSourceBody.length,
      );
      const sourceViewportState = {
        textLength: savedSourceBody.length,
        writingMode: settings.writingMode,
        anchorOffset: sourceCursorOffset,
        anchorRatio:
          sourceViewportBeforeExtract?.anchorRatio ??
          Math.max(0, Math.min(1, settings.typewriterOffset / 100)),
      };
      if (reconciledSource.activeSavedMarkdown !== null) {
        lastSavedMarkdownRef.current = reconciledSource.activeSavedMarkdown;
      }
      setAppState((current) => ({
        ...current,
        ...(reconciledSource.activeSavedMarkdown !== null
          ? {
              markdown: saved.sourceDocument.content,
              lastFilePath: saved.sourceDocument.path,
            }
          : {}),
        cursorPositions: {
          ...current.cursorPositions,
          [saved.sourceDocument.path]: {
            offset: sourceCursorOffset,
            length: savedSourceBody.length,
          },
        },
      }));
      // Switch tabs before yielding so the source update cannot briefly trigger
      // autosave as an unsaved editor change. Reconcile it afterwards to retain
      // a viewport anchored at the extraction point.
      loadDocumentIntoEditor(saved.extractedDocument);
      setOpenTabs((current) =>
        reconcileSavedDocumentTabs(
          current,
          activeTabIdRef.current,
          saved.sourceDocument,
          { viewportState: sourceViewportState },
        ).tabs,
      );
      setProjectAst((current) => {
        if (!current || current.rootPath !== projectFolder?.path) return current;
        return [saved.sourceDocument, saved.extractedDocument].reduce(
          (next, document) =>
            upsertProjectAstDocument(next, {
              path: document.path,
              name: document.name,
              text: parseFrontMatter(document.content).body,
            }),
          current,
        );
      });
      await refreshProjectFolder(getParentPath(source.path) ?? projectFolder?.path ?? "");
      setLastError("");
      showToast(`見出し「${extraction.extractedTitle}」を切り出しました`);
    } catch (error) {
      setLastError(String(error));
      showToast(error instanceof Error ? error.message : "見出しを切り出せませんでした");
    } finally {
      headingMoveInProgressRef.current = false;
    }
  };

  return { handleHeadingMove, handleHeadingExtract };
}
