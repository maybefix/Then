import type { EditorSettings } from "../../types";
import type { SettingsPanelProps } from "./SettingsPanelTypes";
import { SettingsGroup } from "./SettingsGroup";

export function CanvasSettings({ settings, onUpdateSettings }: SettingsPanelProps) {
  return (
    <SettingsGroup title="新しいカードの既定値">
      <label>
        <span>カードの既定方向</span>
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
        <span>カードの既定フォント</span>
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
    </SettingsGroup>
  );
}
