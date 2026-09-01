import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import type {
  LoadedThenPlugin,
  ThenPluginHostRequest,
  ThenPluginManifest,
} from "./types";

type RuntimeRecord = {
  plugin: LoadedThenPlugin;
  token: string;
};

type RuntimeMessage = {
  channel?: string;
  token?: string;
  kind?: string;
  requestId?: string;
  method?: string;
  args?: unknown;
  message?: string;
  viewId?: string;
};

export type ThenPluginRuntimeHostHandle = {
  emit: (event: string, payload: unknown, requiredPermission?: string) => void;
  executeCommand: (pluginId: string, commandId: string) => void;
};

type ThenPluginRuntimeHostProps = {
  plugins: LoadedThenPlugin[];
  activeView: { pluginId: string; viewId: string } | null;
  visible: boolean;
  modal: boolean;
  anchorElement: HTMLElement | null;
  themeKey: string;
  onRequest: (request: ThenPluginHostRequest) => Promise<unknown>;
  onError: (pluginName: string, message: string) => void;
};

type PluginThemePayload = {
  id: string;
  mode: "light" | "dark";
  tokens: Record<string, string>;
};

const pluginThemeTokenSources = {
  "--then-background": "--sidebar-bg",
  "--then-surface": "--card-bg",
  "--then-surface-hover": "--card-hover",
  "--then-input-background": "--bg-panel",
  "--then-border": "--border-subtle",
  "--then-border-strong": "--border-strong",
  "--then-text": "--text-primary",
  "--then-text-secondary": "--text-secondary",
  "--then-text-muted": "--text-muted",
  "--then-text-faint": "--text-faint",
  "--then-accent": "--accent",
  "--then-accent-strong": "--accent-strong",
  "--then-on-accent": "--on-accent",
  "--then-accent-soft": "--accent-soft",
  "--then-danger": "--danger",
  "--then-danger-soft": "--danger-soft",
  "--then-control-hover": "--control-hover",
  "--then-radius-control": "--radius-control",
  "--then-radius-card": "--radius-card",
  "--then-radius-button": "--radius-button",
} as const;

function jsonForInlineScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function runtimeDocument(runtime: RuntimeRecord): string {
  const manifest = jsonForInlineScript(runtime.plugin.manifest);
  const source = jsonForInlineScript(runtime.plugin.source);
  const token = jsonForInlineScript(runtime.token);
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'"><style>
:root{color-scheme:light dark;--then-background:#17181d;--then-surface:#202126;--then-surface-hover:#292a30;--then-input-background:#17181d;--then-border:#2b2c34;--then-border-strong:#3a3a44;--then-text:#eee6d3;--then-text-secondary:#cfc5ae;--then-text-muted:#8a8791;--then-text-faint:#595864;--then-accent:#d4ad52;--then-accent-strong:#f0d48b;--then-on-accent:#171411;--then-accent-soft:rgba(212,173,82,.12);--then-danger:#d97373;--then-danger-soft:rgba(217,115,115,.12);--then-control-hover:rgba(255,255,255,.04);--then-radius-control:6px;--then-radius-card:8px;--then-radius-button:6px;font-family:"Segoe UI","Yu Gothic UI",sans-serif;background:var(--then-background);color:var(--then-text)}
*{box-sizing:border-box}html,body,#then-plugin-root{width:100%;height:100%;margin:0;overflow:hidden}body{background:var(--then-background);color:var(--then-text)}
.then-plugin-view{display:none;width:100%;height:100%;overflow:auto;padding:10px 12px 12px}.then-plugin-view.active{display:block}
.then-plugin-screen{padding:0}
.then-plugin-modal{padding:0;overflow:hidden;background:transparent}
html[data-then-view-kind="modal"],html[data-then-view-kind="modal"] body,html[data-then-view-kind="modal"] #then-plugin-root{background:transparent}
button,input,textarea,select{font:inherit}button{cursor:pointer}
.then-plugin-error{margin:12px;padding:10px;border:1px solid var(--then-danger);border-radius:var(--then-radius-control);background:var(--then-danger-soft);color:var(--then-danger);white-space:pre-wrap}
</style></head><body><div id="then-plugin-root"></div><script>
(() => {
  "use strict";
  const manifest = ${manifest};
  const token = ${token};
  const source = ${source};
  const pending = new Map();
  const listeners = new Map();
  const commands = new Map();
  const views = new Map();
  let requestSequence = 0;
  let currentTheme = null;

  function post(message) {
    parent.postMessage({ channel: "then-plugin", token, ...message }, "*");
  }
  function request(method, args) {
    const requestId = String(++requestSequence);
    post({ kind: "request", requestId, method, args });
    return new Promise((resolve, reject) => pending.set(requestId, { resolve, reject }));
  }
  function subscribe(event, listener) {
    const current = listeners.get(event) || new Set();
    current.add(listener);
    listeners.set(event, current);
    return { dispose: () => current.delete(listener) };
  }
  function dispatch(event, payload) {
    for (const listener of listeners.get(event) || []) {
      try { listener(payload); } catch (error) { report(error); }
    }
  }
  function report(error) {
    const message = error instanceof Error ? (error.stack || error.message) : String(error);
    post({ kind: "error", message });
  }
  addEventListener("error", (event) => report(event.error || event.message));
  addEventListener("unhandledrejection", (event) => report(event.reason));
  function activateView(viewId) {
    for (const [id, element] of views) element.classList.toggle("active", id === viewId);
    const active = views.get(viewId);
    document.documentElement.dataset.thenViewKind = active && active.classList.contains("then-plugin-modal") ? "modal" : "view";
    dispatch("view:" + viewId, undefined);
    post({ kind: "view.activated", viewId });
  }
  function applyTheme(theme) {
    if (!theme || !theme.tokens) return;
    currentTheme = theme;
    document.documentElement.dataset.thenTheme = theme.id || "";
    document.documentElement.style.colorScheme = theme.mode === "dark" ? "dark" : "light";
    for (const [name, value] of Object.entries(theme.tokens)) {
      if (name.startsWith("--then-") && typeof value === "string") {
        document.documentElement.style.setProperty(name, value);
      }
    }
    dispatch("theme.change", theme);
  }

  addEventListener("message", (event) => {
    const data = event.data || {};
    if (data.channel !== "then-host" || data.token !== token) return;
    if (data.kind === "response") {
      const entry = pending.get(data.requestId);
      if (!entry) return;
      pending.delete(data.requestId);
      if (data.ok) entry.resolve(data.value); else entry.reject(new Error(data.error || "Then API request failed"));
      return;
    }
    if (data.kind === "event") {
      if (data.event === "theme.change") {
        applyTheme(data.payload);
      } else if (data.event === "command") {
        const handler = commands.get(data.payload && data.payload.commandId);
        if (handler) Promise.resolve().then(() => handler()).catch(report);
      } else if (data.event === "view.activate") {
        activateView(data.payload && data.payload.viewId);
      } else {
        dispatch(data.event, data.payload);
      }
    }
  });

  const then = Object.freeze({
    apiVersion: 1,
    manifest: Object.freeze(manifest),
    ui: Object.freeze({
      getTheme: () => currentTheme,
      onDidChangeTheme: (listener) => subscribe("theme.change", listener),
    }),
    editor: Object.freeze({
      getSelection: () => request("editor.getSelection", null),
      moveCursor: (target) => request("editor.moveCursor", target),
    }),
    anchors: Object.freeze({
      create: (range) => request("anchors.create", range || null),
      resolve: (anchorId) => request("anchors.resolve", { anchorId }),
      reveal: (anchorId) => request("anchors.reveal", { anchorId }),
      delete: (anchorId) => request("anchors.delete", { anchorId }),
    }),
    workspace: Object.freeze({
      onDidChangeTextDocument: (listener) => subscribe("document.change", listener),
      onDidChangeSelection: (listener) => subscribe("selection.change", listener),
    }),
    storage: Object.freeze({
      get: (key) => request("storage.get", { key }),
      set: (key, value) => request("storage.set", { key, value }),
      delete: (key) => request("storage.delete", { key }),
    }),
    commands: Object.freeze({
      registerCommand: async (definition, handler) => {
        if (!definition || typeof definition.id !== "string" || typeof handler !== "function") throw new Error("Invalid command registration");
        commands.set(definition.id, handler);
        await request("commands.register", definition);
        return { dispose: () => { commands.delete(definition.id); request("commands.unregister", { id: definition.id }).catch(report); } };
      },
    }),
    views: Object.freeze({
      registerToolView: async (definition, render) => {
        if (!definition || typeof definition.id !== "string" || typeof render !== "function") throw new Error("Invalid view registration");
        if (views.has(definition.id)) throw new Error("View id is already registered: " + definition.id);
        const element = document.createElement("section");
        element.className = "then-plugin-view";
        element.dataset.viewId = definition.id;
        document.getElementById("then-plugin-root").append(element);
        views.set(definition.id, element);
        await request("views.register", definition);
        await render(element);
        return { dispose: () => { views.delete(definition.id); element.remove(); request("views.unregister", { id: definition.id }).catch(report); } };
      },
      registerScreen: async (definition, render) => {
        if (!definition || typeof definition.id !== "string" || typeof render !== "function") throw new Error("Invalid screen registration");
        if (views.has(definition.id)) throw new Error("View id is already registered: " + definition.id);
        const element = document.createElement("section");
        element.className = "then-plugin-view then-plugin-screen";
        element.dataset.viewId = definition.id;
        document.getElementById("then-plugin-root").append(element);
        views.set(definition.id, element);
        await request("views.registerScreen", definition);
        await render(element);
        return { dispose: () => { views.delete(definition.id); element.remove(); request("views.unregisterScreen", { id: definition.id }).catch(report); } };
      },
      registerModal: async (definition, render) => {
        if (!definition || typeof definition.id !== "string" || typeof render !== "function") throw new Error("Invalid modal registration");
        if (views.has(definition.id)) throw new Error("View id is already registered: " + definition.id);
        const element = document.createElement("section");
        element.className = "then-plugin-view then-plugin-modal";
        element.dataset.viewId = definition.id;
        document.getElementById("then-plugin-root").append(element);
        views.set(definition.id, element);
        await request("views.registerModal", definition);
        await render(element);
        return { dispose: () => { views.delete(definition.id); element.remove(); request("views.unregisterModal", { id: definition.id }).catch(report); } };
      },
      open: (viewId) => request("views.open", { id: viewId }),
      openModal: (modalId) => request("views.openModal", { id: modalId }),
      closeModal: (modalId) => request("views.closeModal", { id: modalId }),
    }),
    statusBar: Object.freeze({
      setItem: (definition) => request("statusbar.set", definition),
      removeItem: (id) => request("statusbar.remove", { id }),
    }),
  });

  try {
    const activate = new Function("then", "\\\"use strict\\\";\\n" + source + "\\n//# sourceURL=then-plugin-" + manifest.id + ".js");
    Promise.resolve(activate(then)).then(() => post({ kind: "ready" })).catch(report);
  } catch (error) {
    const element = document.createElement("pre");
    element.className = "then-plugin-error";
    element.textContent = String(error);
    document.getElementById("then-plugin-root").append(element);
    report(error);
  }
})();
</script></body></html>`;
}

function hasPermission(manifest: ThenPluginManifest, permission: string | undefined): boolean {
  return !permission || manifest.permissions.includes(permission as never);
}

export const ThenPluginRuntimeHost = forwardRef<
  ThenPluginRuntimeHostHandle,
  ThenPluginRuntimeHostProps
>(function ThenPluginRuntimeHost(
  { plugins, activeView, visible, modal, anchorElement, themeKey, onRequest, onError },
  ref,
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const frameRefs = useRef(new Map<string, HTMLIFrameElement>());
  const requestRef = useRef(onRequest);
  const errorRef = useRef(onError);
  const activeViewRef = useRef(activeView);
  requestRef.current = onRequest;
  errorRef.current = onError;
  activeViewRef.current = activeView;

  const runtimes = useMemo<RuntimeRecord[]>(
    () => plugins.map((plugin) => ({ plugin, token: crypto.randomUUID() })),
    [plugins],
  );
  const runtimesRef = useRef(runtimes);
  runtimesRef.current = runtimes;

  const sendEvent = (pluginId: string, event: string, payload: unknown) => {
    const runtime = runtimesRef.current.find((item) => item.plugin.manifest.id === pluginId);
    const frame = frameRefs.current.get(pluginId);
    if (!runtime || !frame?.contentWindow) return;
    frame.contentWindow.postMessage(
      { channel: "then-host", token: runtime.token, kind: "event", event, payload },
      "*",
    );
  };

  const readTheme = (): PluginThemePayload | null => {
    const host = hostRef.current;
    const shell = host?.closest<HTMLElement>(".appShell");
    if (!host || !shell) return null;
    const styles = getComputedStyle(shell);
    const tokens: Record<string, string> = {};
    for (const [target, source] of Object.entries(pluginThemeTokenSources)) {
      const value = styles.getPropertyValue(source).trim();
      if (value) tokens[target] = value;
    }
    tokens["--then-font-family"] = styles.getPropertyValue("--ui-font-family").trim() || getComputedStyle(host).fontFamily;
    const colorScheme = styles.colorScheme.toLocaleLowerCase();
    return {
      id: shell.dataset.theme || "default",
      mode: colorScheme.includes("dark") ? "dark" : "light",
      tokens,
    };
  };

  const syncTheme = (pluginId?: string) => {
    const theme = readTheme();
    if (!theme) return;
    const targets = pluginId
      ? runtimesRef.current.filter((runtime) => runtime.plugin.manifest.id === pluginId)
      : runtimesRef.current;
    for (const runtime of targets) {
      sendEvent(runtime.plugin.manifest.id, "theme.change", theme);
    }
  };

  useImperativeHandle(ref, () => ({
    emit: (event, payload, requiredPermission) => {
      for (const runtime of runtimesRef.current) {
        if (hasPermission(runtime.plugin.manifest, requiredPermission)) {
          sendEvent(runtime.plugin.manifest.id, event, payload);
        }
      }
    },
    executeCommand: (pluginId, commandId) => {
      sendEvent(pluginId, "command", { commandId });
    },
  }));

  useEffect(() => {
    const handleMessage = (event: MessageEvent<RuntimeMessage>) => {
      const data = event.data;
      if (!data || data.channel !== "then-plugin" || !data.token) return;
      const runtime = runtimesRef.current.find((item) => {
        const frame = frameRefs.current.get(item.plugin.manifest.id);
        return item.token === data.token && frame?.contentWindow === event.source;
      });
      if (!runtime) return;
      if (data.kind === "error") {
        errorRef.current(runtime.plugin.manifest.name, data.message || "Unknown plugin error");
        return;
      }
      if (data.kind === "view.activated") {
        const current = activeViewRef.current;
        if (current?.pluginId === runtime.plugin.manifest.id && data.viewId === current.viewId) {
          hostRef.current?.setAttribute("data-active-view-ready", "true");
        }
        return;
      }
      if (data.kind !== "request" || !data.requestId || !data.method) return;
      const frame = frameRefs.current.get(runtime.plugin.manifest.id);
      Promise.resolve(
        requestRef.current({
          pluginId: runtime.plugin.manifest.id,
          method: data.method,
          args: data.args,
        }),
      ).then(
        (value) => frame?.contentWindow?.postMessage(
          { channel: "then-host", token: runtime.token, kind: "response", requestId: data.requestId, ok: true, value },
          "*",
        ),
        (error) => frame?.contentWindow?.postMessage(
          { channel: "then-host", token: runtime.token, kind: "response", requestId: data.requestId, ok: false, error: String(error) },
          "*",
        ),
      );
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!activeView) {
      host?.removeAttribute("data-active-view-ready");
      return;
    }
    host?.setAttribute("data-active-view-ready", "false");
    sendEvent(activeView.pluginId, "view.activate", { viewId: activeView.viewId });
  }, [activeView?.pluginId, activeView?.viewId]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const syncBounds = () => {
      if (modal) {
        host.style.top = "0";
        host.style.right = "0";
        host.style.bottom = "0";
        host.style.left = "0";
        host.style.width = "auto";
        host.style.height = "auto";
        return;
      }
      if (!anchorElement) return;
      const rect = anchorElement.getBoundingClientRect();
      host.style.top = `${rect.top}px`;
      host.style.right = "auto";
      host.style.bottom = "auto";
      host.style.left = `${rect.left}px`;
      host.style.width = `${rect.width}px`;
      host.style.height = `${rect.height}px`;
    };
    syncBounds();
    const observer = anchorElement && typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(syncBounds)
      : null;
    if (anchorElement) observer?.observe(anchorElement);
    window.addEventListener("resize", syncBounds);
    const frame = window.requestAnimationFrame(syncBounds);
    const sidebar = anchorElement?.closest(".rightSidebar");
    let trackingFrame: number | null = null;
    let isTrackingTransition = false;
    const trackTransition = () => {
      syncBounds();
      if (isTrackingTransition) {
        trackingFrame = window.requestAnimationFrame(trackTransition);
      }
    };
    const startTransitionTracking = (event: Event) => {
      if (!(event instanceof TransitionEvent) || event.propertyName !== "transform") return;
      if (isTrackingTransition) return;
      isTrackingTransition = true;
      trackTransition();
    };
    const stopTransitionTracking = (event: Event) => {
      if (!(event instanceof TransitionEvent) || event.propertyName !== "transform") return;
      isTrackingTransition = false;
      if (trackingFrame !== null) window.cancelAnimationFrame(trackingFrame);
      trackingFrame = null;
      syncBounds();
    };
    sidebar?.addEventListener("transitionrun", startTransitionTracking);
    sidebar?.addEventListener("transitionend", stopTransitionTracking);
    sidebar?.addEventListener("transitioncancel", stopTransitionTracking);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", syncBounds);
      window.cancelAnimationFrame(frame);
      isTrackingTransition = false;
      if (trackingFrame !== null) window.cancelAnimationFrame(trackingFrame);
      sidebar?.removeEventListener("transitionrun", startTransitionTracking);
      sidebar?.removeEventListener("transitionend", stopTransitionTracking);
      sidebar?.removeEventListener("transitioncancel", stopTransitionTracking);
    };
  }, [anchorElement, modal, visible]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => syncTheme());
    return () => window.cancelAnimationFrame(frame);
  }, [themeKey, runtimes]);

  return (
    <div
      ref={hostRef}
      className={`pluginRuntimeHost pluginRuntimeDetachedHost${visible ? " visiblePluginRuntimeHost" : ""}${modal ? " pluginModalRuntimeHost" : ""}`}
      aria-hidden={!visible}
    >
      {runtimes.map((runtime) => {
        const pluginId = runtime.plugin.manifest.id;
        const active = visible && activeView?.pluginId === pluginId;
        return (
          <iframe
            key={`${pluginId}:${runtime.plugin.manifest.version}`}
            ref={(frame) => {
              if (frame) frameRefs.current.set(pluginId, frame);
              else frameRefs.current.delete(pluginId);
            }}
            className={`pluginRuntimeFrame${active ? " activePluginRuntimeFrame" : ""}`}
            title={`${runtime.plugin.manifest.name} plugin`}
            sandbox="allow-scripts"
            srcDoc={runtimeDocument(runtime)}
            onLoad={() => {
              syncTheme(pluginId);
              const current = activeViewRef.current;
              if (current?.pluginId !== pluginId) return;
              hostRef.current?.setAttribute("data-active-view-ready", "false");
              sendEvent(pluginId, "view.activate", { viewId: current.viewId });
            }}
          />
        );
      })}
    </div>
  );
});
