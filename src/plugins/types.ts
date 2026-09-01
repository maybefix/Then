export const THEN_PLUGIN_API_VERSION = 1 as const;

export type ThenPluginPermission =
  | "document:read"
  | "document:selection"
  | "document:navigate"
  | "document:anchors"
  | "views"
  | "statusbar"
  | "storage"
  | "commands";

export type ThenPluginManifest = {
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  main: string;
  description?: string;
  /** Optional only for compatibility with plugins installed by pre-release v0.6.1 builds. */
  icon?: ThenPluginIcon;
  permissions: ThenPluginPermission[];
};

export type ThenPluginIcon = {
  paths: string[];
};

export type LoadedThenPlugin = {
  manifest: ThenPluginManifest;
  source: string;
};

export type ThenPluginCommand = {
  pluginId: string;
  id: string;
  title: string;
  keybinding?: string;
  menus?: ThenPluginMenuLocation[];
};

export type ThenPluginMenuLocation = "editor.selection";

export type ThenPluginStatusItem = {
  pluginId: string;
  id: string;
  text: string;
  tooltip?: string;
  commandId?: string;
};

export type ThenPluginView = {
  pluginId: string;
  id: string;
  title: string;
  icon?: ThenPluginIcon;
};

export type ThenPluginScreen = {
  pluginId: string;
  id: string;
  title: string;
  icon?: ThenPluginIcon;
};

export type ThenPluginModal = {
  pluginId: string;
  id: string;
  title: string;
};

export type ThenPluginSelection = {
  documentPath: string | null;
  from: number;
  to: number;
  head: number;
  text: string;
};

export type ThenPluginAnchor = {
  id: string;
  pluginId: string;
  documentPath: string;
  from: number;
  to: number;
  selectedText: string;
  contextBefore: string;
  contextAfter: string;
  updatedAt: number;
};

export type ThenPluginAnchorStore = {
  version: 1;
  anchors: ThenPluginAnchor[];
};

export type ThenPluginHostRequest = {
  pluginId: string;
  method: string;
  args: unknown;
};

export type ThenPluginDocumentChange = {
  documentPath: string | null;
  version: number;
  changes: {
    from: number;
    to: number;
    insertedText: string;
  };
  text?: string;
};
