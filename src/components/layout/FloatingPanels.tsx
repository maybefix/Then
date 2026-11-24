import { useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode, type RefObject } from "react";
import type { PanelFrame, PanelStatus } from "./floatingPanelState";

type Size = { width: number; height: number };
type PanelGesture = {
  mode: "move" | "resize";
  pointer: number;
  x: number;
  y: number;
  frame: PanelFrame;
};

const SNAP_DISTANCE = 12;
const clamp = (value: number, max: number) => Math.max(0, Math.min(value, max));

export function fitPanelFrame(frame: PanelFrame, area: Size): PanelFrame {
  const width = Math.min(area.width, Math.max(240, frame.width));
  const height = Math.min(area.height, Math.max(144, frame.height));
  return {
    x: frame.x === -1 ? Math.max(0, area.width - width - 16) : clamp(frame.x, area.width - width),
    y: clamp(frame.y, area.height - height),
    width,
    height,
  };
}

export function usePanelArea(workspace: RefObject<HTMLElement>, visible: boolean) {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const stage = workspace.current;
    if (!stage || !visible) return;
    const update = () => {
      const { clientWidth: width, clientHeight: height } = stage;
      if (width && height) {
        setSize((current) => current.width === width && current.height === height ? current : { width, height });
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [workspace, visible]);

  return size;
}

export function usePanelAnimation(
  ref: RefObject<HTMLElement>,
  taskbar: RefObject<HTMLElement>,
  id: string,
  status: PanelStatus,
  enabled: boolean,
) {
  const previous = useRef<PanelStatus>();
  useLayoutEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    const before = previous.current;
    previous.current = status;
    const opening = status === "open";
    const transitioning = enabled && (
      (before === "minimized" && opening) || (before === "open" && status === "minimized")
    );
    const task = transitioning && taskbar.current?.querySelector<HTMLElement>(
      `[data-panel-task="${CSS.escape(id)}"]`,
    );
    if (!task || !panel.animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      panel.hidden = !opening;
      return;
    }

    panel.hidden = false;
    const source = panel.getBoundingClientRect();
    const target = task.getBoundingClientRect();
    if (!source.width || !source.height || !target.width || !target.height) {
      panel.hidden = !opening;
      return;
    }

    const normal = { translate: "0px 0px", scale: "1 1", opacity: 1 };
    const minimized = {
      translate: `${target.left - source.left}px ${target.top - source.top}px`,
      scale: `${target.width / source.width} ${target.height / source.height}`,
      opacity: 0.2,
    };
    panel.dataset.panelAnimating = "";
    const animation = panel.animate(opening ? [minimized, normal] : [normal, minimized], {
      duration: 190,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      fill: "both",
    });
    animation.onfinish = () => {
      panel.hidden = !opening;
      delete panel.dataset.panelAnimating;
      animation.cancel();
    };
    return () => {
      animation.cancel();
      delete panel.dataset.panelAnimating;
    };
  }, [enabled, id, ref, status, taskbar]);
}

export type PanelTask = {
  id: string;
  label: string;
  icon: ReactNode;
  status: PanelStatus;
};

export function PanelTaskbar({ taskbar, fixed, documents, onLaunch, onTaskClick, onToggleAll, allMinimized, canToggle }: {
  taskbar: RefObject<HTMLElement>;
  fixed: PanelTask[];
  documents: PanelTask[];
  onLaunch: (id: string) => void;
  onTaskClick: (id: string) => void;
  onToggleAll: () => void;
  allMinimized: boolean;
  canToggle: boolean;
}) {
  const [launcherOpen, setLauncherOpen] = useState(false);
  const launcherId = useId();
  const launcher = useRef<HTMLElement>(null);
  const launcherButton = useRef<HTMLButtonElement>(null);
  const focusTile = useRef(false);
  const activeTasks = fixed.filter((task) => task.status !== "closed");

  useLayoutEffect(() => {
    if (launcherOpen && focusTile.current) launcher.current?.querySelector("button")?.focus();
  }, [launcherOpen]);

  useEffect(() => {
    if (!launcherOpen) return;
    function dismissOnOutsidePress(event: globalThis.PointerEvent) {
      const path = event.composedPath();
      if ((launcher.current && path.includes(launcher.current)) ||
          (launcherButton.current && path.includes(launcherButton.current))) return;
      setLauncherOpen(false);
    }
    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (launcher.current?.contains(document.activeElement)) launcherButton.current?.focus();
      setLauncherOpen(false);
    }
    document.addEventListener("pointerdown", dismissOnOutsidePress, true);
    document.addEventListener("keydown", dismissOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", dismissOnOutsidePress, true);
      document.removeEventListener("keydown", dismissOnEscape, true);
    };
  }, [launcherOpen]);

  function scrollTasks(event: React.WheelEvent<HTMLDivElement>) {
    if (!event.deltaX && event.currentTarget.scrollWidth > event.currentTarget.clientWidth) {
      event.currentTarget.scrollLeft += event.deltaY;
    }
  }

  function renderTask(task: PanelTask) {
    const detail = task.status === "open" ? "表示中" : "最小化中";
    return (
      <button
        key={task.id}
        type="button"
        title={`${task.label}（${detail}）`}
        aria-label={`${task.label}（${detail}）`}
        aria-expanded={task.status === "open"}
        data-panel-task={task.id}
        data-panel-status={task.status}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onTaskClick(task.id)}
      >
        {task.icon}
        <span>{task.label}</span>
      </button>
    );
  }

  const action = allMinimized ? "パネルを一括復元" : "パネルを一括最小化";
  return (
    <nav ref={taskbar} className="panelTaskbar" aria-label="タスクバー">
      <button
        ref={launcherButton}
        type="button"
        className="panelLauncherButton"
        aria-label="パネルを開く"
        aria-controls={launcherId}
        aria-expanded={launcherOpen}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          focusTile.current = event.detail === 0;
          setLauncherOpen((open) => !open);
        }}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <rect x="4" y="4" width="6" height="6" rx="1" />
          <rect x="14" y="4" width="6" height="6" rx="1" />
          <rect x="4" y="14" width="6" height="6" rx="1" />
          <rect x="14" y="14" width="6" height="6" rx="1" />
        </svg>
        <span>パネル</span>
      </button>
      {launcherOpen && (
        <section ref={launcher} id={launcherId} className="panelLauncher" aria-label="パネルを開く">
          {fixed.map((panel) => (
            <button
              key={panel.id}
              type="button"
              className="panelLauncherTile"
              data-panel-launch={panel.id}
              title={panel.label}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                if (launcher.current?.contains(document.activeElement)) launcherButton.current?.focus();
                setLauncherOpen(false);
                onLaunch(panel.id);
              }}
            >
              {panel.icon}
              <span>{panel.label}</span>
            </button>
          ))}
        </section>
      )}
      {activeTasks.length > 0 && (
        <div className="panelTaskGroup" onWheel={scrollTasks} role="group" aria-label="機能パネル">
          {activeTasks.map(renderTask)}
        </div>
      )}
      {documents.length > 0 && (
        <div className="panelTaskGroup documentPanelTasks" onWheel={scrollTasks} role="group" aria-label="開いている資料">
          {documents.map(renderTask)}
        </div>
      )}
      <button
        className="panelTaskbarToggle"
        type="button"
        disabled={!canToggle}
        aria-label={action}
        title={action}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onToggleAll}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d={allMinimized ? "m5 15 7-7 7 7M5 21l7-7 7 7" : "m5 3 7 7 7-7M5 9l7 7 7-7M4 21h16"} />
        </svg>
      </button>
    </nav>
  );
}

