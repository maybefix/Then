/**
 * Zoneモード（右ペインのホバー表示）で、右ペインを出すかどうかを .appShell の
 * 属性に写す。
 *
 * 以前は .appShell:has(.rightSidebar:is(:hover, :focus-within)) などの CSS で
 * 判定していた。:has() の主語が画面全体の祖先だと、ふだん一致しないあいだは
 * 評価のたびに画面全体をたどり、本文の要素すべてが :has の影響範囲に入る。
 * すると本文へ要素が挿入されるたびに画面全体のスタイル無効化が走り、10万字の
 * 原稿で1キーあたり style が 4ms→10ms（行番号ONでは 40ms）に増えた。
 *
 * ここではポインターとフォーカスのイベントで状態を出し、変わったときだけ
 * 属性を書く。本文の入力では何も起きない。
 *
 *   data-zone-right-active  右ペインの端・右ペイン・プラグイン枠のどれかに
 *                           ポインターがある、または右ペイン内にフォーカスがある
 *   data-zone-plugin-hover  プラグイン枠（モーダルでないもの）にポインターがある
 */
const REGION = ".zoneRightSidebarHoverTarget, .rightSidebar, .pluginRuntimeDetachedHost:not(.pluginModalRuntimeHost)";
const PLUGIN = ".pluginRuntimeDetachedHost";

function setFlag(element: Element, name: string, on: boolean): void {
  if (on === element.hasAttribute(name)) return;
  if (on) element.setAttribute(name, "true");
  else element.removeAttribute(name);
}

export function trackZoneRightHover(shell: HTMLElement, root: Document = document): () => void {
  let hovered: Element | null = null;
  let focused = false;
  const region = (target: EventTarget | null) => (target instanceof Element ? target.closest(REGION) : null);
  const sync = () => {
    setFlag(shell, "data-zone-right-active", Boolean(hovered) || focused);
    setFlag(shell, "data-zone-plugin-hover", Boolean(hovered?.matches(PLUGIN)));
  };
  const handleOver = (event: PointerEvent) => {
    hovered = region(event.target);
    sync();
  };
  // ウィンドウの外へ出たとき（移り先がない）は、どこにもいない。
  const handleOut = (event: PointerEvent) => {
    if (event.relatedTarget) return;
    hovered = null;
    sync();
  };
  const handleFocusIn = (event: FocusEvent) => {
    focused = event.target instanceof Element && Boolean(event.target.closest(".rightSidebar"));
    sync();
  };
  const handleFocusOut = (event: FocusEvent) => {
    focused = event.relatedTarget instanceof Element && Boolean(event.relatedTarget.closest(".rightSidebar"));
    sync();
  };
  focused = Boolean(root.activeElement?.closest(".rightSidebar"));
  sync();
  root.addEventListener("pointerover", handleOver, true);
  root.addEventListener("pointerout", handleOut, true);
  root.addEventListener("focusin", handleFocusIn, true);
  root.addEventListener("focusout", handleFocusOut, true);
  return () => {
    root.removeEventListener("pointerover", handleOver, true);
    root.removeEventListener("pointerout", handleOut, true);
    root.removeEventListener("focusin", handleFocusIn, true);
    root.removeEventListener("focusout", handleFocusOut, true);
    shell.removeAttribute("data-zone-right-active");
    shell.removeAttribute("data-zone-plugin-hover");
  };
}
