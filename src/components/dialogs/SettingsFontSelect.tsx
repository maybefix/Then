import type { FontOption } from "../../types";

type SettingsFontSelectProps = {
  value: string;
  systemFonts: FontOption[];
  onChange: (value: string) => void;
};

export function SettingsFontSelect({ value, systemFonts, onChange }: SettingsFontSelectProps) {
  const isListed = systemFonts.some((font) => font.cssFamily === value);

  return (
    <select value={value} onChange={(event) => onChange(event.currentTarget.value)}>
      {!isListed && (
        <option value={value}>{value}（フォント一覧にありません）</option>
      )}
      {systemFonts.map((font) => (
        <option key={font.cssFamily} value={font.cssFamily}>
          {font.label}
        </option>
      ))}
    </select>
  );
}
