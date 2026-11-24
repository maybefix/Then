import type { EditorSettings } from "../../types";
import { UI_FONT_SCALE_CHOICES } from "../../types";
import { getThemeDefinition } from "../../themes";
import { SettingsFontSelect } from "./SettingsFontSelect";
import { SettingsGroup } from "./SettingsGroup";
import type { FontSettingsPanelProps } from "./SettingsPanelTypes";

export function AppearanceSettings({ settings, systemFonts, onOpenThemePicker, onUpdateSettings }: FontSettingsPanelProps & { onOpenThemePicker: () => void }) {
  const themeDefinition = getThemeDefinition(settings.theme);
  return (
    <>
      <SettingsGroup title="テーマ">
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
      </SettingsGroup>
      <SettingsGroup title="フォントとサイズ">
        <label>
          <span>UIフォント</span>
          <SettingsFontSelect
            value={settings.uiFontFamily}
            systemFonts={systemFonts}
            onChange={(value) => onUpdateSettings("uiFontFamily", value)}
          />
        </label>
        <label>
          <span>作品一覧・スタート画面のフォント</span>
          <select
            value={settings.startPageFontSource}
            onChange={(event) =>
              onUpdateSettings(
                "startPageFontSource",
                event.target.value as EditorSettings["startPageFontSource"],
              )
            }
          >
            <option value="ui">UIフォント</option>
            <option value="editor">本文フォント</option>
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
      </SettingsGroup>
      <SettingsGroup title="画面の表示">
        <label className="checkSetting descriptiveCheckSetting">
          <input
            checked={settings.focusModeUsesNativeFullscreen}
            type="checkbox"
            onChange={(event) =>
              onUpdateSettings("focusModeUsesNativeFullscreen", event.target.checked)
            }
          />
          <span className="checkSettingCopy">
            <span>集中表示で完全フルスクリーンを使用</span>
            <small>タイトルバーとWindowsのタスクバーも隠します</small>
          </span>
        </label>
      </SettingsGroup>
    </>
  );
}
