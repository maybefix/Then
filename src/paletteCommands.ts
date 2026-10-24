import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from "react";
import type { CanvasScope } from "./canvasTypes";
import type { PaletteCommand } from "./components/dialogs/CommandPalette";
import { customNotationSpecs, type createEditorNotationActions } from "./editor/editorNotationActions";
import { createMarkdownTable, tableAtOffset, tableAlignmentEdit } from "./editor/markdownTables";
import { canWrapInlineSelection, type EditorSelectionSnapshot } from "./editor/selectionEdits";
import type { ThenPluginRuntimeHostHandle } from "./plugins/PluginRuntimeHost";
import type { LoadedThenPlugin, ThenPluginCommand } from "./plugins/types";
import type { AppState, ProjectFolder } from "./types";
import type { TextEditorHandle } from "./VerticalTextEditor";

type EditorNotationActions = ReturnType<typeof createEditorNotationActions>;

type PaletteCommandDeps = Pick<
  EditorNotationActions,
  | "applyHeadingShortcut"
  | "applyLineCommentToggle"
  | "applyBoldShortcut"
  | "applyEmphasisShortcut"
  | "openRubyNotationModal"
  | "applyInlineNotation"
  | "openDirectionNotationModal"
  | "clearSelectionNotation"
> & {
  commandPaletteSelectionRef: MutableRefObject<EditorSelectionSnapshot | null>;
  getCurrentEditorSelection: () => EditorSelectionSnapshot | null;
  editorInstanceRef: RefObject<TextEditorHandle>;
  openWorkspace: (path?: string) => Promise<boolean>;
  appState: AppState;
  settings: AppState["settings"];
  requestMultiInput: (request: {
    title: string;
    fields: {
      id: string;
      label: string;
      initialValue: string;
      placeholder?: string;
      optional?: boolean;
      multiline?: boolean;
      options?: { value: string; label: string }[];
    }[];
    confirmLabel: string;
  }) => Promise<Record<string, string> | null>;
  showToast: (message: string) => void;
  toggleShowComments: () => void;
  projectFolder: ProjectFolder | null;
  handleQuickCreateManuscriptSnapshot: () => Promise<void>;
  openCheckpointStudio: (snapshotId?: string) => void;
  setIsQuickIdeaModalOpen: Dispatch<SetStateAction<boolean>>;
  openIdeaCanvasBoard: (scope?: CanvasScope) => Promise<unknown>;
  openManuscriptTidy: (selection: EditorSelectionSnapshot | null) => void;
  loadedPlugins: LoadedThenPlugin[];
  setIsPluginManagerOpen: Dispatch<SetStateAction<boolean>>;
  pluginCommands: ThenPluginCommand[];
  pluginRuntimeHostRef: RefObject<ThenPluginRuntimeHostHandle>;
};

