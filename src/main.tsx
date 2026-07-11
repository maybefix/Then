import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import CanvasWindowApp from "./CanvasWindowApp";
import ExportWindowApp from "./ExportWindowApp";
import "./App.css";
import "./styles/themes/foundations.css";
import "./styles/themes/catalog.css";
import "./styles/themes/previews.css";

function installWebviewNativeShortcutGuards(): void {
  window.addEventListener(
    "contextmenu",
    (event) => {
      event.preventDefault();
    },
    { capture: true },
  );
  window.addEventListener(
    "keydown",
    (event) => {
      const mod = event.ctrlKey || event.metaKey;
      if (mod && !event.altKey && (event.key === "f" || event.key === "F")) {
        event.preventDefault();
      }
    },
    { capture: true },
  );
}

// The dedicated export window loads plain index.html (a "?view=export" query is
// dropped by Tauri's WebviewUrl::App path resolution), so it is identified by
// its Tauri window label. The query string is still honored as a browser-only
// fallback for previewing the export screen outside Tauri.
function detectExportWindow(): boolean {
  if (new URLSearchParams(window.location.search).get("view") === "export") return true;
  try {
    if ((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
      return getCurrentWebviewWindow().label === "linked-export";
    }
  } catch {
    // not running inside a Tauri webview
  }
  return false;
}

function detectCanvasWindow(): boolean {
  if (new URLSearchParams(window.location.search).get("view") === "canvas") return true;
  try {
    if ((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
      return getCurrentWebviewWindow().label === "idea-canvas";
    }
  } catch {
    // not running inside a Tauri webview
  }
  return false;
}

const isExportWindow = detectExportWindow();
const isCanvasWindow = detectCanvasWindow();

installWebviewNativeShortcutGuards();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isCanvasWindow ? <CanvasWindowApp /> : isExportWindow ? <ExportWindowApp /> : <App />}
  </React.StrictMode>,
);
