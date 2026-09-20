import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

const isTauriRuntime = () => "__TAURI_INTERNALS__" in window;

function WindowControlIcon({ name }: { name: "minimize" | "maximize" | "restore" | "close" }) {
  const common = {
    viewBox: "0 0 12 12",
    "aria-hidden": true,
    focusable: false,
  };

  switch (name) {
    case "minimize":
      return (
        <svg {...common}>
          <path d="M1.5 6.5h9" />
        </svg>
      );
    case "maximize":
      return (
        <svg {...common}>
          <rect x="1.5" y="1.5" width="9" height="9" />
        </svg>
      );
    case "restore":
      return (
        <svg {...common}>
          <path d="M3.5 3.5h7v7h-7z" />
          <path d="M1.5 8.5v-7h7" />
        </svg>
      );
    case "close":
      return (
        <svg {...common}>
          <path d="m2 2 8 8M10 2 2 10" />
        </svg>
      );
  }
}

export function WindowControls() {
  const native = isTauriRuntime();
  const [isMaximized, setIsMaximized] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (!native) return;

    const appWindow = getCurrentWindow();
    let disposed = false;
    let unlisten: (() => void) | undefined;

    const syncWindowState = async () => {
      try {
        const [maximized, fullscreen] = await Promise.all([
          appWindow.isMaximized(),
          appWindow.isFullscreen(),
        ]);
        if (disposed) return;
        setIsMaximized(maximized);
        setIsFullscreen(fullscreen);
        document.documentElement.dataset.windowFullscreen = fullscreen ? "true" : "false";
      } catch (error) {
        console.error("Failed to read the main window state", error);
      }
    };

    void syncWindowState();
    void appWindow.onResized(() => void syncWindowState()).then((stopListening) => {
      if (disposed) stopListening();
      else unlisten = stopListening;
    });

    return () => {
      disposed = true;
      unlisten?.();
      delete document.documentElement.dataset.windowFullscreen;
    };
  }, [native]);

  if (!native) return null;

  const appWindow = getCurrentWindow();
  const runWindowAction = (action: () => Promise<void>) => {
    void action().catch((error) => console.error("Window control action failed", error));
  };

  return (
    <div
      className="windowControls"
      data-fullscreen={isFullscreen ? "true" : undefined}
      data-tauri-drag-region="false"
      role="group"
      aria-label="ウィンドウ操作"
    >
      <button
        className="windowControlButton"
        type="button"
        aria-label="最小化"
        title="最小化"
        onClick={() => runWindowAction(() => appWindow.minimize())}
      >
        <WindowControlIcon name="minimize" />
      </button>
      <button
        className="windowControlButton"
        type="button"
        aria-label={isMaximized ? "元のサイズに戻す" : "最大化"}
        title={isMaximized ? "元のサイズに戻す" : "最大化"}
        onClick={() => runWindowAction(() => appWindow.toggleMaximize())}
      >
        <WindowControlIcon name={isMaximized ? "restore" : "maximize"} />
      </button>
      <button
        className="windowControlButton windowCloseButton"
        type="button"
        aria-label="閉じる"
        title="閉じる"
        onClick={() => runWindowAction(() => appWindow.close())}
      >
        <WindowControlIcon name="close" />
      </button>
    </div>
  );
}
