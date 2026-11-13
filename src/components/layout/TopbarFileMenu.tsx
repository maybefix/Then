import type { Dispatch, RefObject, SetStateAction } from "react";
import type { EditorSelectionSnapshot } from "../../editor/selectionEdits";
import { AppIcon } from "./AppIcon";

type AppMode = "write" | "corkboard" | "canvas" | "export" | "checkpoint" | "plugin";

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
  onOpenHelp: () => void;
};

export function TopbarFileMenu(props: TopbarFileMenuProps) {
  const {
    fileMenuRef, isEditorFocusMode, isFileMenuOpen, setIsFileMenuOpen, closeFileMenuAndRun,
    handleNewDocument, handleOpenTextFile, saveCurrentDocument, handleSaveAs,
    handleRegisterCurrentFileAsTemplate, canRegisterTemplate, appMode, openManuscriptTidy, getCurrentEditorSelection,
    handleOpenLinkedExport, handleOpenProjectFolder, onOpenHelp,
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
        aria-haspopup="menu"
        aria-expanded={isFileMenuOpen}
        onClick={() => setIsFileMenuOpen((isOpen) => !isOpen)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          setIsFileMenuOpen(true);
          const last = event.key === "ArrowUp";
          window.requestAnimationFrame(() => {
            const items = fileMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)');
            (last ? items?.[items.length - 1] : items?.[0])?.focus();
          });
        }}
      >
        <AppIcon name="menu" className="topbarSvgIcon" />
      </button>
      {isFileMenuOpen && (
        <div
          className="menuPopover fileMenuPopover"
          role="menu"
          aria-label="ファイルと原稿の操作"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setIsFileMenuOpen(false);
              fileMenuRef.current?.querySelector<HTMLButtonElement>(".menuButton")?.focus();
              return;
            }
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'));
            if (!items.length) return;
            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            const next = event.key === "Home" ? 0
              : event.key === "End" ? items.length - 1
              : event.key === "ArrowDown" ? (index + 1) % items.length
              : (Math.max(index, 0) - 1 + items.length) % items.length;
            items[next].focus();
          }}
        >
          <button
            type="button"
            role="menuitem"
            aria-keyshortcuts="Control+N"
            onClick={() => closeFileMenuAndRun(handleNewDocument)}
          >
            <AppIcon name="filePlus" className="topbarSvgIcon fileMenuIcon" />
            <span className="fileMenuLabel">新規ファイル</span>
            <kbd className="fileMenuShortcut" aria-hidden="true">Ctrl+N</kbd>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => closeFileMenuAndRun(handleOpenTextFile)}
          >
            <AppIcon name="file" className="topbarSvgIcon fileMenuIcon" />
            <span className="fileMenuLabel">ファイルを開く</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => closeFileMenuAndRun(handleOpenProjectFolder)}
          >
            <AppIcon name="folderOpen" className="topbarSvgIcon fileMenuIcon" />
            <span className="fileMenuLabel">フォルダを開く</span>
          </button>
          <div className="menuDivider" role="separator" />
          <button
            type="button"
            role="menuitem"
            onClick={() => closeFileMenuAndRun(saveCurrentDocument)}
          >
            <AppIcon name="save" className="topbarSvgIcon fileMenuIcon" />
            <span className="fileMenuLabel">保存</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => closeFileMenuAndRun(handleSaveAs)}
          >
            <AppIcon name="saveAs" className="topbarSvgIcon fileMenuIcon" />
            <span className="fileMenuLabel">別名で保存</span>
          </button>
          <div className="menuDivider" role="separator" />
          <button
            type="button"
            role="menuitem"
            disabled={!canRegisterTemplate}
            onClick={() => closeFileMenuAndRun(handleRegisterCurrentFileAsTemplate)}
          >
            <AppIcon name="template" className="topbarSvgIcon fileMenuIcon" />
            <span className="fileMenuLabel">テンプレートに登録</span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={appMode !== "write"}
            onClick={() => closeFileMenuAndRun(() => openManuscriptTidy(getCurrentEditorSelection()))}
          >
            <AppIcon name="horizontal" className="topbarSvgIcon fileMenuIcon" />
            <span className="fileMenuLabel">原稿を整える</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => closeFileMenuAndRun(handleOpenLinkedExport)}
          >
            <AppIcon name="export" className="topbarSvgIcon fileMenuIcon" />
            <span className="fileMenuLabel">エクスポート</span>
          </button>
          <div className="menuDivider" role="separator" />
          <button
            type="button"
            role="menuitem"
            onClick={() => closeFileMenuAndRun(onOpenHelp)}
          >
            <AppIcon name="help" className="topbarSvgIcon fileMenuIcon" />
            <span className="fileMenuLabel">ヘルプ</span>
          </button>
        </div>
      )}
    </div>
  );
}
