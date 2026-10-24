import { invoke } from "@tauri-apps/api/core";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { collectProjectTextFiles, upsertProjectAstDocument } from "./editor/ast/projectAst";
import type {
  DocumentOutlineItem,
  ProjectAst,
  ProjectSearchOutcome,
  ProjectSearchResult,
} from "./editor/ast/types";
import { replaceMarkdownBodyMatches } from "./search/editorFindReplace";
import type { TextSearchOptions } from "./search/textSearch";
import type { AppState, DocumentTab, ProjectFolder, SaveStatus, TextDocument } from "./types";
import { parseFrontMatter } from "./utils/frontmatter";
import { findProjectEntry, isPathSameOrInside } from "./utils/projectTree";
import type { TextEditorHandle } from "./VerticalTextEditor";

type ToastAction = {
  label: string;
  onClick: () => void;
};

const isTauriRuntime = () => "__TAURI_INTERNALS__" in window;

export type ProjectSearchActionDeps = {
  projectFolder: ProjectFolder | null;
  currentFilePath: string | null;
  openTabs: DocumentTab[];
  setOpenTabs: Dispatch<SetStateAction<DocumentTab[]>>;
  markdown: string;
  projectSearchQuery: string;
  projectReplaceValue: string;
  projectSearchOptions: TextSearchOptions;
  hasPropertyConditions: boolean;
  projectSearchOutcome: ProjectSearchOutcome;
  pendingSearchJumpRef: MutableRefObject<ProjectSearchResult | null>;
  editorInstanceRef: MutableRefObject<TextEditorHandle | null>;
  lastSavedMarkdownRef: MutableRefObject<string>;
  didMountEditorRef: MutableRefObject<boolean>;
  setAppState: Dispatch<SetStateAction<AppState>>;
  setProjectAst: Dispatch<SetStateAction<ProjectAst | null>>;
  setActiveMarkdown: (nextMarkdown: string) => void;
  setSaveStatus: (nextStatus: SaveStatus) => void;
  setIsProjectReplacing: Dispatch<SetStateAction<boolean>>;
  setLastError: Dispatch<SetStateAction<string>>;
  setFocusedFolderPath: Dispatch<SetStateAction<string | null>>;
  showToast: (message: string, action?: ToastAction | null) => void;
  requestConfirm: (options: {
    title: string;
    message: string;
    detail?: string;
    confirmLabel: string;
    danger?: boolean;
  }) => Promise<boolean>;
  openWorkspace: (path?: string) => Promise<boolean>;
  handleProjectFileSelect: (path: string) => Promise<void>;
  jumpToEditorLine: (line: number) => void;
};

/**
 * 左サイドバーの検索と置換、ツリーの見出しから飛ぶ操作。検索の結果を開く、今のファイルの中で置換する、
 * 作品全体で置換する。値は App が持ち、描画のたびにその時点の値と書き換え用の関数を受け取る。
 */
