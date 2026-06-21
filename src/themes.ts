import type { AppTheme } from "./types";

export type ThemeDefinition = {
  id: AppTheme;
  label: string;
  description: string;
  mode: "light" | "dark";
};

export const themeCatalog: ThemeDefinition[] = [
  { id: "notion", label: "Notion風", description: "温白色とチャコール", mode: "light" },
  { id: "standard", label: "標準", description: "白とネイビー", mode: "light" },
  { id: "claude", label: "Claude風", description: "クリームとコーラル", mode: "light" },
  { id: "apple-light", label: "Apple風", description: "ミニマルな白とブルー", mode: "light" },
  { id: "smarthr-light", label: "SmartHR風", description: "Stone系とプロダクトブルー", mode: "light" },
  { id: "yamaha-light", label: "YAMAHA風", description: "白とロイヤルバイオレット", mode: "light" },
  { id: "ana-light", label: "ANA風", description: "清潔な白とANAブルー", mode: "light" },
  { id: "nissan-light", label: "NISSAN風", description: "構造的な白とNISSANレッド", mode: "light" },
  { id: "nec-light", label: "NEC風", description: "青みのある白とNECブルー", mode: "light" },
  { id: "fujitsu-light", label: "富士通風", description: "明快な白とFujitsuレッド", mode: "light" },
  { id: "dark", label: "標準ダーク", description: "BOTANIST風グレーブルー", mode: "dark" },
  { id: "apple-dark", label: "Apple風", description: "ブラックとブライトブルー", mode: "dark" },
  { id: "yamaha-dark", label: "YAMAHA風", description: "深い紫とラベンダー", mode: "dark" },
  { id: "sony-dark", label: "SONY風", description: "シネマティックブラック", mode: "dark" },
  { id: "ana-dark", label: "ANA風", description: "ダークネイビーとブルー", mode: "dark" },
  { id: "nissan-dark", label: "NISSAN風", description: "ニアブラックとレッド", mode: "dark" },
  { id: "nec-dark", label: "NEC風", description: "ブルーブラックとSkyブルー", mode: "dark" },
  { id: "fujitsu-dark", label: "富士通風", description: "青みのあるチャコールとレッド", mode: "dark" },
];

export const getThemeDefinition = (theme: AppTheme) =>
  themeCatalog.find((item) => item.id === theme) ?? themeCatalog[0];
