import { themeCatalog } from "../../themes";
import type { AppTheme } from "../../types";

type ThemePickerModalProps = {
  selectedTheme: AppTheme;
  onClose: () => void;
  onSelect: (theme: AppTheme) => void;
};

export function ThemePickerModal({
  selectedTheme,
  onClose,
  onSelect,
}: ThemePickerModalProps) {
  return (
    <div className="modalBackdrop themePickerBackdrop" role="presentation">
      <section
        className="modal themePickerModal"
        aria-label="テーマを選択"
        role="dialog"
        aria-modal="true"
      >
        <header className="modalHeader">
          <div className="themePickerHeading">
            <h2>テーマを選択</h2>
            <p>選択内容はすぐにプレビューされ、自動的に保存されます。</p>
          </div>
          <button className="modalClose" type="button" aria-label="テーマ選択を閉じる" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="themePickerBody">
          {(["light", "dark"] as const).map((mode) => (
            <section className="themeGroup" key={mode} aria-labelledby={`theme-${mode}-title`}>
              <div className="themeGroupHeader">
                <h3 id={`theme-${mode}-title`}>{mode === "light" ? "ライト" : "ダーク"}</h3>
                <span>{themeCatalog.filter((theme) => theme.mode === mode).length}テーマ</span>
              </div>
              <div className="themeOptions">
                {themeCatalog
                  .filter((theme) => theme.mode === mode)
                  .map((theme) => (
                    <label className="themeOption" key={theme.id}>
                      <input
                        checked={selectedTheme === theme.id}
                        name="theme"
                        type="radio"
                        value={theme.id}
                        onChange={() => onSelect(theme.id)}
                      />
                      <span className={`themePreview themePreview-${theme.id}`} aria-hidden="true">
                        <i />
                        <b />
                      </span>
                      <span className="themeOptionCopy">
                        <strong>{theme.label}</strong>
                        <small>{theme.description}</small>
                      </span>
                    </label>
                  ))}
              </div>
            </section>
          ))}
        </div>
        <footer className="modalActions themePickerActions">
          <button type="button" onClick={onClose}>閉じる</button>
        </footer>
      </section>
    </div>
  );
}
