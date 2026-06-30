import type { AppTheme } from "./types";

export type ThemeDefinition = {
  id: AppTheme;
  label: string;
  description: string;
  mode: "light" | "dark";
};

export const themeCatalog: ThemeDefinition[] = [
  { id: "standard", label: "Default", description: "白とネイビー", mode: "light" },
  { id: "notion", label: "Notion", description: "温白色とチャコール", mode: "light" },
  { id: "claude", label: "Claude", description: "クリームとコーラル", mode: "light" },
  { id: "apple-light", label: "Apple", description: "ミニマルな白とブルー", mode: "light" },
  { id: "smarthr-light", label: "Worker", description: "Stone系とプロダクトブルー", mode: "light" },
  { id: "life-light", label: "Life", description: "淡い業務UIとメディカルブルー", mode: "light" },
  { id: "yamaha-light", label: "Resonance", description: "白とロイヤルバイオレット", mode: "light" },
  { id: "ana-light", label: "BlueSky", description: "清潔な白とブルー", mode: "light" },
  { id: "nissan-light", label: "Drive", description: "構造的な白とレッド", mode: "light" },
  { id: "nec-light", label: "Orchestrating", description: "青みのある白とブルー", mode: "light" },
  { id: "fujitsu-light", label: "Shaping", description: "明快な白とレッド", mode: "light" },
  { id: "paper-light", label: "Paper", description: "新聞紙面の白とネイビー", mode: "light" },
  { id: "one-hundred-light", label: "OneHundred", description: "白とビビッドマゼンタ", mode: "light" },
  { id: "precious-light", label: "Precious", description: "爽快なブルーとゴールド", mode: "light" },
  { id: "evergreen-light", label: "Evergreen", description: "技術文書の白とグリーン", mode: "light" },
  { id: "express-light", label: "Express", description: "自然な白と鉄道グリーン", mode: "light" },
  { id: "education-light", label: "Education", description: "空色と学びのオレンジ", mode: "light" },
  { id: "water-light", label: "Water", description: "白とサステナブルティール", mode: "light" },
  { id: "hands-light", label: "Hands", description: "実用的な白と深緑", mode: "light" },
  { id: "commerce-light", label: "Commerce", description: "ソフトグレーと立体的なピル", mode: "light" },
  { id: "promise-light", label: "Promise", description: "白緑と深緑のグラデーション", mode: "light" },
  { id: "flat-light", label: "Flat", description: "ブルーグレーのグレースケール", mode: "light" },
  { id: "air-light", label: "Air", description: "空色と深いブルーのグラデーション", mode: "light" },
  { id: "passion-light", label: "Passion", description: "深紅とコーラルのグラデーション", mode: "light" },
  { id: "tech-light", label: "Tech", description: "濃紺とスチールブルー", mode: "light" },
  { id: "energy-light", label: "Energy", description: "黄橙と朱色のグラデーション", mode: "light" },
  { id: "dark", label: "Default", description: "グレーブルー", mode: "dark" },
  { id: "apple-dark", label: "Apple", description: "ブラックとブライトブルー", mode: "dark" },
  { id: "yamaha-dark", label: "Resonance", description: "深い紫とラベンダー", mode: "dark" },
  { id: "sony-dark", label: "Cinematic", description: "シネマティックブラック", mode: "dark" },
  { id: "ana-dark", label: "BlueSky", description: "ダークネイビーとブルー", mode: "dark" },
  { id: "nissan-dark", label: "Drive", description: "ニアブラックとレッド", mode: "dark" },
  { id: "nec-dark", label: "Orchestrating", description: "ブルーブラックとブルー", mode: "dark" },
  { id: "fujitsu-dark", label: "Shaping", description: "青みのあるチャコールとレッド", mode: "dark" },
  { id: "paper-dark", label: "Paper", description: "インクブラックと紙面ブルー", mode: "dark" },
  { id: "express-dark", label: "Express", description: "深緑とシグナルグリーン", mode: "dark" },
  { id: "education-dark", label: "Education", description: "夜空色と学びのオレンジ", mode: "dark" },
  { id: "water-dark", label: "Water", description: "深い水面とブライトティール", mode: "dark" },
  { id: "hands-dark", label: "Hands", description: "森林のダークグリーン", mode: "dark" },
  { id: "dandelion-dark", label: "Dandelion", description: "チャコールとクラフトゴールド", mode: "dark" },
  { id: "commerce-dark", label: "Commerce", description: "チャコールと立体的なピル", mode: "dark" },
  { id: "promise-dark", label: "Promise", description: "深緑とミントのグラデーション", mode: "dark" },
  { id: "flat-dark", label: "Flat", description: "ブルーグレーのグレースケール", mode: "dark" },
  { id: "air-dark", label: "Air", description: "夜空とブライトシアンのグラデーション", mode: "dark" },
  { id: "passion-dark", label: "Passion", description: "ワインレッドとコーラルのグラデーション", mode: "dark" },
  { id: "tech-dark", label: "Tech", description: "ブルーブラックとスチールブルー", mode: "dark" },
  { id: "energy-dark", label: "Energy", description: "焦茶と電光オレンジのグラデーション", mode: "dark" },
];

export const getThemeDefinition = (theme: AppTheme) =>
  themeCatalog.find((item) => item.id === theme) ?? themeCatalog[0];
