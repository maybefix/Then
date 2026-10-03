import type { EditorSettings } from "../../types";
import { UI_FONT_SCALE_CHOICES } from "../../types";
import { getThemeDefinition } from "../../themes";
import { SettingsFontSelect } from "./SettingsFontSelect";
import type { FontSettingsPanelProps } from "./SettingsPanelTypes";

export function AppearanceSettings({ settings, systemFonts, onOpenThemePicker, onUpdateSettings }: FontSettingsPanelProps & { onOpenThemePicker: () => void }) {
  const themeDefinition = getThemeDefinition(settings.theme);
  return (
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
      <label>
        <span>サイドペインの表示</span>
        <select
          value={settings.sidebarHoverMode}
          onChange={(event) =>
            onUpdateSettings(
              "sidebarHoverMode",
              event.target.value as EditorSettings["sidebarHoverMode"],
            )
          }
        >
          <option value="none">左右とも常に表示</option>
          <option value="both">左右ともホバー表示</option>
          <option value="left">左側のみホバー表示</option>
          <option value="right">右側のみホバー表示</option>
        </select>
        <small className="dialogFieldHint">
          ホバー表示にしたペインは画面端へ隠れ、マウスを移すと本文の上へ表示されます
        </small>
      </label>
    </>
  );
}
