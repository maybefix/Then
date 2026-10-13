import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import type { DocumentTab, FileProgressStatus } from "../../types";
import { fileProgressLabels } from "../../types";
import { getScaledFixedMenuPosition } from "../../utils/contextMenuPosition";

type DocumentTabsProps = {
  openTabs: DocumentTab[];
  /** "hover" は編集面の縦幅を空けるため、上端に触れたときだけ重ねて表示する。 */
  displayMode: "always" | "hover";
  activeTabId: string;
  /** ファイルパスごとの進捗ラベル。タブのファイルアイコンを色分けする。 */
  fileProgress: Record<string, FileProgressStatus>;
  onActivateTab: (tabId: string) => void;
  onCloseTabs: (tabIds: string[]) => void;
  /** tabId を beforeTabId の直前へ移す。null なら末尾。 */
  onMoveTab: (tabId: string, beforeTabId: string | null) => void;
  onNewTab: () => void;
  canReopenClosedTab: boolean;
  onReopenClosedTab: () => void;
  onCopyTabPath: (tab: DocumentTab) => void;
  onRevealTab: (tab: DocumentTab) => void;
};

/** この距離を超えて動かしたら、クリックではなくドラッグとして扱う。 */
const DRAG_START_DISTANCE = 4;
/** リストの両端からこの幅に入ると、ドラッグ中に横スクロールする。 */
const DRAG_AUTO_SCROLL_EDGE = 32;
const DRAG_AUTO_SCROLL_MAX_STEP = 14;
const TAB_CONTEXT_MENU_WIDTH = 188;
const TAB_CONTEXT_MENU_HEIGHT = 268;

type TabDrag = {
  tabId: string;
  pointerId: number;
  startX: number;
  startY: number;
  clientX: number;
  isDragging: boolean;
};

/** 挿入位置。beforeTabId の直前（null なら末尾）。 */
type DropTarget = { beforeTabId: string | null };

type TabContextMenu = { tabId: string; x: number; y: number };

function isDirtyDocumentTab(tab: DocumentTab): boolean {
  return (
    tab.saveStatus === "dirty" ||
    tab.saveStatus === "error" ||
    tab.markdown !== tab.savedMarkdown
  );
}

function getTabStatusLabel(tab: DocumentTab): string {
  if (tab.saveStatus === "saved" && tab.markdown === tab.savedMarkdown) return "保存済み";
  if (tab.saveStatus === "saving") return "保存中";
  if (tab.saveStatus === "loading") return "読み込み中";
  if (tab.saveStatus === "error") return "保存失敗";
  return "未保存";
}

