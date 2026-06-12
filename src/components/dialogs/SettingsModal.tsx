import type { EditorSettings, FontOption } from "../../types";

type SettingsModalProps = {
  settings: EditorSettings;
  systemFonts: FontOption[];
  onClose: () => void;
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
          <footer className="modalActions">
            <button type="button" onClick={onClose}>
              閉じる
            </button>
          </footer>
        </div>
      </section>
    </div>
  );
}