export function createProjectSearchActions(deps: ProjectSearchActionDeps) {
  const {
    projectFolder,
    currentFilePath,
    openTabs,
    setOpenTabs,
    markdown,
    projectSearchQuery,
    projectReplaceValue,
    projectSearchOptions,
    hasPropertyConditions,
    projectSearchOutcome,
    pendingSearchJumpRef,
    editorInstanceRef,
    lastSavedMarkdownRef,
    didMountEditorRef,
    setAppState,
    setProjectAst,
    setActiveMarkdown,
    setSaveStatus,
    setIsProjectReplacing,
    setLastError,
    setFocusedFolderPath,
    showToast,
    requestConfirm,
    openWorkspace,
    handleProjectFileSelect,
    jumpToEditorLine,
  } = deps;

  const handleProjectSearchResultOpen = async (result: ProjectSearchResult) => {
    // ライブラリ全体の検索で別の範囲の結果を選んだら、その範囲へ切り替えてから開く。
    if (result.path && projectFolder && !findProjectEntry(projectFolder.children, result.path)) {
      const library = projectFolder.library;
      const scopePath = library
        ? [...library.projects.map((project) => project.path), library.path].find((path) =>
            isPathSameOrInside(result.path, path),
          )
        : null;
      if (!scopePath) return;
      pendingSearchJumpRef.current = result;
      if (!(await openWorkspace(scopePath))) pendingSearchJumpRef.current = null;
      return;
    }
    if (result.path && result.path !== currentFilePath) {
      await handleProjectFileSelect(result.path);
    }
    if (result.absoluteFrom !== undefined && result.absoluteTo !== undefined) {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          editorInstanceRef.current?.selectRange(result.absoluteFrom!, result.absoluteTo!);
          editorInstanceRef.current?.focus();
        });
      });
    } else {
      jumpToEditorLine(result.line);
    }
  };

  const handleReplaceInCurrentFile = () => {
    if (projectSearchQuery.length === 0) {
      showToast("検索語句を入力してください");
      return;
    }

    const result = replaceMarkdownBodyMatches(
      markdown,
      projectSearchQuery,
      projectReplaceValue,
      projectSearchOptions,
    );
    if (result.error) {
      showToast("正規表現に誤りがあります");
      return;
    }
    if (result.count === 0) {
      showToast("置換できる一致がありません");
      return;
    }

    // A replace is an edit of this document: it must reach the autosave even when
    // the body has not been touched since the document was opened.
    didMountEditorRef.current = true;
    setActiveMarkdown(result.markdown);
    setSaveStatus("dirty");
    showToast(`${result.count}件をファイル内で置換しました`);
  };

  const handleReplaceInProject = async () => {
    if (!projectFolder) {
      showToast("先にフォルダを開いてください");
      return;
    }
    if (!isTauriRuntime()) {
      showToast("プロジェクト置換はTauri版で利用できます");
      return;
    }
    if (projectSearchQuery.length === 0) {
      showToast("検索語句を入力してください");
      return;
    }
    if (hasPropertyConditions) {
      showToast("プロパティの条件を含む検索では置換できません");
      return;
    }
    if (projectSearchOutcome.error) {
      showToast("正規表現に誤りがあります");
      return;
    }

    const shouldReplace = await requestConfirm({
      title: "プロジェクト全体を置換",
      message: `${projectSearchOutcome.matchedFileCount}ファイルの${projectSearchOutcome.total}件を置換します。`,
      detail: `検索: ${projectSearchQuery} / 置換: ${projectReplaceValue || "空文字"}\n開いているフォルダ内の本文を保存しながら置換します。`,
      confirmLabel: "置換",
      danger: true,
    });
    if (!shouldReplace) return;

    setIsProjectReplacing(true);
    setLastError("");
    const savedDocuments: TextDocument[] = [];
    // 保存したファイルを、開いているタブと今の本文へ反映する。途中で失敗したときも、
    // それまでに保存した分は反映する（古い本文のタブが残ると、次の保存で置換が元に戻る）。
    const applySavedDocuments = () => {
      const savedByPath = new Map(savedDocuments.map((document) => [document.path, document]));
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

      const activeSavedDocument = currentFilePath ? savedByPath.get(currentFilePath) : null;
      if (activeSavedDocument) {
        lastSavedMarkdownRef.current = activeSavedDocument.content;
        setAppState((current) => ({
          ...current,
          markdown: activeSavedDocument.content,
          lastFilePath: activeSavedDocument.path,
        }));
        setSaveStatus("saved");
      }
    };
    try {
      const files = collectProjectTextFiles(projectFolder);
      let totalCount = 0;

      for (const file of files) {
        const openTab = openTabs.find((tab) => tab.path === file.path);
        const sourceMarkdown =
          openTab?.path === currentFilePath
            ? markdown
            : openTab?.markdown ??
              (await invoke<TextDocument>("read_text_file", { path: file.path })).content;
        const result = replaceMarkdownBodyMatches(
          sourceMarkdown,
          projectSearchQuery,
          projectReplaceValue,
          projectSearchOptions,
        );
        if (result.error) throw new Error(result.error);
        if (result.count === 0) continue;

        const document = await invoke<TextDocument>("save_text_file", {
          path: file.path,
          content: result.markdown,
        });
        savedDocuments.push(document);
        totalCount += result.count;
        setProjectAst((current) =>
          current && current.rootPath === projectFolder.path
            ? upsertProjectAstDocument(current, {
                path: document.path,
                name: document.name,
                text: parseFrontMatter(document.content).body,
              })
            : current,
        );
      }

      if (!savedDocuments.length) {
        showToast("置換できる一致がありません");
        return;
      }

      applySavedDocuments();
      showToast(`${totalCount}件をプロジェクト全体で置換しました`);
    } catch (error) {
      if (savedDocuments.length) applySavedDocuments();
      setLastError(String(error));
      setSaveStatus("error");
    } finally {
      setIsProjectReplacing(false);
    }
  };

  const handleProjectOutlineJump = async (path: string, item: DocumentOutlineItem) => {
    if (path !== currentFilePath) {
      await handleProjectFileSelect(path);
    }
    jumpToEditorLine(item.line);
    setFocusedFolderPath(null);
  };

  return {
    handleProjectSearchResultOpen,
    handleReplaceInCurrentFile,
    handleReplaceInProject,
    handleProjectOutlineJump,
  };
}
