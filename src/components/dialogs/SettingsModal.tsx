import { useState } from "react";
import type { EditorSettings, FontOption } from "../../types";
import {
  EDITOR_MEASURE_PERCENT_MAX,
  EDITOR_MEASURE_PERCENT_MIN,
  UI_FONT_SCALE_CHOICES,
} from "../../types";
import { exportFontFamilies, type ExportFontFamily } from "../../export/types";
import { getThemeDefinition } from "../../themes";

type SettingsModalProps = {
  settings: EditorSettings;
  systemFonts: FontOption[];
  /**
   * 文字表示幅 100% に相当する編集領域の実測px。百分率の実寸表示に使う。
   * エディタ非表示中（実測不能）は null。
   */
  editorMeasureLimit: number | null;
  onClose: () => void;
  onOpenThemePicker: () => void;
  onUpdateSettings: <Key extends keyof EditorSettings>(
    key: Key,
    value: EditorSettings[Key],
  ) => void;
  onSnippetStorageModeChange: (mode: EditorSettings["snippetStorageMode"]) => void;
};

type SettingsTab = "appearance" | "body" | "files" | "canvas" | "export";

const settingsTabs: { id: SettingsTab; label: string }[] = [
  { id: "appearance", label: "外観" },
  { id: "body", label: "本文" },
  { id: "files", label: "ファイル" },
  { id: "canvas", label: "キャンバス" },
  { id: "export", label: "出力" },
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
  const themeDefinition = getThemeDefinition(settings.theme);

  const isHorizontalWriting = settings.writingMode === "horizontal-tb";
  const editorMeasureKey = isHorizontalWriting
    ? "editorMeasureHorizontal"
    : "editorMeasureVertical";
  const editorMeasureValue = isHorizontalWriting
    ? settings.editorMeasureHorizontal
    : settings.editorMeasureVertical;
  /** 現在の百分率に相当する実寸（px）。編集領域が実測できないときは null。 */
  const editorMeasurePx =
    editorMeasureLimit === null
      ? null
      : Math.round((editorMeasureLimit * editorMeasureValue) / 100);

  return (
    <div className="modalBackdrop" role="presentation">
      <section className="modal settingsModal" aria-label="設定" role="dialog" aria-modal="true">
        <header className="modalHeader">
          <h2>設定</h2>
          <button className="modalClose" type="button" aria-label="閉じる" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="settingsTabList" role="tablist" aria-label="設定カテゴリ">
          {settingsTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`settings-panel-${tab.id}`}
              id={`settings-tab-${tab.id}`}
              className={activeTab === tab.id ? "active" : undefined}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="modalForm">
          <section
            className="settingsTabPanel"
            role="tabpanel"
            id={`settings-panel-${activeTab}`}
            aria-labelledby={`settings-tab-${activeTab}`}
          >
            {activeTab === "appearance" && (
              <>
                <div className="themeSettingRow">
                  <span className={`themePreview themePreview-${settings.theme}`} aria-hidden="true">
                    <i />
                    <b />
                  </span>
                  <span className="themeSettingCopy">
                    <small>テーマ</small>
                    <strong>{themeDefinition.label}</strong>
                    <span>{themeDefinition.description}</span>
                  </span>
                  <button className="themePickerButton" type="button" onClick={onOpenThemePicker}>
                    テーマを選ぶ
                  </button>
                </div>
                <label>
                  <span>UIフォント</span>
                  <select
                    value={settings.uiFontFamily}
                    onChange={(event) => onUpdateSettings("uiFontFamily", event.target.value)}
                  >
                    {systemFonts.map((font) => (
                      <option key={font.label} value={font.cssFamily}>
                        {font.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>UI表示サイズ</span>
                  <select
                    value={settings.uiFontScale}
                    onChange={(event) => onUpdateSettings("uiFontScale", Number(event.target.value))}
                  >
                    {UI_FONT_SCALE_CHOICES.map((scale) => (
                      <option key={scale} value={scale}>
                        {`${Math.round(scale * 100)}%`}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="checkSetting">
                  <input
                    checked={settings.zoneMode}
                    type="checkbox"
                    onChange={(event) => onUpdateSettings("zoneMode", event.target.checked)}
                  />
                  <span>Zoneモード</span>
                </label>
                <label className="rangeSetting">
                  <span>Zone透明度 {Math.round(settings.zoneModeOpacity * 100)}%</span>
                  <input
                    disabled={!settings.zoneMode}
                    min="0"
                    max="0.85"
                    step="0.05"
                    type="range"
                    value={settings.zoneModeOpacity}
                    onChange={(event) =>
                      onUpdateSettings("zoneModeOpacity", Number(event.target.value))
                    }
                  />
                </label>
              </>
            )}

            {activeTab === "body" && (
              <>
                <label>
                  <span>本文フォント</span>
                  <select
                    value={settings.editorFontFamily}
                    onChange={(event) => onUpdateSettings("editorFontFamily", event.target.value)}
                  >
                    {systemFonts.map((font) => (
                      <option key={font.label} value={font.cssFamily}>
                        {font.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>見出し・太字フォント</span>
                  <select
                    value={settings.headingFontSource}
                    onChange={(event) =>
                      onUpdateSettings(
                        "headingFontSource",
                        event.target.value as EditorSettings["headingFontSource"],
                      )
                    }
                  >
                    <option value="body">本文フォントを使う</option>
                    <option value="custom">別フォントを指定</option>
                  </select>
                </label>
                {settings.headingFontSource === "custom" && (
                  <label>
                    <span>見出し・太字の指定フォント</span>
                    <select
                      value={settings.headingFontFamily}
                      onChange={(event) =>
                        onUpdateSettings("headingFontFamily", event.target.value)
                      }
                    >
                      {systemFonts.map((font) => (
                        <option key={font.label} value={font.cssFamily}>
                          {font.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  <span>プロット表示フォント</span>
                  <select
                    value={settings.plotFontSource}
                    onChange={(event) =>
                      onUpdateSettings(
                        "plotFontSource",
                        event.target.value as EditorSettings["plotFontSource"],
                      )
                    }
                  >
                    <option value="editor">本文フォント</option>
                    <option value="ui">UIフォント</option>
                  </select>
                </label>
                <label>
                  <span>本文方向</span>
                  <select
                    value={settings.writingMode}
                    onChange={(event) =>
                      onUpdateSettings(
                        "writingMode",
                        event.target.value as EditorSettings["writingMode"],
                      )
                    }
                  >
                    <option value="vertical-rl">縦書き</option>
                    <option value="horizontal-tb">横書き</option>
                  </select>
                </label>
                <div className="modalFormGrid">
                  <label>
                    <span>文字サイズ</span>
                    <input
                      min="12"
                      max="24"
                      type="number"
                      value={settings.fontSize}
                      onChange={(event) => onUpdateSettings("fontSize", Number(event.target.value))}
                    />
                  </label>
                  <label>
                    <span>行間</span>
                    <input
                      min="1.4"
                      max="2.4"
                      step="0.05"
                      type="number"
                      value={settings.lineHeight}
                      onChange={(event) => onUpdateSettings("lineHeight", Number(event.target.value))}
                    />
                  </label>
                </div>
                <label className="rangeSetting">
                  <span>
                    文字表示幅（{isHorizontalWriting ? "横幅" : "縦幅"}）{" "}
                    {editorMeasureValue}%
                    {editorMeasurePx !== null && `（${editorMeasurePx}px）`}
                  </span>
                  <input
                    min={EDITOR_MEASURE_PERCENT_MIN}
                    max={EDITOR_MEASURE_PERCENT_MAX}
                    step="1"
                    type="range"
                    value={editorMeasureValue}
                    onChange={(event) =>
                      onUpdateSettings(editorMeasureKey, Number(event.target.value))
                    }
                  />
                </label>
                <label className="checkSetting">
                  <input
                    checked={settings.typewriterScroll}
                    type="checkbox"
                    onChange={(event) =>
                      onUpdateSettings("typewriterScroll", event.target.checked)
                    }
                  />
                  <span>タイプライタースクロール</span>
                </label>
                <label className="rangeSetting">
                  <span>固定位置 {settings.typewriterOffset}%</span>
                  <input
                    disabled={!settings.typewriterScroll}
                    min="30"
                    max="65"
                    type="range"
                    value={settings.typewriterOffset}
                    onChange={(event) =>
                      onUpdateSettings("typewriterOffset", Number(event.target.value))
                    }
                  />
                </label>
                <label className="checkSetting">
                  <input
                    checked={settings.showLineBreakMarks}
                    type="checkbox"
                    onChange={(event) =>
                      onUpdateSettings("showLineBreakMarks", event.target.checked)
                    }
                  />
                  <span>改行記号を表示</span>
                </label>
                <label className="checkSetting">
                  <input
                    checked={settings.countWhitespace}
                    type="checkbox"
                    onChange={(event) => onUpdateSettings("countWhitespace", event.target.checked)}
                  />
                  <span>文字数に空白を含める</span>
                </label>
              </>
            )}

            {activeTab === "files" && (
              <>
                <label>
                  <span>ファイル表示方式</span>
                  <select
                    value={settings.sidebarMode}
                    onChange={(event) =>
                      onUpdateSettings(
                        "sidebarMode",
                        event.target.value as EditorSettings["sidebarMode"],
                      )
                    }
                  >
                    <option value="tree">ファイルツリー</option>
                    <option value="navigator">ナビゲータ</option>
                  </select>
                </label>
                <label>
                  <span>ナビゲータのプレビュー行数</span>
                  <select
                    value={settings.navigatorPreviewLines}
                    disabled={settings.sidebarMode !== "navigator"}
                    onChange={(event) =>
                      onUpdateSettings("navigatorPreviewLines", Number(event.target.value))
                    }
                  >
                    <option value={0}>なし</option>
                    <option value={1}>1行</option>
                    <option value={2}>2行</option>
                    <option value={3}>3行</option>
                  </select>
                </label>
                <label className="checkSetting">
                  <input
                    checked={settings.showWorkspacePaths}
                    type="checkbox"
                    onChange={(event) =>
                      onUpdateSettings("showWorkspacePaths", event.target.checked)
                    }
                  />
                  <span>プロジェクト切替にパスを表示</span>
                </label>
                <label className="checkSetting">
                  <input
                    checked={settings.showStatusFilePath}
                    type="checkbox"
                    onChange={(event) =>
                      onUpdateSettings("showStatusFilePath", event.target.checked)
                    }
                  />
                  <span>画面下部にファイルパスを表示</span>
                </label>
                <label className="checkSetting">
                  <input
                    checked={settings.skipStartupPortal}
                    type="checkbox"
                    onChange={(event) =>
                      onUpdateSettings("skipStartupPortal", event.target.checked)
                    }
                  />
                  <span>起動時に前回のワークスペースを直接開く</span>
                </label>
                <label>
                  <span>スニペット保存先</span>
                  <select
                    value={settings.snippetStorageMode}
                    onChange={(event) =>
                      onSnippetStorageModeChange(
                        event.target.value as EditorSettings["snippetStorageMode"],
                      )
                    }
                  >
                    <option value="workspace">フォルダごと</option>
                    <option value="profile">固定プロフィール</option>
                  </select>
                </label>
              </>
            )}

            {activeTab === "canvas" && (
              <>
                <label>
                  <span>Canvas node 既定方向</span>
                  <select
                    value={settings.canvasDefaultWritingMode}
                    onChange={(event) =>
                      onUpdateSettings(
                        "canvasDefaultWritingMode",
                        event.target.value as EditorSettings["canvasDefaultWritingMode"],
                      )
                    }
                  >
                    <option value="horizontal-tb">横書き</option>
                    <option value="vertical-rl">縦書き</option>
                  </select>
                </label>
                <label>
                  <span>Canvas node 既定フォント</span>
                  <select
                    value={settings.canvasDefaultFontSource}
                    onChange={(event) =>
                      onUpdateSettings(
                        "canvasDefaultFontSource",
                        event.target.value as EditorSettings["canvasDefaultFontSource"],
                      )
                    }
                  >
                    <option value="ui">UIフォント</option>
                    <option value="editor">本文フォント</option>
                  </select>
                </label>
                <label className="checkSetting">
                  <input
                    checked={settings.canvasOpensInWindow}
                    type="checkbox"
                    onChange={(event) =>
                      onUpdateSettings("canvasOpensInWindow", event.target.checked)
                    }
                  />
                  <span>キャンバスを別ウィンドウで開く</span>
                </label>
              </>
            )}

            {activeTab === "export" && (
              <>
                <label>
                  <span>DOCX・PDF出力フォント</span>
                  <select
                    value={settings.exportFontFamily}
                    onChange={(event) =>
                      onUpdateSettings("exportFontFamily", event.target.value as ExportFontFamily)
                    }
                  >
                    {exportFontFamilies.map((fontFamily) => (
                      <option key={fontFamily} value={fontFamily}>
                        {fontFamily}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="checkSetting">
                  <input
                    checked={settings.exportOpensInWindow}
                    type="checkbox"
                    onChange={(event) =>
                      onUpdateSettings("exportOpensInWindow", event.target.checked)
                    }
                  />
                  <span>エクスポートを別ウィンドウで開く</span>
                </label>
              </>
            )}
          </section>
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
