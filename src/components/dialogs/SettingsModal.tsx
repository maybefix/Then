import type { EditorSettings, FontOption } from "../../types";
import { UI_FONT_SCALE_CHOICES } from "../../types";
import { exportFontFamilies, type ExportFontFamily } from "../../export/types";
import { getThemeDefinition } from "../../themes";

type SettingsModalProps = {
  settings: EditorSettings;
  systemFonts: FontOption[];
  onClose: () => void;
  onOpenThemePicker: () => void;
  onUpdateSettings: <Key extends keyof EditorSettings>(
    key: Key,
    value: EditorSettings[Key],
  ) => void;
  onSnippetStorageModeChange: (mode: EditorSettings["snippetStorageMode"]) => void;
};

export function SettingsModal({
  settings,
  systemFonts,
  onClose,
  onOpenThemePicker,
  onUpdateSettings,
  onSnippetStorageModeChange,
}: SettingsModalProps) {
  return (
    <div className="modalBackdrop" role="presentation">
      <section className="modal settingsModal" aria-label="設定" role="dialog" aria-modal="true">
        <header className="modalHeader">
          <h2>設定</h2>
          <button className="modalClose" type="button" aria-label="閉じる" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="modalForm">
          <div className="themeSettingRow">
            <span className={`themePreview themePreview-${settings.theme}`} aria-hidden="true">
              <i />
              <b />
            </span>
            <span className="themeSettingCopy">
              <small>テーマ</small>
              <strong>{getThemeDefinition(settings.theme).label}</strong>
              <span>{getThemeDefinition(settings.theme).description}</span>
            </span>
            <button className="themePickerButton" type="button" onClick={onOpenThemePicker}>
              テーマを選ぶ
            </button>
          </div>
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
              onChange={(event) =>
                onUpdateSettings("countWhitespace", event.target.checked)
              }
            />
            <span>文字数に空白を含める</span>
          </label>
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
