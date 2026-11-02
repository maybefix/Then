import type { CSSProperties } from "react";
import type { CanvasWindowPayload } from "./canvasTypes";
import type { EditorSettings } from "./types";
import { withIdeographicSpaceFont } from "./utils/fontStack";

type CanvasAppearanceSettings = Pick<
  EditorSettings, "theme" | "editorFontFamily" | "uiFontFamily" | "uiFontScale"
>;

// 開いた時点の外観設定を渡す。ウィンドウ間の同期や設定の保存は行わない。
export function canvasAppearanceSettings(settings: CanvasAppearanceSettings) {
  return {
    theme: settings.theme,
    editorFontFamily: settings.editorFontFamily,
    uiFontFamily: settings.uiFontFamily,
    uiFontScale: settings.uiFontScale,
  };
}

export function buildCanvasThemeStyle(payload: CanvasWindowPayload | null) {
  return {
    "--editor-font-family": withIdeographicSpaceFont(payload?.editorFontFamily),
    "--ui-font-family": payload?.uiFontFamily,
    "--ui-font-scale": payload?.uiFontScale,
  } as CSSProperties;
}

// 埋め込みは親の最新の外観を継承し、別窓はpayloadの外観を自身へ適用する。
export function canvasAppearanceAttributes(
  embedded: boolean,
  payload: CanvasWindowPayload | null,
  themeStyle: CSSProperties,
) {
  return {
    "data-theme": embedded ? undefined : payload?.theme ?? "dark",
    style: embedded ? undefined : themeStyle,
  };
}
