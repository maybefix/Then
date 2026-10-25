import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { collectProjectTextFiles } from "../editor/ast/projectAst";
import type { ProjectFolder, TextDocument } from "../types";
import { parseFrontMatter } from "../utils/frontmatter";
import { isSamePath } from "../utils/projectTree";
import type { TextEditorHandle } from "../VerticalTextEditor";
import { createThenPluginAnchor, resolveThenPluginAnchor } from "./anchors";
import { isValidThenPluginKeybinding } from "./keybindings";
import { objectArgs, pluginDocumentPath, pluginPermissionForMethod, pluginViewIcon } from "./pluginHostModel";
import type {
  LoadedThenPlugin,
  ThenPluginAnchor,
  ThenPluginCommand,
  ThenPluginHostRequest,
  ThenPluginManifest,
  ThenPluginModal,
  ThenPluginScreen,
  ThenPluginStatusItem,
  ThenPluginView,
} from "./types";

const isTauriRuntime = () => "__TAURI_INTERNALS__" in window;

type PluginHostActionDeps = {
  projectFolder: ProjectFolder | null;
  currentFilePath: string | null;
  editorText: string;
  editorInstanceRef: MutableRefObject<TextEditorHandle | null>;
  handleProjectFileSelect: (path: string) => Promise<void>;
  setAppMode: (mode: "write" | "plugin") => void;
  setIsRightSidebarCollapsed: (collapsed: boolean) => void;
  setRightSidebarTab: (tab: string) => void;
  loadedPlugins: LoadedThenPlugin[];
  pluginAnchorsRef: MutableRefObject<ThenPluginAnchor[]>;
  persistPluginAnchors: (anchors: ThenPluginAnchor[]) => void;
  pluginStorageQueuesRef: MutableRefObject<Map<string, Promise<void>>>;
  setPluginCommands: Dispatch<SetStateAction<ThenPluginCommand[]>>;
  setPluginViews: Dispatch<SetStateAction<ThenPluginView[]>>;
  setPluginScreens: Dispatch<SetStateAction<ThenPluginScreen[]>>;
  setPluginModals: Dispatch<SetStateAction<ThenPluginModal[]>>;
  setPluginStatusItems: Dispatch<SetStateAction<ThenPluginStatusItem[]>>;
  pluginModals: ThenPluginModal[];
  pluginScreens: ThenPluginScreen[];
  pluginViews: ThenPluginView[];
  activePluginModal: ThenPluginModal | null;
  activePluginModalKey: string | null;
  setActivePluginModalKey: Dispatch<SetStateAction<string | null>>;
  setActivePluginScreenKey: Dispatch<SetStateAction<string | null>>;
  reloadInstalledPlugins: () => Promise<boolean>;
  requestConfirm: (options: {
    title: string;
    message: string;
    detail?: string;
    confirmLabel: string;
    danger?: boolean;
  }) => Promise<boolean>;
  showToast: (message: string) => void;
  setLastError: Dispatch<SetStateAction<string>>;
};

