import { useState, type KeyboardEvent } from "react";
import type { EditorSettings, FontOption } from "../../types";
import { AiSettings } from "./AiSettings";
import { AppearanceSettings } from "./AppearanceSettings";
import { BodySettings } from "./BodySettings";
import { CanvasSettings } from "./CanvasSettings";
import { ExportSettings } from "./ExportSettings";
import { FileSettings } from "./FileSettings";
import { useModalFocus } from "./useModalFocus";

type SettingsModalProps = {
  settings: EditorSettings;
  systemFonts: FontOption[];
  /** 編集領域の実測px。エディタ非表示中は null。 */
  editorMeasureLimit: number | null;
  onClose: () => void;
  onOpenThemePicker: () => void;
  onUpdateSettings: <Key extends keyof EditorSettings>(
    key: Key,
    value: EditorSettings[Key],
  ) => void;
  onSnippetStorageModeChange: (mode: EditorSettings["snippetStorageMode"]) => void;
};

type SettingsTab = "appearance" | "body" | "files" | "canvas" | "export" | "ai";

const settingsTabs: { id: SettingsTab; label: string }[] = [
  { id: "appearance", label: "外観" },
  { id: "body", label: "本文" },
  { id: "files", label: "ファイル" },
  { id: "canvas", label: "キャンバス" },
  { id: "export", label: "出力" },
  { id: "ai", label: "AI" },
];

export function SettingsModal({
  settings,
  systemFonts,
  editorMeasureLimit,
  onClose,
  onOpenThemePicker,
  onUpdateSettings,
  onSnippetStorageModeChange,
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("appearance");
  const dialogRef = useModalFocus(onClose);

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number;
    switch (event.key) {
      case "ArrowRight":
        nextIndex = (index + 1) % settingsTabs.length;
        break;
      case "ArrowLeft":
        nextIndex = (index - 1 + settingsTabs.length) % settingsTabs.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = settingsTabs.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const nextTab = settingsTabs[nextIndex].id;
    setActiveTab(nextTab);
    document.getElementById(`settings-tab-${nextTab}`)?.focus();
  };

  const panels = {
    appearance: (
      <AppearanceSettings
        settings={settings}
        systemFonts={systemFonts}
        onOpenThemePicker={onOpenThemePicker}
        onUpdateSettings={onUpdateSettings}
      />
    ),
    body: (
      <BodySettings
        settings={settings}
        systemFonts={systemFonts}
        editorMeasureLimit={editorMeasureLimit}
        onUpdateSettings={onUpdateSettings}
      />
    ),
    files: (
      <FileSettings
        settings={settings}
        onSnippetStorageModeChange={onSnippetStorageModeChange}
        onUpdateSettings={onUpdateSettings}
      />
    ),
    canvas: <CanvasSettings settings={settings} onUpdateSettings={onUpdateSettings} />,
    export: <ExportSettings settings={settings} onUpdateSettings={onUpdateSettings} />,
    ai: <AiSettings settings={settings} onUpdateSettings={onUpdateSettings} />,
  };

  return (
    <div className="modalBackdrop" role="presentation">
      <section
        ref={dialogRef}
        className="modal settingsModal"
        aria-label="設定"
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
      >
        <header className="modalHeader">
          <h2>設定</h2>
          <button className="modalClose" type="button" aria-label="閉じる" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="settingsTabList" role="tablist" aria-label="設定カテゴリ">
          {settingsTabs.map((tab, index) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`settings-panel-${tab.id}`}
              id={`settings-tab-${tab.id}`}
              tabIndex={activeTab === tab.id ? 0 : -1}
              className={activeTab === tab.id ? "active" : undefined}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="modalForm">
          {settingsTabs.map((tab) => (
            <section
              key={tab.id}
              className="settingsTabPanel"
              role="tabpanel"
              id={`settings-panel-${tab.id}`}
              aria-labelledby={`settings-tab-${tab.id}`}
              hidden={activeTab !== tab.id}
            >
              {activeTab === tab.id ? panels[tab.id] : null}
            </section>
          ))}
        </div>
        <footer className="modalActions">
          <button type="button" onClick={onClose}>
            閉じる
          </button>
        </footer>
      </section>
    </div>
  );
}
