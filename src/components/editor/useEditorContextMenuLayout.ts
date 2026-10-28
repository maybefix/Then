import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { getUiFontScale } from "../../utils/contextMenuPosition";
import { placeEditorMenu, placeEditorSubmenu } from "./editorContextMenuPosition";

type Layout = {
  ready: boolean;
  scale: number;
  left: number;
  top: number;
  subLeft: number;
  subTop: number;
  subReady: boolean;
  side: string;
};

export function useEditorContextMenuLayout(menuRef: RefObject<HTMLDivElement>, x: number, y: number, submenu: string | null) {
  const submenuRef = useRef<HTMLDivElement>(null);
  const triggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [layout, setLayout] = useState<Layout>({ ready: false, scale: 1, left: 0, top: 0, subLeft: 0, subTop: 0, subReady: false, side: "right" });
  const updateLayout = useCallback(() => {
    const root = menuRef.current;
    if (!root) return;
    const scale = getUiFontScale();
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const box = root.getBoundingClientRect();
    const position = placeEditorMenu({ x, y }, box, viewport);
    const next: Layout = { ready: true, scale, ...position, subLeft: 0, subTop: 0, subReady: false, side: "right" };
    const trigger = submenu ? triggerRefs.current[submenu] : null;
    if (trigger && submenuRef.current) {
      const anchor = trigger.getBoundingClientRect();
      const panel = submenuRef.current.getBoundingClientRect();
      // Project the trigger onto the root's new position, before the next paint.
      const projected = { left: anchor.left + position.left - box.left, top: anchor.top + position.top - box.top, width: anchor.width, height: anchor.height };
      const child = placeEditorSubmenu(projected, panel, viewport);
      next.subLeft = (child.left - position.left) / scale;
      next.subTop = (child.top - position.top) / scale;
      next.subReady = true;
      next.side = child.side;
    }
    setLayout(current => Object.keys(next).every(key => {
      const a = current[key as keyof Layout], b = next[key as keyof Layout];
      return typeof a === "number" && typeof b === "number" ? Math.abs(a - b) < 0.05 : a === b;
    }) ? current : next);
  }, [menuRef, x, y, submenu]);

  // Also runs when parent settings change UI zoom without changing the click point.
  useLayoutEffect(updateLayout);
  useLayoutEffect(() => {
    let frame = 0;
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(updateLayout); };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    if (menuRef.current) observer?.observe(menuRef.current);
    if (submenuRef.current) observer?.observe(submenuRef.current);
    window.addEventListener("resize", schedule);
    document.fonts?.addEventListener("loadingdone", schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", schedule);
      document.fonts?.removeEventListener("loadingdone", schedule);
    };
  }, [updateLayout, menuRef]);

  const rootStyle: CSSProperties = { left: layout.left / layout.scale, top: layout.top / layout.scale, visibility: layout.ready ? "visible" : "hidden" };
  const submenuStyle: CSSProperties = { left: layout.subLeft, top: layout.subTop, visibility: layout.subReady ? "visible" : "hidden" };
  return { rootStyle, submenuStyle, submenuRef, triggerRefs, updateLayout, ready: layout.ready, subReady: layout.subReady, side: layout.side };
}
