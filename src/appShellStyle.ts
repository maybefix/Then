import type { EditorSettings } from "./types";
import { withIdeographicSpaceFont } from "./utils/fontStack";

// main.appShell に置く CSS 変数。描画のたびに、今の設定と、縦書きのために選び直したフォント名から作る。
export function buildAppShellStyle(
  settings: EditorSettings,
  editorFontFamily: string,
  editorHeadingFontFamily: string,
) {
  return (
    {
      "--editor-font-family": withIdeographicSpaceFont(editorFontFamily),
      "--ui-font-family": settings.uiFontFamily,
      "--plot-font-family":
        settings.plotFontSource === "ui"
          ? settings.uiFontFamily
          : withIdeographicSpaceFont(settings.editorFontFamily),
      "--start-page-font-family":
        settings.startPageFontSource === "editor"
          ? withIdeographicSpaceFont(settings.editorFontFamily)
          : settings.uiFontFamily,
      "--ui-font-scale": settings.uiFontScale,
      "--editor-font-size": `${settings.fontSize}px`,
      "--editor-line-height": settings.lineHeight,
      // 編集領域に対する比率（0〜1）。CSS 側で実寸に乗算する。
      "--editor-measure-h-ratio": settings.editorMeasureHorizontal / 100,
      "--editor-measure-v-ratio": settings.editorMeasureVertical / 100,
      "--editor-heading-font-family": withIdeographicSpaceFont(editorHeadingFontFamily),
      "--typewriter-guide-position": `${settings.typewriterOffset}%`,
      "--zone-sidebar-opacity": settings.zoneModeOpacity,
    } as React.CSSProperties
  );
}