// プラグインからの頼みに答える処理（handlePluginRequest）と、プラグインの導入・削除。
// App は描画のたびに、その時点の値で作り直す。
export function createPluginHostActions(deps: PluginHostActionDeps) {
  const {
    projectFolder,
    currentFilePath,
    editorText,
    editorInstanceRef,
    handleProjectFileSelect,
    setAppMode,
    setIsRightSidebarCollapsed,
    setRightSidebarTab,
    loadedPlugins,
    pluginAnchorsRef,
    persistPluginAnchors,
    pluginStorageQueuesRef,
    setPluginCommands,
    setPluginViews,
    setPluginScreens,
    setPluginModals,
    setPluginStatusItems,
    pluginModals,
    pluginScreens,
    pluginViews,
    activePluginModal,
    activePluginModalKey,
    setActivePluginModalKey,
    setActivePluginScreenKey,
    reloadInstalledPlugins,
    requestConfirm,
    showToast,
    setLastError,
  } = deps;

  const findPluginDocument = (documentPath: string) => {
    if (!projectFolder) return null;
    return collectProjectTextFiles(projectFolder).find(
      (file) => pluginDocumentPath(projectFolder.path, file.path) === documentPath,
    ) ?? null;
  };

  const readPluginDocumentText = async (documentPath: string): Promise<string> => {
    const file = findPluginDocument(documentPath);
    if (!file) throw new Error(`文書が見つかりません: ${documentPath}`);
    if (currentFilePath && isSamePath(file.path, currentFilePath)) {
      return editorInstanceRef.current?.getValue() ?? editorText;
    }
    const document = await invoke<TextDocument>("read_text_file", { path: file.path });
    return parseFrontMatter(document.content).body;
  };

  const revealPluginRange = async (documentPath: string, from: number, to = from) => {
    const file = findPluginDocument(documentPath);
    if (!file) throw new Error(`文書が見つかりません: ${documentPath}`);
    setAppMode("write");
    if (!currentFilePath || !isSamePath(file.path, currentFilePath)) {
      await handleProjectFileSelect(file.path);
    }
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        editorInstanceRef.current?.selectRange(from, to);
        editorInstanceRef.current?.focus();
      });
    });
  };

  const resolvePluginAnchor = async (pluginId: string, anchorId: string) => {
    const anchor = pluginAnchorsRef.current.find(
      (item) => item.id === anchorId && item.pluginId === pluginId,
    );
    if (!anchor) throw new Error(`アンカーが見つかりません: ${anchorId}`);
    const text = await readPluginDocumentText(anchor.documentPath);
    const resolved = resolveThenPluginAnchor(anchor, text);
    if (!resolved) return null;
    if (
      resolved.from !== anchor.from ||
      resolved.to !== anchor.to ||
      resolved.contextBefore !== anchor.contextBefore ||
      resolved.contextAfter !== anchor.contextAfter
    ) {
      persistPluginAnchors(
        pluginAnchorsRef.current.map((item) => item.id === anchor.id ? resolved : item),
      );
    }
    return resolved;
  };

  const updatePluginStorage = async (
    pluginId: string,
    updater: (data: Record<string, unknown>) => void,
  ) => {
    const rootPath = projectFolder?.path;
    if (!rootPath) throw new Error("プロジェクトを開いてください");
    const previous = pluginStorageQueuesRef.current.get(pluginId) ?? Promise.resolve();
    const pending = previous.catch(() => undefined).then(async () => {
      const data = await invoke<Record<string, unknown>>("load_plugin_project_data", {
        rootPath,
        pluginId,
      });
      updater(data);
      await invoke("save_plugin_project_data", { rootPath, pluginId, data });
    });
    pluginStorageQueuesRef.current.set(pluginId, pending);
    try {
      await pending;
    } finally {
      if (pluginStorageQueuesRef.current.get(pluginId) === pending) {
        pluginStorageQueuesRef.current.delete(pluginId);
      }
    }
  };

  const handlePluginRequest = async ({
    pluginId,
    method,
    args,
  }: ThenPluginHostRequest): Promise<unknown> => {
    const plugin = loadedPlugins.find((item) => item.manifest.id === pluginId);
    if (!plugin) throw new Error("プラグインが読み込まれていません");
    const requiredPermission = pluginPermissionForMethod(method);
    if (!requiredPermission || !plugin.manifest.permissions.includes(requiredPermission)) {
      throw new Error(`権限がありません: ${requiredPermission ?? method}`);
    }
    const input = objectArgs(args);

    if (method === "editor.getSelection") {
      const editor = editorInstanceRef.current;
      if (!editor) return null;
      const selection = editor.getSelection();
      return {
        documentPath:
          projectFolder && currentFilePath
            ? pluginDocumentPath(projectFolder.path, currentFilePath)
            : null,
        ...selection,
        text: editor.getValue().slice(selection.from, selection.to),
      };
    }

    if (method === "editor.moveCursor") {
      if (typeof input.anchorId === "string") {
        const resolved = await resolvePluginAnchor(pluginId, input.anchorId);
        if (!resolved) throw new Error("アンカーを現在の文書へ再接続できませんでした");
        await revealPluginRange(resolved.documentPath, resolved.from, resolved.to);
        return true;
      }
      const documentPath =
        typeof input.documentPath === "string"
          ? input.documentPath
          : projectFolder && currentFilePath
            ? pluginDocumentPath(projectFolder.path, currentFilePath)
            : null;
      if (!documentPath) throw new Error("移動先の文書が指定されていません");
      const from = typeof input.from === "number"
        ? input.from
        : typeof input.offset === "number"
          ? input.offset
          : 0;
      const to = typeof input.to === "number" ? input.to : from;
      await revealPluginRange(documentPath, from, to);
      return true;
    }

    if (method === "anchors.create") {
      if (!projectFolder || !currentFilePath) throw new Error("プロジェクト内の文書を開いてください");
      const documentPath = pluginDocumentPath(projectFolder.path, currentFilePath);
      if (!documentPath) throw new Error("プロジェクト外の文書にはアンカーを作成できません");
      const editor = editorInstanceRef.current;
      if (!editor) throw new Error("エディタが準備できていません");
      const selection = editor.getSelection();
      const from = typeof input.from === "number" ? input.from : selection.from;
      const to = typeof input.to === "number" ? input.to : selection.to;
      const anchor = createThenPluginAnchor({
        id: crypto.randomUUID(),
        pluginId,
        documentPath,
        from,
        to,
        text: editor.getValue(),
      });
      persistPluginAnchors([...pluginAnchorsRef.current, anchor]);
      return anchor;
    }

    if (method === "anchors.resolve" || method === "anchors.reveal") {
      if (typeof input.anchorId !== "string") throw new Error("anchorId が必要です");
      const resolved = await resolvePluginAnchor(pluginId, input.anchorId);
      if (method === "anchors.reveal" && resolved) {
        await revealPluginRange(resolved.documentPath, resolved.from, resolved.to);
      }
      return resolved;
    }

    if (method === "anchors.delete") {
      if (typeof input.anchorId !== "string") throw new Error("anchorId が必要です");
      const next = pluginAnchorsRef.current.filter(
        (item) => !(item.id === input.anchorId && item.pluginId === pluginId),
      );
      persistPluginAnchors(next);
      return next.length !== pluginAnchorsRef.current.length;
    }

    if (method === "storage.get") {
      const rootPath = projectFolder?.path;
      if (!rootPath) throw new Error("プロジェクトを開いてください");
      const key = typeof input.key === "string" ? input.key : "";
      if (!key) throw new Error("storage key が必要です");
      await (pluginStorageQueuesRef.current.get(pluginId) ?? Promise.resolve()).catch(() => undefined);
      const data = await invoke<Record<string, unknown>>("load_plugin_project_data", { rootPath, pluginId });
      return data[key] ?? null;
    }

    if (method === "storage.set" || method === "storage.delete") {
      const key = typeof input.key === "string" ? input.key : "";
      if (!key || key.length > 200) throw new Error("storage key が不正です");
      await updatePluginStorage(pluginId, (data) => {
        if (method === "storage.delete") delete data[key];
        else data[key] = input.value;
      });
      return true;
    }

    if (method === "commands.register") {
      const id = typeof input.id === "string" ? input.id.trim() : "";
      const title = typeof input.title === "string" ? input.title.trim() : "";
      const keybinding = typeof input.keybinding === "string" ? input.keybinding.trim() : undefined;
      const menus = Array.isArray(input.menus)
        ? input.menus.filter((menu): menu is "editor.selection" => menu === "editor.selection")
        : [];
      if (Array.isArray(input.menus) && menus.length !== input.menus.length) {
        throw new Error("未対応のコマンドメニューが指定されました");
      }
      if (!id || !title) throw new Error("command id と title が必要です");
      if (keybinding && !isValidThenPluginKeybinding(keybinding)) {
        throw new Error("ショートカットは Mod/Ctrl/Cmd を含む形式で指定してください");
      }
      setPluginCommands((current) => [
        ...current.filter((item) => !(item.pluginId === pluginId && item.id === id)),
        { pluginId, id, title, keybinding, menus },
      ]);
      return true;
    }

    if (method === "commands.unregister") {
      const id = typeof input.id === "string" ? input.id : "";
      setPluginCommands((current) => current.filter(
        (item) => !(item.pluginId === pluginId && item.id === id),
      ));
      return true;
    }

    if (method === "views.register") {
      const id = typeof input.id === "string" ? input.id.trim() : "";
      const title = typeof input.title === "string" ? input.title.trim() : "";
      const icon = pluginViewIcon(input.icon);
      if (!id || !title) throw new Error("view id と title が必要です");
      setPluginViews((current) => [
        ...current.filter((item) => !(item.pluginId === pluginId && item.id === id)),
        { pluginId, id, title, icon },
      ]);
      return true;
    }

    if (method === "views.unregister") {
      const id = typeof input.id === "string" ? input.id : "";
      setPluginViews((current) => current.filter(
        (item) => !(item.pluginId === pluginId && item.id === id),
      ));
      return true;
    }

    if (method === "views.registerScreen") {
      const id = typeof input.id === "string" ? input.id.trim() : "";
      const title = typeof input.title === "string" ? input.title.trim() : "";
      const icon = pluginViewIcon(input.icon);
      if (!id || !title) throw new Error("screen id と title が必要です");
      if (!plugin.manifest.icon?.paths.length) {
        throw new Error("画面を登録するプラグインにはmanifest.jsonのiconが必要です");
      }
      setPluginScreens((current) => [
        ...current.filter((item) => !(item.pluginId === pluginId && item.id === id)),
        { pluginId, id, title, icon },
      ]);
      return true;
    }

    if (method === "views.unregisterScreen") {
      const id = typeof input.id === "string" ? input.id : "";
      setPluginScreens((current) => current.filter(
        (item) => !(item.pluginId === pluginId && item.id === id),
      ));
      return true;
    }

    if (method === "views.registerModal") {
      const id = typeof input.id === "string" ? input.id.trim() : "";
      const title = typeof input.title === "string" ? input.title.trim() : "";
      if (!id || !title) throw new Error("modal id と title が必要です");
      setPluginModals((current) => [
        ...current.filter((item) => !(item.pluginId === pluginId && item.id === id)),
        { pluginId, id, title },
      ]);
      return true;
    }

    if (method === "views.unregisterModal") {
      const id = typeof input.id === "string" ? input.id : "";
      setPluginModals((current) => current.filter(
        (item) => !(item.pluginId === pluginId && item.id === id),
      ));
      if (activePluginModalKey === `${pluginId}:${id}`) setActivePluginModalKey(null);
      return true;
    }

    if (method === "views.openModal") {
      const id = typeof input.id === "string" ? input.id : "";
      const modal = pluginModals.find(
        (item) => item.pluginId === pluginId && item.id === id,
      );
      if (!modal) throw new Error(`登録されていないmodalです: ${id}`);
      setActivePluginModalKey(`${pluginId}:${id}`);
      return true;
    }

    if (method === "views.closeModal") {
      const id = typeof input.id === "string" ? input.id : "";
      if (!activePluginModal || activePluginModal.pluginId !== pluginId) return false;
      if (id && activePluginModal.id !== id) return false;
      setActivePluginModalKey(null);
      return true;
    }

    if (method === "views.open") {
      const id = typeof input.id === "string" ? input.id : "";
      const screen = pluginScreens.find(
        (item) => item.pluginId === pluginId && item.id === id,
      );
      if (screen) {
        setActivePluginScreenKey(`${pluginId}:${id}`);
        setAppMode("plugin");
        return true;
      }
      const view = pluginViews.find(
        (item) => item.pluginId === pluginId && item.id === id,
      );
      if (view) {
        setAppMode("write");
        setIsRightSidebarCollapsed(false);
        setRightSidebarTab(`plugin:${pluginId}:${id}`);
        return true;
      }
      throw new Error(`登録されていないviewです: ${id}`);
    }

    if (method === "statusbar.set") {
      const id = typeof input.id === "string" ? input.id.trim() : "";
      const text = typeof input.text === "string" ? input.text.trim() : "";
      const tooltip = typeof input.tooltip === "string" ? input.tooltip.trim() : undefined;
      const commandId = typeof input.commandId === "string" ? input.commandId.trim() : undefined;
      if (!id || !text || text.length > 160) {
        throw new Error("status itemのidと160文字以内のtextが必要です");
      }
      setPluginStatusItems((current) => [
        ...current.filter((item) => !(item.pluginId === pluginId && item.id === id)),
        { pluginId, id, text, tooltip, commandId },
      ]);
      return true;
    }

    if (method === "statusbar.remove") {
      const id = typeof input.id === "string" ? input.id : "";
      setPluginStatusItems((current) => current.filter(
        (item) => !(item.pluginId === pluginId && item.id === id),
      ));
      return true;
    }

    throw new Error(`未対応のThen APIです: ${method}`);
  };

  const handleInstallPlugin = async () => {
    if (!isTauriRuntime()) {
      showToast("デスクトップ版で利用してください");
      return;
    }
    try {
      const candidate = await invoke<{
        sourcePath: string;
        manifest: ThenPluginManifest;
      } | null>("inspect_plugin_dialog");
      if (!candidate) return;
      const approved = await requestConfirm({
        title: "プラグインを導入",
        message: `「${candidate.manifest.name}」v${candidate.manifest.version} をThen全体へ導入しますか？`,
        detail: candidate.manifest.permissions.length
          ? `要求する権限: ${candidate.manifest.permissions.join(" / ")}`
          : "このプラグインはThen API権限を要求しません。",
        confirmLabel: "導入",
      });
      if (!approved) return;
      const installed = await invoke<LoadedThenPlugin>("install_plugin", {
        sourcePath: candidate.sourcePath,
        expectedManifest: candidate.manifest,
      });
      await reloadInstalledPlugins();
      showToast(`プラグイン「${installed.manifest.name}」を導入しました`);
    } catch (error) {
      setLastError(String(error));
      showToast("プラグインを導入できませんでした");
    }
  };

  const handleUninstallPlugin = async (plugin: LoadedThenPlugin) => {
    const confirmed = await requestConfirm({
      title: "プラグインを削除",
      message: `「${plugin.manifest.name}」v${plugin.manifest.version} をThenから削除しますか？`,
      detail:
        "プラグイン本体だけを削除します。各プロジェクトに保存されたデータと永続アンカーは、再導入時に復元できるよう残します。",
      confirmLabel: "削除",
      danger: true,
    });
    if (!confirmed) return;
    try {
      await invoke("uninstall_plugin", { pluginId: plugin.manifest.id });
      await reloadInstalledPlugins();
      showToast(`プラグイン「${plugin.manifest.name}」を削除しました`);
    } catch (error) {
      setLastError(String(error));
      showToast("プラグインを削除できませんでした");
    }
  };

  return { handlePluginRequest, handleInstallPlugin, handleUninstallPlugin };
}
