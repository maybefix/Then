// BINDER 3-2 の調べもの用（2026-11-18）。`[[` の候補が実機で出ない原因を、
// 実際の打鍵で何が起きたかの記録から探す。`VITE_LINK_SUGGEST_DEBUG=1` で
// build したときだけ動き、ふだんの build では null（呼び出しは何もしない）。
// 記録は `VITE_LINK_SUGGEST_DEBUG_LOG` のファイルへ、1秒ごとにまとめて書く。
import { invoke } from "@tauri-apps/api/core";

type Log = (tag: string, data?: unknown) => void;

const enabled = import.meta.env.VITE_LINK_SUGGEST_DEBUG === "1";
const logPath = import.meta.env.VITE_LINK_SUGGEST_DEBUG_LOG as string | undefined;

export const linkSuggestDebug: Log | null = enabled && logPath ? createLog(logPath) : null;

function createLog(path: string): Log {
  const lines = [`# start ${new Date().toISOString()} ${navigator.userAgent}`];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    void invoke("save_text_file", { path, content: `${lines.join("\n")}\n`, expectedHash: null }).catch(() => undefined);
  };
  return (tag, data) => {
    lines.push(`${performance.now().toFixed(1)} ${tag}${data === undefined ? "" : ` ${JSON.stringify(data)}`}`);
    if (lines.length > 20000) lines.splice(1, 5000);
    if (!timer) timer = setTimeout(flush, 1000);
  };
}

/** 本文で起きた入力のイベントをそのまま記録する。外すための関数を返す。 */
export function watchInputEvents(dom: HTMLElement): () => void {
  const log = linkSuggestDebug;
  if (!log) return () => undefined;
  const types = ["keydown", "keyup", "compositionstart", "compositionupdate", "compositionend", "beforeinput", "input"] as const;
  const handler = (event: Event) => {
    const e = event as KeyboardEvent & InputEvent & CompositionEvent;
    log(`dom.${event.type}`, {
      key: e.key, keyCode: e.keyCode, inputType: e.inputType, data: e.data, isComposing: e.isComposing,
    });
  };
  for (const type of types) dom.addEventListener(type, handler, true);
  return () => {
    for (const type of types) dom.removeEventListener(type, handler, true);
  };
}
