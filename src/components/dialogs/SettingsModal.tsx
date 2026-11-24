import { useState, type KeyboardEvent } from "react";
import type { EditorSettings, FontOption } from "../../types";
import { AppearanceSettings } from "./AppearanceSettings";
import { BodySettings } from "./BodySettings";
import { CanvasSettings } from "./CanvasSettings";
import { ExportSettings } from "./ExportSettings";
import { FileSettings } from "./FileSettings";
import { ManuscriptSettings } from "./ManuscriptSettings";
import { WritingSettings } from "./WritingSettings";
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
  /** Hands focus back on close (the manuscript needs its own restorer to keep the caret). */
  onRestoreFocus?: (previouslyFocused: HTMLElement) => void;
};

type SettingsTab = "appearance" | "body" | "manuscript" | "writing" | "files" | "canvas" | "export";

const settingsTabs: { id: SettingsTab; label: string; group: string; description: string }[] = [
  { id: "appearance", label: "外観", group: "アプリ", description: "テーマ、UIのフォントや画面の表示を設定します。" },
  { id: "files", label: "ファイルと起動", group: "アプリ", description: "ファイルの表示、文書タブ、チェックポイントと起動時の動作を設定します。" },
  { id: "body", label: "本文", group: "執筆", description: "本文のフォント、文字組みとページの表示を設定します。" },
  { id: "manuscript", label: "原稿用紙", group: "執筆", description: "原稿用紙の字数、行数、文字サイズと罫線を設定します。" },
  { id: "writing", label: "執筆サポート", group: "執筆", description: "スクロール、表示の補助と文字数の集計方法を設定します。" },
  { id: "canvas", label: "キャンバス", group: "ツール", description: "キャンバスに追加するカードの既定値を設定します。" },
  { id: "export", label: "出力", group: "ツール", description: "出力する文書のフォントとエクスポート画面の開き方を設定します。" },
];

export function SettingsModal({
  settings,
  systemFonts,
  editorMeasureLimit,
  onClose,
  onOpenThemePicker,
  onUpdateSettings,
  onRestoreFocus,
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("appearance");
  const dialogRef = useModalFocus(onClose, undefined, onRestoreFocus);

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number;
    switch (event.key) {
      case "ArrowDown":
        nextIndex = (index + 1) % settingsTabs.length;
        break;
      case "ArrowUp":
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
        onUpdateSettings={onUpdateSettings}
      />
    ),
    manuscript: <ManuscriptSettings settings={settings} onUpdateSettings={onUpdateSettings} />,
    writing: <WritingSettings settings={settings} onUpdateSettings={onUpdateSettings} />,
    canvas: <CanvasSettings settings={settings} onUpdateSettings={onUpdateSettings} />,
    export: <ExportSettings settings={settings} onUpdateSettings={onUpdateSettings} />,
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
        <div className="settingsLayout">
          <div className="settingsSidebar" role="tablist" aria-label="設定カテゴリ" aria-orientation="vertical">
            {settingsTabs.map((tab, index) => (
              <div key={tab.id} role="presentation">
                {(index === 0 || settingsTabs[index - 1].group !== tab.group) && (
                  <p className="settingsNavHeading" aria-hidden="true">{tab.group}</p>
                )}
                <button
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
              </div>
            ))}
          </div>
          <div className="modalForm settingsContent" key={activeTab}>
            {settingsTabs.map((tab) => (
              <section
                key={tab.id}
                className="settingsTabPanel"
                role="tabpanel"
                id={`settings-panel-${tab.id}`}
                aria-labelledby={`settings-tab-${tab.id}`}
                hidden={activeTab !== tab.id}
                tabIndex={0}
              >
                {activeTab === tab.id && (
                  <>
                    <div className="settingsPageHeader">
                      <h3>{tab.label}</h3>
                      <p>{tab.description}</p>
                    </div>
                    {panels[tab.id]}
                  </>
                )}
              </section>
            ))}
          </div>
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
