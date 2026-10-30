import type { Dispatch, RefObject, SetStateAction } from "react";
import type { EditorSelectionSnapshot } from "../../editor/selectionEdits";
import { AppIcon } from "./AppIcon";

type AppMode = "write" | "canvas" | "export" | "checkpoint" | "plugin";

export type TopbarFileMenuProps = {
  fileMenuRef: RefObject<HTMLDivElement>;
  isEditorFocusMode: boolean;
  isFileMenuOpen: boolean;
  setIsFileMenuOpen: Dispatch<SetStateAction<boolean>>;
  closeFileMenuAndRun: (action: () => void | Promise<void>) => void;
  handleNewDocument: () => Promise<void>;
  handleOpenTextFile: () => Promise<void>;
  saveCurrentDocument: () => Promise<void>;
  handleSaveAs: () => Promise<void>;
  handleRegisterCurrentFileAsTemplate: () => Promise<void>;
  canRegisterTemplate: boolean;
  appMode: AppMode;
  openManuscriptTidy: (selection: EditorSelectionSnapshot | null) => void;
  getCurrentEditorSelection: () => EditorSelectionSnapshot | null;
  handleOpenLinkedExport: () => Promise<void>;
  handleOpenProjectFolder: () => Promise<void>;
};

export function TopbarFileMenu(props: TopbarFileMenuProps) {
  const {
    fileMenuRef, isEditorFocusMode, isFileMenuOpen, setIsFileMenuOpen, closeFileMenuAndRun,
    handleNewDocument, handleOpenTextFile, saveCurrentDocument, handleSaveAs,
    handleRegisterCurrentFileAsTemplate, canRegisterTemplate, appMode, openManuscriptTidy, getCurrentEditorSelection,
    handleOpenLinkedExport, handleOpenProjectFolder,
  } = props;

  return (
    <div
      className="fileMenu"
      ref={fileMenuRef}
      aria-hidden={isEditorFocusMode}
      {...(isEditorFocusMode ? { inert: "" } : {})}
    >
      <button
        className="menuButton"
        type="button"
        aria-label="ファイルメニュー"
        aria-expanded={isFileMenuOpen}
        onClick={() => setIsFileMenuOpen((isOpen) => !isOpen)}
      >
        <AppIcon name="menu" className="topbarSvgIcon" />
      </button>
      {isFileMenuOpen && (
        <div className="menuPopover fileMenuPopover" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => closeFileMenuAndRun(handleNewDocument)}
          >
            新規ファイル
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => closeFileMenuAndRun(handleOpenTextFile)}
          >
            ファイルを開く
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => closeFileMenuAndRun(saveCurrentDocument)}
          >
            保存
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => closeFileMenuAndRun(handleSaveAs)}
          >
            別名で保存
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!canRegisterTemplate}
            onClick={() => closeFileMenuAndRun(handleRegisterCurrentFileAsTemplate)}
          >
            このファイルをテンプレートとして登録…
          </button>
          <div className="menuDivider" role="separator" />
          <button
            type="button"
            role="menuitem"
            disabled={appMode !== "write"}
            onClick={() => closeFileMenuAndRun(() => openManuscriptTidy(getCurrentEditorSelection()))}
          >
            原稿を整える…
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => closeFileMenuAndRun(handleOpenLinkedExport)}
          >
            エクスポート…
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => closeFileMenuAndRun(handleOpenProjectFolder)}
          >
            フォルダを開く
          </button>
        </div>
      )}
    </div>
  );
}
