import { exportFontFamilies, type ExportFontFamily } from "../../export/types";
import type { SettingsPanelProps } from "./SettingsPanelTypes";
import { SettingsGroup } from "./SettingsGroup";

export function ExportSettings({ settings, onUpdateSettings }: SettingsPanelProps) {
  return (
    <SettingsGroup title="エクスポート">
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
    </SettingsGroup>
  );
}
