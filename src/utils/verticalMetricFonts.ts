import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { quoteCssFontFamily, unquoteSingleCssFontFamily } from "./fontStack";

/**
 * 縦書きで横倒しにした欧文が、フォントによって行の左右にずれる問題への対処。
 *
 * Chromium は縦書きの中心線を、フォントが申告する ascent/descent の中点に置く。
 * この値はフォントごとにまちまちで（Noto Serif JP は 1.16/0.29em、
 * SOROEMONO は 0.88/0.12em）、中点が和文の仮想ボディの中心からずれたぶん
 * だけ欧文が左右に寄る。和字は仮想ボディ中心に立つので、ずれは欧文にだけ出る。
 *
 * 選択中の書体を同じ実体（local()）のまま @font-face で包み直し、ascent/descent を
 * 和文の標準的な仮想ボディ（-0.12〜0.88em）として申告させる。値は全書体共通で、
 * 残る差はその書体が仮想ボディ内のどこに欧文を置いたかという書体側の設計だけになる。
 *
 * フェイスはブラウザがそのファミリー名で選ぶものと同じ集合を Rust 側で列挙する
 * （get_font_faces）ので、太字などの選ばれ方は包む前と変わらない。
 * local() が解決できなかったときは、後ろに残した元のファミリーがそのまま使われる。
 */

type FontFaceInfo = {
  localNames: string[];
  weight: number;
  italic: boolean;
};

const STYLE_ELEMENT_ID = "then-vertical-metric-fonts";
const IDEOGRAPHIC_EM_BOX_ASCENT = "88%";
const IDEOGRAPHIC_EM_BOX_DESCENT = "12%";

const faceRequests = new Map<string, Promise<FontFaceInfo[]>>();
const registeredRules = new Map<string, string>();

const isTauriRuntime = () => "__TAURI_INTERNALS__" in window;

function loadFontFaces(family: string): Promise<FontFaceInfo[]> {
  let request = faceRequests.get(family);
  if (!request) {
    request = invoke<FontFaceInfo[]>("get_font_faces", { family }).catch(() => []);
    faceRequests.set(family, request);
  }
  return request;
}

function aliasFamilyName(family: string): string {
  return `Then Vertical Metrics ${family}`;
}

function buildFontFaceRules(alias: string, faces: FontFaceInfo[]): string {
  return faces
    .map((face) => {
      const src = face.localNames.map((name) => `local(${quoteCssFontFamily(name)})`).join(", ");
      return `@font-face { font-family: ${quoteCssFontFamily(alias)}; src: ${src}; font-weight: ${face.weight}; font-style: ${face.italic ? "italic" : "normal"}; ascent-override: ${IDEOGRAPHIC_EM_BOX_ASCENT}; descent-override: ${IDEOGRAPHIC_EM_BOX_DESCENT}; }`;
    })
    .join("\n");
}

function registerRules(alias: string, rules: string): void {
  if (registeredRules.get(alias) === rules) return;
  registeredRules.set(alias, rules);
  let style = document.getElementById(STYLE_ELEMENT_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ELEMENT_ID;
    document.head.appendChild(style);
  }
  style.textContent = Array.from(registeredRules.values()).join("\n");
}

/**
 * 縦書きのときだけ、単一ファミリーの CSS 値を「仮想ボディ申告版, 元のファミリー」に
 * 置き換えて返す。複数ファミリーの指定や、フェイスが取れない書体はそのまま返す。
 */
export function useVerticalMetricFontFamily(cssFamily: string, enabled: boolean): string {
  const family = unquoteSingleCssFontFamily(cssFamily);
  const [resolved, setResolved] = useState<{ family: string; alias: string } | null>(null);

  useEffect(() => {
    if (!enabled || !family || !isTauriRuntime()) return;
    let cancelled = false;
    void loadFontFaces(family).then((faces) => {
      if (cancelled || faces.length === 0) return;
      const alias = aliasFamilyName(family);
      registerRules(alias, buildFontFaceRules(alias, faces));
      setResolved({ family, alias });
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, family]);

  if (!enabled || !family || resolved?.family !== family) return cssFamily;
  return `${quoteCssFontFamily(resolved.alias)}, ${cssFamily}`;
}
