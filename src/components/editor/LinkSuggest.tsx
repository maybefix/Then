import { useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

// BINDER 3-2: ノートの名前の候補（docs/BINDER_LINK_SYNTAX_PLAN.md）。
// `[[` を打ったときと Ctrl+L で開き、続けて打つと絞り込む。本文の外（.appShell
// 直下）に置くので、縦書きの組版やページの割りには触らない。日本語入力の確定中
// は呼び出し側が閉じるので、ここは確定した文字だけを受け取る。

const GAP_PX = 6;

export type LinkSuggestAnchor = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  vertical: boolean;
};

/**
 * The caret's box as the list's anchor. The editor's `coordsAtPos` can return a
 * DOMRect, whose sides are getters on the prototype: spreading it (`{ ...rect }`)
 * copies nothing, the list got no position and sat below the window.
 */
export function suggestAnchor(
  rect: { left: number; top: number; right: number; bottom: number },
  vertical: boolean,
): LinkSuggestAnchor {
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, vertical };
}

export function placement(anchor: LinkSuggestAnchor): CSSProperties {
  const width = window.innerWidth;
  const height = window.innerHeight;
  if (anchor.vertical) {
    const top = Math.max(GAP_PX, Math.min(anchor.top, height - GAP_PX - 160));
    if (anchor.left > width - anchor.right) {
      return { right: width - anchor.left + GAP_PX, top };
    }
    return { left: anchor.right + GAP_PX, top };
  }
  const left = Math.max(GAP_PX, Math.min(anchor.left, width - GAP_PX - 240));
  if (height - anchor.bottom >= anchor.top) return { left, top: anchor.bottom + GAP_PX };
  return { left, bottom: height - anchor.top + GAP_PX };
}

export function LinkSuggest({
  items,
  anchor,
  onChoose,
  onClose,
}: {
  items: ReadonlyArray<{ name: string; path: string }>;
  anchor: LinkSuggestAnchor;
  onChoose: (name: string) => void;
  onClose: () => void;
}) {
  const [active, setActive] = useState(0);
  const at = items.length ? Math.min(active, items.length - 1) : 0;

  useEffect(() => {
    setActive(0);
  }, [items]);

  useEffect(() => {
    // 本文はフォーカスを持ったままなので、キーはここで先に受け取る。
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (items.length === 0) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActive((current) => {
          const next = (Math.min(current, items.length - 1) + step + items.length) % items.length;
          return next;
        });
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        onChoose(items[Math.min(active, items.length - 1)].name);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [active, items, onChoose, onClose]);

  if (items.length === 0) return null;
  const portalRoot = document.querySelector<HTMLElement>(".appShell") ?? document.body;

  return createPortal(
    <div className="linkSuggest" style={placement(anchor)} role="listbox" aria-label="ノートの名前">
      {items.map((item, index) => (
        <button
          key={item.path}
          type="button"
          className={`linkSuggestItem${index === at ? " isActive" : ""}`}
          role="option"
          aria-selected={index === at}
          // 本文からフォーカスを奪わない（押したあとも入力を続けられる）。
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => setActive(index)}
          onClick={() => onChoose(item.name)}
        >
          {item.name}
        </button>
      ))}
    </div>,
    portalRoot,
  );
}
