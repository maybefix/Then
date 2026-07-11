import { appThemeValues, type AppTheme } from "./types";

export type ThemeDefinition = {
  id: AppTheme;
  label: string;
  description: string;
  mode: "light" | "dark";
};

export const themeCatalog: ThemeDefinition[] = [
  { id: "standard", label: "Default", description: "白とネイビー", mode: "light" },
  { id: "note-light", label: "Note", description: "温白色とチャコール", mode: "light" },
  { id: "coral-light", label: "Coral", description: "クリームとコーラル", mode: "light" },
  { id: "minimal-light", label: "Minimal", description: "ミニマルな白とブルー", mode: "light" },
  { id: "worker-light", label: "Worker", description: "Stone系とプロダクトブルー", mode: "light" },
  { id: "resonance-light", label: "Resonance", description: "白とロイヤルバイオレット", mode: "light" },
  { id: "blue-sky-light", label: "BlueSky", description: "清潔な白とブルー", mode: "light" },
  { id: "drive-light", label: "Drive", description: "構造的な白とレッド", mode: "light" },
  { id: "orchestrating-light", label: "Orchestrating", description: "青みのある白とブルー", mode: "light" },
  { id: "shaping-light", label: "Shaping", description: "明快な白とレッド", mode: "light" },
  { id: "paper-light", label: "Paper", description: "新聞紙面の白とネイビー", mode: "light" },
  { id: "precious-light", label: "Precious", description: "爽快なブルーとゴールド", mode: "light" },
  { id: "express-light", label: "Express", description: "自然な白と鉄道グリーン", mode: "light" },
  { id: "education-light", label: "Education", description: "空色と学びのオレンジ", mode: "light" },
  { id: "water-light", label: "Water", description: "白とサステナブルティール", mode: "light" },
  { id: "hands-light", label: "Hands", description: "実用的な白と深緑", mode: "light" },
  { id: "promise-light", label: "Promise", description: "白緑と深緑のグラデーション", mode: "light" },
  { id: "flat-light", label: "Flat", description: "ブルーグレーのグレースケール", mode: "light" },
  { id: "air-light", label: "Air", description: "空色と深いブルーのグラデーション", mode: "light" },
  { id: "passion-light", label: "Passion", description: "深紅とコーラルのグラデーション", mode: "light" },
  { id: "tech-light", label: "Tech", description: "濃紺とスチールブルー", mode: "light" },
  { id: "dark", label: "Default", description: "グレーブルー", mode: "dark" },
  { id: "minimal-dark", label: "Minimal", description: "ブラックとブライトブルー", mode: "dark" },
  { id: "resonance-dark", label: "Resonance", description: "深い紫とラベンダー", mode: "dark" },
  { id: "cinematic-dark", label: "Cinematic", description: "シネマティックブラック", mode: "dark" },
  { id: "blue-sky-dark", label: "BlueSky", description: "ダークネイビーとブルー", mode: "dark" },
  { id: "drive-dark", label: "Drive", description: "ニアブラックとレッド", mode: "dark" },
  { id: "orchestrating-dark", label: "Orchestrating", description: "ブルーブラックとブルー", mode: "dark" },
  { id: "shaping-dark", label: "Shaping", description: "青みのあるチャコールとレッド", mode: "dark" },
  { id: "paper-dark", label: "Paper", description: "インクブラックと紙面ブルー", mode: "dark" },
  { id: "express-dark", label: "Express", description: "深緑とシグナルグリーン", mode: "dark" },
  { id: "education-dark", label: "Education", description: "夜空色と学びのオレンジ", mode: "dark" },
  { id: "water-dark", label: "Water", description: "深い水面とブライトティール", mode: "dark" },
  { id: "hands-dark", label: "Hands", description: "森林のダークグリーン", mode: "dark" },
  { id: "dandelion-dark", label: "Dandelion", description: "チャコールとクラフトゴールド", mode: "dark" },
  { id: "promise-dark", label: "Promise", description: "深緑とミントのグラデーション", mode: "dark" },
  { id: "flat-dark", label: "Flat", description: "ブルーグレーのグレースケール", mode: "dark" },
  { id: "air-dark", label: "Air", description: "夜空とブライトシアンのグラデーション", mode: "dark" },
  { id: "passion-dark", label: "Passion", description: "ワインレッドとコーラルのグラデーション", mode: "dark" },
  { id: "tech-dark", label: "Tech", description: "ブルーブラックとスチールブルー", mode: "dark" },
];

export const getThemeDefinition = (theme: AppTheme) =>
  themeCatalog.find((item) => item.id === theme) ?? themeCatalog[0];

const legacyThemeAliases: Record<string, AppTheme> = {
  notion: "note-light",
  claude: "coral-light",
  "apple-light": "minimal-light",
  "apple-dark": "minimal-dark",
  "smarthr-light": "worker-light",
  "yamaha-light": "resonance-light",
  "yamaha-dark": "resonance-dark",
  "sony-dark": "cinematic-dark",
  "ana-light": "blue-sky-light",
  "ana-dark": "blue-sky-dark",
  "nissan-light": "drive-light",
  "nissan-dark": "drive-dark",
  "nec-light": "orchestrating-light",
  "nec-dark": "orchestrating-dark",
  "fujitsu-light": "shaping-light",
  "fujitsu-dark": "shaping-dark",
  "commerce-light": "standard",
  "commerce-dark": "dark",
  "life-light": "standard",
  "one-hundred-light": "standard",
  "evergreen-light": "standard",
  "energy-light": "standard",
  "energy-dark": "dark",
};

export const normalizeAppTheme = (theme: unknown): AppTheme => {
  if (typeof theme !== "string") return "dark";
  if (theme in legacyThemeAliases) return legacyThemeAliases[theme];
  return appThemeValues.includes(theme as AppTheme) ? theme as AppTheme : "dark";
};
