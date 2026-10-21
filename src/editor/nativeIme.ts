import type { Editor } from "@tiptap/core";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { closeHistory } from "@tiptap/pm/history";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

type NativeEdit = {
  text: string; anchor: number; head: number; composing: boolean;
  composition: [number, number] | null;
};
type NativeEvent = {
  session: string; epoch: number; serial: number; kind: "edit" | "key" | "focus" | "error";
  value: NativeEdit | NativeKey | string | boolean;
  keysSeen?: number; keysConsumed?: number; geometryQueries?: number; attributeQueries?: number;
};
type Connection = { focused: boolean; keysSeen: number; keysConsumed: number; geometryQueries: number; attributeQueries: number; edits: number };
type NativeKey = { down: boolean; vk: number; ctrl: boolean; shift: boolean; alt: boolean; repeat: boolean };
type Rect = [number, number, number, number];
const compositionKey = new PluginKey<DecorationSet>("nativeImeComposition");

/** Prefer the real collapsed range, then the adjacent glyph, including empty lines. */
export function nativeImeCaretRect(vertical: boolean, collapsed: Rect, glyph: Rect | null, after: boolean, fallback: Rect, dpr = 1): Rect {
  const usable = (r: Rect) => r.every(Number.isFinite) && (r[2] > 0 || r[3] > 0);
  const thickness = 1 / Math.max(1, dpr);
  if (usable(collapsed) && (vertical ? collapsed[2] > 1 : collapsed[3] > 1)) {
    return vertical ? [collapsed[0], collapsed[1], collapsed[2], thickness] : [collapsed[0], collapsed[1], thickness, collapsed[3]];
  }
  if (glyph && usable(glyph)) return vertical
    ? [glyph[0], glyph[1] + (after ? glyph[3] : 0), glyph[2], thickness]
    : [glyph[0] + (after ? glyph[2] : 0), glyph[1], thickness, glyph[3]];
  return vertical
    ? [fallback[0], fallback[1], Math.max(fallback[2], fallback[3], 1), thickness]
    : [fallback[0], fallback[1], thickness, Math.max(fallback[3], fallback[2], 1)];
}

/** A local replacement, with unchanged prefix/suffix excluded from the PM step. */
export function nativeImeTransaction(state: EditorState, start: number, previous: string, edit: NativeEdit): Transaction {
  let prefix = 0;
  while (prefix < previous.length && prefix < edit.text.length && previous[prefix] === edit.text[prefix]) prefix++;
  // Do not split a UTF-16 surrogate pair at the edge of a replacement.
  if (prefix && /[\uD800-\uDBFF]/.test(previous[prefix - 1])) prefix--;
  let suffix = 0;
  while (suffix < previous.length - prefix && suffix < edit.text.length - prefix &&
    previous[previous.length - 1 - suffix] === edit.text[edit.text.length - 1 - suffix]) suffix++;
  if (suffix && /[\uDC00-\uDFFF]/.test(previous[previous.length - suffix])) suffix--;
  let tr = state.tr;
  if (previous !== edit.text) tr = tr.insertText(edit.text.slice(prefix, edit.text.length - suffix),
    start + prefix, start + previous.length - suffix);
  const clamp = (n: number) => start + Math.max(0, Math.min(edit.text.length, n));
  tr.setSelection(TextSelection.create(tr.doc, clamp(edit.anchor), clamp(edit.head)));
  return tr;
}

