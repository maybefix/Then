import type { EditorSettings } from "../../types";
import type { SettingsPanelProps } from "./SettingsPanelTypes";

export function CanvasSettings({ settings, onUpdateSettings }: SettingsPanelProps) {
  return (
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
  );
}
