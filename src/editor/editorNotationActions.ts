import type { Dispatch, FormEvent, RefObject, SetStateAction } from "react";
import type { TextEditorHandle } from "../VerticalTextEditor";
import { toggleLineComments } from "./lineComments";
import {
  applyDirectionToSelection,
  applyHeadingToSelection,
  applyRubyToSelection,
  canWrapInlineSelection,
  clearNotationFromSelection,
  findRubyAtSelection,
  normalizeSelectionRange,
  sanitizeNotationArgument,
  toggleBoldSelection,
  toggleEmphasisSelection,
  toggleTcySelection,
  type EditorSelectionSnapshot,
  type LayoutDirection,
} from "./selectionEdits";

export type NotationModalState =
  | {
      type: "ruby";
      selection: EditorSelectionSnapshot;
      reading: string;
      error: string;
    }
  | {
      type: "direction";
      selection: EditorSelectionSnapshot;
    };

export const customNotationSpecs = [
  {
    id: "ruby",
    label: "ルビ",
    syntax: "[本文(rb,ルビ)]",
    description: "選択範囲に読みを付けます",
  },
  {
    id: "tcy",
    label: "縦中横",
    syntax: "[本文(tcy)]",
    description: "選択範囲を縦書き中の横組みにします",
  },
  {
    id: "emphasis",
    label: "圏点",
    syntax: "[本文(em,goma)]",
    description: "選択範囲に圏点を付けます",
  },
  {
    id: "direction",
    label: "文章方向",
    syntax: "[(al:start|center|end)]",
    description: "右クリック位置または選択範囲を含む行の文末に配置指示を付けます",
  },
] as const;

type EditorNotationActionDeps = {
  editorInstanceRef: RefObject<TextEditorHandle>;
  notationModal: NotationModalState | null;
  setNotationModal: Dispatch<SetStateAction<NotationModalState | null>>;
  showToast: (message: string) => void;
  closeEditorContextMenu: () => void;
};