export function DocumentTabs({
  openTabs,
  displayMode,
  activeTabId,
  fileProgress,
  onActivateTab,
  onCloseTabs,
  onMoveTab,
  onNewTab,
  canReopenClosedTab,
  onReopenClosedTab,
  onCopyTabPath,
  onRevealTab,
}: DocumentTabsProps) {
  const isHoverMode = displayMode === "hover";
  const visibleTabs = openTabs.filter((tab) => tab.kind !== "empty");
  const listRef = useRef<HTMLDivElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<TabDrag | null>(null);
  const dropTargetRef = useRef<DropTarget | null>(null);
  const autoScrollFrameRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [contextMenu, setContextMenu] = useState<TabContextMenu | null>(null);

  // 縦ホイールでも、はみ出したタブを横へ送れるようにする。
  // React の onWheel は passive で preventDefault できないため、直接登録する。
  useEffect(() => {
    const list = listRef.current;
    if (!list) return undefined;
    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey || list.scrollWidth <= list.clientWidth) return;
      if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 40 : 1;
      event.preventDefault();
      list.scrollLeft += event.deltaY * unit;
    };
    list.addEventListener("wheel", handleWheel, { passive: false });
    return () => list.removeEventListener("wheel", handleWheel);
  }, []);

  // アクティブなタブが隠れていれば、リストの横スクロールだけで見える位置へ寄せる。
  // scrollIntoView は祖先の縦スクロールまで動かし得るので使わない。
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.querySelector<HTMLElement>(".activeDocumentTabItem");
    if (!item) return;
    const listRect = list.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    if (itemRect.left < listRect.left) {
      list.scrollLeft -= listRect.left - itemRect.left;
    } else if (itemRect.right > listRect.right) {
      list.scrollLeft += itemRect.right - listRect.right;
    }
  }, [activeTabId, visibleTabs.length]);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const close = () => setContextMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    contextMenuRef.current
      ?.querySelector<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)')
      ?.focus();
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [contextMenu]);

  // 右クリックした文書が他の経路で閉じられたら、メニューも閉じる。
  useEffect(() => {
    if (contextMenu && !visibleTabs.some((tab) => tab.id === contextMenu.tabId)) {
      setContextMenu(null);
    }
  }, [contextMenu, visibleTabs]);

  useEffect(() => () => stopAutoScroll(), []);

  const stopAutoScroll = () => {
    if (autoScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(autoScrollFrameRef.current);
      autoScrollFrameRef.current = null;
    }
  };

  const updateDropTarget = (clientX: number) => {
    const list = listRef.current;
    const drag = dragRef.current;
    if (!list || !drag) return;
    const items = Array.from(list.querySelectorAll<HTMLElement>("[data-tab-id]"));
    const beforeItem = items.find((item) => {
      const rect = item.getBoundingClientRect();
      return clientX < rect.left + rect.width / 2;
    });
    const beforeTabId = beforeItem?.dataset.tabId ?? null;
    // 元の位置と変わらない挿入先は示さない。
    const fromIndex = items.findIndex((item) => item.dataset.tabId === drag.tabId);
    const toIndex = beforeTabId === null ? items.length : items.indexOf(beforeItem!);
    const next = toIndex === fromIndex || toIndex === fromIndex + 1 ? null : { beforeTabId };
    if (dropTargetRef.current?.beforeTabId === next?.beforeTabId) return;
    dropTargetRef.current = next;
    setDropTarget(next);
  };

  const runAutoScroll = () => {
    autoScrollFrameRef.current = null;
    const list = listRef.current;
    const drag = dragRef.current;
    if (!list || !drag?.isDragging) return;
    const rect = list.getBoundingClientRect();
    let step = 0;
    if (drag.clientX < rect.left + DRAG_AUTO_SCROLL_EDGE) {
      step = -Math.min(DRAG_AUTO_SCROLL_MAX_STEP, rect.left + DRAG_AUTO_SCROLL_EDGE - drag.clientX);
    } else if (drag.clientX > rect.right - DRAG_AUTO_SCROLL_EDGE) {
      step = Math.min(DRAG_AUTO_SCROLL_MAX_STEP, drag.clientX - (rect.right - DRAG_AUTO_SCROLL_EDGE));
    }
    if (step === 0) return;
    const before = list.scrollLeft;
    list.scrollLeft += step;
    if (list.scrollLeft === before) return;
    updateDropTarget(drag.clientX);
    autoScrollFrameRef.current = window.requestAnimationFrame(runAutoScroll);
  };

  const finishDrag = (commit: boolean, isPointerReleased = true) => {
    const drag = dragRef.current;
    const target = dropTargetRef.current;
    dragRef.current = null;
    dropTargetRef.current = null;
    stopAutoScroll();
    setDraggingTabId(null);
    setDropTarget(null);
    if (!drag?.isDragging) return;
    // ドラッグの直後に発生する click でタブが切り替わらないようにする。
    // Esc で取り消したときはボタンがまだ押されているので、離すまで抑止を続ける。
    suppressClickRef.current = true;
    const releaseSuppression = () =>
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    if (isPointerReleased) {
      releaseSuppression();
    } else {
      window.addEventListener("pointerup", releaseSuppression, { capture: true, once: true });
    }
    if (commit && target) onMoveTab(drag.tabId, target.beforeTabId);
  };

  // ドラッグ中だけ Esc で取り消せるようにする。
  useEffect(() => {
    if (!draggingTabId) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      const list = listRef.current;
      const drag = dragRef.current;
      // 先に片付けておけば、キャプチャ解除で届く lostpointercapture は素通りする。
      finishDrag(false, false);
      if (list && drag && list.hasPointerCapture(drag.pointerId)) {
        list.releasePointerCapture(drag.pointerId);
      }
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  });

  const handleItemPointerDown = (event: ReactPointerEvent<HTMLDivElement>, tabId: string) => {
    // 中ボタンは自動スクロールのカーソルを出さず、auxclick で閉じる。
    if (event.button === 1) {
      event.preventDefault();
      return;
    }
    if (event.button !== 0 || event.pointerType === "touch") return;
    if ((event.target as Element).closest(".documentTabCloseButton")) return;
    dragRef.current = {
      tabId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      clientX: event.clientX,
      isDragging: false,
    };
  };

  const handleListPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.clientX = event.clientX;
    if (!drag.isDragging) {
      // バーの外で離されたときは pointerup が届かないので、ここで捨てる。
      if ((event.buttons & 1) === 0) {
        dragRef.current = null;
        return;
      }
      const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      if (distance < DRAG_START_DISTANCE) return;
      drag.isDragging = true;
      // キャプチャしておけば、バーの外へ出てもドラッグが続き、
      // ホバー表示モードでもバーが消えない。
      event.currentTarget.setPointerCapture(event.pointerId);
      setDraggingTabId(drag.tabId);
      setContextMenu(null);
    }
    updateDropTarget(event.clientX);
    if (autoScrollFrameRef.current === null) {
      autoScrollFrameRef.current = window.requestAnimationFrame(runAutoScroll);
    }
  };

  const handleListPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    finishDrag(true);
  };

  const handleListPointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    finishDrag(false);
  };

  const openContextMenu = (clientX: number, clientY: number, tabId: string) => {
    const position = getScaledFixedMenuPosition(clientX, clientY, {
      width: TAB_CONTEXT_MENU_WIDTH,
      height: TAB_CONTEXT_MENU_HEIGHT,
    });
    setContextMenu({ tabId, x: position.left, y: position.top });
  };

  const runMenuAction = (action: () => void) => {
    setContextMenu(null);
    action();
  };

  const renderContextMenu = () => {
    if (!contextMenu) return null;
    const index = visibleTabs.findIndex((tab) => tab.id === contextMenu.tabId);
    const tab = visibleTabs[index];
    if (!tab) return null;
    const otherIds = visibleTabs.filter((item) => item.id !== tab.id).map((item) => item.id);
    const rightIds = visibleTabs.slice(index + 1).map((item) => item.id);
    const savedIds = visibleTabs.filter((item) => !isDirtyDocumentTab(item)).map((item) => item.id);

    return createPortal(
      <div
        ref={contextMenuRef}
        className="treeContextMenu documentTabContextMenu"
        style={{ left: contextMenu.x, top: contextMenu.y }}
        role="menu"
        aria-label={`${tab.name} のタブ操作`}
        onPointerDown={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
      >
        <button type="button" role="menuitem" onClick={() => runMenuAction(() => onCloseTabs([tab.id]))}>
          閉じる
          <kbd>Ctrl+W</kbd>
        </button>
        <button
          type="button"
          role="menuitem"
          disabled={otherIds.length === 0}
          onClick={() => runMenuAction(() => onCloseTabs(otherIds))}
        >
          他のタブを閉じる
        </button>
        <button
          type="button"
          role="menuitem"
          disabled={rightIds.length === 0}
          onClick={() => runMenuAction(() => onCloseTabs(rightIds))}
        >
          右側のタブを閉じる
        </button>
        <button
          type="button"
          role="menuitem"
          disabled={savedIds.length === 0}
          onClick={() => runMenuAction(() => onCloseTabs(savedIds))}
        >
          保存済みのタブを閉じる
        </button>
        <div className="contextMenuDivider" role="separator" />
        <button
          type="button"
          role="menuitem"
          disabled={!canReopenClosedTab}
          onClick={() => runMenuAction(onReopenClosedTab)}
        >
          閉じたタブを開き直す
          <kbd>Ctrl+Shift+T</kbd>
        </button>
        <div className="contextMenuDivider" role="separator" />
        <button
          type="button"
          role="menuitem"
          disabled={!tab.path}
          onClick={() => runMenuAction(() => onCopyTabPath(tab))}
        >
          パスをコピー
        </button>
        <button
          type="button"
          role="menuitem"
          disabled={!tab.path}
          onClick={() => runMenuAction(() => onRevealTab(tab))}
        >
          フォルダーで表示
        </button>
      </div>,
      document.querySelector<HTMLElement>(".appShell") ?? document.body,
    );
  };

  const tabBar = (
    <nav
      className={`documentTabs ${isHoverMode ? "hoverDocumentTabs" : ""} ${
        draggingTabId || contextMenu ? "heldDocumentTabs" : ""
      }`}
      aria-label="開いている文書"
    >
      <div
        ref={listRef}
        className={`documentTabsList ${draggingTabId ? "draggingDocumentTabsList" : ""}`}
        role="tablist"
        aria-orientation="horizontal"
        onPointerMove={handleListPointerMove}
        onPointerUp={handleListPointerUp}
        onPointerCancel={handleListPointerCancel}
        onLostPointerCapture={handleListPointerCancel}
        onDoubleClick={(event) => {
          // タブ以外の空いている所をダブルクリックしたら新しいタブを開く。
          if ((event.target as Element).closest(".documentTabItem")) return;
          onNewTab();
        }}
      >
        {visibleTabs.length === 0 && (
          <span className="documentTabsEmpty">開いている文書はありません</span>
        )}
        {visibleTabs.map((tab, index) => {
          const isActive = tab.id === activeTabId;
          const tabStatus = getTabStatusLabel(tab);
          const progress = tab.path ? fileProgress[tab.path] ?? "todo" : null;
          const isDirty = isDirtyDocumentTab(tab);
          const isDropBefore = dropTarget?.beforeTabId === tab.id;
          const isDropAfter =
            dropTarget !== null && dropTarget.beforeTabId === null && index === visibleTabs.length - 1;
          return (
            <div
              className={[
                "documentTabItem",
                isActive ? "activeDocumentTabItem" : "",
                isDirty ? "dirtyDocumentTabItem" : "",
                tab.saveStatus === "error" ? "errorDocumentTabItem" : "",
                draggingTabId === tab.id ? "draggingDocumentTabItem" : "",
                isDropBefore ? "dropBeforeDocumentTabItem" : "",
                isDropAfter ? "dropAfterDocumentTabItem" : "",
              ].filter(Boolean).join(" ")}
              key={tab.id}
              data-tab-id={tab.id}
              onPointerDown={(event) => handleItemPointerDown(event, tab.id)}
              onAuxClick={(event) => {
                if (event.button !== 1) return;
                event.preventDefault();
                onCloseTabs([tab.id]);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                openContextMenu(event.clientX, event.clientY, tab.id);
              }}
            >
              <button
                className="documentTabButton"
                type="button"
                role="tab"
                aria-selected={isActive}
                tabIndex={isActive ? 0 : -1}
                title={
                  progress
                    ? `${tab.path}
進捗: ${fileProgressLabels[progress]}`
                    : tab.path ?? tab.name
                }
                onClick={() => {
                  if (suppressClickRef.current) return;
                  onActivateTab(tab.id);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                  event.preventDefault();
                  const delta = event.key === "ArrowLeft" ? -1 : 1;
                  // Ctrl+Shift+←/→ でタブ自体を並べ替える。
                  if ((event.ctrlKey || event.metaKey) && event.shiftKey) {
                    if (delta < 0 && index > 0) {
                      onMoveTab(tab.id, visibleTabs[index - 1].id);
                    } else if (delta > 0 && index < visibleTabs.length - 1) {
                      onMoveTab(tab.id, visibleTabs[index + 2]?.id ?? null);
                    }
                    return;
                  }
                  const nextIndex = (index + delta + visibleTabs.length) % visibleTabs.length;
                  onActivateTab(visibleTabs[nextIndex].id);
                  const tabButtons = event.currentTarget
                    .closest('[role="tablist"]')
                    ?.querySelectorAll<HTMLButtonElement>(".documentTabButton");
                  tabButtons?.[nextIndex]?.focus();
                }}
              >
                <svg
                  className={[
                    "documentTabKind",
                    tab.kind === "scratch" ? "scratchDocumentTabKind" : "",
                    progress ? `progressDocumentTabKind progressText-${progress}` : "",
                  ].filter(Boolean).join(" ")}
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                  <path d="M14 3v5h5" />
                </svg>
                <span className="documentTabText">
                  <span className="documentTabName">{tab.name}</span>
                  <span className="documentTabPath">{tab.path ?? "保存先未指定"}</span>
                </span>
                <span className="documentTabStatus" aria-label={tabStatus} title={tabStatus} />
              </button>
              <button
                className="documentTabCloseButton"
                type="button"
                aria-label={`${tab.name} を閉じる`}
                title="閉じる (Ctrl+W)"
                onClick={(event) => {
                  event.stopPropagation();
                  onCloseTabs([tab.id]);
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      <button
        className="documentTabsNewButton"
        type="button"
        aria-label="新しいタブ"
        title="新しいタブ"
        onClick={onNewTab}
      >
        <span aria-hidden="true">＋</span>
      </button>
      {renderContextMenu()}
    </nav>
  );

  if (!isHoverMode) return tabBar;
  return <div className="documentTabsHoverZone">{tabBar}</div>;
}
