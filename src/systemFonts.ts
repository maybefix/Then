import { invoke } from "@tauri-apps/api/core";
import type {
  FontOption,
} from "./types";
import {
  toCssFontFamilyValue,
} from "./storedStateModel";

export function createFontOptions(fontFamilies: string[]): FontOption[] {
  const uniqueFamilies = new Map<string, FontOption>();

  for (const fontFamily of fontFamilies) {
    const label = fontFamily.trim();
    if (!label || uniqueFamilies.has(label)) continue;
    uniqueFamilies.set(label, {
      label,
      cssFamily: toCssFontFamilyValue(label),
    });
  }

  return Array.from(uniqueFamilies.values()).sort((left, right) =>
    left.label.localeCompare(right.label),
  );
}

const fallbackFontFamilies = [
  "Noto Serif JP",
  "Yu Mincho",
  "Yu Gothic",
  "BIZ UDMincho",
  "BIZ UDPMincho",
  "BIZ UDGothic",
  "BIZ UDPGothic",
  "Consolas",
  "Segoe UI",
];

export const fallbackFontOptions = createFontOptions(fallbackFontFamilies);

export function createSystemFontLoader(isTauriRuntime: () => boolean) {
  async function loadSystemFonts(): Promise<FontOption[]> {
    if (isTauriRuntime()) {
      const fonts = await invoke<string[]>("get_system_fonts");
      const options = createFontOptions(fonts);
      return options.length > 0 ? options : fallbackFontOptions;
    }

    return fallbackFontOptions;
  }

  return loadSystemFonts;
}
