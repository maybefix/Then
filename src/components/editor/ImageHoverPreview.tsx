import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useState, type CSSProperties, type RefObject } from "react";
import { createPortal } from "react-dom";
import { IMAGE_SCHEME, resolveImageUrl } from "../../utils/markdownImage";

// 本文の画像記法 `![alt](src)` にマウスを重ねると、その画像を浮かべて見せる。
// 記法の範囲はエディタの装飾が .mk-image（data-image-src / data-image-alt）で
// 印を付けている。表示はエディタの外（.appShell 直下）に置くので、本文の
// 組版やスクロールには触れない。

const SHOW_DELAY_MS = 250;
const GAP_PX = 8;

type HoverTarget = {
  key: string;
  url: string | null;
  src: string;
  alt: string;
  rect: DOMRect;
  vertical: boolean;
};

type LoadState = "loading" | "ready" | "error";

function imageUrlBase(): string | null {
  return "__TAURI_INTERNALS__" in window ? convertFileSrc("", IMAGE_SCHEME) : null;
}

function placement(target: HoverTarget): CSSProperties {
  const { rect, vertical } = target;
  const width = window.innerWidth;
  const height = window.innerHeight;
  if (vertical) {
    // 縦書きは行が左へ進むので、まず行の左側（次の行の上）に出す。
    const top = Math.max(GAP_PX, Math.min(rect.top, height - GAP_PX - 120));
    if (rect.left > width - rect.right) {
      return { right: width - rect.left + GAP_PX, top, maxWidth: rect.left - GAP_PX * 2 };
    }
    return { left: rect.right + GAP_PX, top, maxWidth: width - rect.right - GAP_PX * 2 };
  }
  const left = Math.max(GAP_PX, Math.min(rect.left, width - GAP_PX - 160));
  if (height - rect.bottom >= rect.top) {
    return { left, top: rect.bottom + GAP_PX, maxHeight: height - rect.bottom - GAP_PX * 2 };
  }
  return { left, bottom: height - rect.top + GAP_PX, maxHeight: rect.top - GAP_PX * 2 };
}

export function ImageHoverPreview({
  hostRef,
  documentPath,
}: {
  hostRef: RefObject<HTMLElement | null>;
  documentPath: string | null;
}) {
  const [target, setTarget] = useState<HoverTarget | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const base = imageUrlBase();
    let timer = 0;
    let pendingKey: string | null = null;
    let shownKey: string | null = null;

    const hide = () => {
      window.clearTimeout(timer);
      pendingKey = null;
      if (shownKey !== null) {
        shownKey = null;
        setTarget(null);
      }
    };

    const onMouseOver = (event: MouseEvent) => {
      const element = (event.target as Element | null)?.closest<HTMLElement>(".mk-image[data-image-src]");
      if (!element || !host.contains(element)) {
        hide();
        return;
      }
      const src = element.dataset.imageSrc ?? "";
      const alt = element.dataset.imageAlt ?? "";
      const key = `${element.dataset.imageKey ?? ""}|${src}`;
      if (key === shownKey || key === pendingKey) return;
      window.clearTimeout(timer);
      pendingKey = key;
      timer = window.setTimeout(() => {
        pendingKey = null;
        if (!element.isConnected) return;
        // The notation is split into several spans by other decorations
        // (Latin tokens, kinsoku); anchor to the box around all of them.
        const parts = [...host.querySelectorAll<HTMLElement>(".mk-image[data-image-key]")]
          .filter((part) => part.dataset.imageKey === element.dataset.imageKey);
        const rects = (parts.length > 0 ? parts : [element]).map((part) => part.getBoundingClientRect());
        const left = Math.min(...rects.map((rect) => rect.left));
        const top = Math.min(...rects.map((rect) => rect.top));
        const right = Math.max(...rects.map((rect) => rect.right));
        const bottom = Math.max(...rects.map((rect) => rect.bottom));
        shownKey = key;
        setLoadState("loading");
        setTarget({
          key,
          url: resolveImageUrl(src, documentPath, base),
          src,
          alt,
          rect: new DOMRect(left, top, right - left, bottom - top),
          vertical: getComputedStyle(element).writingMode.startsWith("vertical"),
        });
      }, SHOW_DELAY_MS);
    };

    host.addEventListener("mouseover", onMouseOver);
    host.addEventListener("mouseleave", hide);
    // 本文が動いたり打鍵したりしたら、位置がずれる前に消す。
    window.addEventListener("keydown", hide, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("wheel", hide, { capture: true, passive: true });
    window.addEventListener("blur", hide);
    return () => {
      window.clearTimeout(timer);
      host.removeEventListener("mouseover", onMouseOver);
      host.removeEventListener("mouseleave", hide);
      window.removeEventListener("keydown", hide, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("wheel", hide, { capture: true });
      window.removeEventListener("blur", hide);
    };
  }, [hostRef, documentPath]);

  if (!target) return null;
  const portalRoot = document.querySelector<HTMLElement>(".appShell") ?? document.body;
  const message = !target.url
    ? documentPath
      ? "この画像は表示できません（作品フォルダ内の画像か、http/https の URL を指定してください）"
      : "原稿ファイルを保存すると、相対パスの画像を表示できます"
    : loadState === "error"
      ? "画像を読み込めませんでした"
      : loadState === "loading"
        ? "読み込み中…"
        : null;

  return createPortal(
    <div className="imageHoverPreview" style={placement(target)} role="tooltip">
      {target.url && (
        <img
          key={target.key}
          src={target.url}
          alt={target.alt}
          hidden={loadState !== "ready"}
          onLoad={() => setLoadState("ready")}
          onError={() => setLoadState("error")}
        />
      )}
      {message && <p className="imageHoverPreviewMessage">{message}</p>}
      <p className="imageHoverPreviewSource" title={target.src}>{target.src}</p>
    </div>,
    portalRoot,
  );
}
