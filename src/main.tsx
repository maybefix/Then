import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ExportWindowApp from "./ExportWindowApp";
import "./App.css";

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

const isExportWindow = detectExportWindow();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isExportWindow ? <ExportWindowApp /> : <App />}
  </React.StrictMode>,
);