// コマンドパレット（Ctrl+P）に並べる操作の一覧。
// App はパレットを描くたびにその時点の値で呼ぶ（値を読む時点を今と同じにするため）。
export function createPaletteCommands(deps: PaletteCommandDeps): PaletteCommand[] {
  const {
    commandPaletteSelectionRef,
    getCurrentEditorSelection,
    editorInstanceRef,
    applyHeadingShortcut,
    openWorkspace,
    appState,
    settings,
    requestMultiInput,
    showToast,
    applyLineCommentToggle,
    toggleShowComments,
    applyBoldShortcut,
    applyEmphasisShortcut,
    projectFolder,
    handleQuickCreateManuscriptSnapshot,
    openCheckpointStudio,
    setIsQuickIdeaModalOpen,
    openIdeaCanvasBoard,
    openRubyNotationModal,
    applyInlineNotation,
    openDirectionNotationModal,
    clearSelectionNotation,
    openManuscriptTidy,
    loadedPlugins,
    setIsPluginManagerOpen,
    pluginCommands,
    pluginRuntimeHostRef,
  } = deps;

  const selection = commandPaletteSelectionRef.current ?? getCurrentEditorSelection();
  const editor = editorInstanceRef.current;
  const table = editor && selection ? tableAtOffset(editor.getValue(), selection.from) : null;
  // 本文を使う項目は、本文がなければ同じ理由で使えなくする。
  const editorDisabled = editor ? undefined : "本文を開いてください";
  const tableDisabled = editorDisabled ?? (table ? undefined : "表のセルにカーソルを置いてください");
  const canWrap = selection ? canWrapInlineSelection(selection) : false;
  const wrapDisabled = editorDisabled ?? (canWrap ? undefined : "単一行の範囲を選択してください");

  const headingCommands: PaletteCommand[] = [1, 2, 3, 4, 5, 6].map((level) => ({
    id: `heading-${level}`,
    label: `見出し${level}`,
    hint: `Ctrl+${level}`,
    disabledReason: editorDisabled,
    run: () => applyHeadingShortcut(level, selection ?? undefined),
  }));
  const workspaceCommands: PaletteCommand[] = [
    {
      id: "workspace-open",
      label: "別のプロジェクトを開く...",
      hint: "プロジェクト",
      run: () => void openWorkspace(),
    },
    // 今開いている作品は出さない（パンくずのメニューと同じく、パスが同じものを今の作品とみなす）。
    ...appState.recentWorkspaces
      .filter((workspace) => workspace.path !== projectFolder?.path)
      .map((workspace) => ({
        id: `workspace-open-${workspace.path}`,
        label: `プロジェクトを開く: ${workspace.name}`,
        hint: settings.showWorkspacePaths ? workspace.path : "プロジェクト",
        run: () => void openWorkspace(workspace.path),
      })),
  ];

  return [
    {
      id: "table-insert",
      label: "表を挿入…",
      hint: "行数・列数を指定",
      disabledReason: editorDisabled,
      run: () => void (async () => {
        if (!editor || !selection) return;
        const originalText = editor.getValue();
        const values = await requestMultiInput({
          title: "表を挿入",
          fields: [
            { id: "columns", label: "列数", initialValue: "3", options: Array.from({ length: 10 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}列` })) },
            { id: "rows", label: "データ行数（見出しを除く）", initialValue: "3", options: Array.from({ length: 20 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}行` })) },
          ],
          confirmLabel: "挿入",
        });
        if (!values) return;
        if (editorInstanceRef.current !== editor || editor.getValue() !== originalText) {
          showToast("本文が変わったため、挿入位置を選び直してください");
          return;
        }
        const before = originalText.slice(0, selection.from);
        const after = originalText.slice(selection.to);
        const prefix = before ? (before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n") : "";
        const suffix = after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
        const insert = prefix + createMarkdownTable(Number(values.columns), Number(values.rows)) + suffix;
        const cursor = selection.from + prefix.length + 1;
        editor.replaceRange(selection.from, selection.to, insert, cursor);
        editor.selectRange(cursor, cursor + "見出し1".length);
        editor.focus();
        showToast("表を挿入しました。セルを編集できます");
      })(),
    },
    ...([ ["start", "開始揃え（横書き：左／縦書き：上）"], ["center", "中央揃え"], ["end", "終了揃え（横書き：右／縦書き：下）"] ] as const).map(([alignment, label]) => ({
      id: `table-align-${alignment}`,
      label: `表：この列を${label}`,
      hint: table ? `${table.column + 1}列目` : "列の配置",
      disabledReason: tableDisabled,
      run: () => {
        if (!editor || !selection) return;
        const edit = tableAlignmentEdit(editor.getValue(), selection.from, alignment);
        if (!edit) return;
        editor.replaceRange(edit.from, edit.to, edit.insert, edit.cursorPos);
        editor.focus();
        showToast(`列を${label}にしました`);
      },
    })),
    {
      id: "line-comment-toggle",
      label: "行をコメントにする／戻す",
      hint: "Ctrl+/",
      disabledReason: editorDisabled,
      run: () => applyLineCommentToggle(selection ?? undefined),
    },
    {
      id: "comments-visibility",
      label: settings.showComments ? "コメントを非表示にする" : "コメントを表示する",
      hint: "Ctrl+Shift+/",
      run: toggleShowComments,
    },
    {
      id: "bold",
      label: "太字",
      hint: "Ctrl+B",
      disabledReason: editorDisabled,
      run: () => applyBoldShortcut(selection ?? undefined),
    },
    {
      id: "emphasis",
      label: "圏点（傍点）",
      hint: "Ctrl+I",
      disabledReason: wrapDisabled,
      run: () => applyEmphasisShortcut(selection ?? undefined),
    },
    {
      id: "checkpoint-create",
      label: "今の状態を保存点にする",
      hint: "Ctrl+Shift+S",
      disabledReason: projectFolder ? undefined : "プロジェクトを開いてください",
      run: () => void handleQuickCreateManuscriptSnapshot(),
    },
    {
      id: "checkpoint-open",
      label: "チェックポイントを開く",
      hint: "チェックポイント",
      disabledReason: projectFolder ? undefined : "プロジェクトを開いてください",
      run: () => openCheckpointStudio(),
    },
    {
      id: "idea-quick-capture",
      label: "Idea にメモを追加…",
      hint: "Ctrl+Alt+I",
      run: () => setIsQuickIdeaModalOpen(true),
    },
    {
      id: "idea-board-open",
      label: "Idea Board を開く",
      hint: "Ctrl+Alt+B",
      disabledReason: projectFolder ? undefined : "プロジェクトを開いてください",
      run: () => void openIdeaCanvasBoard("project"),
    },
    {
      id: "ruby",
      label: "ルビ…",
      hint: customNotationSpecs[0].syntax,
      disabledReason: wrapDisabled,
      run: () => openRubyNotationModal(selection),
    },
    {
      id: "tcy",
      label: "縦中横",
      hint: customNotationSpecs[1].syntax,
      disabledReason: wrapDisabled,
      run: () => {
        if (selection) applyInlineNotation(selection, "tcy");
      },
    },
    ...headingCommands,
    {
      id: "heading-clear",
      label: "見出しを解除",
      hint: "Ctrl+0",
      disabledReason: editorDisabled,
      run: () => applyHeadingShortcut(0, selection ?? undefined),
    },
    {
      id: "direction",
      label: "文章方向…",
      hint: customNotationSpecs[3].syntax,
      disabledReason: editorDisabled,
      run: () => openDirectionNotationModal(selection),
    },
    {
      id: "clear-notation",
      label: "記法をクリア",
      disabledReason: editorDisabled,
      run: () => clearSelectionNotation(selection),
    },
    {
      id: "manuscript-tidy",
      label: "原稿を整える…",
      hint: "字下げ・！？の後の空き",
      disabledReason: editorDisabled,
      run: () => openManuscriptTidy(selection),
    },
    ...workspaceCommands,
    {
      id: "plugin-manage",
      label: "プラグインを管理…",
      hint: `${loadedPlugins.length}個を導入済み`,
      run: () => setIsPluginManagerOpen(true),
    },
    ...pluginCommands.map((command) => ({
      id: `plugin:${command.pluginId}:${command.id}`,
      label: command.title,
      hint: command.keybinding ?? command.pluginId,
      run: () => pluginRuntimeHostRef.current?.executeCommand(command.pluginId, command.id),
    })),
  ];
}
