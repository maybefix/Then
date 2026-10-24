import type { Dispatch, KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject, SetStateAction } from "react";
import type { EditorSettings, ProjectFolder } from "../../types";
import { AppIcon } from "./AppIcon";

type AppMode = "write" | "canvas" | "export" | "checkpoint" | "plugin";

type ModeMenuEntry = {
  key: string;
  label: string;
  title: string;
  icon: ReactNode;
  isActive: boolean;
  opensInWindow: boolean;
  select: () => void;
};

export type TopbarActionsProps = {
  appMode: AppMode;
  isEditorFocusMode: boolean;
  settings: EditorSettings;
  toggleEditorFocusMode: () => void;
  isRightSidebarCollapsed: boolean;
  setIsRightSidebarCollapsed: (collapsed: boolean) => void;
  projectFolder: ProjectFolder | null;
  handleQuickCreateManuscriptSnapshot: () => Promise<unknown>;
  updateSettings: <Key extends keyof EditorSettings>(key: Key, value: EditorSettings[Key]) => void;
  setShouldReturnToSettingsAfterThemePicker: Dispatch<SetStateAction<boolean>>;
  setIsThemePickerModalOpen: Dispatch<SetStateAction<boolean>>;
  setIsSettingsModalOpen: Dispatch<SetStateAction<boolean>>;
  modeMenuRef: RefObject<HTMLDivElement>;
  modeMenuButtonRef: RefObject<HTMLButtonElement>;
  isModeMenuOpen: boolean;
  activeModeMenuEntry: ModeMenuEntry | undefined;
  setIsModeMenuOpen: Dispatch<SetStateAction<boolean>>;
  handleModeMenuKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  modeMenuEntries: ModeMenuEntry[];
};

export function TopbarActions(props: TopbarActionsProps) {
  const {
    appMode, isEditorFocusMode, settings, toggleEditorFocusMode, isRightSidebarCollapsed,
    setIsRightSidebarCollapsed, projectFolder, handleQuickCreateManuscriptSnapshot, updateSettings,
    setShouldReturnToSettingsAfterThemePicker, setIsThemePickerModalOpen, setIsSettingsModalOpen,
    modeMenuRef, modeMenuButtonRef, isModeMenuOpen, activeModeMenuEntry, setIsModeMenuOpen,
    handleModeMenuKeyDown, modeMenuEntries,
  } = props;

  return (
    <div
      className="topbarActions"
      aria-hidden={isEditorFocusMode}
      {...(isEditorFocusMode ? { inert: "" } : {})}
    >
      {appMode === "write" && (
        <button
          className={`iconButton editorFocusModeButton ${
            isEditorFocusMode ? "activeIconButton" : ""
          }`}
          type="button"
          aria-label={
            settings.focusModeUsesNativeFullscreen
              ? "エディタを完全フルスクリーン表示"
              : "エディタをフルスクリーン表示"
          }
          aria-pressed={isEditorFocusMode}
          title={
            settings.focusModeUsesNativeFullscreen
              ? "エディタを完全フルスクリーン表示"
              : "エディタをフルスクリーン表示"
          }
          onClick={toggleEditorFocusMode}
        >
          <AppIcon name="fullscreen" className="topbarSvgIcon" />
        </button>
      )}
      {isRightSidebarCollapsed && (appMode === "write" || appMode === "canvas") && (
        <button
          className="iconButton"
          type="button"
          aria-label="右サイドバーを表示"
          title="右サイドバーを表示"
          onClick={() => setIsRightSidebarCollapsed(false)}
        >
          <AppIcon name="panelRight" className="topbarSvgIcon" />
        </button>
      )}
      {projectFolder && appMode !== "checkpoint" && (
        <button
          className="iconButton"
          type="button"
          aria-label="今の状態を保存点にする（Ctrl+Shift+S）"
          title="今の状態を保存点にする（Ctrl+Shift+S）"
          onClick={() => void handleQuickCreateManuscriptSnapshot()}
        >
          <AppIcon name="checkpointAdd" className="topbarSvgIcon" />
        </button>
      )}
      <button
        className={`iconButton ${settings.writingMode === "horizontal-tb" ? "activeIconButton" : ""}`}
        type="button"
        aria-label={settings.writingMode === "horizontal-tb" ? "縦書きに切り替え" : "横書きに切り替え"}
        title={settings.writingMode === "horizontal-tb" ? "縦書きに切り替え" : "横書きに切り替え"}
        onClick={() =>
          updateSettings(
            "writingMode",
            settings.writingMode === "horizontal-tb" ? "vertical-rl" : "horizontal-tb",
          )
        }
      >
        <AppIcon
          name={settings.writingMode === "horizontal-tb" ? "horizontal" : "vertical"}
          className="topbarSvgIcon"
        />
      </button>
      <button
        className="iconButton"
        type="button"
        aria-label="テーマを選択"
        title="テーマを選択"
        onClick={() => {
          setShouldReturnToSettingsAfterThemePicker(false);
          setIsThemePickerModalOpen(true);
        }}
      >
        <AppIcon name="theme" className="topbarSvgIcon" />
      </button>
      <button
        className="iconButton"
        type="button"
        aria-label="設定"
        title="設定"
        onClick={() => setIsSettingsModalOpen(true)}
      >
        <AppIcon name="settings" className="topbarSvgIcon" />
      </button>
      <div className="modeMenu" ref={modeMenuRef}>
        <button
          ref={modeMenuButtonRef}
          className="modeMenuButton"
          type="button"
          aria-haspopup="menu"
          aria-expanded={isModeMenuOpen}
          aria-label={`画面モード：${activeModeMenuEntry?.label ?? ""}`}
          title="画面モードを切り替え"
          onClick={() => setIsModeMenuOpen((isOpen) => !isOpen)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setIsModeMenuOpen(true);
            }
          }}
        >
          {activeModeMenuEntry?.icon}
          <span className="modeMenuButtonLabel">{activeModeMenuEntry?.label}</span>
          <AppIcon name="chevronDown" className="modeMenuChevron" />
        </button>
        {isModeMenuOpen && (
          <div
            className="menuPopover modeMenuPopover"
            role="menu"
            aria-label="画面モード"
            onKeyDown={handleModeMenuKeyDown}
          >
            {modeMenuEntries.map((entry) => (
              <button
                key={entry.key}
                className={entry.isActive ? "activeMenuItem" : ""}
                type="button"
                role="menuitemradio"
                aria-checked={entry.isActive}
                title={entry.title}
                onClick={() => {
                  setIsModeMenuOpen(false);
                  modeMenuButtonRef.current?.focus();
                  entry.select();
                }}
              >
                {entry.icon}
                <span className="modeMenuItemLabel">{entry.label}</span>
                {entry.opensInWindow && (
                  <AppIcon
                    name="openExternal"
                    className="modeMenuExternalIcon"
                  />
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
