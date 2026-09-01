export type ThenPluginPermission =
  | "document:read"
  | "document:selection"
  | "document:navigate"
  | "document:anchors"
  | "views"
  | "statusbar"
  | "storage"
  | "commands";

export interface ThenPluginIcon {
  /** SVG path data drawn in a fixed 0 0 24 24 viewBox. */
  paths: string[];
}

export interface ThenPluginManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  main: string;
  description?: string;
  icon: ThenPluginIcon;
  permissions: ThenPluginPermission[];
}

export interface ThenSelection {
  documentPath: string | null;
  from: number;
  to: number;
  head: number;
  line: number;
  text: string;
}

export interface ThenAnchor {
  id: string;
  pluginId: string;
  documentPath: string;
  from: number;
  to: number;
  selectedText: string;
  contextBefore: string;
  contextAfter: string;
  updatedAt: number;
}

export interface Disposable {
  dispose(): void;
}

export interface ThenPluginTheme {
  id: string;
  mode: "light" | "dark";
  tokens: Readonly<Record<string, string>>;
}

export interface ThenPluginApi {
  readonly apiVersion: 1;
  readonly manifest: Readonly<ThenPluginManifest>;
  readonly ui: {
    getTheme(): ThenPluginTheme | null;
    onDidChangeTheme(listener: (theme: ThenPluginTheme) => void): Disposable;
  };
  readonly editor: {
    getSelection(): Promise<ThenSelection | null>;
    moveCursor(target: {
      documentPath?: string;
      offset?: number;
      from?: number;
      to?: number;
      anchorId?: string;
    }): Promise<boolean>;
  };
  readonly anchors: {
    create(range?: { from: number; to: number }): Promise<ThenAnchor>;
    resolve(anchorId: string): Promise<ThenAnchor | null>;
    reveal(anchorId: string): Promise<ThenAnchor | null>;
    delete(anchorId: string): Promise<boolean>;
  };
  readonly workspace: {
    onDidChangeTextDocument(listener: (event: {
      documentPath: string | null;
      version: number;
      changes: { from: number; to: number; insertedText: string };
      text: string;
    }) => void): Disposable;
    onDidChangeSelection(listener: (selection: ThenSelection) => void): Disposable;
  };
  readonly storage: {
    get<T = unknown>(key: string): Promise<T | null>;
    set(key: string, value: unknown): Promise<boolean>;
    delete(key: string): Promise<boolean>;
  };
  readonly commands: {
    registerCommand(
      definition: {
        id: string;
        title: string;
        keybinding?: string;
        menus?: Array<"editor.selection">;
      },
      handler: () => void | Promise<void>,
    ): Promise<Disposable>;
  };
  readonly views: {
    registerToolView(
      definition: { id: string; title: string; icon?: ThenPluginIcon },
      render: (container: HTMLElement) => void | Promise<void>,
    ): Promise<Disposable>;
    registerScreen(
      definition: { id: string; title: string; icon?: ThenPluginIcon },
      render: (container: HTMLElement) => void | Promise<void>,
    ): Promise<Disposable>;
    registerModal(
      definition: { id: string; title: string },
      render: (container: HTMLElement) => void | Promise<void>,
    ): Promise<Disposable>;
    open(viewId: string): Promise<boolean>;
    openModal(modalId: string): Promise<boolean>;
    closeModal(modalId?: string): Promise<boolean>;
  };
  readonly statusBar: {
    setItem(definition: {
      id: string;
      text: string;
      tooltip?: string;
      commandId?: string;
    }): Promise<boolean>;
    removeItem(id: string): Promise<boolean>;
  };
}

declare global {
  const then: ThenPluginApi;
}