// 右クリックメニュー・記法のダイアログ・Ctrl+B などから、記法を本文に入れる操作。
// App は描画のたびにその時点の値で呼び、今と同じ名前で取り出す。
export function createEditorNotationActions(deps: EditorNotationActionDeps) {
  const { editorInstanceRef, notationModal, setNotationModal, showToast, closeEditorContextMenu } = deps;

  const applyInlineNotation = (
    selection: EditorSelectionSnapshot,
    notation: "ruby" | "tcy" | "emphasis",
    argument = "",
  ) => {
    const editor = editorInstanceRef.current;
    if (!editor) return false;

    const text = editor.getValue();
    const currentSelection = normalizeSelectionRange(selection, text);
    if (!canWrapInlineSelection(currentSelection)) {
      showToast("単一行の範囲を選択してください");
      return false;
    }

    const arg = sanitizeNotationArgument(argument);
    if (notation === "ruby" && !arg) {
      setNotationModal((current) =>
        current?.type === "ruby" ? { ...current, error: "ルビを入力してください" } : current,
      );
      return false;
    }

    // すでに付いた記法に当たれば、圏点と縦中横は外し、ルビは読みを置き換える。
    const edit =
      notation === "ruby"
        ? applyRubyToSelection(text, currentSelection, arg)
        : notation === "emphasis"
          ? toggleEmphasisSelection(text, currentSelection)
          : toggleTcySelection(text, currentSelection);
    if (!edit) return false;
    // 外したときだけ、書き換えた後の文字が元より短くなる（ルビの読みの置き換えは除く）。
    const removed = notation !== "ruby" && edit.insert.length < edit.to - edit.from;

    editor.replaceRange(edit.from, edit.to, edit.insert, edit.cursorPos);
    editor.focus();
    const label = customNotationSpecs.find((item) => item.id === notation)?.label;
    showToast(`${label}を${removed ? "解除" : "反映"}しました`);
    return true;
  };

  const applyDirectionNotation = (
    selection: EditorSelectionSnapshot,
    direction: LayoutDirection,
  ) => {
    const editor = editorInstanceRef.current;
    if (!editor) return false;

    const currentText = editor.getValue();
    const currentSelection = normalizeSelectionRange(selection, currentText);
    const replacement = applyDirectionToSelection(currentText, currentSelection, direction);

    editor.replaceRange(
      replacement.from,
      replacement.to,
      replacement.insert,
      replacement.cursorPos,
    );
    editor.focus();
    showToast("文章方向を反映しました");
    return true;
  };

  const clearSelectionNotation = (selection: EditorSelectionSnapshot | null) => {
    const editor = editorInstanceRef.current;
    if (!editor || !selection) return false;

    const currentText = editor.getValue();
    const currentSelection = normalizeSelectionRange(selection, currentText);
    const replacement = clearNotationFromSelection(currentText, currentSelection);

    if (!replacement.changed) {
      showToast("クリアできる記法がありません");
      closeEditorContextMenu();
      return false;
    }

    editor.replaceRange(
      replacement.from,
      replacement.to,
      replacement.insert,
      replacement.cursorPos,
    );
    editor.focus();
    showToast("記法をクリアしました");
    closeEditorContextMenu();
    return true;
  };

  const applyBoldShortcut = (selectionOverride?: EditorSelectionSnapshot) => {
    const editor = editorInstanceRef.current;
    if (!editor) return;
    const text = editor.getValue();
    const selection = normalizeSelectionRange(selectionOverride ?? editor.getSelection(), text);
    const edit = toggleBoldSelection(text, selection);
    if (!edit) {
      showToast("太字にする単一行の範囲を選択してください");
      return;
    }
    editor.replaceRange(edit.from, edit.to, edit.insert, edit.cursorPos);
    editor.focus();
  };

  const applyEmphasisShortcut = (selectionOverride?: EditorSelectionSnapshot) => {
    const editor = editorInstanceRef.current;
    if (!editor) return;
    const text = editor.getValue();
    const selection = normalizeSelectionRange(selectionOverride ?? editor.getSelection(), text);
    const edit = toggleEmphasisSelection(text, selection);
    if (!edit) {
      showToast("圏点を付ける単一行の範囲を選択してください");
      return;
    }
    editor.replaceRange(edit.from, edit.to, edit.insert, edit.cursorPos);
    editor.focus();
  };

  const applyHeadingShortcut = (level: number, selectionOverride?: EditorSelectionSnapshot) => {
    const editor = editorInstanceRef.current;
    if (!editor) return;
    const text = editor.getValue();
    const selection = normalizeSelectionRange(selectionOverride ?? editor.getSelection(), text);
    const edit = applyHeadingToSelection(text, selection, level);
    editor.replaceRange(edit.from, edit.to, edit.insert, edit.cursorPos);
    editor.focus();
    showToast(level <= 0 ? "見出しを解除しました" : `見出し${level}を設定しました`);
  };

  const applyLineCommentToggle = (selectionOverride?: EditorSelectionSnapshot) => {
    const editor = editorInstanceRef.current;
    if (!editor) return;
    const text = editor.getValue();
    const selection = normalizeSelectionRange(selectionOverride ?? editor.getSelection(), text);
    const edit = toggleLineComments(text, selection.from, selection.to);
    if (!edit) return;
    if ("blocked" in edit) {
      showToast("コード内ではコメントにできません（ブロック全体を選ぶとまとめてコメントにできます）");
      return;
    }
    editor.replaceRange(edit.from, edit.to, edit.insert, edit.selectionTo);
    if (edit.selectionFrom !== edit.selectionTo) editor.selectRange(edit.selectionFrom, edit.selectionTo);
    editor.focus();
  };

  const openRubyNotationModal = (selection: EditorSelectionSnapshot | null) => {
    if (!selection || !canWrapInlineSelection(selection)) {
      showToast("ルビを付ける単一行の範囲を選択してください");
      closeEditorContextMenu();
      return;
    }
    // すでに付いたルビなら、今の読みを入れて開く。
    const editor = editorInstanceRef.current;
    const text = editor?.getValue() ?? "";
    const ruby = editor ? findRubyAtSelection(text, normalizeSelectionRange(selection, text)) : null;
    setNotationModal({ type: "ruby", selection, reading: ruby?.reading ?? "", error: "" });
    closeEditorContextMenu();
  };

  const openDirectionNotationModal = (selection: EditorSelectionSnapshot | null) => {
    if (!selection) return;
    setNotationModal({ type: "direction", selection });
    closeEditorContextMenu();
  };

  const submitRubyNotation = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (notationModal?.type !== "ruby") return;
    if (applyInlineNotation(notationModal.selection, "ruby", notationModal.reading)) {
      setNotationModal(null);
    }
  };

  const chooseDirectionNotation = (direction: LayoutDirection) => {
    if (notationModal?.type !== "direction") return;
    if (applyDirectionNotation(notationModal.selection, direction)) {
      setNotationModal(null);
    }
  };

  return {
    applyInlineNotation,
    applyDirectionNotation,
    clearSelectionNotation,
    applyBoldShortcut,
    applyEmphasisShortcut,
    applyHeadingShortcut,
    applyLineCommentToggle,
    openRubyNotationModal,
    openDirectionNotationModal,
    submitRubyNotation,
    chooseDirectionNotation,
  };
}
