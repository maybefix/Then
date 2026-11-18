// BINDER 3-2: エディタへ渡す「リンクの行き先の引き口」を、索引から作る。
// 索引が変わったとき（`version` が増えたとき）だけ新しい値になるので、
// エディタはそのときだけ装飾を作り直す。打鍵では作り直さない。
import { useMemo } from "react";
import { type LinkLookup, createLinkLookup } from "../editor/linkDecorations";
import type { LinkIndexHandle } from "./useLinkIndex";

export function useLinkLookup(
  linkIndex: LinkIndexHandle,
  rootPath: string | null,
  isNote: boolean,
): LinkLookup | null {
  const { peek, version } = linkIndex;
  return useMemo(() => {
    // version は「索引が変わったら作り直す」ための合図として読む。
    void version;
    return rootPath ? createLinkLookup(peek(rootPath), isNote) : null;
  }, [isNote, peek, rootPath, version]);
}
