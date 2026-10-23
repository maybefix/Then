import type { RefObject } from "react";
import type { TextEditorHandle } from "../VerticalTextEditor";
import type { EditorSelectionSnapshot } from "./selectionEdits";

type EditorClipboardActionDeps = {
  editorInstanceRef: RefObject<TextEditorHandle>;
  writeClipboardText: (text: string) => Promise<void>;
  showToast: (message: string) => void;
  closeEditorContextMenu: () => void;
};

// 右クリックメニューの「コピー」「切り取り」「貼り付け」。クリップボードへ書く処理は、
// タブの「パスをコピー」と共有しているので App から受け取る。
export function createEditorClipboardActions(deps: EditorClipboardActionDeps) {
  const { editorInstanceRef, writeClipboardText, showToast, closeEditorContextMenu } = deps;

  const readClipboardText = async () => {
    if (!navigator.clipboard?.readText) {
      throw new Error("Clipboard read is not available");
    }
    return navigator.clipboard.readText();
  };

  const copyEditorSelection = async (selection: EditorSelectionSnapshot | null) => {
    if (!selection || selection.from === selection.to) {
      showToast("コピーする範囲を選択してください");
      return;
    }

    try {
      await writeClipboardText(selection.text);
      showToast("コピーしました");
    } catch {
      showToast("クリップボードへコピーできませんでした");
    } finally {
      closeEditorContextMenu();
    }
  };

  const cutEditorSelection = async (selection: EditorSelectionSnapshot | null) => {
    const editor = editorInstanceRef.current;
    if (!editor || !selection || selection.from === selection.to) {
      showToast("切り取る範囲を選択してください");
      return;
    }

    try {
      await writeClipboardText(selection.text);
      editor.replaceRange(selection.from, selection.to, "", selection.from);
      editor.focus();
      showToast("切り取りました");
    } catch {
      showToast("クリップボードへ切り取れませんでした");
    } finally {
      closeEditorContextMenu();
    }
  };

  const pasteIntoEditorSelection = async (selection: EditorSelectionSnapshot | null) => {
    const editor = editorInstanceRef.current;
    if (!editor || !selection) return;

    try {
      const pastedText = await readClipboardText();
      if (!pastedText) return;
      editor.replaceRange(
        selection.from,
        selection.to,
        pastedText,
        selection.from + pastedText.length,
      );
      editor.focus();
      showToast("貼り付けました");
    } catch {
      showToast("クリップボードから貼り付けできませんでした");
    } finally {
      closeEditorContextMenu();
    }
  };

  return { copyEditorSelection, cutEditorSelection, pasteIntoEditorSelection };
}
