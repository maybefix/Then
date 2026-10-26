import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ProjectFolder } from "../types";
import { clearPendingSave, setPendingSave } from "../pendingSaves";
import { toProjectRelativePath } from "../utils/projectTree";
import type { ThenPluginRuntimeHostHandle } from "./PluginRuntimeHost";
import type {
  LoadedThenPlugin,
  ThenPluginAnchor,
  ThenPluginAnchorStore,
  ThenPluginCommand,
  ThenPluginModal,
  ThenPluginScreen,
  ThenPluginStatusItem,
  ThenPluginView,
} from "./types";

const isTauriRuntime = () => "__TAURI_INTERNALS__" in window;

// 待っている遅延保存の一覧（pendingSaves）での名前。
const PLUGIN_ANCHORS_PENDING_SAVE = "plugin-anchors";

type PluginHostDeps = {
  projectFolder: ProjectFolder | null;
  setLastError: Dispatch<SetStateAction<string>>;
  appMode: string;
  setAppMode: (mode: "write") => void;
  rightSidebarTab: string;
  setRightSidebarTab: (tab: string) => void;
  isRightSidebarCollapsed: boolean;
  isEditorFocusMode: boolean;
};

// プラグインの値（読み込んだプラグインと、プラグインが登録したもの・開いているもの）、
// プラグインの読み込み、アンカーの読み込みと保存。App は state があった位置で呼ぶ。
export function usePluginHost({
  projectFolder,
  setLastError,
  appMode,
  setAppMode,
  rightSidebarTab,
  setRightSidebarTab,
  isRightSidebarCollapsed,
  isEditorFocusMode,
}: PluginHostDeps) {
  const pluginRuntimeHostRef = useRef<ThenPluginRuntimeHostHandle | null>(null);
  const pluginWorkspacePathRef = useRef<string | null>(null);
  const pluginAnchorSaveTimerRef = useRef<number | null>(null);
  const pluginAnchorSaveRootRef = useRef<string | null>(null);
  const pluginAnchorsRef = useRef<ThenPluginAnchor[]>([]);
  const pluginAnchorMutationVersionRef = useRef(0);
  // アンカーのファイルを読めなかった作品。読めなかったファイルを上書きしないよう、この作品では保存しない。
  const pluginAnchorUnreadableRootRef = useRef<string | null>(null);
  const pluginCommandsRef = useRef<ThenPluginCommand[]>([]);
  const pluginStorageQueuesRef = useRef<Map<string, Promise<void>>>(new Map());
  const pluginActiveDocumentRef = useRef<{ path: string | null; text: string }>({
    path: null,
    text: "",
  });
  const [loadedPlugins, setLoadedPlugins] = useState<LoadedThenPlugin[]>([]);
  const [pluginCommands, setPluginCommands] = useState<ThenPluginCommand[]>([]);
  const [pluginViews, setPluginViews] = useState<ThenPluginView[]>([]);
  const [pluginScreens, setPluginScreens] = useState<ThenPluginScreen[]>([]);
  const [pluginModals, setPluginModals] = useState<ThenPluginModal[]>([]);
  const [pluginStatusItems, setPluginStatusItems] = useState<ThenPluginStatusItem[]>([]);
  const [activePluginScreenKey, setActivePluginScreenKey] = useState<string | null>(null);
  const [activePluginModalKey, setActivePluginModalKey] = useState<string | null>(null);
  const [sidebarPluginRuntimeAnchor, setSidebarPluginRuntimeAnchor] = useState<HTMLDivElement | null>(null);
  const [screenPluginRuntimeAnchor, setScreenPluginRuntimeAnchor] = useState<HTMLDivElement | null>(null);
  const [pluginAnchors, setPluginAnchors] = useState<ThenPluginAnchor[]>([]);
  const activePluginView = pluginViews.find(
    (view) => rightSidebarTab === `plugin:${view.pluginId}:${view.id}`,
  ) ?? null;
  const pluginSelectionCommands = pluginCommands.filter(
    (command) => command.menus?.includes("editor.selection"),
  );
  const activePluginScreen = pluginScreens.find(
    (screen) => activePluginScreenKey === `${screen.pluginId}:${screen.id}`,
  ) ?? null;
  const activePluginModal = pluginModals.find(
    (modal) => activePluginModalKey === `${modal.pluginId}:${modal.id}`,
  ) ?? null;
  const dockedPluginRuntimeView = appMode === "plugin" && activePluginScreen
    ? { pluginId: activePluginScreen.pluginId, viewId: activePluginScreen.id }
    : activePluginView
      ? { pluginId: activePluginView.pluginId, viewId: activePluginView.id }
      : null;
  const isDockedPluginRuntimeVisible = appMode === "plugin"
    ? Boolean(activePluginScreen)
    : Boolean(activePluginView) && !isRightSidebarCollapsed && !isEditorFocusMode;
  const pluginRuntimeAnchor = appMode === "plugin"
    ? screenPluginRuntimeAnchor
    : sidebarPluginRuntimeAnchor;
  const pluginRuntimeActiveView = activePluginModal
    ? { pluginId: activePluginModal.pluginId, viewId: activePluginModal.id }
    : dockedPluginRuntimeView;
  useEffect(() => {
    if (appMode === "plugin" && !activePluginScreen) {
      setAppMode("write");
    }
  }, [activePluginScreen, appMode]);
  useEffect(() => {
    if (rightSidebarTab.startsWith("plugin:") && !activePluginView) {
      setRightSidebarTab("plot");
    }
  }, [activePluginView, rightSidebarTab]);
  useEffect(() => {
    if (activePluginModalKey && !activePluginModal) setActivePluginModalKey(null);
  }, [activePluginModal, activePluginModalKey]);
  useEffect(() => {
    if (!activePluginModal) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setActivePluginModalKey(null);
    };
    window.addEventListener("keydown", closeOnEscape, true);
    return () => window.removeEventListener("keydown", closeOnEscape, true);
  }, [activePluginModal]);

  pluginCommandsRef.current = pluginCommands;
  pluginAnchorsRef.current = pluginAnchors;

  const reloadInstalledPlugins = useCallback(async () => {
    if (!isTauriRuntime()) {
      setLoadedPlugins([]);
      return true;
    }
    try {
      const result = await invoke<{ plugins: LoadedThenPlugin[]; errors: string[] }>(
        "list_installed_plugins",
      );
      setLoadedPlugins(result.plugins);
      setPluginCommands([]);
      setPluginViews([]);
      setPluginScreens([]);
      setPluginModals([]);
      setActivePluginModalKey(null);
      setPluginStatusItems([]);
      if (result.errors.length > 0) {
        setLastError(`読み込めないプラグインがあります: ${result.errors.join(" / ")}`);
      }
      return result.errors.length === 0;
    } catch (error) {
      setLastError(`プラグインの読み込みに失敗しました: ${String(error)}`);
      return false;
    }
  }, []);

  useEffect(() => {
    void reloadInstalledPlugins();
  }, [reloadInstalledPlugins]);

  useEffect(() => {
    const workspacePath = projectFolder?.path ?? null;
    if (pluginWorkspacePathRef.current === workspacePath) return;
    pluginWorkspacePathRef.current = workspacePath;
    pluginRuntimeHostRef.current?.emit("workspace.change", {
      name: projectFolder?.name ?? null,
      hasProject: Boolean(projectFolder),
    });
  }, [projectFolder?.name, projectFolder?.path]);

  useEffect(() => {
    if (pluginAnchorSaveTimerRef.current !== null) {
      window.clearTimeout(pluginAnchorSaveTimerRef.current);
      pluginAnchorSaveTimerRef.current = null;
      pluginAnchorSaveRootRef.current = null;
      clearPendingSave(PLUGIN_ANCHORS_PENDING_SAVE);
    }
    pluginAnchorUnreadableRootRef.current = null;
    const rootPath = projectFolder?.path;
    if (!rootPath || !isTauriRuntime()) {
      setPluginAnchors([]);
      return;
    }
    const loadVersion = ++pluginAnchorMutationVersionRef.current;
    setPluginAnchors([]);
    pluginAnchorsRef.current = [];
    let cancelled = false;
    invoke<ThenPluginAnchorStore | null>("load_plugin_anchors", { rootPath })
      .then((store) => {
        if (cancelled) return;
        if (store && !(store.version === 1 && Array.isArray(store.anchors))) {
          pluginAnchorUnreadableRootRef.current = rootPath;
          setLastError("アンカーの読み込みに失敗しました: 対応していない形式です");
          return;
        }
        if (pluginAnchorMutationVersionRef.current !== loadVersion) return;
        setPluginAnchors(store?.anchors ?? []);
      })
      .catch((error) => {
        if (cancelled) return;
        pluginAnchorUnreadableRootRef.current = rootPath;
        setLastError(`アンカーの読み込みに失敗しました: ${String(error)}`);
      });
    return () => {
      cancelled = true;
      if (
        pluginAnchorSaveTimerRef.current !== null &&
        pluginAnchorSaveRootRef.current === rootPath
      ) {
        window.clearTimeout(pluginAnchorSaveTimerRef.current);
        pluginAnchorSaveTimerRef.current = null;
        pluginAnchorSaveRootRef.current = null;
        clearPendingSave(PLUGIN_ANCHORS_PENDING_SAVE);
        if (pluginAnchorUnreadableRootRef.current !== rootPath) {
          const store: ThenPluginAnchorStore = { version: 1, anchors: pluginAnchorsRef.current };
          void invoke("save_plugin_anchors", { rootPath, store });
        }
      }
    };
  }, [projectFolder?.path]);

  const persistPluginAnchors = useCallback((anchors: ThenPluginAnchor[]) => {
    pluginAnchorMutationVersionRef.current += 1;
    setPluginAnchors(anchors);
    pluginAnchorsRef.current = anchors;
    const rootPath = projectFolder?.path;
    if (!rootPath || !isTauriRuntime()) return;
    if (pluginAnchorSaveTimerRef.current !== null) {
      window.clearTimeout(pluginAnchorSaveTimerRef.current);
    }
    const saveAnchors = () => {
      pluginAnchorSaveTimerRef.current = null;
      pluginAnchorSaveRootRef.current = null;
      clearPendingSave(PLUGIN_ANCHORS_PENDING_SAVE, saveAnchorsNow);
      if (pluginAnchorUnreadableRootRef.current === rootPath) return;
      const store: ThenPluginAnchorStore = { version: 1, anchors: pluginAnchorsRef.current };
      return invoke("save_plugin_anchors", { rootPath, store }).catch((error) => {
        setLastError(`アンカーの保存に失敗しました: ${String(error)}`);
      });
    };
    // 閉じる前は、待たずに今書く。
    const saveAnchorsNow = () => {
      if (pluginAnchorSaveTimerRef.current !== null) {
        window.clearTimeout(pluginAnchorSaveTimerRef.current);
      }
      return saveAnchors();
    };
    pluginAnchorSaveTimerRef.current = window.setTimeout(saveAnchors, 180);
    pluginAnchorSaveRootRef.current = rootPath;
    setPendingSave(PLUGIN_ANCHORS_PENDING_SAVE, saveAnchorsNow);
  }, [projectFolder?.path]);

  const retargetPluginAnchors = useCallback((oldAbsolutePath: string, newAbsolutePath: string) => {
    if (!projectFolder) return;
    const oldPath = toProjectRelativePath(projectFolder.path, oldAbsolutePath).replace(/[\\/]+/g, "/");
    const newPath = toProjectRelativePath(projectFolder.path, newAbsolutePath).replace(/[\\/]+/g, "/");
    const comparableOld = oldPath.toLocaleLowerCase();
    let changed = false;
    const next = pluginAnchorsRef.current.map((anchor) => {
      const comparableAnchor = anchor.documentPath.replace(/[\\/]+/g, "/").toLocaleLowerCase();
      if (comparableAnchor !== comparableOld && !comparableAnchor.startsWith(`${comparableOld}/`)) {
        return anchor;
      }
      changed = true;
      return {
        ...anchor,
        documentPath: `${newPath}${anchor.documentPath.replace(/[\\/]+/g, "/").slice(oldPath.length)}`,
        updatedAt: Date.now(),
      };
    });
    if (changed) persistPluginAnchors(next);
  }, [persistPluginAnchors, projectFolder]);

  return {
    pluginRuntimeHostRef,
    pluginAnchorsRef,
    pluginCommandsRef,
    pluginStorageQueuesRef,
    pluginActiveDocumentRef,
    loadedPlugins,
    pluginCommands,
    setPluginCommands,
    pluginViews,
    setPluginViews,
    pluginScreens,
    setPluginScreens,
    pluginModals,
    setPluginModals,
    pluginStatusItems,
    setPluginStatusItems,
    activePluginScreenKey,
    setActivePluginScreenKey,
    activePluginModalKey,
    setActivePluginModalKey,
    setSidebarPluginRuntimeAnchor,
    setScreenPluginRuntimeAnchor,
    activePluginView,
    pluginSelectionCommands,
    activePluginScreen,
    activePluginModal,
    isDockedPluginRuntimeVisible,
    pluginRuntimeAnchor,
    pluginRuntimeActiveView,
    reloadInstalledPlugins,
    persistPluginAnchors,
    retargetPluginAnchors,
  };
}
