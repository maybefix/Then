import { useEffect, useState } from "react";
import type {
  FontOption,
} from "./types";
import { fallbackFontOptions } from "./systemFonts";

/** OSフォントの取得状態。取得関数は呼び出し元で一度だけ組み立てる。 */
export function useSystemFonts(loadSystemFonts: () => Promise<FontOption[]>): FontOption[] {
  const [systemFonts, setSystemFonts] = useState<FontOption[]>(fallbackFontOptions);

  useEffect(() => {
    let isCancelled = false;

    loadSystemFonts()
      .then((fonts) => {
        if (!isCancelled) setSystemFonts(fonts);
      })
      .catch(() => {
        if (!isCancelled) setSystemFonts(fallbackFontOptions);
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  return systemFonts;
}
