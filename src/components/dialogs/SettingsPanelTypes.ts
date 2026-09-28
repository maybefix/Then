import type { EditorSettings, FontOption } from "../../types";

export type UpdateSettings = <Key extends keyof EditorSettings>(
  key: Key,
  value: EditorSettings[Key],
) => void;

export type SettingsPanelProps = {
  settings: EditorSettings;
  onUpdateSettings: UpdateSettings;
};

export type FontSettingsPanelProps = SettingsPanelProps & {
  systemFonts: FontOption[];
};
