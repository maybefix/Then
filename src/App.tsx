import { invoke } from "@tauri-apps/api/core";
import {
  ChangeEvent,
  DragEvent,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { VerticalTextEditor, type TextEditorHandle } from "./VerticalTextEditor";
import { AppDialogModal } from "./components/dialogs/AppDialogModal";
import { SettingsModal } from "./components/dialogs/SettingsModal";
import { MetadataPanel } from "./components/editor/MetadataPanel";
import { WorkspaceSidebar } from "./components/layout/WorkspaceSidebar";
import { PlotPane } from "./components/plot/PlotPane";
import { IdeaPane } from "./components/snippets/IdeaPane";
import { StatusBar } from "./components/status/StatusBar";
import type {
  AppDialog,
  AppState,
  BreadcrumbDropTarget,
  DocumentTab,
  EditorSettings,
  FlatOutlineItem,
  FontOption,
  OutlineItem,
  PlotCard,
  ProjectEntry,
  ProjectFolder,
  SaveStatus,
  Snippet,
  TextDocument,
  WorkspaceAlert,
  WorkspaceRecord,
} from "./types";
import {
  appendFrontMatterProperty,
  composeMarkdown,
  parseFrontMatter,
  updateMarkdownBody,
} from "./utils/frontmatter";
import {
  findContainingFolderPath,
  findFirstTextFile,
  findPathToEntry,
  findProjectEntry,
  getFolderChildren,
  getParentPath,
  getWorkspaceName,
  movePathInOrder,
  movePathToDropPosition,
  replaceFolderChildren,
  upsertRecentWorkspace,
} from "./utils/projectTree";

const SNIPPET_DRAG_MIME = "application/x-brew-snippet-id";
const BREADCRUMB_ENTRY_DRAG_MIME = "application/x-brew-project-entry-path";
const STORAGE_KEY = "then.app-state.v1";
const LEGACY_STORAGE_KEY = "brew.app-state.v1";
const scratchFileName = "無題.txt";
const newTabName = "新しいタブ";
const scratchWorkspaceName = "一時ファイル";
const isTauriRuntime = () => "__TAURI_INTERNALS__" in window;

function debugLog(message: string, data?: unknown): void {
  const timestamp = new Date().toISOString();
  if (data === undefined) {
    console.log(`[folder-debug] ${timestamp} ${message}`);
    return;
  }

  console.log(`[folder-debug] ${timestamp} ${message}`, data);
}

const documentData = {
  title: "剣士の目覚め",
};

const initialMarkdown = `# ${documentData.title}

夜明け前の静寂の中、エリアスは汗ばんだ額を拭いながら起き上がった。また同じ夢だった。蒼穹の封印の扉、その向こうから響く無数の叫び声。

十七年間、一度も会ったことのない父の声も、その中に混じっているような気がした。

窓の外では、ハルト村の朝が静かに始まろうとしていた。鶏の鳴き声、パン屋の煙突から立ち上る煙。いつもと変わらぬ光景のはずなのに、今日は何かが違った。

壁に掛けてあった祖父の形見の剣が、微かに光を放っていた。

> 「また始まったか」
`;

const htmlIdeaSnippets: Snippet[] = [
  {
    id: "idea-sample-1",
    title: "主人公が改札の前で一瞬立ち止まる描写",
    text: "主人公が改札の前で一瞬立ち止まる描写を入れる。",
    category: "",
    tags: [],
  },
  {
    id: "idea-sample-2",
    title: "風呂のシーン",
    text: "風呂のシーンはテンポよく、1分で終わらせる緊張感を持たせたい。",
    category: "",
    tags: [],
  },
];

const defaultPlotCards: PlotCard[] = [
  {
    id: "plot-1",
    num: "001",
    title: "縦書きプロットテストです",
    body: "",
    expanded: false,
  },
  {
    id: "plot-2",
    num: "002",
    title: "縦書きプロットテストです",
    body: "",
    expanded: false,
  },
  {
    id: "plot-3",
    num: "003",
    title: "縦書きプロットテストです",
    body: "これは縦書きプロットテストです。ちゃんと書けていることを確かめるためにあります。",
    expanded: false,
  },
];

const defaultSnippets: Snippet[] = [
  ...htmlIdeaSnippets,
  {
    id: "s1",
    title: "旅立ちの夜明け",
    text: "夜明けの光が、山の稜線を白く縁どり始めた頃",
    category: "情景",
    tags: ["朝", "旅立ち"],
  },
  {
    id: "s2",
    title: "内面の葛藤",
    text: "主人公は決断する。しかしその足は、一歩踏み出すことを躊躇っていた。",
    category: "心理",
    tags: ["葛藤"],
  },
  {
    id: "s3",
    title: "謎めいた台詞",
    text: "「お前には、まだ知らないことがある」老人は静かに言った。",
    category: "台詞",
    tags: ["伏線"],
  },
  {
    id: "s4",
    title: "霧の中の影",
    text: "霧の中から現れた影は、かつて見た夢の中の人物と瓜二つだった。",
    category: "情景",
    tags: ["霧", "夢"],
  },
];

const defaultSettings: EditorSettings = {
  editorFontFamily: toCssFontFamilyValue("Noto Serif JP"),
  uiFontFamily: toCssFontFamilyValue("Segoe UI"),
  fontSize: 15,
  lineHeight: 1.82,
  typewriterScroll: true,
  typewriterOffset: 46,
  snippetStorageMode: "workspace",
};

const fallbackFontFamilies = [
  "Noto Serif JP",
  "Yu Mincho",
  "Yu Gothic",
  "BIZ UDMincho",
  "BIZ UDPMincho",
  "BIZ UDGothic",
  "BIZ UDPGothic",
  "Consolas",
  "Segoe UI",
];

const fallbackFontOptions = createFontOptions(fallbackFontFamilies);

function createScratchDocumentTab(
  markdown = "",
  options: Partial<
    Pick<DocumentTab, "id" | "documentKey" | "name" | "saveStatus" | "savedMarkdown">
  > = {},
): DocumentTab {
  const id = options.id ?? `scratch-${Date.now()}`;
  return {
    id,
    kind: "scratch",
    path: null,
    name: options.name ?? scratchFileName,
    markdown,
    savedMarkdown: options.savedMarkdown ?? "",
    saveStatus: options.saveStatus ?? "dirty",
    documentKey: options.documentKey ?? id,
    activeOutlineLine: null,
  };
}

function createFileDocumentTab(document: TextDocument): DocumentTab {
  return {
    id: `file:${document.path}`,
    kind: "file",
    path: document.path,
    name: document.name,
    markdown: document.content,
    savedMarkdown: document.content,
    saveStatus: "saved",
    documentKey: document.path,
    activeOutlineLine: null,
  };
}

function isDirtyDocumentTab(tab: DocumentTab): boolean {
  return (
    tab.saveStatus === "dirty" ||
    tab.saveStatus === "error" ||
    tab.markdown !== tab.savedMarkdown
  );
}

function createDefaultState(): AppState {
  return {
    markdown: initialMarkdown,
    snippets: defaultSnippets,
    profileSnippets: defaultSnippets,
    settings: defaultSettings,
    lastWorkspacePath: null,
    lastFilePath: null,
    recentWorkspaces: [],
  };
}

function getTextLength(text: string): number {
  return Array.from(text).length;
}

function parseInlineIdeaTags(text: string): string[] {
  const tags = new Set<string>();
  const matches = text.matchAll(/(?:^|\s)#([^\s#.,;:!?()[\]{}「」『』、。]+)/g);

  for (const match of matches) {
    const tag = match[1]?.trim();
    if (tag) tags.add(tag);
  }

  return Array.from(tags);
}

function createIdeaTitle(text: string): string {
  const cleaned = text
    .replace(/(?:^|\s)#([^\s#.,;:!?()[\]{}「」『』、。]+)/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return "Idea";
  return Array.from(cleaned).slice(0, 28).join("");
}

function ensureHtmlIdeaSamples(snippets: Snippet[]): Snippet[] {
  const hasHtmlIdeaSample = htmlIdeaSnippets.some((sample) =>
    snippets.some((snippet) => snippet.id === sample.id || snippet.text === sample.text),
  );
  if (hasHtmlIdeaSample) return snippets;

  const hasOnlyLegacyDefaults =
    snippets.length === 4 && snippets.every((snippet) => /^s[1-4]$/.test(snippet.id));

  return hasOnlyLegacyDefaults ? [...htmlIdeaSnippets, ...snippets] : snippets;
}

function normalizePlotCards(value: unknown): PlotCard[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((card): card is Partial<PlotCard> & { id: string } =>
      Boolean(card) && typeof card === "object" && typeof card.id === "string",
    )
    .map((card, index) => ({
      id: card.id,
      num:
        typeof card.num === "string" && card.num.trim()
          ? card.num
          : String(index + 1).padStart(3, "0"),
      title: typeof card.title === "string" ? card.title : "",
      body: typeof card.body === "string" ? card.body : "",
      expanded: Boolean(card.expanded),
    }));
}

function parseTextOutline(text: string): OutlineItem[] {
  const roots: OutlineItem[] = [];
  const stack: OutlineItem[] = [];
  const lines = text.split(/\r?\n/);

  lines.forEach((line, index) => {
    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match) return;

    const level = match[1].length;
    const title = match[2].trim();
    if (!title) return;

    const item: OutlineItem = {
      id: `${index}-${level}-${title}`,
      title,
      level,
      line: index + 1,
      children: [],
    };

    while (stack.length && stack[stack.length - 1].level >= level) {
      stack.pop();
    }

    const parent = stack[stack.length - 1];
    if (parent) {
      parent.children.push(item);
    } else {
      roots.push(item);
    }
    stack.push(item);
  });

  return roots;
}

function flattenOutline(items: OutlineItem[], parents: OutlineItem[] = []): FlatOutlineItem[] {
  return items.flatMap((item) => [
    { ...item, parents },
    ...flattenOutline(item.children, [...parents, item]),
  ]);
}

function findActiveOutlineChain(items: OutlineItem[], lineNumber: number): OutlineItem[] {
  let activeChain: OutlineItem[] = [];

  const visit = (outlineItems: OutlineItem[], parents: OutlineItem[]) => {
    for (const item of outlineItems) {
      if (item.line > lineNumber) break;
      const chain = [...parents, item];
      activeChain = chain;
      visit(item.children, chain);
    }
  };

  visit(items, []);
  return activeChain;
}

function getLineNumberAtOffset(text: string, offset: number): number {
  const clamped = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  for (let index = 0; index < clamped; index += 1) {
    if (text[index] === "\n") line += 1;
  }
  return line;
}

function quoteCssFontFamily(family: string): string {
  const escaped = family.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function toCssFontFamilyValue(family: string): string {
  return quoteCssFontFamily(family.trim());
}

function normalizeStoredFontFamily(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;

  const fontFamily = value.trim();
  if (!fontFamily) return fallback;
  if (fontFamily.startsWith('"') || fontFamily.startsWith("'") || fontFamily.includes(",")) {
    return fontFamily;
  }

  return toCssFontFamilyValue(fontFamily);
}

function createFontOptions(fontFamilies: string[]): FontOption[] {
  const uniqueFamilies = new Map<string, FontOption>();

  for (const fontFamily of fontFamilies) {
    const label = fontFamily.trim();
    if (!label || uniqueFamilies.has(label)) continue;
    uniqueFamilies.set(label, {
      label,
      cssFamily: toCssFontFamilyValue(label),
    });
  }

  return Array.from(uniqueFamilies.values()).sort((left, right) =>
    left.label.localeCompare(right.label),
  );
}

function normalizeState(value: Partial<AppState> | null | undefined): AppState {
  const settings = (value?.settings ?? {}) as Partial<EditorSettings>;
  const recentWorkspaces = Array.isArray(value?.recentWorkspaces)
    ? value.recentWorkspaces.filter(
        (record): record is WorkspaceRecord =>
          Boolean(record) &&
          typeof record.path === "string" &&
          typeof record.name === "string" &&
          typeof record.lastOpenedAt === "number",
      )
    : [];

  const profileSnippets = ensureHtmlIdeaSamples(Array.isArray(value?.profileSnippets)
    ? value.profileSnippets
    : Array.isArray(value?.snippets)
      ? value.snippets
      : defaultSnippets);

  return {
    markdown: typeof value?.markdown === "string" ? value.markdown : initialMarkdown,
    snippets: ensureHtmlIdeaSamples(
      Array.isArray(value?.snippets) ? value.snippets : profileSnippets,
    ),
    profileSnippets,
    settings: {
      ...defaultSettings,
      ...settings,
      editorFontFamily: normalizeStoredFontFamily(
        settings.editorFontFamily,
        defaultSettings.editorFontFamily,
      ),
      uiFontFamily: normalizeStoredFontFamily(
        settings.uiFontFamily,
        defaultSettings.uiFontFamily,
      ),
      snippetStorageMode:
        settings.snippetStorageMode === "profile" ? "profile" : "workspace",
    },
    lastWorkspacePath:
      typeof value?.lastWorkspacePath === "string" ? value.lastWorkspacePath : null,
    lastFilePath: typeof value?.lastFilePath === "string" ? value.lastFilePath : null,
    recentWorkspaces,
  };
}

async function loadStoredState(): Promise<AppState> {
  if (isTauriRuntime()) {
    const state = await invoke<AppState | null>("load_app_state");
    return normalizeState(state);
  }

  const raw =
    window.localStorage.getItem(STORAGE_KEY) ??
    window.localStorage.getItem(LEGACY_STORAGE_KEY);
  return normalizeState(raw ? JSON.parse(raw) : null);
}

async function saveStoredState(state: AppState): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("save_app_state", { state });
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

async function loadSystemFonts(): Promise<FontOption[]> {
  if (isTauriRuntime()) {
    const fonts = await invoke<string[]>("get_system_fonts");
    const options = createFontOptions(fonts);
    return options.length > 0 ? options : fallbackFontOptions;
  }

  return fallbackFontOptions;
}

async function loadWorkspaceSnippets(folderPath: string): Promise<Snippet[]> {
  if (!isTauriRuntime()) return defaultSnippets;
  const snippets = await invoke<Snippet[]>("load_project_snippets", { rootPath: folderPath });
  return snippets.length ? snippets : defaultSnippets;
}

async function saveWorkspaceSnippets(folderPath: string, snippets: Snippet[]): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("save_project_snippets", { rootPath: folderPath, snippets });
}

async function loadWorkspacePlotCards(folderPath: string): Promise<PlotCard[]> {
  if (!isTauriRuntime()) return defaultPlotCards;
  const plotCards = await invoke<PlotCard[]>("load_project_plot_cards", { rootPath: folderPath });
  return normalizePlotCards(plotCards);
}

async function saveWorkspacePlotCards(folderPath: string, plotCards: PlotCard[]): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("save_project_plot_cards", { rootPath: folderPath, plotCards });
}

export default function App() {
  const saveTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const typewriterScrollFrameRef = useRef<number | null>(null);
  const draggingSnippetRef = useRef<Snippet | null>(null);
  const editorInstanceRef = useRef<TextEditorHandle | null>(null);
  const editorShellRef = useRef<HTMLDivElement | null>(null);
  const fileMenuRef = useRef<HTMLDivElement | null>(null);
  const breadcrumbMenuRef = useRef<HTMLDivElement | null>(null);
  const didMountEditorRef = useRef(false);
  const suppressNextEditorUpdateRef = useRef(false);
  const lastSavedMarkdownRef = useRef(initialMarkdown);
  const breadcrumbDragEntryRef = useRef<{ folderPath: string; entryPath: string } | null>(null);

  const [appState, setAppState] = useState<AppState>(() => createDefaultState());
  const [isHydrated, setIsHydrated] = useState(false);
  const [lastError, setLastError] = useState("");
  const [openTabs, setOpenTabs] = useState<DocumentTab[]>(() => [
    createScratchDocumentTab(initialMarkdown, {
      id: "initial-document-tab",
      documentKey: "initial-document",
      savedMarkdown: initialMarkdown,
      saveStatus: "loading",
    }),
  ]);
  const [activeTabId, setActiveTabId] = useState("initial-document-tab");
  const [projectFolder, setProjectFolder] = useState<ProjectFolder | null>(null);
  const [snippetWorkspacePath, setSnippetWorkspacePath] = useState<string | null>(null);
  const [plotWorkspacePath, setPlotWorkspacePath] = useState<string | null>(null);
  const [plotCards, setPlotCards] = useState<PlotCard[]>(() => defaultPlotCards);
  const [focusedFolderPath, setFocusedFolderPath] = useState<string | null>(null);
  const [workspaceAlert, setWorkspaceAlert] = useState<WorkspaceAlert>(null);
  const [query, setQuery] = useState("");
  const [outlineQuery, setOutlineQuery] = useState("");
  const [toast, setToast] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [draggingBreadcrumbEntryPath, setDraggingBreadcrumbEntryPath] =
    useState<string | null>(null);
  const [breadcrumbDropTarget, setBreadcrumbDropTarget] =
    useState<BreadcrumbDropTarget>(null);
  const [charCount, setCharCount] = useState(0);
  const [editorSelectionHead, setEditorSelectionHead] = useState(0);
  const [dropIndicatorTop, setDropIndicatorTop] = useState<number | null>(null);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isFileMenuOpen, setIsFileMenuOpen] = useState(false);
  const [activeBreadcrumbPath, setActiveBreadcrumbPath] = useState<string | null>(null);
  const [isOutlineMenuOpen, setIsOutlineMenuOpen] = useState(false);
  const [appDialog, setAppDialog] = useState<AppDialog | null>(null);
  const [systemFonts, setSystemFonts] = useState<FontOption[]>(fallbackFontOptions);
  const [isMetadataOpen, setIsMetadataOpen] = useState(false);
  const [isLeftSidebarCollapsed, setIsLeftSidebarCollapsed] = useState(false);
  const [isRightSidebarCollapsed, setIsRightSidebarCollapsed] = useState(false);
  const [isRightSidebarWide, setIsRightSidebarWide] = useState(false);
  const [rightSidebarTab, setRightSidebarTab] = useState<"idea" | "plot">("plot");

  const activeTab = useMemo(
    () => openTabs.find((tab) => tab.id === activeTabId) ?? openTabs[0] ?? null,
    [activeTabId, openTabs],
  );
  const patchActiveTab = useCallback(
    (updater: (tab: DocumentTab) => DocumentTab) => {
      setOpenTabs((current) =>
        current.map((tab) => (tab.id === activeTabId ? updater(tab) : tab)),
      );
    },
    [activeTabId],
  );
  const replaceActiveTab = useCallback(
    (nextTab: DocumentTab) => {
      setOpenTabs((current) => {
        if (current.some((tab) => tab.id === activeTabId)) {
          return current.map((tab) => (tab.id === activeTabId ? nextTab : tab));
        }
        return [...current, nextTab];
      });
      setActiveTabId(nextTab.id);
      lastSavedMarkdownRef.current = nextTab.savedMarkdown;
      setAppState((current) => ({
        ...current,
        markdown: nextTab.markdown,
        lastFilePath: nextTab.path ?? current.lastFilePath,
      }));
    },
    [activeTabId],
  );
  const syncDocumentTabToEditor = useCallback((tab: DocumentTab) => {
    suppressNextEditorUpdateRef.current = true;
    didMountEditorRef.current = false;
    lastSavedMarkdownRef.current = tab.savedMarkdown;
    setActiveTabId(tab.id);
    setAppState((current) => ({
      ...current,
      markdown: tab.markdown,
      lastFilePath: tab.path ?? current.lastFilePath,
    }));
    setFocusedFolderPath(null);
    setLastError("");
  }, []);
  const activateDocumentTab = useCallback(
    (tabId: string): boolean => {
      const tab = openTabs.find((item) => item.id === tabId);
      if (!tab) return false;
      syncDocumentTabToEditor(tab);
      return true;
    },
    [openTabs, syncDocumentTabToEditor],
  );
  const openDocumentInTab = useCallback(
    (document: TextDocument) => {
      const existingTab = openTabs.find((tab) => tab.path === document.path);
      if (existingTab) {
        syncDocumentTabToEditor(existingTab);
        return existingTab;
      }

      const nextTab = createFileDocumentTab(document);
      setOpenTabs((current) => [...current, nextTab]);
      syncDocumentTabToEditor(nextTab);
      return nextTab;
    },
    [openTabs, syncDocumentTabToEditor],
  );
  const replaceActiveTabWithDocument = useCallback(
    (document: TextDocument) => {
      const nextTab = createFileDocumentTab(document);
      setOpenTabs((current) => [
        ...current.filter((tab) => tab.id !== activeTabId && tab.path !== document.path),
        nextTab,
      ]);
      syncDocumentTabToEditor(nextTab);
      return nextTab;
    },
    [activeTabId, syncDocumentTabToEditor],
  );
  const addScratchTab = useCallback(
    (documentKey = `new-${Date.now()}`, name = scratchFileName) => {
      const nextTab = createScratchDocumentTab("", {
        documentKey,
        name,
        saveStatus: name === newTabName ? "saved" : "dirty",
      });
      setOpenTabs((current) => [...current, nextTab]);
      syncDocumentTabToEditor(nextTab);
      return nextTab;
    },
    [syncDocumentTabToEditor],
  );
  const setSaveStatus = useCallback(
    (nextStatus: SaveStatus) => {
      patchActiveTab((tab) => ({ ...tab, saveStatus: nextStatus }));
    },
    [patchActiveTab],
  );
  const setCurrentFilePath = useCallback(
    (path: string | null) => {
      patchActiveTab((tab) => ({
        ...tab,
        kind: path ? "file" : "scratch",
        path,
      }));
    },
    [patchActiveTab],
  );
  const setCurrentFileName = useCallback(
    (name: string) => {
      patchActiveTab((tab) => ({ ...tab, name }));
    },
    [patchActiveTab],
  );
  const setDocumentKey = useCallback(
    (documentKey: string) => {
      patchActiveTab((tab) => ({ ...tab, documentKey }));
    },
    [patchActiveTab],
  );
  const setActiveMarkdown = useCallback(
    (nextMarkdown: string) => {
      patchActiveTab((tab) => ({ ...tab, markdown: nextMarkdown }));
      setAppState((current) =>
        current.markdown === nextMarkdown ? current : { ...current, markdown: nextMarkdown },
      );
    },
    [patchActiveTab],
  );
  const markActiveTabSaved = useCallback(
    (savedMarkdown: string, name?: string) => {
      lastSavedMarkdownRef.current = savedMarkdown;
      patchActiveTab((tab) => ({
        ...tab,
        markdown: savedMarkdown,
        savedMarkdown,
        name: name ?? tab.name,
        saveStatus: "saved",
      }));
      setAppState((current) =>
        current.markdown === savedMarkdown ? current : { ...current, markdown: savedMarkdown },
      );
    },
    [patchActiveTab],
  );

  const { snippets, settings } = appState;
  const markdown = activeTab?.markdown ?? appState.markdown;
  const saveStatus = activeTab?.saveStatus ?? "loading";
  const currentFilePath = activeTab?.path ?? null;
  const currentFileName = activeTab?.name ?? scratchFileName;
  const documentKey = activeTab?.documentKey ?? "initial-document";
  const isNewTabStartPage =
    activeTab?.kind === "scratch" && activeTab.name === newTabName && markdown.trim() === "";
  const activeWorkspaceRootPath = useMemo(() => {
    if (!currentFilePath) return null;
    if (projectFolder && findContainingFolderPath(projectFolder, currentFilePath)) {
      return projectFolder.path;
    }
    return getParentPath(currentFilePath);
  }, [currentFilePath, projectFolder]);
  const frontMatter = useMemo(() => parseFrontMatter(markdown), [markdown]);
  const editorText = frontMatter.body;
  const outlineItems = useMemo(() => parseTextOutline(editorText), [editorText]);
  const outlineFlatItems = useMemo(() => flattenOutline(outlineItems), [outlineItems]);
  const activeEditorLine = useMemo(
    () => getLineNumberAtOffset(editorText, editorSelectionHead),
    [editorSelectionHead, editorText],
  );
  const activeOutlineChain = useMemo(
    () => findActiveOutlineChain(outlineItems, activeEditorLine),
    [activeEditorLine, outlineItems],
  );
  const activeOutlineIds = useMemo(
    () => new Set(activeOutlineChain.map((item) => item.id)),
    [activeOutlineChain],
  );
  const filteredOutlineItems = useMemo(() => {
    const normalized = outlineQuery.trim().toLowerCase();
    if (!normalized) return outlineFlatItems;
    return outlineFlatItems.filter((item) => item.title.toLowerCase().includes(normalized));
  }, [outlineFlatItems, outlineQuery]);
  const breadcrumbTrail = useMemo(
    () => findPathToEntry(projectFolder, focusedFolderPath ?? currentFilePath),
    [currentFilePath, focusedFolderPath, projectFolder],
  );

  const filteredSnippets = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return snippets;

    return snippets.filter((snippet) => {
      const inlineTags = parseInlineIdeaTags(snippet.text);
      return (
        snippet.title.toLowerCase().includes(normalized) ||
        snippet.text.toLowerCase().includes(normalized) ||
        snippet.category.toLowerCase().includes(normalized) ||
        snippet.tags.some((tag) => tag.toLowerCase().includes(normalized)) ||
        inlineTags.some((tag) => tag.toLowerCase().includes(normalized))
      );
    });
  }, [query, snippets]);

  useEffect(() => {
    let isCancelled = false;

    const openScratch = (state: AppState, alert: WorkspaceAlert = null) => {
      suppressNextEditorUpdateRef.current = true;
      didMountEditorRef.current = false;
      setProjectFolder(null);
      setSnippetWorkspacePath(null);
      setPlotWorkspacePath(null);
      setPlotCards(defaultPlotCards);
      setFocusedFolderPath(null);
      replaceActiveTab(createScratchDocumentTab("", { documentKey: `scratch-${Date.now()}` }));
      setWorkspaceAlert(alert);
      setAppState({ ...state, markdown: "" });
      setLastError("");
    };

    loadStoredState()
      .then(async (state) => {
        if (isCancelled) return;

        if (!isTauriRuntime() || !state.lastWorkspacePath) {
          openScratch(state);
          return;
        }

        try {
          const folder = await invoke<ProjectFolder>("list_project_text_files", {
            folderPath: state.lastWorkspacePath,
          });
          if (isCancelled) return;

          setProjectFolder(folder);
          setWorkspaceAlert(null);
          const restoredSnippets =
            state.settings.snippetStorageMode === "workspace"
              ? await loadWorkspaceSnippets(folder.path)
              : state.snippets;
          const restoredPlotCards = await loadWorkspacePlotCards(folder.path);
          setSnippetWorkspacePath(
            state.settings.snippetStorageMode === "workspace" ? folder.path : null,
          );
          setPlotWorkspacePath(folder.path);
          setPlotCards(restoredPlotCards);

          const restoredState: AppState = {
            ...state,
            snippets: restoredSnippets,
            recentWorkspaces: upsertRecentWorkspace(
              state.recentWorkspaces,
              folder.path,
              folder.name,
            ),
          };

          const filePath =
            state.lastFilePath && findProjectEntry(folder.children, state.lastFilePath)
              ? state.lastFilePath
              : findFirstTextFile(folder.children)?.path ?? null;

          if (filePath) {
            const document = await invoke<TextDocument>("read_text_file", {
              path: filePath,
            });
            if (isCancelled) return;
            suppressNextEditorUpdateRef.current = true;
            didMountEditorRef.current = false;
            setFocusedFolderPath(null);
            replaceActiveTab(createFileDocumentTab(document));
            setAppState({
              ...restoredState,
              markdown: document.content,
              lastWorkspacePath: folder.path,
              lastFilePath: document.path,
            });
          } else {
            suppressNextEditorUpdateRef.current = true;
            didMountEditorRef.current = false;
            setFocusedFolderPath(folder.path);
            replaceActiveTab(
              createScratchDocumentTab("", {
                documentKey: `workspace-new-${Date.now()}`,
                saveStatus: "saved",
              }),
            );
            setAppState({
              ...restoredState,
              markdown: "",
              lastWorkspacePath: folder.path,
              lastFilePath: null,
            });
          }
          setLastError("");
          setSaveStatus("saved");
        } catch {
          if (isCancelled) return;
          openScratch(state, {
            path: state.lastWorkspacePath,
            message: "前回の作業フォルダを開けませんでした",
          });
        }
      })
      .catch(() => {
        if (isCancelled) return;
        setSaveStatus("error");
      })
      .finally(() => {
        if (!isCancelled) setIsHydrated(true);
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;

    loadSystemFonts()
      .then((fonts) => {
        if (!isCancelled) setSystemFonts(fonts);
      })
      .catch(() => {
        if (!isCancelled) setSystemFonts(fallbackFontOptions);
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = window.setTimeout(() => {
      saveStoredState(appState)
        .catch(() => {
          setLastError("アプリ状態の保存に失敗しました");
        });
      saveTimerRef.current = null;
    }, 700);
  }, [appState, isHydrated]);

  useEffect(() => {
    if (!isHydrated || !projectFolder || settings.snippetStorageMode !== "workspace") return;
    if (snippetWorkspacePath !== projectFolder.path) return;

    const timer = window.setTimeout(() => {
      saveWorkspaceSnippets(projectFolder.path, snippets).catch(() => {
        setLastError("ワークスペースのスニペット保存に失敗しました");
      });
    }, 700);

    return () => window.clearTimeout(timer);
  }, [isHydrated, projectFolder, settings.snippetStorageMode, snippetWorkspacePath, snippets]);

  useEffect(() => {
    if (!isHydrated || !projectFolder) return;
    if (plotWorkspacePath !== projectFolder.path) return;

    const timer = window.setTimeout(() => {
      saveWorkspacePlotCards(projectFolder.path, plotCards).catch(() => {
        setLastError("ワークスペースのプロット保存に失敗しました");
      });
    }, 700);

    return () => window.clearTimeout(timer);
  }, [isHydrated, plotCards, plotWorkspacePath, projectFolder]);

  useEffect(() => {
    if (!isHydrated || !isTauriRuntime()) return;
    if (settings.snippetStorageMode !== "workspace") return;
    if (!currentFilePath || !activeWorkspaceRootPath) return;
    if (snippetWorkspacePath === activeWorkspaceRootPath && projectFolder?.path === activeWorkspaceRootPath) {
      return;
    }

    let isCancelled = false;

    Promise.all([
      projectFolder?.path === activeWorkspaceRootPath
        ? Promise.resolve(projectFolder)
        : invoke<ProjectFolder>("list_project_text_files", {
            folderPath: activeWorkspaceRootPath,
          }),
      loadWorkspaceSnippets(activeWorkspaceRootPath),
      loadWorkspacePlotCards(activeWorkspaceRootPath),
    ])
      .then(([folder, workspaceSnippets, workspacePlotCards]) => {
        if (isCancelled) return;
        setProjectFolder(folder);
        setFocusedFolderPath(null);
        setWorkspaceAlert(null);
        setSnippetWorkspacePath(folder.path);
        setPlotWorkspacePath(folder.path);
        setPlotCards(workspacePlotCards);
        setAppState((current) => ({
          ...current,
          snippets: workspaceSnippets,
          lastWorkspacePath: folder.path,
          lastFilePath: currentFilePath,
          recentWorkspaces: upsertRecentWorkspace(
            current.recentWorkspaces,
            folder.path,
            folder.name,
          ),
        }));
      })
      .catch((error) => {
        if (isCancelled) return;
        setLastError(String(error));
        setSaveStatus("error");
      });

    return () => {
      isCancelled = true;
    };
  }, [
    activeWorkspaceRootPath,
    currentFilePath,
    isHydrated,
    projectFolder,
    settings.snippetStorageMode,
    snippetWorkspacePath,
  ]);

  useEffect(() => {
    if (!isHydrated || !didMountEditorRef.current || !currentFilePath) return;
    if (markdown === lastSavedMarkdownRef.current) {
      setSaveStatus("saved");
      return;
    }

    setSaveStatus("dirty");
    const timer = window.setTimeout(() => {
      setSaveStatus("saving");
      invoke<TextDocument>("save_text_file", {
        path: currentFilePath,
        content: markdown,
      })
        .then((document) => {
          markActiveTabSaved(document.content, document.name);
          setLastError("");
        })
        .catch((error) => {
          setLastError(String(error));
          setSaveStatus("error");
        });
    }, 700);

    return () => window.clearTimeout(timer);
  }, [currentFilePath, isHydrated, markActiveTabSaved, markdown, setSaveStatus]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      if (typewriterScrollFrameRef.current) {
        window.cancelAnimationFrame(typewriterScrollFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;

      if (!fileMenuRef.current?.contains(target)) {
        setIsFileMenuOpen(false);
      }
      if (!breadcrumbMenuRef.current?.contains(target)) {
        setActiveBreadcrumbPath(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setIsFileMenuOpen(false);
      setActiveBreadcrumbPath(null);
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const handleEditorReady = useCallback((editor: TextEditorHandle | null) => {
    editorInstanceRef.current = editor;
  }, []);

  const handleBreadcrumbKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    const menu = breadcrumbMenuRef.current?.querySelector(".menuPopover");
    if (!menu) return;

    if (event.key === "Escape") {
      setActiveBreadcrumbPath(null);
      setIsOutlineMenuOpen(false);
      event.preventDefault();
      return;
    }

    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;

    const focusableItems = Array.from(
      menu.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
        'button[role="menuitem"]:not(:disabled), input:not(:disabled)',
      ),
    ).filter((item) => item.offsetParent !== null);

    if (!focusableItems.length) return;

    const currentIndex = focusableItems.findIndex((item) => item === document.activeElement);
    let nextIndex = currentIndex;

    if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = focusableItems.length - 1;
    } else if (event.key === "ArrowDown") {
      nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % focusableItems.length;
    } else if (event.key === "ArrowUp") {
      nextIndex =
        currentIndex < 0
          ? focusableItems.length - 1
          : (currentIndex - 1 + focusableItems.length) % focusableItems.length;
    }

    focusableItems[nextIndex]?.focus();
    event.preventDefault();
  }, []);

  const applyTypewriterScroll = useCallback(() => {
    if (!settings.typewriterScroll) return;

    const editor = editorInstanceRef.current;
    if (!editor || editor.isComposing()) return;
    const selection = editor.getSelection();
    if (selection.from !== selection.to) return;
    editor.scrollCaretIntoView(settings.typewriterOffset);
  }, [settings.typewriterOffset, settings.typewriterScroll]);

  const scheduleTypewriterScroll = useCallback(() => {
    if (!settings.typewriterScroll) return;
    if (typewriterScrollFrameRef.current) {
      window.cancelAnimationFrame(typewriterScrollFrameRef.current);
    }
    typewriterScrollFrameRef.current = window.requestAnimationFrame(() => {
      typewriterScrollFrameRef.current = null;
      applyTypewriterScroll();
    });
  }, [applyTypewriterScroll, settings.typewriterScroll]);

  useEffect(() => {
    if (!settings.typewriterScroll) return;
    scheduleTypewriterScroll();
  }, [scheduleTypewriterScroll, settings.typewriterScroll]);

  const handleTextChange = useCallback((nextText: string) => {
    didMountEditorRef.current = true;
    setCharCount(getTextLength(nextText));
    if (suppressNextEditorUpdateRef.current) {
      suppressNextEditorUpdateRef.current = false;
      return;
    }
    const nextFullText = updateMarkdownBody(markdown, nextText);
    if (markdown !== nextFullText) {
      setActiveMarkdown(nextFullText);
    }
    if (!currentFilePath) {
      setSaveStatus("dirty");
    }
  }, [currentFilePath, markdown, setActiveMarkdown, setSaveStatus]);

  useEffect(() => {
    setCharCount(getTextLength(editorText));
  }, [editorText]);

  const updateFrontMatter = useCallback((metadata: string) => {
    const nextMarkdown = composeMarkdown(metadata, parseFrontMatter(markdown).body);
    if (markdown !== nextMarkdown) {
      setActiveMarkdown(nextMarkdown);
    }
    if (!currentFilePath) {
      setSaveStatus("dirty");
    }
  }, [currentFilePath, markdown, setActiveMarkdown, setSaveStatus]);

  const handleFrontMatterChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      updateFrontMatter(event.target.value);
    },
    [updateFrontMatter],
  );

  const handleAddFrontMatterProperty = useCallback(() => {
    updateFrontMatter(appendFrontMatterProperty(parseFrontMatter(markdown).metadata));
    setIsMetadataOpen(true);
  }, [markdown, updateFrontMatter]);

  const handleClearFrontMatter = useCallback(async () => {
    if (!frontMatter.hasFrontMatter) return;
    const shouldClear = await requestConfirm({
      title: "プロパティを削除",
      message: "プロパティをすべて削除しますか？",
      confirmLabel: "削除",
      danger: true,
    });
    if (!shouldClear) return;
    updateFrontMatter("");
  }, [frontMatter.hasFrontMatter, updateFrontMatter]);

  const handleSelectionChange = useCallback(() => {
    const editor = editorInstanceRef.current;
    if (editor) {
      setEditorSelectionHead(editor.getSelection().head);
    }
    scheduleTypewriterScroll();
  }, [scheduleTypewriterScroll]);

  const showToast = (message: string) => {
    setToast(message);

    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }

    toastTimerRef.current = window.setTimeout(() => {
      setToast("");
      toastTimerRef.current = null;
    }, 2200);
  };

  const requestInput = ({
    title,
    label,
    initialValue,
    confirmLabel,
    placeholder,
  }: {
    title: string;
    label: string;
    initialValue: string;
    confirmLabel: string;
    placeholder?: string;
  }) =>
    new Promise<string | null>((resolve) => {
      setAppDialog({
        type: "input",
        title,
        label,
        value: initialValue,
        confirmLabel,
        placeholder,
        error: "",
        resolve,
      });
    });

  const requestConfirm = ({
    title,
    message,
    detail,
    confirmLabel,
    danger = false,
  }: {
    title: string;
    message: string;
    detail?: string;
    confirmLabel: string;
    danger?: boolean;
  }) =>
    new Promise<boolean>((resolve) => {
      setAppDialog({
        type: "confirm",
        title,
        message,
        detail,
        confirmLabel,
        danger,
        resolve,
      });
    });

  const closeAppDialog = () => {
    setAppDialog((current) => {
      if (!current) return null;
      if (current.type === "input") {
        current.resolve(null);
      } else {
        current.resolve(false);
      }
      return null;
    });
  };

  const submitAppDialog = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    setAppDialog((current) => {
      if (!current) return null;
      if (current.type === "confirm") {
        current.resolve(true);
        return null;
      }

      const value = current.value.trim();
      if (!value) {
        return { ...current, error: "名前を入力してください" };
      }
      current.resolve(value);
      return null;
    });
  };

  const updateAppDialogValue = (value: string) => {
    setAppDialog((current) =>
      current?.type === "input" ? { ...current, value, error: "" } : current,
    );
  };

  const confirmDiscardDirtyDocument = async () => {
    if (saveStatus !== "dirty" && saveStatus !== "error") return true;
    return requestConfirm({
      title: "未保存の変更があります",
      message: "現在の変更を破棄して続行しますか？",
      detail: currentFileName,
      confirmLabel: "破棄して続行",
      danger: true,
    });
  };

  const confirmCloseDocumentTab = async (tab: DocumentTab) => {
    if (!isDirtyDocumentTab(tab)) return true;
    return requestConfirm({
      title: "未保存の変更があります",
      message: "このタブを閉じると未保存の変更は破棄されます。",
      detail: tab.name,
      confirmLabel: "破棄して閉じる",
      danger: true,
    });
  };

  const activateRelativeDocumentTab = (direction: -1 | 1) => {
    if (openTabs.length <= 1) return;
    const currentIndex = openTabs.findIndex((tab) => tab.id === activeTabId);
    const startIndex = currentIndex < 0 ? 0 : currentIndex;
    const nextIndex = (startIndex + direction + openTabs.length) % openTabs.length;
    activateDocumentTab(openTabs[nextIndex].id);
  };

  const closeDocumentTab = async (tabId = activeTabId) => {
    const targetIndex = openTabs.findIndex((tab) => tab.id === tabId);
    if (targetIndex < 0) return;

    const targetTab = openTabs[targetIndex];
    if (!(await confirmCloseDocumentTab(targetTab))) return;

    const remainingTabs = openTabs.filter((tab) => tab.id !== tabId);
    const fallbackTab =
      remainingTabs[targetIndex] ??
      remainingTabs[targetIndex - 1] ??
      createScratchDocumentTab("", {
        documentKey: `closed-last-tab-${Date.now()}`,
        saveStatus: "dirty",
      });

    setOpenTabs(remainingTabs.length ? remainingTabs : [fallbackTab]);
    syncDocumentTabToEditor(fallbackTab);
    showToast(`「${targetTab.name}」を閉じました`);
  };

  const loadDocumentIntoEditor = useCallback((document: TextDocument, options: { replaceActive?: boolean } = {}) => {
    suppressNextEditorUpdateRef.current = true;
    didMountEditorRef.current = false;
    if (options.replaceActive) {
      replaceActiveTabWithDocument(document);
    } else {
      openDocumentInTab(document);
    }
    setFocusedFolderPath(null);
    setAppState((current) => ({
      ...current,
      markdown: document.content,
      lastWorkspacePath: projectFolder?.path ?? current.lastWorkspacePath,
      lastFilePath: document.path,
      recentWorkspaces: projectFolder
        ? upsertRecentWorkspace(current.recentWorkspaces, projectFolder.path, projectFolder.name)
        : current.recentWorkspaces,
    }));
    setLastError("");
  }, [openDocumentInTab, projectFolder, replaceActiveTabWithDocument]);

  const setWorkspaceFromDocumentPath = useCallback(
    async (document: TextDocument, options: { loadWorkspaceSnippets?: boolean } = {}) => {
      if (!isTauriRuntime()) return null;
      const folderPath = getParentPath(document.path);
      if (!folderPath) return null;

      const folder = await invoke<ProjectFolder>("list_project_text_files", {
        folderPath,
      });
      setProjectFolder(folder);
      setFocusedFolderPath(null);
      setWorkspaceAlert(null);
      const nextSnippets =
        options.loadWorkspaceSnippets && settings.snippetStorageMode === "workspace"
          ? await loadWorkspaceSnippets(folder.path)
          : null;
      const nextPlotCards = await loadWorkspacePlotCards(folder.path);
      if (nextSnippets) {
        setSnippetWorkspacePath(folder.path);
      }
      setPlotWorkspacePath(folder.path);
      setPlotCards(nextPlotCards);
      setAppState((current) => ({
        ...current,
        snippets: nextSnippets ?? current.snippets,
        lastWorkspacePath: folder.path,
        lastFilePath: document.path,
        recentWorkspaces: upsertRecentWorkspace(
          current.recentWorkspaces,
          folder.path,
          folder.name,
        ),
      }));
      return folder;
    },
    [settings.snippetStorageMode],
  );

  const refreshProjectFolder = useCallback(async (_folderPath: string) => {
    if (!isTauriRuntime() || !projectFolder) return null;
    const folder = await invoke<ProjectFolder>("list_project_text_files", {
      folderPath: projectFolder.path,
    });
    setProjectFolder(folder);
    return folder;
  }, [projectFolder]);

  const handleProjectFolderSelect = useCallback(
    async (path: string) => {
      if (!projectFolder || !isTauriRuntime()) return;

      try {
        const folder = await refreshProjectFolder(path);
        setFocusedFolderPath(path);
        setActiveBreadcrumbPath(path);
        const selectedFolder =
          folder?.path === path
            ? folder
            : folder
              ? findProjectEntry(folder.children, path)
              : null;
        showToast(`「${selectedFolder?.name ?? getWorkspaceName(path)}」を開きました`);
      } catch (error) {
        setLastError(String(error));
        setSaveStatus("error");
      }
    },
    [currentFilePath, projectFolder, refreshProjectFolder],
  );

  const handleNewTab = () => {
    addScratchTab(`new-tab-${Date.now()}`, newTabName);
    setFocusedFolderPath(null);
    setLastError("");
  };

  const handleNewDocument = async () => {
    if (projectFolder) {
      void handleCreateProjectFile(focusedFolderPath ?? projectFolder.path);
      return;
    }
    addScratchTab();
    setLastError("");
  };

  const handleOpenTextFile = async () => {
    if (!isTauriRuntime()) {
      showToast("ファイルを開く機能はTauri版で利用できます");
      return;
    }

    try {
      const document = await invoke<TextDocument | null>("open_text_file_dialog");
      if (!document) {
        return;
      }
      await setWorkspaceFromDocumentPath(document, { loadWorkspaceSnippets: true });
      loadDocumentIntoEditor(document);
      showToast(`「${document.name}」を開きました`);
    } catch (error) {
      setLastError(String(error));
      setSaveStatus("error");
    }
  };

  const saveCurrentDocument = async () => {
    if (!isTauriRuntime()) {
      await saveStoredState(appState);
      markActiveTabSaved(markdown);
      return;
    }

    const previousSaveStatus = saveStatus;
    setSaveStatus("saving");
    try {
      const document = currentFilePath
        ? await invoke<TextDocument>("save_text_file", {
            path: currentFilePath,
            content: markdown,
          })
        : await invoke<TextDocument | null>("save_text_file_dialog", {
            content: markdown,
          });

      if (!document) {
        setSaveStatus(previousSaveStatus);
        return;
      }

      const wasScratch = !currentFilePath;
      loadDocumentIntoEditor(document, { replaceActive: true });
      if (wasScratch) {
        await setWorkspaceFromDocumentPath(document, { loadWorkspaceSnippets: true });
      }
      const refreshPath = currentFilePath
        ? findContainingFolderPath(projectFolder, currentFilePath)
        : projectFolder?.path;
      if (refreshPath) await refreshProjectFolder(refreshPath);
      showToast(`「${document.name}」を保存しました`);
    } catch (error) {
      setLastError(String(error));
      setSaveStatus("error");
    }
  };

  const handleSaveAs = async () => {
    if (!isTauriRuntime()) {
      showToast("名前を付けて保存はTauri版で利用できます");
      return;
    }

    const previousSaveStatus = saveStatus;
    setSaveStatus("saving");
    try {
      const document = await invoke<TextDocument | null>("save_text_file_dialog", {
        content: markdown,
      });
      if (!document) {
        setSaveStatus(previousSaveStatus);
        return;
      }
      loadDocumentIntoEditor(document, { replaceActive: true });
      const folder = await setWorkspaceFromDocumentPath(document, { loadWorkspaceSnippets: true });
      if (!folder && projectFolder) {
        await refreshProjectFolder(projectFolder.path);
      }
      showToast(`「${document.name}」を保存しました`);
    } catch (error) {
      setLastError(String(error));
      setSaveStatus("error");
    }
  };

  const handleOpenProjectFolder = async () => {
    if (!isTauriRuntime()) {
      showToast("フォルダを開く機能はTauri版で利用できます");
      return;
    }
    if (!(await confirmDiscardDirtyDocument())) return;

    const previousSaveStatus = saveStatus;
    setSaveStatus("loading");
    try {
      debugLog("before invoke open_project_folder_dialog");
      const folder = await invoke<ProjectFolder | null>("open_project_folder_dialog");
      debugLog("after invoke open_project_folder_dialog", {
        selected: Boolean(folder),
        path: folder?.path ?? null,
        children: folder?.children.length ?? 0,
      });
      if (!folder) {
        setSaveStatus(previousSaveStatus);
        return;
      }

      debugLog("before setProjectFolder", {
        path: folder.path,
        children: folder.children.length,
      });
      setProjectFolder(folder);
      setWorkspaceAlert(null);
      debugLog("after setProjectFolder call");
      setFocusedFolderPath(folder.path);
      const restoredSnippets =
        settings.snippetStorageMode === "workspace"
          ? await loadWorkspaceSnippets(folder.path)
          : snippets;
      const restoredPlotCards = await loadWorkspacePlotCards(folder.path);
      setSnippetWorkspacePath(settings.snippetStorageMode === "workspace" ? folder.path : null);
      setPlotWorkspacePath(folder.path);
      setPlotCards(restoredPlotCards);
      setAppState((current) => ({
        ...current,
        snippets: restoredSnippets,
        lastWorkspacePath: folder.path,
        recentWorkspaces: upsertRecentWorkspace(
          current.recentWorkspaces,
          folder.path,
          folder.name,
        ),
      }));
      const firstFile = findFirstTextFile(folder.children);
      if (firstFile) {
        debugLog("before invoke read_text_file firstFile", {
          path: firstFile.path,
        });
        const document = await invoke<TextDocument>("read_text_file", {
          path: firstFile.path,
        });
        debugLog("after invoke read_text_file firstFile", {
          path: document.path,
          contentLength: document.content.length,
        });
        debugLog("before loadDocumentIntoEditor");
        loadDocumentIntoEditor(document, { replaceActive: true });
        debugLog("after loadDocumentIntoEditor call");
        setAppState((current) => ({
          ...current,
          lastWorkspacePath: folder.path,
          lastFilePath: document.path,
          recentWorkspaces: upsertRecentWorkspace(
            current.recentWorkspaces,
            folder.path,
            folder.name,
          ),
        }));
      } else {
        setSaveStatus("saved");
        setCurrentFilePath(null);
        setCurrentFileName(scratchFileName);
        setDocumentKey(`workspace-empty-${Date.now()}`);
      }
      showToast(`「${folder.name}」を開きました`);
    } catch (error) {
      setLastError(String(error));
      setSaveStatus("error");
    }
  };

  const handleRetryWorkspaceRestore = async () => {
    if (!workspaceAlert || !isTauriRuntime()) return;

    setSaveStatus("loading");
    try {
      const folder = await invoke<ProjectFolder>("list_project_text_files", {
        folderPath: workspaceAlert.path,
      });
      setProjectFolder(folder);
      setFocusedFolderPath(folder.path);
      setWorkspaceAlert(null);
      const restoredSnippets =
        settings.snippetStorageMode === "workspace"
          ? await loadWorkspaceSnippets(folder.path)
          : snippets;
      const restoredPlotCards = await loadWorkspacePlotCards(folder.path);
      setSnippetWorkspacePath(settings.snippetStorageMode === "workspace" ? folder.path : null);
      setPlotWorkspacePath(folder.path);
      setPlotCards(restoredPlotCards);
      const firstFile = findFirstTextFile(folder.children);
      setAppState((current) => ({
        ...current,
        snippets: restoredSnippets,
        lastWorkspacePath: folder.path,
        lastFilePath: firstFile?.path ?? null,
        recentWorkspaces: upsertRecentWorkspace(
          current.recentWorkspaces,
          folder.path,
          folder.name,
        ),
      }));
      if (firstFile) {
        const document = await invoke<TextDocument>("read_text_file", {
          path: firstFile.path,
        });
        loadDocumentIntoEditor(document, { replaceActive: true });
      } else {
        setSaveStatus("saved");
      }
    } catch (error) {
      setLastError(String(error));
      setWorkspaceAlert((current) => current);
      setSaveStatus("dirty");
    }
  };

  const handleForgetWorkspace = () => {
    if (!workspaceAlert) return;
    const failedPath = workspaceAlert.path;
    setAppState((current) => ({
      ...current,
      lastWorkspacePath:
        current.lastWorkspacePath === failedPath ? null : current.lastWorkspacePath,
      recentWorkspaces: current.recentWorkspaces.filter(
        (workspace) => workspace.path !== failedPath,
      ),
    }));
    setWorkspaceAlert(null);
    setLastError("");
  };

  const handleProjectFileSelect = async (path: string) => {
    if (!path || path === currentFilePath) return;
    const existingTab = openTabs.find((tab) => tab.path === path);
    if (existingTab) {
      activateDocumentTab(existingTab.id);
      showToast(`「${existingTab.name}」を開きました`);
      return;
    }

    try {
      const document = await invoke<TextDocument>("read_text_file", { path });
      loadDocumentIntoEditor(document);
      showToast(`「${document.name}」を開きました`);
    } catch (error) {
      setLastError(String(error));
      setSaveStatus("error");
    }
  };

  const handleProjectFileSelectInNewTab = async (path: string) => {
    if (!path) return;
    const existingTab = openTabs.find((tab) => tab.path === path);
    if (existingTab) {
      activateDocumentTab(existingTab.id);
      showToast(`「${existingTab.name}」を開きました`);
      return;
    }

    try {
      const document = await invoke<TextDocument>("read_text_file", { path });
      openDocumentInTab(document);
      setFocusedFolderPath(null);
      setLastError("");
      showToast(`「${document.name}」を新しいタブで開きました`);
    } catch (error) {
      setLastError(String(error));
      setSaveStatus("error");
    }
  };

  const closeFileMenuAndRun = (action: () => void | Promise<void>) => {
    setIsFileMenuOpen(false);
    void action();
  };

  const closeBreadcrumbMenuAndRun = (action: () => void | Promise<void>) => {
    setActiveBreadcrumbPath(null);
    void action();
  };

  const handleCreateProjectFile = async (folderPath = activeBreadcrumbPath) => {
    if (!projectFolder) {
      showToast("先にフォルダを開いてください");
      return;
    }
    const targetFolderPath = folderPath ?? projectFolder.path;

    const name = await requestInput({
      title: "新規ファイルを作成",
      label: "テキストファイル名",
      initialValue: "新規ノート.txt",
      confirmLabel: "作成",
      placeholder: "例: chapter-01.txt",
    });
    if (!name) return;

    try {
      const document = await invoke<TextDocument>("create_text_file", {
        folderPath: targetFolderPath,
        name,
      });
      await refreshProjectFolder(targetFolderPath);
      loadDocumentIntoEditor(document);
      showToast(`「${document.name}」を作成しました`);
    } catch (error) {
      setLastError(String(error));
      setSaveStatus("error");
    }
  };

  const handleCreateProjectFolder = async (folderPath = activeBreadcrumbPath) => {
    if (!projectFolder) {
      showToast("先にフォルダを開いてください");
      return;
    }
    const targetFolderPath = folderPath ?? projectFolder.path;
    const name = await requestInput({
      title: "新規フォルダを作成",
      label: "フォルダ名",
      initialValue: "新規フォルダ",
      confirmLabel: "作成",
      placeholder: "例: 第一章",
    });
    if (!name) return;

    setSaveStatus("loading");
    try {
      await invoke<ProjectFolder>("create_project_folder", {
        folderPath: targetFolderPath,
        name,
      });
      await refreshProjectFolder(targetFolderPath);
      setSaveStatus(currentFilePath ? "saved" : "dirty");
      showToast(`「${name.trim()}」を作成しました`);
    } catch (error) {
      setLastError(String(error));
      setSaveStatus("error");
    }
  };

  const handleRenameProjectEntry = async (entry: ProjectFolder | ProjectEntry) => {
    if (!projectFolder) return;
    const name = await requestInput({
      title: "名前を変更",
      label: "kind" in entry && entry.kind === "folder" ? "フォルダ名" : "テキストファイル名",
      initialValue: entry.name,
      confirmLabel: "変更",
    });
    if (!name || name.trim() === entry.name) return;

    setSaveStatus("loading");
    try {
      const document = await invoke<TextDocument>("rename_project_entry", {
        path: entry.path,
        name,
      });
      const parentFolderPath =
        findContainingFolderPath(projectFolder, entry.path) ?? projectFolder.path;
      await refreshProjectFolder(parentFolderPath);
      if ("kind" in entry && entry.kind === "file") {
        setOpenTabs((current) =>
          current.map((tab) =>
            tab.path === entry.path
              ? {
                  ...tab,
                  id: `file:${document.path}`,
                  kind: "file",
                  path: document.path,
                  name: document.name,
                  documentKey: document.path,
                }
              : tab,
          ),
        );
      }
      if (entry.path === currentFilePath) {
        loadDocumentIntoEditor(document, { replaceActive: true });
      } else if (entry.path === focusedFolderPath) {
        setFocusedFolderPath(document.path);
        setSaveStatus(currentFilePath ? "saved" : "dirty");
      } else {
        setSaveStatus(currentFilePath ? "saved" : "dirty");
      }
      showToast(`「${entry.name}」をリネームしました`);
    } catch (error) {
      setLastError(String(error));
      setSaveStatus("error");
    }
  };

  const handleDeleteProjectEntry = async (entry: ProjectEntry) => {
    if (!projectFolder) return;
    const shouldDelete = await requestConfirm({
      title: "項目を削除",
      message: `「${entry.name}」を削除しますか？`,
      detail:
        entry.kind === "folder"
          ? "空のフォルダだけ削除できます。"
          : "削除したファイルはこの操作では復元できません。",
      confirmLabel: "削除",
      danger: true,
    });
    if (!shouldDelete) return;

    setSaveStatus("loading");
    try {
      await invoke("delete_project_entry", { path: entry.path });
      const parentFolderPath =
        findContainingFolderPath(projectFolder, entry.path) ?? projectFolder.path;
      const refreshed = await refreshProjectFolder(parentFolderPath);
      if (entry.path === focusedFolderPath) {
        setFocusedFolderPath(null);
      }
      if (entry.path !== currentFilePath) {
        setOpenTabs((current) => current.filter((tab) => tab.path !== entry.path));
      }
      if (entry.path === currentFilePath) {
        const nextFile = refreshed ? findFirstTextFile(refreshed.children) : null;
        if (nextFile) {
          const document = await invoke<TextDocument>("read_text_file", {
            path: nextFile.path,
          });
          loadDocumentIntoEditor(document, { replaceActive: true });
        } else {
          suppressNextEditorUpdateRef.current = true;
          didMountEditorRef.current = false;
          setFocusedFolderPath(projectFolder.path);
          replaceActiveTab(
            createScratchDocumentTab("", {
              documentKey: `workspace-empty-${Date.now()}`,
              saveStatus: "saved",
            }),
          );
          setAppState((current) => ({
            ...current,
            markdown: "",
            lastFilePath: null,
          }));
          setLastError("");
        }
      } else {
        setSaveStatus(currentFilePath ? "saved" : "dirty");
      }
      showToast(`「${entry.name}」を削除しました`);
    } catch (error) {
      setLastError(String(error));
      setSaveStatus("error");
    }
  };

  const saveProjectEntryOrder = async (folderPath: string, orderedPaths: string[]) => {
    if (!projectFolder) return;

    try {
      const folder = await invoke<ProjectFolder>("reorder_project_entries", {
        rootPath: projectFolder.path,
        folderPath,
        orderedPaths,
      });
      setProjectFolder((current) =>
        current ? replaceFolderChildren(current, folder.path, folder.children) : folder,
      );
      showToast("並び順を保存しました");
    } catch (error) {
      setLastError(String(error));
      setSaveStatus("error");
    }
  };

  const handleMoveProjectEntry = async (
    folderPath: string,
    entryPath: string,
    direction: -1 | 1,
  ) => {
    if (!projectFolder) return;

    const children = getFolderChildren(projectFolder, folderPath);
    const nextOrder = movePathInOrder(
      children.map((entry) => entry.path),
      entryPath,
      direction,
    );
    if (!nextOrder) return;

    await saveProjectEntryOrder(folderPath, nextOrder);
  };

  const handleBreadcrumbEntryDragStart = (
    event: DragEvent<HTMLDivElement>,
    folderPath: string,
    entryPath: string,
  ) => {
    breadcrumbDragEntryRef.current = { folderPath, entryPath };
    setDraggingBreadcrumbEntryPath(entryPath);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(BREADCRUMB_ENTRY_DRAG_MIME, entryPath);
  };

  const handleBreadcrumbEntryDragOver = (
    event: DragEvent<HTMLDivElement>,
    folderPath: string,
    entryPath: string,
  ) => {
    const draggingEntry = breadcrumbDragEntryRef.current;
    if (!draggingEntry || draggingEntry.folderPath !== folderPath) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const rect = event.currentTarget.getBoundingClientRect();
    const position = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
    setBreadcrumbDropTarget({ folderPath, entryPath, position });
  };

  const handleBreadcrumbEntryDrop = async (
    event: DragEvent<HTMLDivElement>,
    folderPath: string,
    entryPath: string,
  ) => {
    const draggingEntry = breadcrumbDragEntryRef.current;
    if (!projectFolder || !draggingEntry || draggingEntry.folderPath !== folderPath) return;

    event.preventDefault();
    const children = getFolderChildren(projectFolder, folderPath);
    const nextOrder = movePathToDropPosition(
      children.map((entry) => entry.path),
      draggingEntry.entryPath,
      entryPath,
      breadcrumbDropTarget?.position ?? "before",
    );
    setBreadcrumbDropTarget(null);
    setDraggingBreadcrumbEntryPath(null);
    breadcrumbDragEntryRef.current = null;
    if (nextOrder) await saveProjectEntryOrder(folderPath, nextOrder);
  };

  const handleBreadcrumbEntryDragEnd = () => {
    setBreadcrumbDropTarget(null);
    setDraggingBreadcrumbEntryPath(null);
    breadcrumbDragEntryRef.current = null;
  };

  const jumpToOutlineItem = (item: OutlineItem) => {
    const view = getEditorView();
    if (!view) return;

    view.jumpToLine(item.line);
    setIsOutlineMenuOpen(false);
  };

  const clearDropIndicator = () => {
    setDropIndicatorTop(null);
  };

  const isSnippetDragEvent = (event: DragEvent<HTMLElement>) => {
    return Array.from(event.dataTransfer.types).includes(SNIPPET_DRAG_MIME);
  };

  const getDraggedSnippet = (event: DragEvent<HTMLElement>) => {
    if (draggingSnippetRef.current) return draggingSnippetRef.current;

    const snippetId = event.dataTransfer.getData(SNIPPET_DRAG_MIME);
    if (!snippetId) return null;
    return snippets.find((snippet) => snippet.id === snippetId) ?? null;
  };

  const getEditorView = () => {
    return editorInstanceRef.current;
  };

  const insertSnippetParagraph = (snippet: Snippet, pos?: number) => {
    const view = getEditorView();
    if (!view) return false;

    const selection = view.getSelection();
    const insertFrom = typeof pos === "number" ? pos : selection.from;
    const insertTo = typeof pos === "number" ? pos : selection.to;
    const doc = view.getValue();
    const before = insertFrom > 0 ? doc.slice(insertFrom - 1, insertFrom) : "\n";
    const after = insertTo < doc.length ? doc.slice(insertTo, insertTo + 1) : "\n";
    const prefix = before === "\n" ? "" : "\n";
    const suffix = after === "\n" ? "" : "\n";
    const insertedText = `${prefix}${snippet.text}${suffix}`;
    const cursorPos = insertFrom + prefix.length + snippet.text.length;

    view.replaceRange(insertFrom, insertTo, insertedText, cursorPos);
    view.focus();
    return true;
  };

  const commitInsertion = (snippet: Snippet) => {
    showToast(`「${snippet.title}」を挿入しました`);
  };

  const handleSnippetDoubleClick = (snippet: Snippet) => {
    if (insertSnippetParagraph(snippet)) {
      commitInsertion(snippet);
    }
  };

  const handleSnippetDragStart = (
    event: DragEvent<HTMLDivElement>,
    snippet: Snippet,
  ) => {
    draggingSnippetRef.current = snippet;
    setDraggingId(snippet.id);
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(SNIPPET_DRAG_MIME, snippet.id);
    event.dataTransfer.setData("text/plain", snippet.text);
  };

  const handleSnippetDragEnd = () => {
    draggingSnippetRef.current = null;
    setDraggingId(null);
    clearDropIndicator();
  };

  const handleEditorDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!draggingSnippetRef.current && !isSnippetDragEvent(event)) return;

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    const rect = editorShellRef.current?.getBoundingClientRect();
    if (rect) {
      setDropIndicatorTop(event.clientY - rect.top);
    }
  };

  const handleEditorDragLeave = (event: DragEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;

    if (!(nextTarget instanceof Node) || !editorShellRef.current?.contains(nextTarget)) {
      clearDropIndicator();
    }
  };

  const handleEditorDrop = (event: DragEvent<HTMLDivElement>) => {
    const snippet = getDraggedSnippet(event);
    const view = getEditorView();

    if (!snippet || !view) return;

    event.preventDefault();
    event.stopPropagation();

    const resolvedPos = view.positionFromPoint(event.clientX, event.clientY);
    clearDropIndicator();

    if (insertSnippetParagraph(snippet, resolvedPos ?? undefined)) {
      commitInsertion(snippet);
    }
    draggingSnippetRef.current = null;
    setDraggingId(null);
  };

  const updateSnippetList = (updater: (snippets: Snippet[]) => Snippet[]) => {
    setAppState((current) => {
      const nextSnippets = updater(current.snippets);
      return {
        ...current,
        snippets: nextSnippets,
        profileSnippets:
          current.settings.snippetStorageMode === "profile"
            ? nextSnippets
            : current.profileSnippets,
      };
    });
  };

  const createIdea = () => {
    const id = `idea-${Date.now()}`;
    setQuery("");
    updateSnippetList((currentSnippets) => [
      {
        id,
        title: "Idea",
        text: "",
        category: "",
        tags: [],
      },
      ...currentSnippets,
    ]);
    showToast("Ideaを追加しました");
  };

  const updateIdeaText = (snippetId: string, text: string) => {
    updateSnippetList((currentSnippets) =>
      currentSnippets.map((snippet) =>
        snippet.id === snippetId
          ? {
              ...snippet,
              title: createIdeaTitle(text),
              text,
              category: "",
              tags: parseInlineIdeaTags(text),
            }
          : snippet,
      ),
    );
  };

  const deleteSnippet = async (snippet: Snippet) => {
    const shouldDelete = await requestConfirm({
      title: "Ideaを削除",
      message: "このIdeaを削除しますか？",
      detail: snippet.title,
      confirmLabel: "削除",
      danger: true,
    });
    if (!shouldDelete) return;

    updateSnippetList((currentSnippets) =>
      currentSnippets.filter((item) => item.id !== snippet.id),
    );
    showToast(`「${snippet.title}」を削除しました`);
  };

  const moveSnippet = (snippetId: string, direction: -1 | 1) => {
    updateSnippetList((currentSnippets) => {
      const index = currentSnippets.findIndex((snippet) => snippet.id === snippetId);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= currentSnippets.length) {
        return currentSnippets;
      }

      const next = [...currentSnippets];
      const [snippet] = next.splice(index, 1);
      next.splice(targetIndex, 0, snippet);
      return next;
    });
  };

  const updateSettings = <Key extends keyof EditorSettings>(
    key: Key,
    value: EditorSettings[Key],
  ) => {
    setAppState((current) => ({
      ...current,
      settings: {
        ...current.settings,
        [key]: value,
      },
    }));
  };

  const handleSnippetStorageModeChange = async (
    mode: EditorSettings["snippetStorageMode"],
  ) => {
    updateSettings("snippetStorageMode", mode);
    if (!projectFolder) return;

    if (mode === "workspace") {
      try {
        const workspaceSnippets = await loadWorkspaceSnippets(projectFolder.path);
        setSnippetWorkspacePath(projectFolder.path);
        setAppState((current) => ({ ...current, snippets: workspaceSnippets }));
      } catch (error) {
        setLastError(String(error));
      }
      return;
    }

    const profileState = normalizeState(
      isTauriRuntime()
        ? await invoke<AppState | null>("load_app_state")
        : JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null"),
    );
    setSnippetWorkspacePath(null);
    setAppState((current) => ({ ...current, snippets: profileState.profileSnippets }));
  };

  return (
      <main
        className="appShell"
        style={
          {
            "--editor-font-family": settings.editorFontFamily,
            "--ui-font-family": settings.uiFontFamily,
            "--editor-font-size": `${settings.fontSize}px`,
            "--editor-line-height": settings.lineHeight,
            "--typewriter-guide-position": `${settings.typewriterOffset}%`,
          } as React.CSSProperties
        }
      >
        <section className="appFrame" aria-label="Then">
          <header className="topbar">
            <div className="fileMenu" ref={fileMenuRef}>
              <button
                className="menuButton"
                type="button"
                aria-label="ファイルメニュー"
                aria-expanded={isFileMenuOpen}
                onClick={() => setIsFileMenuOpen((isOpen) => !isOpen)}
              >
                ☰
              </button>
              {isFileMenuOpen && (
                <div className="menuPopover fileMenuPopover" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => closeFileMenuAndRun(handleNewDocument)}
                  >
                    新規ファイル
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => closeFileMenuAndRun(handleOpenTextFile)}
                  >
                    ファイルを開く
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => closeFileMenuAndRun(saveCurrentDocument)}
                  >
                    保存
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => closeFileMenuAndRun(handleSaveAs)}
                  >
                    別名で保存
                  </button>
                  <div className="menuDivider" role="separator" />
                  <button
                    type="button"
                    role="menuitem"
                    disabled={openTabs.length <= 1}
                    onClick={() => closeFileMenuAndRun(() => activateRelativeDocumentTab(-1))}
                  >
                    前のタブ
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={openTabs.length <= 1}
                    onClick={() => closeFileMenuAndRun(() => activateRelativeDocumentTab(1))}
                  >
                    次のタブ
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => closeFileMenuAndRun(() => closeDocumentTab())}
                  >
                    タブを閉じる
                  </button>
                  <div className="menuDivider" role="separator" />
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => closeFileMenuAndRun(handleOpenProjectFolder)}
                  >
                    フォルダを開く
                  </button>
                </div>
              )}
            </div>
            {isLeftSidebarCollapsed && (
              <button
                className="iconButton"
                type="button"
                aria-label="左サイドバーを表示"
                title="左サイドバーを表示"
                onClick={() => setIsLeftSidebarCollapsed(false)}
              >
                <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <line x1="9" y1="3" x2="9" y2="21" />
                </svg>
              </button>
            )}
            <span className="appName">Then</span>
            <nav
              className="breadcrumbs"
              aria-label="パンくず"
              ref={breadcrumbMenuRef}
              onKeyDown={handleBreadcrumbKeyDown}
            >
              {projectFolder ? (
                breadcrumbTrail.map((crumb, index) => {
                  const isFolder =
                    "children" in crumb &&
                    (!("kind" in crumb) || crumb.kind === "folder");
                  const isLast = index === breadcrumbTrail.length - 1;
                  const children = isFolder
                    ? getFolderChildren(projectFolder, crumb.path)
                    : [];

                  return (
                    <div className="breadcrumbSegment" key={crumb.path}>
                      {index > 0 && <span className="crumbSeparator">›</span>}
                      {isFolder ? (
                        <div className="breadcrumbMenu">
                          <button
                            className="breadcrumbFolderButton"
                            type="button"
                            aria-label={`${crumb.name} の項目`}
                            aria-expanded={activeBreadcrumbPath === crumb.path}
                            onClick={() =>
                              setActiveBreadcrumbPath((path) =>
                                path === crumb.path ? null : crumb.path,
                              )
                            }
                            onContextMenu={(event) => {
                              event.preventDefault();
                              setActiveBreadcrumbPath(crumb.path);
                            }}
                          >
                            <span>{crumb.name}</span>
                          </button>
                          {activeBreadcrumbPath === crumb.path && (
                            <div className="menuPopover breadcrumbPopover" role="menu">
                              {children.length ? (
                                children.map((entry, entryIndex) => {
                                  const dropClass =
                                    breadcrumbDropTarget?.entryPath === entry.path
                                      ? `breadcrumbDrop-${breadcrumbDropTarget.position}`
                                      : "";
                                  return (
                                  <div
                                    className={`menuRow ${dropClass} ${
                                      draggingBreadcrumbEntryPath === entry.path
                                        ? "draggingBreadcrumbEntry"
                                        : ""
                                    }`}
                                    draggable
                                    key={entry.path}
                                    onDragStart={(event) =>
                                      handleBreadcrumbEntryDragStart(
                                        event,
                                        crumb.path,
                                        entry.path,
                                      )
                                    }
                                    onDragOver={(event) =>
                                      handleBreadcrumbEntryDragOver(
                                        event,
                                        crumb.path,
                                        entry.path,
                                      )
                                    }
                                    onDrop={(event) =>
                                      handleBreadcrumbEntryDrop(event, crumb.path, entry.path)
                                    }
                                    onDragEnd={handleBreadcrumbEntryDragEnd}
                                  >
                                    <button
                                      className={
                                        entry.path === currentFilePath
                                          ? "activeMenuItem breadcrumbPrimaryMenuItem"
                                          : "breadcrumbPrimaryMenuItem"
                                      }
                                      type="button"
                                      role="menuitem"
                                      onClick={() =>
                                        entry.kind === "file"
                                          ? closeBreadcrumbMenuAndRun(() =>
                                              handleProjectFileSelect(entry.path),
                                            )
                                          : void handleProjectFolderSelect(entry.path)
                                      }
                                    >
                                      <span
                                        className={
                                          entry.kind === "folder"
                                            ? "menuFolderIcon"
                                            : "menuFileIcon"
                                        }
                                        aria-hidden="true"
                                      />
                                      <span>{entry.name}</span>
                                    </button>
                                    <div className="breadcrumbRowTools" aria-label={`${entry.name} の操作`}>
                                    <button
                                      className="menuActionButton"
                                      type="button"
                                      aria-label={`${entry.name} を新しいタブで開く`}
                                      disabled={entry.kind !== "file"}
                                      onClick={() =>
                                        entry.kind === "file"
                                          ? closeBreadcrumbMenuAndRun(() =>
                                              handleProjectFileSelectInNewTab(entry.path),
                                            )
                                          : undefined
                                      }
                                    >
                                      +
                                    </button>
                                    <button
                                      className="menuActionButton"
                                      type="button"
                                      aria-label={`${entry.name} を上へ移動`}
                                      disabled={entryIndex === 0}
                                      onClick={() =>
                                        handleMoveProjectEntry(crumb.path, entry.path, -1)
                                      }
                                    >
                                      ↑
                                    </button>
                                    <button
                                      className="menuActionButton"
                                      type="button"
                                      aria-label={`${entry.name} を下へ移動`}
                                      disabled={entryIndex === children.length - 1}
                                      onClick={() =>
                                        handleMoveProjectEntry(crumb.path, entry.path, 1)
                                      }
                                    >
                                      ↓
                                    </button>
                                    <button
                                      className="menuActionButton"
                                      type="button"
                                      aria-label={`${entry.name} をリネーム`}
                                      onClick={() =>
                                        closeBreadcrumbMenuAndRun(() =>
                                          handleRenameProjectEntry(entry),
                                        )
                                      }
                                    >
                                      ✎
                                    </button>
                                    <button
                                      className="menuActionButton"
                                      type="button"
                                      aria-label={`${entry.name} を削除`}
                                      onClick={() =>
                                        closeBreadcrumbMenuAndRun(() =>
                                          handleDeleteProjectEntry(entry),
                                        )
                                      }
                                    >
                                      ×
                                    </button>
                                    </div>
                                  </div>
                                  );
                                })
                              ) : (
                                <span className="emptyMenuMessage">
                                  テキストファイルまたはフォルダがありません
                                </span>
                              )}
                              <div className="menuDivider" role="separator" />
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() =>
                                  closeBreadcrumbMenuAndRun(() =>
                                    handleCreateProjectFile(crumb.path),
                                  )
                                }
                              >
                                新規ファイルを作成
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() =>
                                  closeBreadcrumbMenuAndRun(() =>
                                    handleCreateProjectFolder(crumb.path),
                                  )
                                }
                              >
                                新規フォルダを作成
                              </button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="breadcrumbItem">
                          <span className={isLast ? "activeCrumb" : ""}>{crumb.name}</span>
                        </span>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="breadcrumbMenu">
                  <button
                    className="breadcrumbFolderButton"
                    type="button"
                    aria-label="フォルダを開く"
                    onClick={handleOpenProjectFolder}
                  >
                    <span>{scratchWorkspaceName}</span>
                  </button>
                </div>
              )}
              {!projectFolder && (
                <>
                  <span className="crumbSeparator">›</span>
                  <span className="breadcrumbItem">
                    <span className="activeCrumb">{currentFileName}</span>
                  </span>
                </>
              )}
              {currentFilePath && outlineItems.length > 0 && (
                <>
                  <span className="outlineSeparator">/</span>
                  {activeOutlineChain.map((item, index) => (
                    <div className="breadcrumbSegment" key={item.id}>
                      {index > 0 && <span className="crumbSeparator">›</span>}
                      <div className="breadcrumbMenu">
                        <button
                          className="breadcrumbFolderButton outlineCrumbButton"
                          type="button"
                          aria-label={`${item.title} のアウトライン`}
                          aria-expanded={isOutlineMenuOpen}
                          onClick={() => setIsOutlineMenuOpen((isOpen) => !isOpen)}
                        >
                          <span>{item.title}</span>
                        </button>
                        {isOutlineMenuOpen && index === activeOutlineChain.length - 1 && (
                          <div className="menuPopover outlinePopover" role="menu">
                            <label className="outlineSearch">
                              <span aria-hidden="true">⌕</span>
                              <input
                                value={outlineQuery}
                                onChange={(event) => setOutlineQuery(event.target.value)}
                                placeholder="見出しを検索"
                                type="search"
                              />
                            </label>
                            <div className="outlineList">
                              {filteredOutlineItems.map((outlineItem) => (
                                <button
                                  className="outlineMenuItem"
                                  key={outlineItem.id}
                                  style={{ paddingLeft: `${10 + (outlineItem.level - 1) * 18}px` }}
                                  type="button"
                                  role="menuitem"
                                  onClick={() => jumpToOutlineItem(outlineItem)}
                                >
                                  <span>{outlineItem.title}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </>
              )}
            </nav>
            <div className="topbarActions">
              {isRightSidebarCollapsed && (
                <button
                  className="iconButton"
                  type="button"
                  aria-label="右サイドバーを表示"
                  title="右サイドバーを表示"
                  onClick={() => setIsRightSidebarCollapsed(false)}
                >
                  <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <line x1="15" y1="3" x2="15" y2="21" />
                  </svg>
                </button>
              )}
              <button className="iconButton" type="button" aria-label="履歴">
                ↶
              </button>
              <button
                className="iconButton"
                type="button"
                aria-label="設定"
                onClick={() => setIsSettingsModalOpen(true)}
              >
                ⚙
              </button>
            </div>
          </header>

          <div className="workspace">
            {!isLeftSidebarCollapsed && (
              <WorkspaceSidebar
                projectFolder={projectFolder}
                currentFilePath={currentFilePath}
                currentFileName={currentFileName}
                focusedFolderPath={focusedFolderPath}
                outlineItems={filteredOutlineItems}
                outlineCount={outlineFlatItems.length}
                outlineQuery={outlineQuery}
                activeOutlineIds={activeOutlineIds}
                onOutlineQueryChange={setOutlineQuery}
                onJumpOutline={jumpToOutlineItem}
                onOpenProjectFolder={handleOpenProjectFolder}
                onNewDocument={handleNewDocument}
                onCreateFile={(folderPath) => void handleCreateProjectFile(folderPath)}
                onCreateFolder={(folderPath) => void handleCreateProjectFolder(folderPath)}
                onSelectFile={(path) => void handleProjectFileSelect(path)}
                onSelectFolder={(path) => void handleProjectFolderSelect(path)}
                onOpenFileInNewTab={(path) => void handleProjectFileSelectInNewTab(path)}
                onRenameEntry={(entry) => void handleRenameProjectEntry(entry)}
                onDeleteEntry={(entry) => void handleDeleteProjectEntry(entry)}
                onCollapse={() => setIsLeftSidebarCollapsed(true)}
              />
            )}
            <div className="editorColumn">
              <div className="editorFrame">
                <div
                  ref={editorShellRef}
                  className="editor"
                  onDragOverCapture={handleEditorDragOver}
                  onDragLeave={handleEditorDragLeave}
                  onDropCapture={handleEditorDrop}
                >
                  <div className="editorContent">
                    {workspaceAlert && (
                      <section className="workspaceAlert" role="alert">
                        <div>
                          <strong>{workspaceAlert.message}</strong>
                          <span>{workspaceAlert.path}</span>
                        </div>
                        <div className="workspaceAlertActions">
                          <button type="button" onClick={handleRetryWorkspaceRestore}>
                            再試行
                          </button>
                          <button type="button" onClick={handleOpenProjectFolder}>
                            別のフォルダを選択
                          </button>
                          <button type="button" onClick={handleForgetWorkspace}>
                            履歴から削除
                          </button>
                          <button type="button" onClick={() => setWorkspaceAlert(null)}>
                            閉じる
                          </button>
                        </div>
                      </section>
                    )}
                    {isNewTabStartPage ? (
                      <section className="newTabStart" aria-label="新しいタブ">
                        <div>
                          <p className="newTabEyebrow">New tab</p>
                          <h1>フォルダを開いて書き始める</h1>
                          <p>
                            作業するフォルダを選ぶと、テキストファイルとスニペットをこのタブで扱えます。
                          </p>
                        </div>
                        <div className="newTabActions">
                          <button type="button" onClick={handleOpenProjectFolder}>
                            フォルダを開く
                          </button>
                          <button type="button" onClick={handleOpenTextFile}>
                            テキストファイルを開く
                          </button>
                        </div>
                      </section>
                    ) : (
                      <>
                        <MetadataPanel
                          metadata={frontMatter.metadata}
                          hasFrontMatter={frontMatter.hasFrontMatter}
                          isOpen={isMetadataOpen}
                          onToggle={() => setIsMetadataOpen((current) => !current)}
                          onAddProperty={handleAddFrontMatterProperty}
                          onClear={handleClearFrontMatter}
                          onChange={handleFrontMatterChange}
                        />
                        {isHydrated && (
                          <VerticalTextEditor
                            key={documentKey}
                            text={editorText}
                            typewriterOffset={settings.typewriterOffset}
                            onReady={handleEditorReady}
                            onTextChange={handleTextChange}
                            onSelectionChange={handleSelectionChange}
                          />
                        )}
                      </>
                    )}
                  </div>
                  <div
                    className={`dropIndicator ${
                      dropIndicatorTop === null ? "" : "showDropIndicator"
                    }`}
                    style={dropIndicatorTop === null ? undefined : { top: dropIndicatorTop }}
                  />
                </div>
              </div>
              <StatusBar
                saveStatus={saveStatus}
                currentFilePath={currentFilePath}
                lastError={lastError}
                charCount={charCount}
              />
            </div>

            {!isRightSidebarCollapsed && (
              <aside
                className={`rightSidebar ${isRightSidebarWide ? "wideRightSidebar" : ""}`}
                aria-label="補助ペイン"
              >
                <div className="rightSidebarHeader">
                  <div className="rightTabs" role="tablist" aria-label="補助ペイン">
                    <button
                      className={`rightTab ${rightSidebarTab === "idea" ? "activeRightTab" : ""}`}
                      type="button"
                      role="tab"
                      aria-selected={rightSidebarTab === "idea"}
                      onClick={() => setRightSidebarTab("idea")}
                    >
                      Idea
                    </button>
                    <button
                      className={`rightTab ${rightSidebarTab === "plot" ? "activeRightTab" : ""}`}
                      type="button"
                      role="tab"
                      aria-selected={rightSidebarTab === "plot"}
                      onClick={() => setRightSidebarTab("plot")}
                    >
                      Plot
                    </button>
                  </div>
                  <button
                    className="sidebarIconButton"
                    type="button"
                    aria-label={isRightSidebarWide ? "ペイン幅を戻す" : "ペイン幅を拡張"}
                    title={isRightSidebarWide ? "ペイン幅を戻す" : "ペイン幅を拡張"}
                    onClick={() => setIsRightSidebarWide((isWide) => !isWide)}
                  >
                    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
                      <polyline points={isRightSidebarWide ? "9 18 15 12 9 6" : "15 18 9 12 15 6"} />
                    </svg>
                  </button>
                  <button
                    className="sidebarIconButton"
                    type="button"
                    aria-label="右サイドバーを畳む"
                    title="右サイドバーを畳む"
                    onClick={() => setIsRightSidebarCollapsed(true)}
                  >
                    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
                <div className="rightSidebarBody">
                  {rightSidebarTab === "plot" ? (
                    <PlotPane cards={plotCards} onCardsChange={setPlotCards} />
                  ) : (
                    <IdeaPane
                      snippets={filteredSnippets}
                      query={query}
                      draggingId={draggingId}
                      onQueryChange={setQuery}
                      onCreate={createIdea}
                      onTextChange={updateIdeaText}
                      onDragStart={handleSnippetDragStart}
                      onDragEnd={handleSnippetDragEnd}
                      onDoubleClick={handleSnippetDoubleClick}
                      onMove={moveSnippet}
                      onDelete={deleteSnippet}
                    />
                  )}
                </div>
              </aside>
            )}
          </div>

          <div className={`toast ${toast ? "showToast" : ""}`} role="status">
            {toast}
          </div>

          {appDialog && (
            <AppDialogModal
              dialog={appDialog}
              onClose={closeAppDialog}
              onSubmit={submitAppDialog}
              onValueChange={updateAppDialogValue}
            />
          )}

          {isSettingsModalOpen && (
            <SettingsModal
              settings={settings}
              systemFonts={systemFonts}
              onClose={() => setIsSettingsModalOpen(false)}
              onUpdateSettings={updateSettings}
              onSnippetStorageModeChange={(mode) =>
                void handleSnippetStorageModeChange(mode)
              }
            />
          )}
        </section>
      </main>
  );
}