export function FloatingPanel({
  id, label, icon, status, visible, area, frame, zIndex, taskbar,
  onFocus, onMinimize, onClose, onFrameChange, headerActions, children,
}: {
  id: string;
  label: string;
  icon: ReactNode;
  status: PanelStatus;
  visible: boolean;
  area: Size;
  frame: PanelFrame;
  zIndex: number;
  taskbar: RefObject<HTMLElement>;
  onFocus: () => void;
  onMinimize: () => void;
  onClose: () => void;
  onFrameChange: (frame: PanelFrame) => void;
  headerActions?: ReactNode;
  children: ReactNode;
}) {
  const panel = useRef<HTMLElement>(null);
  const gesture = useRef<PanelGesture | null>(null);
  const [draft, setDraft] = useState<PanelFrame | null>(null);
  const [mounted, setMounted] = useState(status === "open");
  useLayoutEffect(() => {
    if (status === "open" && !mounted) setMounted(true);
  }, [mounted, status]);
  const actual = fitPanelFrame(draft ?? frame, area);
  const interactive = visible && status === "open";
  usePanelAnimation(panel, taskbar, id, status, visible);

  function begin(event: PointerEvent<HTMLElement>, mode: PanelGesture["mode"]) {
    if (event.button !== 0 || gesture.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { mode, pointer: event.pointerId, x: event.clientX, y: event.clientY, frame: actual };
  }

  function change(event: PointerEvent<HTMLElement>, finish = false) {
    const drag = gesture.current;
    if (!drag || drag.pointer !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    let next = drag.frame;
    if (drag.mode === "resize") {
      next = {
        ...next,
        width: Math.min(area.width - next.x, Math.max(240, next.width + dx)),
        height: Math.min(area.height - next.y, Math.max(144, next.height + dy)),
      };
    } else {
      const right = area.width - next.width;
      const bottom = area.height - next.height;
      const snap = (value: number, limit: number) =>
        value <= SNAP_DISTANCE ? 0 : value >= limit - SNAP_DISTANCE ? limit : value;
      next = { ...next, x: snap(next.x + dx, right), y: snap(next.y + dy, bottom) };
    }
    if (!finish) {
      setDraft(next);
      return;
    }
    gesture.current = null;
    setDraft(null);
    if (dx || dy) onFrameChange(next);
  }

  const cancel = () => {
    gesture.current = null;
    setDraft(null);
  };

  const dragHandlers = {
    onPointerMove: (event: PointerEvent<HTMLElement>) => change(event),
    onPointerUp: (event: PointerEvent<HTMLElement>) => change(event, true),
    onPointerCancel: cancel,
    onLostPointerCapture: cancel,
  };

  return (
    <section
      ref={panel}
      className="floatingPanel"
      aria-label={label}
      aria-hidden={!interactive}
      {...(!interactive ? { inert: "" } : {})}
      data-floating-panel={id}
      data-panel-status={status}
      style={{ left: actual.x, top: actual.y, width: actual.width, height: actual.height, zIndex }}
      onPointerDown={onFocus}
      onFocusCapture={onFocus}
    >
      <header className="floatingPanelHeader">
        <div className="floatingPanelGrip" onPointerDown={(event) => begin(event, "move")} {...dragHandlers}>
          {icon}
          <strong>{label}</strong>
        </div>
        {headerActions}
        <button
          type="button"
          aria-label="最小化"
          title="最小化"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onMinimize}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 17h12" /></svg>
        </button>
        <button
          type="button"
          aria-label="閉じる"
          title="閉じる"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onClose}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
      </header>
      <div className="floatingPanelContent">{(mounted || interactive) && children}</div>
      <span
        className="floatingPanelResize"
        aria-hidden="true"
        onPointerDown={(event) => begin(event, "resize")}
        {...dragHandlers}
      />
    </section>
  );
}