/** Only installed in the separate experimental app (?native-ime=1). */
export function installNativeImeExperiment(editor: Editor, shell: HTMLElement, callbacks: {
  start: () => void; update: () => void; end: () => void;
}): () => void {
  const limited = import.meta.env.VITE_NATIVE_TSF_LIMITED === "1";
  if (!isTauri() || (!limited && new URLSearchParams(location.search).get("native-ime") !== "1")) return () => {};
  const root = editor.view.dom;
  const scroller = shell.querySelector(".verticalTypewriterScroller")!;
  let session = crypto.randomUUID();
  let enabled = false, active = false, composing = false, disposed = false, applying = false;
  let epoch = 0, serial = 0, start = 1, paragraphText = "", frame = 0;
  let inFlight = false, pendingFocus = false, queued = false;
  let unlisten: UnlistenFn | undefined;
  let focusRequested = false;
  let connection: Connection | null = null;
  let nativeQueue: Promise<unknown> = Promise.resolve();
  const command = <T,>(name: string, args: Record<string, unknown>): Promise<T> => {
    const result = nativeQueue.then(() => invoke<T>(name, args));
    nativeQueue = result.catch(() => undefined);
    return result;
  };
  const panel = document.createElement("div");
  panel.className = "nativeImeExperiment";
  const toggle = document.createElement("button");
  toggle.type = "button"; toggle.textContent = "入力：標準"; toggle.setAttribute("aria-pressed", "false");
  const status = document.createElement("span"); status.textContent = "TSF入力を比較";
  const openIme = document.createElement("button"); openIme.type = "button"; openIme.textContent = "日本語入力ON";
  openIme.disabled = true;
  panel.append(toggle, openIme, status); shell.append(panel);
  // A read-only hook for inspecting this experimental connection, never a key injector.
  const diagnostics = () => command("native_ime_control", { session, action: "inspect" });
  (root as HTMLElement & { nativeImeDiagnostics?: () => Promise<unknown> }).nativeImeDiagnostics = diagnostics;
  const inspectButton = document.createElement("button"); inspectButton.type = "button"; inspectButton.textContent = "接続状態";
  const diagnosticOutput = document.createElement("output");
  diagnosticOutput.style.cssText = "max-width:360px;max-height:140px;overflow:auto;white-space:pre-wrap";
  panel.append(inspectButton, diagnosticOutput);
  const inspect = () => { void diagnostics().then(value => { diagnosticOutput.textContent = JSON.stringify(value); }).catch(error => { diagnosticOutput.textContent = String(error); }); };
  inspectButton.addEventListener("click", inspect);
  const caret = document.createElement("div"); caret.className = "nativeImeCaret"; caret.hidden = true;
  caret.setAttribute("aria-hidden", "true");
  document.body.append(caret);
  const renderStatus = () => {
    if (!enabled || disposed) return;
    const count = connection ? `・キー ${connection.keysSeen} / IME ${connection.keysConsumed} / 編集 ${connection.edits}` : "";
    status.textContent = `${active ? "TSF入力" : focusRequested ? "TSF接続中" : "TSF待機"}：現在段落 ${paragraph()?.text.length ?? 0}字${composing ? "・変換中" : ""}${count}`;
  };
  const setActive = (value: boolean) => {
    active = value;
    root.classList.toggle("nativeImeActive", value);
    caret.hidden = !value || !editor.state.selection.empty;
    renderStatus();
  };

  editor.registerPlugin(new Plugin<DecorationSet>({
    key: compositionKey,
    state: {
      init: () => DecorationSet.empty,
      apply: (tr, value) => {
        const range = tr.getMeta(compositionKey) as [number, number] | null | undefined;
        if (range === null) return DecorationSet.empty;
        if (range) return range[0] < range[1]
          ? DecorationSet.create(tr.doc, [Decoration.inline(range[0], range[1], { class: "nativeImeComposition" })])
          : DecorationSet.empty;
        return value.map(tr.mapping, tr.doc);
      },
    },
    props: { decorations: state => compositionKey.getState(state) },
  }));

  const clearComposition = () => {
    if (composing) { composing = false; callbacks.end(); }
    editor.view.dispatch(editor.state.tr.setMeta(compositionKey, null).setMeta("addToHistory", false));
  };
  const release = async () => {
    const endingSession = session;
    session = crypto.randomUUID(); serial = 0;
    pendingFocus = false; focusRequested = false;
    active = false; caret.hidden = true; root.classList.remove("nativeImeActive");
    if (!disposed) clearComposition();
    await command("native_ime_release", { session: endingSession });
  };
  const fail = (error: unknown) => {
    status.textContent = `TSFエラー：${String(error)}`;
    enabled = false; toggle.textContent = "入力：標準"; toggle.setAttribute("aria-pressed", "false");
    openIme.disabled = true;
    void release().catch(console.error);
  };

  function paragraph() {
    const { $anchor, $head } = editor.state.selection;
    if ($anchor.depth !== 1 || $head.depth !== 1 || $anchor.start() !== $head.start()) return null;
    return { start: $head.start(), text: $head.parent.textContent, anchor: $anchor.parentOffset, head: $head.parentOffset };
  }
  const rect = (r: DOMRect | { left: number; top: number; right: number; bottom: number }): Rect =>
    [r.left, r.top, r.right - r.left, r.bottom - r.top];

  async function sync() {
    if (!enabled || disposed) return;
    if (inFlight) { queued = true; return; }
    const p = paragraph();
    if (!p) {
      status.textContent = "複数段落選択：標準入力";
      if (active || focusRequested) await release();
      return;
    }
    if (!active && !pendingFocus && !focusRequested) return;
    start = p.start; paragraphText = p.text;
    const vertical = getComputedStyle(root).writingMode.startsWith("vertical");
    const point = editor.view.domAtPos(editor.state.selection.head, 1);
    const caretRange = document.createRange(); caretRange.setStart(point.node, point.offset); caretRange.collapse(true);
    const collapsed = rect(caretRange.getBoundingClientRect());
    let adjacent: Rect | null = null;
    if (p.text.length) {
      const index = Math.min(p.head, p.text.length - 1);
      const a = editor.view.domAtPos(p.start + index, 1), b = editor.view.domAtPos(p.start + index + 1, -1);
      const glyph = document.createRange(); glyph.setStart(a.node, a.offset); glyph.setEnd(b.node, b.offset);
      adjacent = rect(glyph.getBoundingClientRect());
    }
    const fallback = rect(editor.view.coordsAtPos(editor.state.selection.head));
    const caretRect = nativeImeCaretRect(vertical, collapsed, adjacent, p.head === p.text.length, fallback, devicePixelRatio);
    // The DOM range retains the actual horizontal caret stroke in vertical text.
    caret.style.backgroundColor = getComputedStyle(root).caretColor;
    caret.style.left = `${caretRect[0]}px`; caret.style.top = `${caretRect[1]}px`;
    caret.style.width = `${caretRect[2]}px`; caret.style.height = `${caretRect[3]}px`;
    caret.hidden = !active || !editor.state.selection.empty;
    const rectangles: Rect[] = [];
    for (let i = 0; i < p.text.length; i++) {
      const from = editor.view.domAtPos(p.start + i, 1), to = editor.view.domAtPos(p.start + i + 1, -1);
      const range = document.createRange(); range.setStart(from.node, from.offset); range.setEnd(to.node, to.offset);
      rectangles.push(rect(range.getBoundingClientRect()));
    }
    const focus = pendingFocus; pendingFocus = false; focusRequested ||= focus;
    inFlight = true;
    try {
      const syncedSession = session;
      const state = await command<Connection>("native_ime_sync", { snapshot: {
        session, epoch, acknowledged: serial, text: p.text, anchor: p.anchor, head: p.head,
        vertical, dpr: devicePixelRatio, rects: rectangles, caret: caretRect, focus,
      } });
      if (!disposed && enabled && syncedSession === session) { connection = state; focusRequested = false; setActive(state.focused); }
    } catch (error) { if (!disposed) fail(error); }
    finally { inFlight = false; if (queued && !disposed) { queued = false; schedule(); } }
  }
  function schedule(focus = false) {
    if (!enabled || disposed) return;
    pendingFocus ||= focus;
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; void sync(); });
  }
  const transaction = ({ transaction: tr }: { transaction: Transaction }) => {
    if (!enabled || disposed) return;
    if (!applying && (tr.docChanged || tr.selectionSet)) {
      epoch++;
      if (composing) { void release().then(() => schedule(true)).catch(fail); return; }
    }
    schedule();
  };
  const insert = (value: string) => {
    const normalized = value.replace(/\r\n?/g, "\n");
    const tr = editor.state.tr.insertText(normalized);
    if (normalized.includes("\n")) {
      // Let the existing plain-text clipboard parser create actual paragraphs.
      editor.view.pasteText(normalized);
    } else editor.view.dispatch(tr.scrollIntoView());
  };

  async function key(value: NativeKey) {
    const names: Record<number, string> = { 8: "Backspace", 9: "Tab", 13: "Enter", 27: "Escape", 32: " ",
      33: "PageUp", 34: "PageDown", 35: "End", 36: "Home", 37: "ArrowLeft", 38: "ArrowUp", 39: "ArrowRight", 40: "ArrowDown", 46: "Delete" };
    const name = names[value.vk] ?? (value.vk >= 65 && value.vk <= 90 ? String.fromCharCode(value.vk).toLowerCase() : "Unidentified");
    const event = new KeyboardEvent(value.down ? "keydown" : "keyup", {
      key: name, code: value.vk >= 65 && value.vk <= 90 ? `Key${name.toUpperCase()}` : name,
      ctrlKey: value.ctrl, shiftKey: value.shift, altKey: value.alt, repeat: value.repeat, bubbles: true, cancelable: true,
    });
    // Existing PM keymaps and application shortcuts retain first refusal.
    root.dispatchEvent(event);
    if (!value.down || event.defaultPrevented) return;
    if (value.ctrl && !value.alt && [67, 88, 86].includes(value.vk)) {
      try {
        const before = editor.state;
        if (value.vk === 86) {
          const text = await command<string>("native_clipboard_read", {});
          if (editor.state.doc === before.doc && editor.state.selection.eq(before.selection)) insert(text);
        }
        else {
          const { from, to } = editor.state.selection;
          if (from === to) return;
          await command("native_clipboard_write", { text: before.doc.textBetween(from, to, "\n") });
          if (value.vk === 88 && editor.state.doc === before.doc && editor.state.selection.eq(before.selection)) editor.view.dispatch(editor.state.tr.deleteSelection());
        }
      } catch (error) { status.textContent = `クリップボード：${String(error)}`; }
      return;
    }
    if (name === "Backspace" || name === "Delete") {
      const { from, to, $head } = editor.state.selection;
      if (from !== to) editor.view.dispatch(editor.state.tr.deleteSelection());
      else {
        const backward = name === "Backspace", local = $head.parentOffset, text = $head.parent.textContent;
        const count = backward ? [...text.slice(0, local)].pop()?.length : [...text.slice(local)][0]?.length;
        if (count) editor.view.dispatch(editor.state.tr.delete(backward ? from - count : from, backward ? from : from + count));
      }
    } else if (name.startsWith("Arrow") || name === "Home" || name === "End") {
      const selection = document.getSelection() as (Selection & { modify: (alter: string, direction: string, granularity: string) => void }) | null;
      if (!selection) return;
      // PM does not update the DOM selection while the native input window owns
      // focus. Start browser line navigation from the current PM selection.
      const anchor = editor.view.domAtPos(editor.state.selection.anchor, 1);
      const head = editor.view.domAtPos(editor.state.selection.head, 1);
      selection.setBaseAndExtent(anchor.node, anchor.offset, head.node, head.offset);
      const vertical = getComputedStyle(root).writingMode.startsWith("vertical");
      const forward = name === "End" || name === "ArrowDown" || name === "ArrowRight" && !vertical || name === "ArrowLeft" && vertical;
      const line = vertical ? name === "ArrowLeft" || name === "ArrowRight" : name === "ArrowUp" || name === "ArrowDown";
      selection.modify(value.shift ? "extend" : "move", forward ? "forward" : "backward",
        name === "Home" || name === "End" ? "lineboundary" : line ? "line" : value.ctrl ? "word" : "character");
      if (selection.anchorNode && selection.focusNode && root.contains(selection.anchorNode) && root.contains(selection.focusNode)) {
        const anchor = editor.view.posAtDOM(selection.anchorNode, selection.anchorOffset);
        const head = editor.view.posAtDOM(selection.focusNode, selection.focusOffset);
        editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, anchor, head)));
      }
      schedule(true);
    }
    schedule();
  }

  const receive = async (event: NativeEvent) => {
    if (!enabled || disposed || event.session !== session) return;
    if (event.kind === "error") { fail(event.value); return; }
    if (event.kind === "focus") {
      focusRequested = false; setActive(event.value === true);
      if (!active) { pendingFocus = false; status.textContent = "TSF待機：本文をクリック"; }
      else schedule();
      return;
    }
    if (event.kind === "edit" && event.epoch !== epoch) {
      // A user command/file replacement has superseded an in-flight IME event.
      // Acknowledge it without applying stale text, then synchronize the live PM state.
      serial = Math.max(serial, event.serial); schedule(); return;
    }
    if (event.kind === "edit") {
      if (event.serial <= serial) return;
      serial = event.serial;
      const p = paragraph();
      if (!p || p.start !== start || p.text !== paragraphText) { epoch++; schedule(); return; }
      const edit = event.value as NativeEdit;
      applying = true;
      try {
        const starting = edit.composing && !composing;
        if (starting) { callbacks.start(); composing = true; }
        let tr = nativeImeTransaction(editor.state, start, p.text, edit);
        if (starting) tr = closeHistory(tr);
        if (edit.composing) tr.setMeta("composition", session);
        tr.setMeta(compositionKey, edit.composition ? [start + edit.composition[0], start + edit.composition[1]] : null);
        paragraphText = edit.text;
        editor.view.dispatch(tr);
        if (!edit.composing && composing) {
          composing = false; callbacks.end();
          editor.view.dispatch(closeHistory(editor.state.tr).setMeta("addToHistory", false));
        }
        else if (edit.composing) callbacks.update();
      } finally { applying = false; }
      schedule();
    } else if (event.kind === "key") await key(event.value as NativeKey);
  };
  let eventQueue = Promise.resolve();
  void listen<NativeEvent>("native-ime", ({ payload }) => {
    // Keep native edits, shortcuts and clipboard requests in native message order.
    eventQueue = eventQueue.then(() => receive(payload)).catch(fail);
  }).then(fn => {
    if (disposed) fn();
    else {
      unlisten = fn; toggle.disabled = false;
      if (limited) { try { if (localStorage.getItem("then.nativeTsfInput") === "1") toggleMode(); } catch {} }
    }
  }).catch(fail);
  toggle.disabled = true;
  const toggleMode = () => {
    enabled = !enabled; epoch++;
    if (limited) { try { localStorage.setItem("then.nativeTsfInput", enabled ? "1" : "0"); } catch {} }
    toggle.textContent = enabled ? "入力：TSF試験" : "入力：標準";
    toggle.setAttribute("aria-pressed", String(enabled));
    openIme.disabled = !enabled;
    if (enabled) { session = crypto.randomUUID(); serial = 0; connection = null; editor.view.focus(); schedule(true); }
    else void release().then(() => { editor.view.focus(); status.textContent = "標準入力"; }).catch(fail);
  };
  const pointerUp = (event: PointerEvent) => {
    if (enabled && root.contains(event.target as Node)) schedule(true);
  };
  const focus = () => { if (enabled) schedule(true); };
  const layout = () => schedule();
  const observer = new ResizeObserver(layout); observer.observe(root);
  const modeObserver = new MutationObserver(layout);
  modeObserver.observe(shell, { attributes: true, attributeFilter: ["class", "style", "data-editor-display"] });
  modeObserver.observe(root, { attributes: true, attributeFilter: ["class", "style"] });
  toggle.addEventListener("click", toggleMode);
  const turnImeOn = () => { void command("native_ime_control", { session, action: "open" }).catch(fail); };
  openIme.addEventListener("click", turnImeOn);
  root.addEventListener("focus", focus); root.addEventListener("pointerup", pointerUp);
  scroller.addEventListener("scroll", layout, { passive: true });
  window.addEventListener("resize", layout); document.fonts?.addEventListener("loadingdone", layout);
  editor.on("transaction", transaction);
  return () => {
    disposed = true; enabled = false;
    if (frame) cancelAnimationFrame(frame);
    unlisten?.(); observer.disconnect(); modeObserver.disconnect();
    toggle.removeEventListener("click", toggleMode); root.removeEventListener("focus", focus); root.removeEventListener("pointerup", pointerUp);
    openIme.removeEventListener("click", turnImeOn);
    inspectButton.removeEventListener("click", inspect);
    delete (root as HTMLElement & { nativeImeDiagnostics?: () => Promise<unknown> }).nativeImeDiagnostics;
    scroller.removeEventListener("scroll", layout); window.removeEventListener("resize", layout);
    document.fonts?.removeEventListener("loadingdone", layout); editor.off("transaction", transaction);
    root.classList.remove("nativeImeActive"); panel.remove(); caret.remove();
    void command("native_ime_release", { session }).catch(console.error);
    editor.unregisterPlugin(compositionKey);
  };
}
