import type { ManuscriptSettings as ManuscriptOptions } from "../../types";
import {
  MANUSCRIPT_CHARACTERS_MAX,
  MANUSCRIPT_CHARACTERS_MIN,
  MANUSCRIPT_FONT_SIZE_MAX,
  MANUSCRIPT_FONT_SIZE_MIN,
  MANUSCRIPT_LINES_MAX,
  MANUSCRIPT_LINES_MIN,
} from "../../types";
import { BoundedNumberInput } from "./BoundedNumberInput";
import type { SettingsPanelProps } from "./SettingsPanelTypes";
import { SettingsGroup } from "./SettingsGroup";

export function ManuscriptSettings({ settings, onUpdateSettings }: SettingsPanelProps) {
  const manuscript = settings.manuscript;
  const manuscriptOn = manuscript.layoutMode === "manuscript";
  const updateManuscript = <Key extends keyof ManuscriptOptions>(key: Key, value: ManuscriptOptions[Key]) =>
    onUpdateSettings("manuscript", { ...manuscript, [key]: value });
  return (
    <SettingsGroup title="原稿用紙のレイアウト">
      <label>
        <span>原稿用紙</span>
        <select
          value={manuscript.layoutMode}
          onChange={(event) =>
            updateManuscript("layoutMode", event.target.value as ManuscriptOptions["layoutMode"])
          }
        >
          <option value="normal">使用しない</option>
          <option value="manuscript">使用する</option>
        </select>
      </label>
      {manuscriptOn && (
        <>
          <label>
            <span>原稿用紙の文字サイズ</span>
            <BoundedNumberInput
              min={MANUSCRIPT_FONT_SIZE_MIN}
              max={MANUSCRIPT_FONT_SIZE_MAX}
              step={1}
              value={manuscript.fontSize}
              onChange={(value) => updateManuscript("fontSize", Math.round(value))}
            />
          </label>
          <div className="modalFormGrid">
            <label>
              <span>1行の字数</span>
              <BoundedNumberInput
                min={MANUSCRIPT_CHARACTERS_MIN}
                max={MANUSCRIPT_CHARACTERS_MAX}
                step={1}
                value={manuscript.charactersPerLine}
                onChange={(value) => updateManuscript("charactersPerLine", Math.round(value))}
              />
            </label>
            <label>
              <span>1ページの行数</span>
              <BoundedNumberInput
                min={MANUSCRIPT_LINES_MIN}
                max={MANUSCRIPT_LINES_MAX}
                step={1}
                value={manuscript.linesPerPage}
                onChange={(value) => updateManuscript("linesPerPage", Math.round(value))}
              />
            </label>
          </div>
          <label className="checkSetting">
            <input
              checked={manuscript.showGrid}
              type="checkbox"
              onChange={(event) => updateManuscript("showGrid", event.target.checked)}
            />
            <span>罫線を表示</span>
          </label>
          <label className="checkSetting">
            <input
              checked={manuscript.showPageBoundaries}
              disabled={settings.editorDisplayMode === "paged"}
              type="checkbox"
              onChange={(event) => updateManuscript("showPageBoundaries", event.target.checked)}
            />
            <span>ページ境界を表示</span>
          </label>
        </>
      )}
    </SettingsGroup>
  );
}
