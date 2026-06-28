import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  ChangeEvent,
  DragEvent,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { VerticalTextEditor, type TextEditorHandle } from "./VerticalTextEditor";
import { AppDialogModal } from "./components/dialogs/AppDialogModal";
import { CommandPalette, type PaletteCommand } from "./components/dialogs/CommandPalette";
import { SettingsModal } from "./components/dialogs/SettingsModal";
import { ThemePickerModal } from "./components/dialogs/ThemePickerModal";
import { MetadataPanel } from "./components/editor/MetadataPanel";
import { WorkspaceSidebar } from "./components/layout/WorkspaceSidebar";
import {
  createDocumentAst,
  findActiveOutlineChain,
  flattenOutline,
  getLineNumberAtOffset,
} from "./editor/ast/documentAst";
import {
  moveHeadingSection,
  type HeadingDropPosition,
} from "./editor/ast/headingMove";
import {
  collectProjectTextFiles,
  createProjectAstSkeleton,
  markProjectAstFileError,
  searchProjectAst,
  upsertProjectAstDocument,
} from "./editor/ast/projectAst";
import { PlotPane } from "./components/plot/PlotPane";
import { IdeaPane } from "./components/snippets/IdeaPane";
import { StatusBar } from "./components/status/StatusBar";
import type {
  DocumentAst,
  DocumentOutlineItem,
  ProjectAst,
  ProjectSearchResult,
} from "./editor/ast/types";
import type {
  AppDialog,
  AppState,
  BreadcrumbDropTarget,
  CursorPosition,
  DocumentTab,
  EditorSettings,
  FileProgressStatus,
  FlatOutlineItem,
  FontOption,
  IdeaFragment,
  IdeaThread,
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
  appThemeValues,
  fileProgressStatuses,
  DEFAULT_NAVIGATOR_PREVIEW_LINES,
  NAVIGATOR_PREVIEW_LINE_CHOICES,
  UI_FONT_SCALE_MIN,
  UI_FONT_SCALE_MAX,
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
  removeNestedRecentWorkspaces,
  replaceFolderChildren,
  upsertRecentWorkspace,
} from "./utils/projectTree";
import { logHeadingDnd } from "./utils/headingDndDiagnostics";
import {
  exportFontFamilies,
  type LoadedExportSource,
} from "./export/types";

const SNIPPET_DRAG_MIME = "application/x-brew-snippet-id";
const BREADCRUMB_ENTRY_DRAG_MIME = "application/x-brew-project-entry-path";
const STORAGE_KEY = "then.app-state.v1";
const LEGACY_STORAGE_KEY = "brew.app-state.v1";
const scratchFileName = "無題.txt";
const newTabName = "新しいタブ";
const scratchWorkspaceName = "一時ファイル";
const isTauriRuntime = () => "__TAURI_INTERNALS__" in window;

type LayoutDirection = "start" | "center" | "end";

type WorkspaceSearchScope = "file" | "project";

type EditorSelectionSnapshot = {
  from: number;
  to: number;
  text: string;
};

type EditorContextMenuState = EditorSelectionSnapshot & {
  x: number;
  y: number;
};

type QueuedDocumentSave = {
  tabId: string;
  path: string;
  content: string;
  waiters: Array<{
    resolve: (document: TextDocument) => void;
    reject: (error: unknown) => void;
  }>;
};

type DocumentSaveRequest = Omit<QueuedDocumentSave, "waiters">;

type DocumentSaveQueue = {
  running: boolean;
  pending: QueuedDocumentSave | null;
};

type HeadingMoveDocuments = {
  sourceDocument: TextDocument;
  targetDocument: TextDocument | null;
};

type NotationModalState =
  | {
      type: "ruby";
      selection: EditorSelectionSnapshot;
      reading: string;
      error: string;
    }
  | {
      type: "direction";
      selection: EditorSelectionSnapshot;
    };

const customNotationSpecs = [
  {
    id: "ruby",
    label: "ルビ",
    syntax: "[本文(rb,ルビ)]",
    description: "選択範囲に読みを付けます",
  },
  {
    id: "tcy",
    label: "縦中横",
    syntax: "[本文(tcy)]",
    description: "選択範囲を縦書き中の横組みにします",
  },
  {
    id: "emphasis",
    label: "圏点",
    syntax: "[本文(em,goma)]",
    description: "選択範囲に圏点を付けます",
  },
  {
    id: "direction",
    label: "文章方向",
    syntax: "[(al:start|center|end)]",
    description: "右クリック位置または選択範囲を含む行の文末に配置指示を付けます",
  },
] as const;

const directionOptions: Array<{
  value: LayoutDirection;
  label: string;
  description: string;
}> = [
  { value: "start", label: "行頭", description: "対象行の文末に行頭揃え指示を付けます" },
  { value: "center", label: "中央", description: "対象行の文末に中央揃え指示を付けます" },
  { value: "end", label: "行末", description: "対象行の文末に行末揃え指示を付けます" },
];

type AppIconName =
  | "book"
  | "export"
  | "file"
  | "folder"
  | "horizontal"
  | "menu"
  | "panelLeft"
  | "panelRight"
  | "settings"
  | "theme"
  | "vertical";

function AppIcon({ name, className = "" }: { name: AppIconName; className?: string }) {
  const common = {
    className,
    viewBox: "0 0 24 24",
    "aria-hidden": true,
    focusable: false,
  };

  switch (name) {
    case "book":
      return (
        <svg {...common}>
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
      );
    case "export":
      return (
        <svg {...common}>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <path d="M7 10l5 5 5-5" />
          <path d="M12 15V3" />
        </svg>
      );
    case "file":
      return (
        <svg {...common}>
          <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" />
          <path d="M14 2v6h6" />
        </svg>
      );
    case "folder":
      return (
        <svg {...common}>
          <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2h6.5A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" />
        </svg>
      );
    case "horizontal":
      return (
        <svg {...common}>
          <path d="M4 7h16" />
          <path d="M4 12h16" />
          <path d="M4 17h10" />
        </svg>
      );
    case "menu":
      return (
        <svg {...common}>
          <path d="M4 6h16" />
          <path d="M4 12h16" />
          <path d="M4 18h16" />
        </svg>
      );
    case "panelLeft":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M9 3v18" />
        </svg>
      );
    case "panelRight":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M15 3v18" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.04.04a2 2 0 1 1-2.83 2.83l-.04-.04a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.06A1.7 1.7 0 0 0 8.97 19.4a1.7 1.7 0 0 0-1.88.34l-.04.04a2 2 0 1 1-2.83-2.83l.04-.04A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.06A1.7 1.7 0 0 0 4.6 8.97a1.7 1.7 0 0 0-.34-1.88l-.04-.04a2 2 0 1 1 2.83-2.83l.04.04A1.7 1.7 0 0 0 8.97 4.6 1.7 1.7 0 0 0 10 3.06V3a2 2 0 1 1 4 0v.06a1.7 1.7 0 0 0 1.03 1.54 1.7 1.7 0 0 0 1.88-.34l.04-.04a2 2 0 1 1 2.83 2.83l-.04.04a1.7 1.7 0 0 0-.34 1.88A1.7 1.7 0 0 0 20.94 10H21a2 2 0 1 1 0 4h-.06A1.7 1.7 0 0 0 19.4 15z" />
        </svg>
      );
    case "theme":
      return (
        <svg {...common}>
          <circle cx="13.5" cy="6.5" r="2.5" />
          <circle cx="7.5" cy="10.5" r="2.5" />
          <circle cx="16.5" cy="14.5" r="2.5" />
          <path d="M12 22a9 9 0 1 1 8.8-10.9 2.4 2.4 0 0 1-2.35 2.9H17a2 2 0 0 0 0 4h.35A2.4 2.4 0 0 1 19.7 21 9.1 9.1 0 0 1 12 22z" />
        </svg>
      );
    case "vertical":
      return (
        <svg {...common}>
          <path d="M7 4v16" />
          <path d="M12 4v16" />
          <path d="M17 4v10" />
        </svg>
      );
    default:
      return null;
  }
}

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

const INBOX_THREAD_ID = "idea-inbox";

let ideaIdCounter = 0;

function nextIdeaId(prefix: string): string {
  ideaIdCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${ideaIdCounter}`;
}

function makeIdeaFragment(body: string, used = false): IdeaFragment {
  const now = Date.now();
  return { id: nextIdeaId("frag"), body, used, createdAt: now, updatedAt: now };
}

function makeInboxThread(fragments: IdeaFragment[] = []): IdeaThread {
  const now = Date.now();
  return {
    id: INBOX_THREAD_ID,
    kind: "inbox",
    title: "インボックス",
    starred: false,
    createdAt: now,
    updatedAt: now,
    fragments,
  };
}

const defaultPlotCards: PlotCard[] = [
  {
    id: "plot-1",
    kind: "section",
    num: "001",
    title: "縦書きプロットテストです",
    body: "",
    expanded: false,
    managerCollapsed: false,
  },
  {
    id: "plot-2",
    kind: "section",
    num: "002",
    title: "縦書きプロットテストです",
    body: "",
    expanded: false,
    managerCollapsed: false,
  },
  {
    id: "plot-3",
    kind: "section",
    num: "003",
    title: "縦書きプロットテストです",
    body: "これは縦書きプロットテストです。ちゃんと書けていることを確かめるためにあります。",
    expanded: false,
    managerCollapsed: false,
  },
];

function defaultIdeaThreads(): IdeaThread[] {
  const now = Date.now();
  return [
    makeInboxThread([
      makeIdeaFragment("主人公が改札の前で一瞬立ち止まる描写を入れる。"),
      makeIdeaFragment("風呂のシーンはテンポよく、1分で終わらせる緊張感を持たせたい。"),
    ]),
    {
      id: "idea-sample-scene",
      kind: "thread",
      title: "旅立ちの朝（場面）",
      starred: false,
      createdAt: now,
      updatedAt: now,
      fragments: [
        makeIdeaFragment("夜明けの光が、山の稜線を白く縁どり始めた頃。"),
        makeIdeaFragment("主人公は決断する。しかしその足は、一歩踏み出すことを躊躇っていた。"),
      ],
    },
    {
      id: "idea-sample-foreshadow",
      kind: "thread",
      title: "老人の台詞（伏線）",
      starred: false,
      createdAt: now,
      updatedAt: now,
      fragments: [
        makeIdeaFragment("「お前には、まだ知らないことがある」老人は静かに言った。"),
      ],
    },
  ];
}

/** 値を {@link IdeaThread}[] へ正規化する。旧フラット Snippet[] からの移行も担う。 */
function normalizeIdeaThreads(value: unknown): IdeaThread[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [makeInboxThread()];
  }

  const looksLegacy = value.some(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      "text" in (entry as Record<string, unknown>) &&
      !("fragments" in (entry as Record<string, unknown>)),
  );

  let threads: IdeaThread[];
  if (looksLegacy) {
    const fragments = (value as Snippet[])
      .map((snippet) =>
        makeIdeaFragment(
          typeof snippet?.text === "string" && snippet.text.trim()
            ? snippet.text
            : String(snippet?.title ?? "").trim(),
        ),
      )
      .filter((fragment) => fragment.body.trim().length > 0);
    threads = [makeInboxThread(fragments)];
  } else {
    threads = (value as Array<Partial<IdeaThread>>)
      .filter((thread) => thread && typeof thread === "object")
      .map((thread) => {
        const now = Date.now();
        const fragments = Array.isArray(thread.fragments)
          ? thread.fragments
              .filter((fragment) => fragment && typeof fragment.body === "string")
              .map((fragment) => ({
                id: typeof fragment.id === "string" ? fragment.id : nextIdeaId("frag"),
                body: fragment.body,
                used: Boolean(fragment.used),
                createdAt:
                  typeof fragment.createdAt === "number" ? fragment.createdAt : now,
                updatedAt:
                  typeof fragment.updatedAt === "number" ? fragment.updatedAt : now,
              }))
          : [];
        return {
          id: typeof thread.id === "string" ? thread.id : nextIdeaId("thread"),
          kind: thread.kind === "inbox" ? "inbox" : "thread",
          title: typeof thread.title === "string" ? thread.title : "スレッド",
          starred: Boolean(thread.starred),
          createdAt: typeof thread.createdAt === "number" ? thread.createdAt : now,
          updatedAt: typeof thread.updatedAt === "number" ? thread.updatedAt : now,
          fragments,
        } satisfies IdeaThread;
      });
  }

  // インボックスを必ず1つ、先頭に置く。
  const inboxes = threads.filter((thread) => thread.kind === "inbox");
  const others = threads.filter((thread) => thread.kind !== "inbox");
  const inbox =
    inboxes.length > 0
      ? { ...inboxes[0], id: INBOX_THREAD_ID, fragments: inboxes.flatMap((t) => t.fragments) }
      : makeInboxThread();
  return [inbox, ...others];
}

const defaultSettings: EditorSettings = {
  theme: "dark",
  editorFontFamily: toCssFontFamilyValue("Noto Serif JP"),
  uiFontFamily: toCssFontFamilyValue("Segoe UI"),
  uiFontScale: 1,
  exportFontFamily: "Noto Serif CJK JP",
  fontSize: 15,
  lineHeight: 1.82,
  writingMode: "vertical-rl",
  typewriterScroll: true,
  typewriterOffset: 46,
  showLineBreakMarks: false,
  snippetStorageMode: "workspace",
  sidebarMode: "tree",
  showWorkspacePaths: true,
  navigatorPreviewLines: DEFAULT_NAVIGATOR_PREVIEW_LINES,
  countWhitespace: true,
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
    editorRevision: null,
    saveStatus: options.saveStatus ?? "dirty",
    documentKey: options.documentKey ?? id,
    activeOutlineLine: null,
  };
}

function normalizePathForCompare(path: string): string {
  return path.replace(/[\\/]+/g, "\\").replace(/\\+$/, "").toLocaleLowerCase();
}

function isSamePath(left: string, right: string): boolean {
  return normalizePathForCompare(left) === normalizePathForCompare(right);
}

function isPathInsideFolder(path: string, folderPath: string): boolean {
  const normalizedPath = normalizePathForCompare(path);
  const normalizedFolder = normalizePathForCompare(folderPath);
  return (
    normalizedPath !== normalizedFolder &&
    normalizedPath.startsWith(`${normalizedFolder}\\`)
  );
}

function createFileDocumentTab(document: TextDocument): DocumentTab {
  return {
    id: `file:${document.path}`,
    kind: "file",
    path: document.path,
    name: document.name,
    markdown: document.content,
    savedMarkdown: document.content,
    editorRevision: null,
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
  const threads = defaultIdeaThreads();
  return {
    markdown: initialMarkdown,
    snippets: threads,
    profileSnippets: threads,
    settings: defaultSettings,
    lastWorkspacePath: null,
    lastFilePath: null,
    recentWorkspaces: [],
    fileProgress: {},
    cursorPositions: {},
  };
}

/** 空白文字（半角・全角スペース、タブ、改行など）を除いた文字（コードポイント）。 */
const WHITESPACE_PATTERN = /[\s　]/g;

/**
 * 文字数カウント。`includeWhitespace` が false の場合は空白文字を除外する。
 * サロゲートペアを 1 文字として数えるため Array.from を用いる。
 */
function countDisplayCharacters(text: string, includeWhitespace: boolean): number {
  const target = includeWhitespace ? text : text.replace(WHITESPACE_PATTERN, "");
  return Array.from(target).length;
}


function normalizePlotCards(value: unknown): PlotCard[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((card): card is Partial<PlotCard> & { id: string } =>
      Boolean(card) && typeof card === "object" && typeof card.id === "string",
    )
    .map((card, index) => {
      const kind = card.kind === "chapter" ? "chapter" : "section";
      return {
        id: card.id,
        kind,
        num:
          kind === "chapter"
            ? ""
            : typeof card.num === "string" && card.num.trim()
              ? card.num
              : String(index + 1).padStart(3, "0"),
        title: typeof card.title === "string" ? card.title : "",
        body: typeof card.body === "string" ? card.body : "",
        expanded: Boolean(card.expanded),
        managerCollapsed: Boolean(card.managerCollapsed),
      };
    });
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

function normalizeSelectionRange(
  selection: { from: number; to: number },
  text: string,
): EditorSelectionSnapshot {
  const from = Math.max(0, Math.min(text.length, Math.min(selection.from, selection.to)));
  const to = Math.max(from, Math.min(text.length, Math.max(selection.from, selection.to)));

  return {
    from,
    to,
    text: text.slice(from, to),
  };
}

function sanitizeNotationArgument(value: string): string {
  return value.replace(/[\r\n\])]/g, " ").replace(/\s+/g, " ").trim();
}

function canWrapInlineSelection(selection: EditorSelectionSnapshot): boolean {
  return selection.from < selection.to && !selection.text.includes("\n");
}

function stripDirectionMarkers(line: string): string {
  return line.replace(/\[\(al:(?:start|center|end)\)\]/g, "").replace(/^>>\s*/, "");
}

function applyDirectionToLine(line: string, direction: LayoutDirection): string {
  const cleaned = stripDirectionMarkers(line);
  return `${cleaned}[(al:${direction})]`;
}

function applyDirectionToSelection(
  text: string,
  selection: EditorSelectionSnapshot,
  direction: LayoutDirection,
): { from: number; to: number; insert: string; cursorPos: number } {
  const rangeStart = selection.from;
  const rangeEnd = selection.to > selection.from ? selection.to : selection.from;
  const start = text.lastIndexOf("\n", Math.max(0, rangeStart - 1)) + 1;
  const normalizedEnd = rangeEnd > rangeStart && text[rangeEnd - 1] === "\n"
    ? rangeEnd - 1
    : rangeEnd;
  const nextBreak = text.indexOf("\n", normalizedEnd);
  const end = nextBreak === -1 ? text.length : nextBreak;
  const insert = text
    .slice(start, end)
    .split("\n")
    .map((line) => applyDirectionToLine(line, direction))
    .join("\n");

  return {
    from: start,
    to: end,
    insert,
    cursorPos: start + insert.length,
  };
}

function rangesTouch(
  selectionFrom: number,
  selectionTo: number,
  markupFrom: number,
  markupTo: number,
): boolean {
  if (selectionFrom === selectionTo) {
    return markupFrom <= selectionFrom && selectionFrom <= markupTo;
  }

  return markupFrom < selectionTo && markupTo > selectionFrom;
}

function pushClearReplacement(
  replacements: Array<{ from: number; to: number; insert: string }>,
  from: number,
  to: number,
  insert: string,
): void {
  if (to <= from) return;
  if (replacements.some((item) => from < item.to && to > item.from)) return;
  replacements.push({ from, to, insert });
}

function clearNotationInLine(
  line: string,
  selectionFrom: number,
  selectionTo: number,
): { text: string; changed: boolean } {
  const replacements: Array<{ from: number; to: number; insert: string }> = [];
  let match: RegExpExecArray | null;

  const layout = /\[([^\[\]\n]*?)\s*\((rb|em|tcy)(?:,([^)]*))?\)\]/g;
  while ((match = layout.exec(line))) {
    const full = match[0];
    const from = match.index;
    const to = from + full.length;
    if (rangesTouch(selectionFrom, selectionTo, from, to)) {
      pushClearReplacement(replacements, from, to, match[1].replace(/\s+$/, ""));
    }
  }

  const pipeRuby = /｜([^《》｜]+)《([^《》]+)》/g;
  while ((match = pipeRuby.exec(line))) {
    const from = match.index;
    const to = from + match[0].length;
    if (rangesTouch(selectionFrom, selectionTo, from, to)) {
      pushClearReplacement(replacements, from, to, match[1]);
    }
  }

  const kanjiRuby = /([一-龠々〆ヶ]+)《([^《》]+)》/g;
  while ((match = kanjiRuby.exec(line))) {
    const from = match.index;
    const to = from + match[0].length;
    if (rangesTouch(selectionFrom, selectionTo, from, to)) {
      pushClearReplacement(replacements, from, to, match[1]);
    }
  }

  const emphasis = /《《([^《》]+)》》/g;
  while ((match = emphasis.exec(line))) {
    const from = match.index;
    const to = from + match[0].length;
    if (rangesTouch(selectionFrom, selectionTo, from, to)) {
      pushClearReplacement(replacements, from, to, match[1]);
    }
  }

  const bold = /\*\*([^*]+)\*\*/g;
  while ((match = bold.exec(line))) {
    const from = match.index;
    const to = from + match[0].length;
    if (rangesTouch(selectionFrom, selectionTo, from, to)) {
      pushClearReplacement(replacements, from, to, match[1]);
    }
  }

  const align = /\[\(al:(?:start|center|end)\)\]/g;
  while ((match = align.exec(line))) {
    pushClearReplacement(replacements, match.index, match.index + match[0].length, "");
  }

  if (replacements.length === 0) {
    return { text: line, changed: false };
  }

  replacements.sort((left, right) => right.from - left.from);
  let next = line;
  for (const replacement of replacements) {
    next = `${next.slice(0, replacement.from)}${replacement.insert}${next.slice(replacement.to)}`;
  }

  return { text: next, changed: true };
}

function clearNotationFromSelection(
  text: string,
  selection: EditorSelectionSnapshot,
): { from: number; to: number; insert: string; cursorPos: number; changed: boolean } {
  const rangeStart = selection.from;
  const rangeEnd = selection.to > selection.from ? selection.to : selection.from;
  const start = text.lastIndexOf("\n", Math.max(0, rangeStart - 1)) + 1;
  const normalizedEnd = rangeEnd > rangeStart && text[rangeEnd - 1] === "\n"
    ? rangeEnd - 1
    : rangeEnd;
  const nextBreak = text.indexOf("\n", normalizedEnd);
  const end = nextBreak === -1 ? text.length : nextBreak;
  const lines = text.slice(start, end).split("\n");
  let offset = start;
  let changed = false;

  const insert = lines
    .map((line) => {
      const lineStart = offset;
      const lineEnd = lineStart + line.length;
      offset = lineEnd + 1;
      const localFrom = Math.max(0, Math.min(line.length, selection.from - lineStart));
      const localTo = selection.from === selection.to
        ? localFrom
        : Math.max(0, Math.min(line.length, selection.to - lineStart));
      const result = clearNotationInLine(line, localFrom, localTo);
      changed = changed || result.changed;
      return result.text;
    })
    .join("\n");

  return {
    from: start,
    to: end,
    insert,
    cursorPos: Math.min(start + insert.length, selection.from),
    changed,
  };
}

type SelectionEdit = {
  from: number;
  to: number;
  insert: string;
  cursorPos: number;
};

/** Ctrl+B 用。選択範囲を `**…**` で囲む／外すトグル。複数行は対象外。 */
function toggleBoldSelection(
  text: string,
  selection: EditorSelectionSnapshot,
): SelectionEdit | null {
  const { from, to } = selection;
  if (from === to) {
    return { from, to, insert: "****", cursorPos: from + 2 };
  }

  const inner = text.slice(from, to);
  if (inner.includes("\n")) return null;

  if (text.slice(from - 2, from) === "**" && text.slice(to, to + 2) === "**") {
    return { from: from - 2, to: to + 2, insert: inner, cursorPos: from - 2 + inner.length };
  }

  if (inner.length >= 4 && inner.startsWith("**") && inner.endsWith("**")) {
    const stripped = inner.slice(2, -2);
    return { from, to, insert: stripped, cursorPos: from + stripped.length };
  }

  const insert = `**${inner}**`;
  return { from, to, insert, cursorPos: from + insert.length };
}

/** Ctrl+I 用。選択範囲に圏点 `[…(em,goma)]` を付ける／外すトグル。複数行は対象外。 */
function toggleEmphasisSelection(
  text: string,
  selection: EditorSelectionSnapshot,
): SelectionEdit | null {
  const { from, to } = selection;
  if (from >= to) return null;

  const inner = text.slice(from, to);
  if (inner.includes("\n")) return null;

  const enclosed = text.slice(to).match(/^\(em[^)]*\)\]/);
  if (text[from - 1] === "[" && enclosed) {
    return {
      from: from - 1,
      to: to + enclosed[0].length,
      insert: inner,
      cursorPos: from - 1 + inner.length,
    };
  }

  const selfMatch = inner.match(/^\[(.+)\(em[^)]*\)\]$/);
  if (selfMatch) {
    return { from, to, insert: selfMatch[1], cursorPos: from + selfMatch[1].length };
  }

  const insert = `[${inner}(em,goma)]`;
  return { from, to, insert, cursorPos: from + insert.length };
}

/**
 * Ctrl+数字 用。選択範囲を含む各行の見出しレベルを設定する。
 * `level` が 0 の場合は見出しマーカーを除去する。
 */
function applyHeadingToSelection(
  text: string,
  selection: EditorSelectionSnapshot,
  level: number,
): SelectionEdit {
  const rangeStart = selection.from;
  const rangeEnd = selection.to > selection.from ? selection.to : selection.from;
  const start = text.lastIndexOf("\n", Math.max(0, rangeStart - 1)) + 1;
  const normalizedEnd =
    rangeEnd > rangeStart && text[rangeEnd - 1] === "\n" ? rangeEnd - 1 : rangeEnd;
  const nextBreak = text.indexOf("\n", normalizedEnd);
  const end = nextBreak === -1 ? text.length : nextBreak;

  const insert = text
    .slice(start, end)
    .split("\n")
    .map((line) => {
      const body = line.replace(/^#{1,6}[ \t]*/, "");
      if (level <= 0) return body;
      return `${"#".repeat(Math.min(6, level))} ${body}`;
    })
    .join("\n");

  return { from: start, to: end, insert, cursorPos: start + insert.length };
}

function replaceLiteralMatches(
  text: string,
  rawQuery: string,
  replacement: string,
): { text: string; count: number } {
  const query = rawQuery.trim();
  if (!query) return { text, count: 0 };

  const haystack = text.toLocaleLowerCase();
  const needle = query.toLocaleLowerCase();
  const chunks: string[] = [];
  let from = 0;
  let count = 0;

  while (from <= text.length) {
    const index = haystack.indexOf(needle, from);
    if (index < 0) break;
    chunks.push(text.slice(from, index), replacement);
    from = index + query.length;
    count += 1;
  }

  if (count === 0) return { text, count: 0 };
  chunks.push(text.slice(from));
  return { text: chunks.join(""), count };
}

function replaceMarkdownBodyMatches(
  markdown: string,
  query: string,
  replacement: string,
): { markdown: string; count: number } {
  const frontMatter = parseFrontMatter(markdown);
  const result = replaceLiteralMatches(frontMatter.body, query, replacement);
  if (result.count === 0) return { markdown, count: 0 };
  return {
    markdown: updateMarkdownBody(markdown, result.text),
    count: result.count,
  };
}

function collectDocumentSearchMatches(
  documentAst: DocumentAst,
  rawQuery: string,
  path: string | null,
  name: string,
  maxResults = 80,
): ProjectSearchResult[] {
  const query = rawQuery.trim();
  if (!query) return [];

  const normalizedQuery = query.toLocaleLowerCase();
  const results: ProjectSearchResult[] = [];

  for (const block of documentAst.blocks) {
    const source = block.source;
    const normalizedSource = source.toLocaleLowerCase();
    let from = 0;
    let matchIndex = 0;

    while (from <= normalizedSource.length) {
      const index = normalizedSource.indexOf(normalizedQuery, from);
      if (index < 0) break;

      const line = block.lineIndex + 1;
      const headingChain = findActiveOutlineChain(documentAst.outline, line);
      results.push({
        id: `current:${path ?? "scratch"}:${line}:${index}:${matchIndex}:${normalizedQuery}`,
        kind: "fullText",
        path: path ?? "",
        name,
        line,
        column: index + 1,
        title: headingChain[headingChain.length - 1]?.title ?? null,
        excerpt: source,
        headingChain,
        matchStart: index,
        matchLength: query.length,
        score: index === 0 ? 70 : 50,
      });

      if (results.length >= maxResults) return results;
      from = index + Math.max(1, normalizedQuery.length);
      matchIndex += 1;
    }
  }

  return results;
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

  const profileSnippets = normalizeIdeaThreads(
    Array.isArray(value?.profileSnippets)
      ? value.profileSnippets
      : Array.isArray(value?.snippets)
        ? value.snippets
        : defaultIdeaThreads(),
  );

  return {
    markdown: typeof value?.markdown === "string" ? value.markdown : initialMarkdown,
    snippets: Array.isArray(value?.snippets)
      ? normalizeIdeaThreads(value.snippets)
      : profileSnippets,
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
      uiFontScale:
        typeof settings.uiFontScale === "number" && Number.isFinite(settings.uiFontScale)
          ? Math.min(UI_FONT_SCALE_MAX, Math.max(UI_FONT_SCALE_MIN, settings.uiFontScale))
          : defaultSettings.uiFontScale,
      exportFontFamily: exportFontFamilies.some(
        (fontFamily) => fontFamily === settings.exportFontFamily,
      )
        ? settings.exportFontFamily as EditorSettings["exportFontFamily"]
        : defaultSettings.exportFontFamily,
      snippetStorageMode:
        settings.snippetStorageMode === "profile" ? "profile" : "workspace",
      sidebarMode: settings.sidebarMode === "navigator" ? "navigator" : "tree",
      showWorkspacePaths:
        typeof settings.showWorkspacePaths === "boolean"
          ? settings.showWorkspacePaths
          : defaultSettings.showWorkspacePaths,
      navigatorPreviewLines: NAVIGATOR_PREVIEW_LINE_CHOICES.includes(
        settings.navigatorPreviewLines as number,
      )
        ? (settings.navigatorPreviewLines as number)
        : DEFAULT_NAVIGATOR_PREVIEW_LINES,
      theme: appThemeValues.includes(settings.theme as EditorSettings["theme"])
        ? (settings.theme as EditorSettings["theme"])
        : "dark",
      countWhitespace:
        typeof settings.countWhitespace === "boolean"
          ? settings.countWhitespace
          : defaultSettings.countWhitespace,
      writingMode:
        settings.writingMode === "horizontal-tb" || settings.writingMode === "vertical-rl"
          ? settings.writingMode
          : defaultSettings.writingMode,
    },
    lastWorkspacePath:
      typeof value?.lastWorkspacePath === "string" ? value.lastWorkspacePath : null,
    lastFilePath: typeof value?.lastFilePath === "string" ? value.lastFilePath : null,
    recentWorkspaces,
    fileProgress: normalizeFileProgress(value?.fileProgress),
    cursorPositions: normalizeCursorPositions(value?.cursorPositions),
  };
}

function normalizeCursorPositions(
  value: unknown,
): Record<string, CursorPosition> {
  if (!value || typeof value !== "object") return {};
  const result: Record<string, CursorPosition> = {};
  for (const [path, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof path !== "string" || !entry || typeof entry !== "object") continue;
    const { offset, length } = entry as Partial<CursorPosition>;
    if (
      typeof offset === "number" &&
      Number.isFinite(offset) &&
      offset >= 0 &&
      typeof length === "number" &&
      Number.isFinite(length) &&
      length >= 0
    ) {
      result[path] = { offset: Math.floor(offset), length: Math.floor(length) };
    }
  }
  return result;
}

function normalizeFileProgress(
  value: unknown,
): Record<string, FileProgressStatus> {
  if (!value || typeof value !== "object") return {};
  const result: Record<string, FileProgressStatus> = {};
  for (const [path, status] of Object.entries(value as Record<string, unknown>)) {
    if (
      typeof path === "string" &&
      fileProgressStatuses.includes(status as FileProgressStatus)
    ) {
      result[path] = status as FileProgressStatus;
    }
  }
  return result;
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

async function loadWorkspaceSnippets(folderPath: string): Promise<IdeaThread[]> {
  if (!isTauriRuntime()) return defaultIdeaThreads();
  const loaded = await invoke<IdeaThread[]>("load_project_snippets", { rootPath: folderPath });
  return loaded.length ? normalizeIdeaThreads(loaded) : defaultIdeaThreads();
}

async function saveWorkspaceSnippets(folderPath: string, snippets: IdeaThread[]): Promise<void> {
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
  const activeTabIdRef = useRef("initial-document-tab");
  const documentSaveQueuesRef = useRef<Map<string, DocumentSaveQueue>>(new Map());
  const headingMoveInProgressRef = useRef(false);
  const toastTimerRef = useRef<number | null>(null);
  const typewriterScrollFrameRef = useRef<number | null>(null);
  const draggingSnippetRef = useRef<{
    threadId: string;
    fragmentId: string;
    body: string;
  } | null>(null);
  const editorInstanceRef = useRef<TextEditorHandle | null>(null);
  const editorShellRef = useRef<HTMLDivElement | null>(null);
  const editorContextMenuRef = useRef<HTMLDivElement | null>(null);
  const fileMenuRef = useRef<HTMLDivElement | null>(null);
  const breadcrumbMenuRef = useRef<HTMLDivElement | null>(null);
  const didMountEditorRef = useRef(false);
  const suppressNextEditorUpdateRef = useRef(false);
  const lastSavedMarkdownRef = useRef(initialMarkdown);
  const breadcrumbDragEntryRef = useRef<{ folderPath: string; entryPath: string } | null>(null);
  const projectAstBuildIdRef = useRef(0);
  const activeDocumentSnapshotRef = useRef<{
    path: string | null;
    name: string;
    text: string;
  } | null>(null);

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
  activeTabIdRef.current = activeTabId;
  const [projectFolder, setProjectFolder] = useState<ProjectFolder | null>(null);
  const [projectAst, setProjectAst] = useState<ProjectAst | null>(null);
  const [snippetWorkspacePath, setSnippetWorkspacePath] = useState<string | null>(null);
  const [plotWorkspacePath, setPlotWorkspacePath] = useState<string | null>(null);
  const [plotCards, setPlotCards] = useState<PlotCard[]>(() => defaultPlotCards);
  const [focusedFolderPath, setFocusedFolderPath] = useState<string | null>(null);
  const [workspaceAlert, setWorkspaceAlert] = useState<WorkspaceAlert>(null);
  const [outlineQuery, setOutlineQuery] = useState("");
  const [projectSearchQuery, setProjectSearchQuery] = useState("");
  const [searchScope, setSearchScope] = useState<WorkspaceSearchScope>("project");
  const [projectReplaceValue, setProjectReplaceValue] = useState("");
  const [isProjectReplacing, setIsProjectReplacing] = useState(false);
  const [isProjectSearchMode, setIsProjectSearchMode] = useState(false);
  const [toast, setToast] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [draggingBreadcrumbEntryPath, setDraggingBreadcrumbEntryPath] =
    useState<string | null>(null);
  const [breadcrumbDropTarget, setBreadcrumbDropTarget] =
    useState<BreadcrumbDropTarget>(null);
  const [charCount, setCharCount] = useState(0);
  const [editorSelectionHead, setEditorSelectionHead] = useState(0);
  const [editorContextMenu, setEditorContextMenu] =
    useState<EditorContextMenuState | null>(null);
  const [notationModal, setNotationModal] = useState<NotationModalState | null>(null);
  const [dropIndicatorTop, setDropIndicatorTop] = useState<number | null>(null);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isThemePickerModalOpen, setIsThemePickerModalOpen] = useState(false);
  const [shouldReturnToSettingsAfterThemePicker, setShouldReturnToSettingsAfterThemePicker] =
    useState(false);
  const [isFileMenuOpen, setIsFileMenuOpen] = useState(false);
  const [activeBreadcrumbPath, setActiveBreadcrumbPath] = useState<string | null>(null);
  const [isWorkspaceSwitcherOpen, setIsWorkspaceSwitcherOpen] = useState(false);
  const [workspaceSwitcherQuery, setWorkspaceSwitcherQuery] = useState("");
  const [collapsedWorkspaceFolderPaths, setCollapsedWorkspaceFolderPaths] =
    useState<ReadonlySet<string>>(() => new Set());
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
  const visibleRecentWorkspaces = useMemo(() => {
    const normalizedQuery = workspaceSwitcherQuery.trim().toLocaleLowerCase();
    if (!normalizedQuery) return appState.recentWorkspaces;
    return appState.recentWorkspaces.filter((workspace) =>
      `${workspace.name}\n${workspace.path}`.toLocaleLowerCase().includes(normalizedQuery),
    );
  }, [appState.recentWorkspaces, workspaceSwitcherQuery]);
  const findKnownParentWorkspace = useCallback(
    (path: string): WorkspaceRecord | null => {
      const candidates = new Map<string, WorkspaceRecord>();
      if (projectFolder) {
        candidates.set(normalizePathForCompare(projectFolder.path), {
          path: projectFolder.path,
          name: projectFolder.name,
          lastOpenedAt: Date.now(),
        });
      }
      for (const workspace of appState.recentWorkspaces) {
        candidates.set(normalizePathForCompare(workspace.path), workspace);
      }

      return Array.from(candidates.values())
        .filter((workspace) => isPathInsideFolder(path, workspace.path))
        .sort((left, right) => right.path.length - left.path.length)[0] ?? null;
    },
    [appState.recentWorkspaces, projectFolder],
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
  const setActiveMarkdown = useCallback(
    (nextMarkdown: string, editorRevision: number | null = null) => {
      patchActiveTab((tab) => ({ ...tab, markdown: nextMarkdown, editorRevision }));
      setAppState((current) =>
        current.markdown === nextMarkdown ? current : { ...current, markdown: nextMarkdown },
      );
    },
    [patchActiveTab],
  );
  const markActiveTabSaved = useCallback(
    (savedMarkdown: string, name?: string) => {
      lastSavedMarkdownRef.current = savedMarkdown;
      patchActiveTab((tab) => {
        const savedLatestRevision = tab.markdown === savedMarkdown;
        return {
          ...tab,
          savedMarkdown,
          name: name ?? tab.name,
          saveStatus: savedLatestRevision ? "saved" : "dirty",
        };
      });
    },
    [patchActiveTab],
  );

  const enqueueDocumentSave = useCallback((request: DocumentSaveRequest): Promise<TextDocument> => {
    return new Promise<TextDocument>((resolve, reject) => {
      const queues = documentSaveQueuesRef.current;
      let queue = queues.get(request.tabId);
      const queuedRequest: QueuedDocumentSave = {
        ...request,
        waiters: [{ resolve, reject }],
      };

      if (!queue) {
        queue = { running: false, pending: null };
        queues.set(request.tabId, queue);
      }

      if (queue.running) {
        if (queue.pending) queuedRequest.waiters.push(...queue.pending.waiters);
        queue.pending = queuedRequest;
        return;
      }

      const runQueue = async (firstRequest: QueuedDocumentSave) => {
        if (!queue) return;
        queue.running = true;
        let currentRequest: QueuedDocumentSave | null = firstRequest;

        while (currentRequest) {
          const savingRequest: QueuedDocumentSave = currentRequest;
          setOpenTabs((current) =>
            current.map((tab) =>
              tab.id === savingRequest.tabId ? { ...tab, saveStatus: "saving" } : tab,
            ),
          );

          try {
            const document = await invoke<TextDocument>("save_text_file", {
              path: savingRequest.path,
              content: savingRequest.content,
            });

            if (activeTabIdRef.current === savingRequest.tabId) {
              lastSavedMarkdownRef.current = document.content;
            }

            setOpenTabs((current) =>
              current.map((tab) => {
                if (tab.id !== savingRequest.tabId) return tab;
                const savedLatestRevision = tab.markdown === document.content;
                return {
                  ...tab,
                  savedMarkdown: document.content,
                  name: document.name,
                  saveStatus: savedLatestRevision ? "saved" : "dirty",
                };
              }),
            );
            setLastError("");
            savingRequest.waiters.forEach((waiter) => waiter.resolve(document));
          } catch (error) {
            setLastError(String(error));
            setOpenTabs((current) =>
              current.map((tab) =>
                tab.id === savingRequest.tabId ? { ...tab, saveStatus: "error" } : tab,
              ),
            );
            savingRequest.waiters.forEach((waiter) => waiter.reject(error));
          }

          currentRequest = queue.pending;
          queue.pending = null;
        }

        queue.running = false;
        queues.delete(request.tabId);
      };

      void runQueue(queuedRequest);
    });
  }, []);

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
  activeDocumentSnapshotRef.current = {
    path: currentFilePath,
    name: currentFileName,
    text: editorText,
  };
  // 前回終了時のカーソル位置。保存時点の本文長が現在と一致する場合のみ復元し、
  // 外部編集などで食い違う場合は先頭へフォールバックする。
  const initialSelectionOffset = useMemo(() => {
    if (!currentFilePath) return 0;
    const saved = appState.cursorPositions[currentFilePath];
    if (!saved || saved.length !== editorText.length) return 0;
    return Math.min(saved.offset, editorText.length);
  }, [appState.cursorPositions, currentFilePath, editorText]);
  const activeDocumentAst = useMemo(
    () =>
      createDocumentAst({
        path: currentFilePath,
        name: currentFileName,
        text: editorText,
      }),
    [currentFileName, currentFilePath, editorText],
  );
  const outlineItems = activeDocumentAst.outline;
  const outlineFlatItems = useMemo<FlatOutlineItem[]>(
    () => flattenOutline(outlineItems),
    [outlineItems],
  );
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
  const currentFileSearchResults = useMemo(
    () =>
      collectDocumentSearchMatches(
        activeDocumentAst,
        projectSearchQuery,
        currentFilePath,
        currentFileName,
      ),
    [activeDocumentAst, currentFileName, currentFilePath, projectSearchQuery],
  );
  const projectSearchResults = useMemo(
    () => searchProjectAst(projectAst, projectSearchQuery, "fullText"),
    [projectAst, projectSearchQuery],
  );
  const workspaceSearchResults = useMemo(
    () => (searchScope === "file" ? currentFileSearchResults : projectSearchResults),
    [currentFileSearchResults, projectSearchResults, searchScope],
  );
  const breadcrumbTrail = useMemo(
    () => findPathToEntry(projectFolder, currentFilePath),
    [currentFilePath, projectFolder],
  );

  useEffect(() => {
    if (!projectFolder) {
      projectAstBuildIdRef.current += 1;
      setProjectAst(null);
      setProjectSearchQuery("");
      return;
    }

    setProjectAst((current) => createProjectAstSkeleton(projectFolder, current));
  }, [projectFolder]);

  useEffect(() => {
    if (!projectFolder || !currentFilePath) return;
    if (!findProjectEntry(projectFolder.children, currentFilePath)) return;

    setProjectAst((current) =>
      current && current.rootPath === projectFolder.path
        ? upsertProjectAstDocument(current, {
            path: currentFilePath,
            name: currentFileName,
            text: editorText,
          })
        : current,
    );
  }, [currentFileName, currentFilePath, editorText, projectFolder]);

  useEffect(() => {
    if (!isHydrated || !isTauriRuntime() || !projectFolder) return;

    const files = collectProjectTextFiles(projectFolder);
    if (!files.length) return;

    let isCancelled = false;
    const buildId = projectAstBuildIdRef.current + 1;
    projectAstBuildIdRef.current = buildId;
    setProjectAst((current) => createProjectAstSkeleton(projectFolder, current));

    const indexFiles = async () => {
      for (const file of files) {
        if (isCancelled || projectAstBuildIdRef.current !== buildId) return;

        const activeSnapshot = activeDocumentSnapshotRef.current;
        if (activeSnapshot?.path === file.path) {
          setProjectAst((current) =>
            current && current.rootPath === projectFolder.path
              ? upsertProjectAstDocument(current, {
                  path: file.path,
                  name: activeSnapshot.name || file.name,
                  text: activeSnapshot.text,
                })
              : current,
          );
          continue;
        }

        try {
          const document = await invoke<TextDocument>("read_text_file", { path: file.path });
          if (isCancelled || projectAstBuildIdRef.current !== buildId) return;

          const latestActiveSnapshot = activeDocumentSnapshotRef.current;
          const text =
            latestActiveSnapshot?.path === document.path
              ? latestActiveSnapshot.text
              : parseFrontMatter(document.content).body;
          const name =
            latestActiveSnapshot?.path === document.path
              ? latestActiveSnapshot.name
              : document.name;

          setProjectAst((current) =>
            current && current.rootPath === projectFolder.path
              ? upsertProjectAstDocument(current, {
                  path: document.path,
                  name,
                  text,
                })
              : current,
          );
        } catch (error) {
          if (isCancelled || projectAstBuildIdRef.current !== buildId) return;
          setProjectAst((current) =>
            current && current.rootPath === projectFolder.path
              ? markProjectAstFileError(current, file.path, error)
              : current,
          );
        }
      }
    };

    void indexFiles();

    return () => {
      isCancelled = true;
    };
  }, [isHydrated, projectFolder]);

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
              removeNestedRecentWorkspaces(state.recentWorkspaces, folder.path),
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

  // カーソル位置の記憶。移動が落ち着いた後に現在ファイルの位置を保存する。
  useEffect(() => {
    if (!isHydrated || !currentFilePath) return;
    const path = currentFilePath;
    const offset = editorSelectionHead;
    const length = editorText.length;

    const timer = window.setTimeout(() => {
      setAppState((current) => {
        const previous = current.cursorPositions[path];
        if (previous && previous.offset === offset && previous.length === length) {
          return current;
        }
        return {
          ...current,
          cursorPositions: { ...current.cursorPositions, [path]: { offset, length } },
        };
      });
    }, 600);

    return () => window.clearTimeout(timer);
  }, [currentFilePath, editorSelectionHead, editorText, isHydrated]);

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
      void enqueueDocumentSave({
        tabId: activeTabId,
        path: currentFilePath,
        content: markdown,
      }).catch(() => undefined);
    }, 700);

    return () => window.clearTimeout(timer);
  }, [activeTabId, currentFilePath, enqueueDocumentSave, isHydrated, markdown, setSaveStatus]);

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
        setIsWorkspaceSwitcherOpen(false);
      }
      if (!editorContextMenuRef.current?.contains(target)) {
        setEditorContextMenu(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setIsFileMenuOpen(false);
      setActiveBreadcrumbPath(null);
      setIsWorkspaceSwitcherOpen(false);
      setEditorContextMenu(null);
      setNotationModal(null);
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
      setIsWorkspaceSwitcherOpen(false);
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

  const handleTextChange = useCallback((nextText: string, editorRevision: number) => {
    didMountEditorRef.current = true;
    setCharCount(countDisplayCharacters(nextText, settings.countWhitespace));
    if (suppressNextEditorUpdateRef.current) {
      suppressNextEditorUpdateRef.current = false;
      return;
    }
    const nextFullText = updateMarkdownBody(markdown, nextText);
    if (markdown !== nextFullText) {
      setActiveMarkdown(nextFullText, editorRevision);
    }
    if (!currentFilePath) {
      setSaveStatus("dirty");
    }
  }, [currentFilePath, markdown, setActiveMarkdown, setSaveStatus, settings.countWhitespace]);

  useEffect(() => {
    setCharCount(countDisplayCharacters(editorText, settings.countWhitespace));
  }, [editorText, settings.countWhitespace]);

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
    // 選択変化に伴うタイプライター再センタリングはエディタ内部に一本化した。
    // App 側の scheduleTypewriterScroll は設定・オフセット変更時の再適用専用に残す。
  }, []);

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

  const closeEditorContextMenu = () => {
    setEditorContextMenu(null);
  };

  const writeClipboardText = async (text: string) => {
    if (!navigator.clipboard?.writeText) {
      throw new Error("Clipboard write is not available");
    }
    await navigator.clipboard.writeText(text);
  };

  const readClipboardText = async () => {
    if (!navigator.clipboard?.readText) {
      throw new Error("Clipboard read is not available");
    }
    return navigator.clipboard.readText();
  };

  const handleEditorContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (!target?.closest(".verticalTypewriterShell")) return;

    const editor = editorInstanceRef.current;
    if (!editor) return;

    event.preventDefault();
    setIsFileMenuOpen(false);
    setActiveBreadcrumbPath(null);
    setIsWorkspaceSwitcherOpen(false);
    setIsOutlineMenuOpen(false);

    const currentText = editor.getValue();
    let snapshot = normalizeSelectionRange(editor.getSelection(), currentText);
    if (snapshot.from === snapshot.to) {
      const pointOffset = editor.positionFromPoint(event.clientX, event.clientY);
      if (pointOffset !== null) {
        snapshot = normalizeSelectionRange({ from: pointOffset, to: pointOffset }, currentText);
      }
    }

    setEditorContextMenu({
      ...snapshot,
      x: Math.min(event.clientX, window.innerWidth - 236),
      y: Math.min(event.clientY, window.innerHeight - 292),
    });
  };

  const copyEditorSelection = async (selection: EditorSelectionSnapshot | null) => {
    if (!selection || selection.from === selection.to) {
      showToast("コピーする範囲を選択してください");
      return;
    }

    try {
      await writeClipboardText(selection.text);
      showToast("コピーしました");
    } catch {
      showToast("クリップボードへコピーできませんでした");
    } finally {
      closeEditorContextMenu();
    }
  };

  const cutEditorSelection = async (selection: EditorSelectionSnapshot | null) => {
    const editor = editorInstanceRef.current;
    if (!editor || !selection || selection.from === selection.to) {
      showToast("切り取る範囲を選択してください");
      return;
    }

    try {
      await writeClipboardText(selection.text);
      editor.replaceRange(selection.from, selection.to, "", selection.from);
      editor.focus();
      showToast("切り取りました");
    } catch {
      showToast("クリップボードへ切り取れませんでした");
    } finally {
      closeEditorContextMenu();
    }
  };

  const pasteIntoEditorSelection = async (selection: EditorSelectionSnapshot | null) => {
    const editor = editorInstanceRef.current;
    if (!editor || !selection) return;

    try {
      const pastedText = await readClipboardText();
      if (!pastedText) return;
      editor.replaceRange(
        selection.from,
        selection.to,
        pastedText,
        selection.from + pastedText.length,
      );
      editor.focus();
      showToast("貼り付けました");
    } catch {
      showToast("クリップボードから貼り付けできませんでした");
    } finally {
      closeEditorContextMenu();
    }
  };

  const applyInlineNotation = (
    selection: EditorSelectionSnapshot,
    notation: "ruby" | "tcy" | "emphasis",
    argument = "",
  ) => {
    const editor = editorInstanceRef.current;
    if (!editor) return false;

    const currentSelection = normalizeSelectionRange(selection, editor.getValue());
    if (!canWrapInlineSelection(currentSelection)) {
      showToast("単一行の範囲を選択してください");
      return false;
    }

    const arg = sanitizeNotationArgument(argument);
    if (notation === "ruby" && !arg) {
      setNotationModal((current) =>
        current?.type === "ruby" ? { ...current, error: "ルビを入力してください" } : current,
      );
      return false;
    }

    const method =
      notation === "ruby" ? `rb,${arg}` : notation === "emphasis" ? "em,goma" : "tcy";
    const insert = `[${currentSelection.text}(${method})]`;

    editor.replaceRange(
      currentSelection.from,
      currentSelection.to,
      insert,
      currentSelection.from + insert.length,
    );
    editor.focus();
    showToast(`${customNotationSpecs.find((item) => item.id === notation)?.label}を反映しました`);
    return true;
  };

  const applyDirectionNotation = (
    selection: EditorSelectionSnapshot,
    direction: LayoutDirection,
  ) => {
    const editor = editorInstanceRef.current;
    if (!editor) return false;

    const currentText = editor.getValue();
    const currentSelection = normalizeSelectionRange(selection, currentText);
    const replacement = applyDirectionToSelection(currentText, currentSelection, direction);

    editor.replaceRange(
      replacement.from,
      replacement.to,
      replacement.insert,
      replacement.cursorPos,
    );
    editor.focus();
    showToast("文章方向を反映しました");
    return true;
  };

  const clearSelectionNotation = (selection: EditorSelectionSnapshot | null) => {
    const editor = editorInstanceRef.current;
    if (!editor || !selection) return false;

    const currentText = editor.getValue();
    const currentSelection = normalizeSelectionRange(selection, currentText);
    const replacement = clearNotationFromSelection(currentText, currentSelection);

    if (!replacement.changed) {
      showToast("クリアできる記法がありません");
      closeEditorContextMenu();
      return false;
    }

    editor.replaceRange(
      replacement.from,
      replacement.to,
      replacement.insert,
      replacement.cursorPos,
    );
    editor.focus();
    showToast("記法をクリアしました");
    closeEditorContextMenu();
    return true;
  };

  // --- キーボードショートカット / コマンドパレット用の編集アクション ---
  // いずれも現在のエディタ選択をその場で読み取って適用する。

  const getCurrentEditorSelection = (): EditorSelectionSnapshot | null => {
    const editor = editorInstanceRef.current;
    if (!editor) return null;
    return normalizeSelectionRange(editor.getSelection(), editor.getValue());
  };

  const applyBoldShortcut = () => {
    const editor = editorInstanceRef.current;
    if (!editor) return;
    const text = editor.getValue();
    const selection = normalizeSelectionRange(editor.getSelection(), text);
    const edit = toggleBoldSelection(text, selection);
    if (!edit) {
      showToast("太字にする単一行の範囲を選択してください");
      return;
    }
    editor.replaceRange(edit.from, edit.to, edit.insert, edit.cursorPos);
    editor.focus();
  };

  const applyEmphasisShortcut = () => {
    const editor = editorInstanceRef.current;
    if (!editor) return;
    const text = editor.getValue();
    const selection = normalizeSelectionRange(editor.getSelection(), text);
    const edit = toggleEmphasisSelection(text, selection);
    if (!edit) {
      showToast("圏点を付ける単一行の範囲を選択してください");
      return;
    }
    editor.replaceRange(edit.from, edit.to, edit.insert, edit.cursorPos);
    editor.focus();
  };

  const applyHeadingShortcut = (level: number) => {
    const editor = editorInstanceRef.current;
    if (!editor) return;
    const text = editor.getValue();
    const selection = normalizeSelectionRange(editor.getSelection(), text);
    const edit = applyHeadingToSelection(text, selection, level);
    editor.replaceRange(edit.from, edit.to, edit.insert, edit.cursorPos);
    editor.focus();
    showToast(level <= 0 ? "見出しを解除しました" : `見出し${level}を設定しました`);
  };

  // 最新のクロージャを常に参照するため、ハンドラ本体は ref 経由で呼び出す。
  const editorShortcutHandlerRef = useRef<(event: KeyboardEvent) => void>(() => {});
  editorShortcutHandlerRef.current = (event: KeyboardEvent) => {
    const mod = event.ctrlKey || event.metaKey;
    if (!mod || event.altKey) return;
    const key = event.key;

    // Ctrl+P：コマンドパレット。印刷ダイアログの既定動作を抑止する。
    if (key === "p" || key === "P") {
      event.preventDefault();
      setIsCommandPaletteOpen((open) => !open);
      return;
    }

    // 以降はエディタにフォーカスがある場合のみ。
    const editorFocused = Boolean(
      (document.activeElement as Element | null)?.closest?.(".pm-root"),
    );
    if (!editorFocused) return;

    if (key === "b" || key === "B") {
      event.preventDefault();
      applyBoldShortcut();
    } else if (key === "i" || key === "I") {
      event.preventDefault();
      applyEmphasisShortcut();
    } else if (/^[0-6]$/.test(key)) {
      event.preventDefault();
      applyHeadingShortcut(Number(key));
    }
  };

  useEffect(() => {
    const listener = (event: KeyboardEvent) => editorShortcutHandlerRef.current(event);
    window.addEventListener("keydown", listener, { capture: true });
    return () => window.removeEventListener("keydown", listener, { capture: true });
  }, []);

  const openRubyNotationModal = (selection: EditorSelectionSnapshot | null) => {
    if (!selection || !canWrapInlineSelection(selection)) {
      showToast("ルビを付ける単一行の範囲を選択してください");
      closeEditorContextMenu();
      return;
    }
    setNotationModal({ type: "ruby", selection, reading: "", error: "" });
    closeEditorContextMenu();
  };

  const openDirectionNotationModal = (selection: EditorSelectionSnapshot | null) => {
    if (!selection) return;
    setNotationModal({ type: "direction", selection });
    closeEditorContextMenu();
  };

  const submitRubyNotation = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (notationModal?.type !== "ruby") return;
    if (applyInlineNotation(notationModal.selection, "ruby", notationModal.reading)) {
      setNotationModal(null);
    }
  };

  const chooseDirectionNotation = (direction: LayoutDirection) => {
    if (notationModal?.type !== "direction") return;
    if (applyDirectionNotation(notationModal.selection, direction)) {
      setNotationModal(null);
    }
  };

  const buildPaletteCommands = (): PaletteCommand[] => {
    const selection = getCurrentEditorSelection();
    const canWrap = selection ? canWrapInlineSelection(selection) : false;
    const wrapDisabled = canWrap ? undefined : "単一行の範囲を選択してください";

    const headingCommands: PaletteCommand[] = [1, 2, 3, 4, 5, 6].map((level) => ({
      id: `heading-${level}`,
      label: `見出し${level}`,
      hint: `Ctrl+${level}`,
      run: () => applyHeadingShortcut(level),
    }));
    const workspaceCommands: PaletteCommand[] = [
      {
        id: "workspace-open",
        label: "別のプロジェクトを開く...",
        hint: "Workspace",
        run: () => void openWorkspace(),
      },
      ...appState.recentWorkspaces.map((workspace) => ({
        id: `workspace-open-${workspace.path}`,
        label: `プロジェクトを開く: ${workspace.name}`,
        hint: settings.showWorkspacePaths ? workspace.path : "Workspace",
        run: () => void openWorkspace(workspace.path),
      })),
    ];

    return [
      { id: "bold", label: "太字", hint: "Ctrl+B", run: applyBoldShortcut },
      {
        id: "emphasis",
        label: "圏点（傍点）",
        hint: "Ctrl+I",
        disabledReason: wrapDisabled,
        run: applyEmphasisShortcut,
      },
      {
        id: "ruby",
        label: "ルビ…",
        hint: customNotationSpecs[0].syntax,
        disabledReason: wrapDisabled,
        run: () => openRubyNotationModal(getCurrentEditorSelection()),
      },
      {
        id: "tcy",
        label: "縦中横",
        hint: customNotationSpecs[1].syntax,
        disabledReason: wrapDisabled,
        run: () => {
          const target = getCurrentEditorSelection();
          if (target) applyInlineNotation(target, "tcy");
        },
      },
      ...headingCommands,
      { id: "heading-clear", label: "見出しを解除", hint: "Ctrl+0", run: () => applyHeadingShortcut(0) },
      {
        id: "direction",
        label: "文章方向…",
        hint: customNotationSpecs[3].syntax,
        run: () => openDirectionNotationModal(getCurrentEditorSelection()),
      },
      {
        id: "clear-notation",
        label: "記法をクリア",
        run: () => clearSelectionNotation(getCurrentEditorSelection()),
      },
      ...workspaceCommands,
    ];
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

  const requestChoice = ({
    title,
    message,
    detail,
    primaryLabel,
    secondaryLabel,
  }: {
    title: string;
    message: string;
    detail?: string;
    primaryLabel: string;
    secondaryLabel: string;
  }) =>
    new Promise<"primary" | "secondary" | null>((resolve) => {
      setAppDialog({
        type: "choice",
        title,
        message,
        detail,
        primaryLabel,
        secondaryLabel,
        resolve,
      });
    });

  const closeAppDialog = () => {
    setAppDialog((current) => {
      if (!current) return null;
      if (current.type === "input") {
        current.resolve(null);
      } else if (current.type === "confirm") {
        current.resolve(false);
      } else {
        current.resolve(null);
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
      if (current.type === "choice") {
        current.resolve("primary");
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

  const chooseAppDialog = (value: "primary" | "secondary") => {
    setAppDialog((current) => {
      if (current?.type !== "choice") return current;
      current.resolve(value);
      return null;
    });
  };

  const confirmDiscardDirtyWorkspace = async () => {
    const dirtyTabs = openTabs.filter(isDirtyDocumentTab);
    if (dirtyTabs.length === 0) return true;
    return requestConfirm({
      title: "未保存の変更があります",
      message:
        dirtyTabs.length === 1
          ? "現在の変更を破棄してプロジェクトを切り替えますか？"
          : `${dirtyTabs.length}個のタブに未保存の変更があります。破棄してプロジェクトを切り替えますか？`,
      detail: dirtyTabs.map((tab) => tab.name).join(" / "),
      confirmLabel: "破棄して切り替え",
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
    }));
    setLastError("");
  }, [openDocumentInTab, projectFolder, replaceActiveTabWithDocument]);

  const setWorkspaceFromDocumentPath = useCallback(
    async (document: TextDocument, options: { loadWorkspaceSnippets?: boolean } = {}) => {
      if (!isTauriRuntime()) return null;
      const folderPath =
        projectFolder && findContainingFolderPath(projectFolder, document.path)
          ? projectFolder.path
          : getParentPath(document.path);
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
      }));
      return folder;
    },
    [projectFolder, settings.snippetStorageMode],
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

  const toggleWorkspaceFolderCollapse = useCallback((path: string) => {
    setCollapsedWorkspaceFolderPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleWorkspaceFolderTreeSelect = useCallback(
    async (path: string) => {
      if (!projectFolder || !isTauriRuntime()) return;

      try {
        const folder = await refreshProjectFolder(path);
        const selectedFolder =
          folder?.path === path
            ? folder
            : folder
              ? findProjectEntry(folder.children, path)
              : null;
        setFocusedFolderPath(path);
        setActiveBreadcrumbPath(null);
        setIsWorkspaceSwitcherOpen(false);
        showToast(`「${selectedFolder?.name ?? getWorkspaceName(path)}」へ移動しました`);
      } catch (error) {
        setLastError(String(error));
        setSaveStatus("error");
      }
    },
    [projectFolder, refreshProjectFolder],
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
        ? await enqueueDocumentSave({
            tabId: activeTabId,
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

  const handleOpenLinkedExport = async () => {
    if (!isTauriRuntime()) {
      showToast("エクスポート画面はTauri版で利用できます");
      return;
    }

    setLastError("");
    try {
      const projectFiles = projectFolder ? collectProjectTextFiles(projectFolder) : [];
      const candidates = projectFiles.length > 0
        ? projectFiles
        : [{ path: currentFilePath ?? "", name: currentFileName }];
      const sources: LoadedExportSource[] = [];
      const readErrors: string[] = [];

      for (const [index, file] of candidates.entries()) {
        try {
          const openTab = openTabs.find((tab) => tab.path === file.path);
          const rawContent = file.path
            ? openTab?.markdown ?? (await invoke<TextDocument>("read_text_file", { path: file.path })).content
            : markdown;
          const content = parseFrontMatter(rawContent).body;
          const extension = file.name.match(/\.([^.]+)$/)?.[1]?.toLowerCase() ?? "txt";
          sources.push({
            id: file.path || `active-document-${index}`,
            path: file.path,
            extension,
            displayName: file.name,
            chars: content.replace(/\s/g, "").length,
            enabled: true,
            order: index,
            startMode: index === 0 ? "continue" : "new-page",
            markupMode: "then-markup",
            content,
          });
        } catch (error) {
          readErrors.push(`${file.name}: ${String(error)}`);
        }
      }

      if (sources.length === 0) throw new Error(readErrors.join("\n") || "出力できる本文ファイルがありません");
      const workspaceTitle = projectFolder?.name
        ?? currentFileName.replace(/\.(?:txt|md)$/i, "")
        ?? "本文連結";
      await invoke("open_export_window", {
        payload: {
          requestId: String(Date.now()),
          title: workspaceTitle,
          sources,
          sourceError: readErrors.length > 0 ? readErrors.join("\n") : undefined,
        },
      });
    } catch (error) {
      setLastError(String(error));
    }
  };

  const openWorkspaceFolder = async (
    folder: ProjectFolder,
    options: { focusFolderPath?: string | null } = {},
  ) => {
    const focusedPath = options.focusFolderPath ?? folder.path;
    const focusedEntry =
      focusedPath && !isSamePath(focusedPath, folder.path)
        ? findProjectEntry(folder.children, focusedPath)
        : null;
    const preferredFiles =
      focusedEntry?.kind === "folder" ? focusedEntry.children : folder.children;

    setProjectFolder(folder);
    setWorkspaceAlert(null);
    setFocusedFolderPath(focusedPath);
    setWorkspaceSwitcherQuery("");

    const restoredSnippets =
      settings.snippetStorageMode === "workspace"
        ? await loadWorkspaceSnippets(folder.path)
        : snippets;
    const restoredPlotCards = await loadWorkspacePlotCards(folder.path);
    setSnippetWorkspacePath(settings.snippetStorageMode === "workspace" ? folder.path : null);
    setPlotWorkspacePath(folder.path);
    setPlotCards(restoredPlotCards);

    const firstFile = findFirstTextFile(preferredFiles) ?? findFirstTextFile(folder.children);
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
      const nextTab = createFileDocumentTab(document);
      setOpenTabs([nextTab]);
      syncDocumentTabToEditor(nextTab);
      setFocusedFolderPath(focusedPath);
      setAppState((current) => ({
        ...current,
        snippets: restoredSnippets,
        markdown: document.content,
        lastWorkspacePath: folder.path,
        lastFilePath: document.path,
        recentWorkspaces: upsertRecentWorkspace(
          removeNestedRecentWorkspaces(current.recentWorkspaces, folder.path),
          folder.path,
          folder.name,
        ),
      }));
      return;
    }

    const nextTab = createScratchDocumentTab("", {
      documentKey: `workspace-empty-${Date.now()}`,
      saveStatus: "saved",
      savedMarkdown: "",
    });
    setOpenTabs([nextTab]);
    syncDocumentTabToEditor(nextTab);
    setFocusedFolderPath(focusedPath);
    setAppState((current) => ({
      ...current,
      snippets: restoredSnippets,
      markdown: "",
      lastWorkspacePath: folder.path,
      lastFilePath: null,
      recentWorkspaces: upsertRecentWorkspace(
        removeNestedRecentWorkspaces(current.recentWorkspaces, folder.path),
        folder.path,
        folder.name,
      ),
    }));
  };

  async function openWorkspace(
    path?: string,
    options: { skipKnownParentPrompt?: boolean } = {},
  ) {
    if (!isTauriRuntime()) {
      showToast("フォルダを開く機能はTauri版で利用できます");
      return;
    }
    if (!(await confirmDiscardDirtyWorkspace())) return;

    const previousSaveStatus = saveStatus;
    setSaveStatus("loading");
    try {
      debugLog(path ? "before invoke list_project_text_files" : "before invoke open_project_folder_dialog");
      const folder = path
        ? await invoke<ProjectFolder>("list_project_text_files", { folderPath: path })
        : await invoke<ProjectFolder | null>("open_project_folder_dialog");
      debugLog("after invoke open_project_folder_dialog", {
        selected: Boolean(folder),
        path: folder?.path ?? null,
        children: folder?.children.length ?? 0,
      });
      if (!folder) {
        setSaveStatus(previousSaveStatus);
        return;
      }

      let folderToOpen = folder;
      let focusFolderPath: string | null = null;
      if (!path && !options.skipKnownParentPrompt) {
        const parentWorkspace = findKnownParentWorkspace(folder.path);
        if (parentWorkspace) {
          const choice = await requestChoice({
            title: "フォルダの開き方",
            message: `「${folder.name}」は「${parentWorkspace.name}」内のフォルダです。`,
            detail:
              "独立プロジェクトとして開くと、このフォルダ自身に .then/project.json が作られ、スニペットやプロットも別管理になります。",
            primaryLabel: `${parentWorkspace.name} を開いて移動`,
            secondaryLabel: `${folder.name} を独立プロジェクトとして開く`,
          });
          if (!choice) {
            setSaveStatus(previousSaveStatus);
            return;
          }
          if (choice === "primary") {
            folderToOpen = await invoke<ProjectFolder>("list_project_text_files", {
              folderPath: parentWorkspace.path,
            });
            focusFolderPath = folder.path;
          }
        }
      }

      debugLog("before setProjectFolder", {
        path: folderToOpen.path,
        children: folderToOpen.children.length,
      });
      await openWorkspaceFolder(folderToOpen, { focusFolderPath });
      setIsWorkspaceSwitcherOpen(false);
      showToast(
        focusFolderPath
          ? `「${folderToOpen.name}」内の「${folder.name}」へ移動しました`
          : `「${folderToOpen.name}」を開きました`,
      );
    } catch (error) {
      setLastError(String(error));
      setSaveStatus("error");
    }
  }

  const handleOpenProjectFolder = async () => {
    await openWorkspace();
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
          removeNestedRecentWorkspaces(current.recentWorkspaces, folder.path),
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

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let dispose: (() => void) | undefined;
    void listen<string>("then-open-export-source", (event) => {
      void handleProjectFileSelect(event.payload);
    }).then((unlisten) => { dispose = unlisten; });
    return () => dispose?.();
  }, [currentFilePath, openTabs]);

  const jumpToEditorLine = (line: number) => {
    const targetLine = Math.max(1, line);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        editorInstanceRef.current?.jumpToLine(targetLine);
        editorInstanceRef.current?.focus();
      });
    });
  };

  const handleProjectSearchResultOpen = async (result: ProjectSearchResult) => {
    if (result.path && result.path !== currentFilePath) {
      await handleProjectFileSelect(result.path);
    }
    jumpToEditorLine(result.line);
    showToast(`「${result.name}」${result.line}行へ移動しました`);
  };

  const handleReplaceInCurrentFile = () => {
    if (!projectSearchQuery.trim()) {
      showToast("検索語句を入力してください");
      return;
    }

    const result = replaceMarkdownBodyMatches(markdown, projectSearchQuery, projectReplaceValue);
    if (result.count === 0) {
      showToast("置換できる一致がありません");
      return;
    }

    setActiveMarkdown(result.markdown);
    setSaveStatus("dirty");
    showToast(`${result.count}件をファイル内で置換しました`);
  };

  const handleReplaceInProject = async () => {
    if (!projectFolder) {
      showToast("先にフォルダを開いてください");
      return;
    }
    if (!isTauriRuntime()) {
      showToast("プロジェクト置換はTauri版で利用できます");
      return;
    }
    if (!projectSearchQuery.trim()) {
      showToast("検索語句を入力してください");
      return;
    }

    const shouldReplace = await requestConfirm({
      title: "プロジェクト全体を置換",
      message: "開いているフォルダ内のテキストファイルを保存しながら置換します。",
      detail: `検索: ${projectSearchQuery} / 置換: ${projectReplaceValue || "空文字"}`,
      confirmLabel: "置換",
      danger: true,
    });
    if (!shouldReplace) return;

    setIsProjectReplacing(true);
    setLastError("");
    try {
      const files = collectProjectTextFiles(projectFolder);
      const savedDocuments: TextDocument[] = [];
      let totalCount = 0;

      for (const file of files) {
        const openTab = openTabs.find((tab) => tab.path === file.path);
        const sourceMarkdown =
          openTab?.path === currentFilePath
            ? markdown
            : openTab?.markdown ??
              (await invoke<TextDocument>("read_text_file", { path: file.path })).content;
        const result = replaceMarkdownBodyMatches(
          sourceMarkdown,
          projectSearchQuery,
          projectReplaceValue,
        );
        if (result.count === 0) continue;

        const document = await invoke<TextDocument>("save_text_file", {
          path: file.path,
          content: result.markdown,
        });
        savedDocuments.push(document);
        totalCount += result.count;
        setProjectAst((current) =>
          current && current.rootPath === projectFolder.path
            ? upsertProjectAstDocument(current, {
                path: document.path,
                name: document.name,
                text: parseFrontMatter(document.content).body,
              })
            : current,
        );
      }

      if (!savedDocuments.length) {
        showToast("置換できる一致がありません");
        return;
      }

      const savedByPath = new Map(savedDocuments.map((document) => [document.path, document]));
      setOpenTabs((current) =>
        current.map((tab) => {
          if (!tab.path) return tab;
          const document = savedByPath.get(tab.path);
          if (!document) return tab;
          return {
            ...tab,
            markdown: document.content,
            savedMarkdown: document.content,
            editorRevision: null,
            name: document.name,
            saveStatus: "saved",
          };
        }),
      );

      const activeSavedDocument = currentFilePath ? savedByPath.get(currentFilePath) : null;
      if (activeSavedDocument) {
        lastSavedMarkdownRef.current = activeSavedDocument.content;
        setAppState((current) => ({
          ...current,
          markdown: activeSavedDocument.content,
          lastFilePath: activeSavedDocument.path,
        }));
        setSaveStatus("saved");
      }

      showToast(`${totalCount}件をプロジェクト全体で置換しました`);
    } catch (error) {
      setLastError(String(error));
      setSaveStatus("error");
    } finally {
      setIsProjectReplacing(false);
    }
  };

  const handleProjectOutlineJump = async (path: string, item: DocumentOutlineItem) => {
    if (path !== currentFilePath) {
      await handleProjectFileSelect(path);
    }
    jumpToEditorLine(item.line);
    setFocusedFolderPath(null);
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
    setIsWorkspaceSwitcherOpen(false);
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

  const handleSidebarEntryReorder = async (
    folderPath: string,
    draggedPath: string,
    targetPath: string,
    position: "before" | "after",
  ) => {
    if (!projectFolder) return;

    const children = getFolderChildren(projectFolder, folderPath);
    const nextOrder = movePathToDropPosition(
      children.map((entry) => entry.path),
      draggedPath,
      targetPath,
      position,
    );
    if (nextOrder) await saveProjectEntryOrder(folderPath, nextOrder);
  };

  const handleHeadingMove = async (
    sourcePath: string,
    sourceLine: number,
    sourceBlockId: string,
    targetPath: string,
    targetLine: number | null,
    targetBlockId: string | null,
    position: HeadingDropPosition,
  ) => {
    logHeadingDnd("reorder-handler-reached", {
      sourcePath,
      sourceLine,
      sourceBlockId,
      targetPath,
      targetLine,
      targetBlockId,
      position,
    });
    if (headingMoveInProgressRef.current) {
      showToast("見出しを移動中です");
      return;
    }
    const affectedTabs = openTabs.filter(
      (tab) => tab.path === sourcePath || tab.path === targetPath,
    );
    if (affectedTabs.some((tab) => tab.saveStatus === "saving")) {
      showToast("保存完了後に見出しを移動してください");
      return;
    }
    headingMoveInProgressRef.current = true;

    const readMarkdown = async (path: string) => {
      const openTab = openTabs.find((tab) => tab.path === path);
      if (openTab) return openTab.markdown;
      return (await invoke<TextDocument>("read_text_file", { path })).content;
    };

    try {
      const sourceMarkdown = await readMarkdown(sourcePath);
      const targetMarkdown =
        sourcePath === targetPath ? sourceMarkdown : await readMarkdown(targetPath);
      const move = moveHeadingSection({
        sourceMarkdown,
        targetMarkdown,
        sourceLine,
        targetLine,
        position,
        sameDocument: sourcePath === targetPath,
      });
      logHeadingDnd("reorder-transform-complete", {
        sourceBlockId,
        targetBlockId,
        changed: move.changed,
        movedTitle: move.movedTitle,
      });
      if (!move.changed) {
        showToast("見出しの移動先が同じため変更はありません");
        return;
      }

      logHeadingDnd("reorder-save-start", { sourceBlockId, targetBlockId });
      const saved = await invoke<HeadingMoveDocuments>("save_heading_move", {
        sourcePath,
        targetPath,
        sourceContent: move.sourceMarkdown,
        targetContent: move.targetMarkdown,
      });
      const savedDocuments = [saved.sourceDocument, saved.targetDocument].filter(
        (document): document is TextDocument => document !== null,
      );
      logHeadingDnd("reorder-save-complete", {
        sourceBlockId,
        targetBlockId,
        savedPaths: savedDocuments.map((document) => document.path),
      });
      const savedByPath = new Map(
        savedDocuments.map((document) => [document.path, document] as const),
      );

      setOpenTabs((current) =>
        current.map((tab) => {
          if (!tab.path) return tab;
          const document = savedByPath.get(tab.path);
          if (!document) return tab;
          return {
            ...tab,
            markdown: document.content,
            savedMarkdown: document.content,
            editorRevision: null,
            name: document.name,
            saveStatus: "saved",
          };
        }),
      );
      setProjectAst((current) => {
        if (!current || current.rootPath !== projectFolder?.path) return current;
        return savedDocuments.reduce(
          (next, document) =>
            upsertProjectAstDocument(next, {
              path: document.path,
              name: document.name,
              text: parseFrontMatter(document.content).body,
            }),
          current,
        );
      });

      const activeDocument = currentFilePath ? savedByPath.get(currentFilePath) : null;
      if (activeDocument) {
        lastSavedMarkdownRef.current = activeDocument.content;
        setAppState((current) => ({
          ...current,
          markdown: activeDocument.content,
          lastFilePath: activeDocument.path,
        }));
      }
      logHeadingDnd("state-update-scheduled", {
        sourceBlockId,
        targetBlockId,
        updatedTabPaths: savedDocuments.map((document) => document.path),
      });
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          const outlineRows = Array.from(
            document.querySelectorAll<HTMLElement>("[data-outline-block-id]"),
          );
          const movedRows = outlineRows
            .filter((row) => row.dataset.outlineBlockId === sourceBlockId)
            .map((row) => ({
              path: row.dataset.outlineFilePath ?? null,
              line: Number(row.dataset.outlineHeadingLine ?? 0),
            }));
          logHeadingDnd("state-dom-updated", {
            sourceBlockId,
            targetBlockId,
            outlineRowCount: outlineRows.length,
            movedRows,
          });
        });
      });
      setLastError("");
      showToast(
        sourcePath === targetPath
          ? `見出し「${move.movedTitle}」を移動しました`
          : `見出し「${move.movedTitle}」を「${saved.targetDocument?.name ?? targetPath}」へ移動しました`,
      );
    } catch (error) {
      setLastError(String(error));
      showToast(error instanceof Error ? error.message : "見出しを移動できませんでした");
    } finally {
      headingMoveInProgressRef.current = false;
    }
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

  const getDraggedFragment = (event: DragEvent<HTMLElement>) => {
    if (draggingSnippetRef.current) return draggingSnippetRef.current;

    const fragmentId = event.dataTransfer.getData(SNIPPET_DRAG_MIME);
    if (!fragmentId) return null;
    for (const thread of snippets) {
      const fragment = thread.fragments.find((item) => item.id === fragmentId);
      if (fragment) {
        return { threadId: thread.id, fragmentId, body: fragment.body };
      }
    }
    return null;
  };

  const getEditorView = () => {
    return editorInstanceRef.current;
  };

  const insertParagraph = (text: string, pos?: number) => {
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
    const insertedText = `${prefix}${text}${suffix}`;
    const cursorPos = insertFrom + prefix.length + text.length;

    view.replaceRange(insertFrom, insertTo, insertedText, cursorPos);
    view.focus();
    return true;
  };

  const handleFragmentDragStart = (
    event: DragEvent<HTMLElement>,
    threadId: string,
    fragmentId: string,
  ) => {
    const thread = snippets.find((item) => item.id === threadId);
    const fragment = thread?.fragments.find((item) => item.id === fragmentId);
    if (!fragment) return;
    draggingSnippetRef.current = { threadId, fragmentId, body: fragment.body };
    setDraggingId(fragmentId);
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(SNIPPET_DRAG_MIME, fragmentId);
    event.dataTransfer.setData("text/plain", fragment.body);
  };

  const handleFragmentDragEnd = () => {
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
    const dragged = getDraggedFragment(event);
    const view = getEditorView();

    if (!dragged || !view) return;

    event.preventDefault();
    event.stopPropagation();

    const resolvedPos = view.positionFromPoint(event.clientX, event.clientY);
    clearDropIndicator();

    if (insertParagraph(dragged.body, resolvedPos ?? undefined)) {
      markFragmentUsed(dragged.threadId, dragged.fragmentId, true);
      showToast("本文へ挿入しました");
    }
    draggingSnippetRef.current = null;
    setDraggingId(null);
  };

  const updateIdeaThreads = (updater: (threads: IdeaThread[]) => IdeaThread[]) => {
    setAppState((current) => {
      const nextThreads = updater(current.snippets);
      return {
        ...current,
        snippets: nextThreads,
        profileSnippets:
          current.settings.snippetStorageMode === "profile"
            ? nextThreads
            : current.profileSnippets,
      };
    });
  };

  /** スレッドを id で見つけて差し替える（updatedAt を更新）。 */
  const patchThread = (threadId: string, patch: (thread: IdeaThread) => IdeaThread) => {
    updateIdeaThreads((threads) =>
      threads.map((thread) =>
        thread.id === threadId ? { ...patch(thread), updatedAt: Date.now() } : thread,
      ),
    );
  };

  const captureFragment = (body: string, destId: string) => {
    const text = body.trim();
    if (!text) return;
    const dest = snippets.find((thread) => thread.id === destId) ?? snippets[0];
    if (!dest) return;
    patchThread(dest.id, (thread) => {
      const fragment = makeIdeaFragment(text);
      const fragments =
        thread.kind === "inbox"
          ? [fragment, ...thread.fragments]
          : [...thread.fragments, fragment];
      return { ...thread, fragments };
    });
    showToast(`「${dest.title}」に追加しました`);
  };

  const addFragment = (threadId: string, body: string) => {
    const text = body.trim();
    if (!text) return;
    patchThread(threadId, (thread) => ({
      ...thread,
      fragments: [...thread.fragments, makeIdeaFragment(text)],
    }));
  };

  const updateFragmentBody = (threadId: string, fragmentId: string, body: string) => {
    const text = body.trim();
    if (!text) return;
    patchThread(threadId, (thread) => ({
      ...thread,
      fragments: thread.fragments.map((fragment) =>
        fragment.id === fragmentId
          ? { ...fragment, body: text, updatedAt: Date.now() }
          : fragment,
      ),
    }));
  };

  const markFragmentUsed = (threadId: string, fragmentId: string, used: boolean) => {
    patchThread(threadId, (thread) => ({
      ...thread,
      fragments: thread.fragments.map((fragment) =>
        fragment.id === fragmentId
          ? { ...fragment, used, updatedAt: Date.now() }
          : fragment,
      ),
    }));
  };

  const toggleFragmentUsed = (threadId: string, fragmentId: string) => {
    const thread = snippets.find((item) => item.id === threadId);
    const fragment = thread?.fragments.find((item) => item.id === fragmentId);
    if (!fragment) return;
    markFragmentUsed(threadId, fragmentId, !fragment.used);
  };

  const deleteFragment = (threadId: string, fragmentId: string) => {
    patchThread(threadId, (thread) => ({
      ...thread,
      fragments: thread.fragments.filter((fragment) => fragment.id !== fragmentId),
    }));
    showToast("断片を削除しました");
  };

  const moveFragment = (fromThreadId: string, fragmentId: string, toThreadId: string) => {
    if (fromThreadId === toThreadId) return;
    const fromThread = snippets.find((thread) => thread.id === fromThreadId);
    const fragment = fromThread?.fragments.find((item) => item.id === fragmentId);
    const toThread = snippets.find((thread) => thread.id === toThreadId);
    if (!fragment || !toThread) return;

    const now = Date.now();
    updateIdeaThreads((threads) =>
      threads.map((thread) => {
        if (thread.id === fromThreadId) {
          return {
            ...thread,
            fragments: thread.fragments.filter((item) => item.id !== fragmentId),
            updatedAt: now,
          };
        }
        if (thread.id === toThreadId) {
          return {
            ...thread,
            fragments: [...thread.fragments, { ...fragment, updatedAt: now }],
            updatedAt: now,
          };
        }
        return thread;
      }),
    );
    showToast(`「${toThread.title}」へ移動しました`);
  };

  const createIdeaThread = (): string => {
    const id = nextIdeaId("thread");
    const now = Date.now();
    updateIdeaThreads((threads) => {
      const thread: IdeaThread = {
        id,
        kind: "thread",
        title: "新しいスレッド",
        starred: false,
        createdAt: now,
        updatedAt: now,
        fragments: [],
      };
      const inboxIndex = threads.findIndex((item) => item.kind === "inbox");
      const next = [...threads];
      next.splice(inboxIndex >= 0 ? inboxIndex + 1 : 0, 0, thread);
      return next;
    });
    return id;
  };

  const renameIdeaThread = (threadId: string, title: string) => {
    patchThread(threadId, (thread) =>
      thread.kind === "inbox" ? thread : { ...thread, title },
    );
  };

  const toggleThreadStar = (threadId: string) => {
    patchThread(threadId, (thread) => ({ ...thread, starred: !thread.starred }));
  };

  const deleteIdeaThread = async (threadId: string) => {
    const thread = snippets.find((item) => item.id === threadId);
    if (!thread || thread.kind === "inbox") return;
    const shouldDelete = await requestConfirm({
      title: "スレッドを削除",
      message: `「${thread.title}」を削除しますか？`,
      detail: `断片 ${thread.fragments.length} 件もまとめて削除されます。`,
      confirmLabel: "削除",
      danger: true,
    });
    if (!shouldDelete) return;
    updateIdeaThreads((threads) => threads.filter((item) => item.id !== threadId));
    showToast("スレッドを削除しました");
  };

  const insertFragmentToEditor = (threadId: string, fragmentId: string) => {
    const thread = snippets.find((item) => item.id === threadId);
    const fragment = thread?.fragments.find((item) => item.id === fragmentId);
    if (!fragment) return;
    if (insertParagraph(fragment.body)) {
      markFragmentUsed(threadId, fragmentId, true);
      showToast("本文へ挿入しました");
    }
  };

  const insertThreadToEditor = (threadId: string) => {
    const thread = snippets.find((item) => item.id === threadId);
    if (!thread) return;
    const pending = thread.fragments.filter((fragment) => !fragment.used);
    if (pending.length === 0) {
      showToast("未使用の断片がありません");
      return;
    }
    if (insertParagraph(pending.map((fragment) => fragment.body).join("\n"))) {
      const pendingIds = new Set(pending.map((fragment) => fragment.id));
      const now = Date.now();
      patchThread(threadId, (current) => ({
        ...current,
        fragments: current.fragments.map((fragment) =>
          pendingIds.has(fragment.id)
            ? { ...fragment, used: true, updatedAt: now }
            : fragment,
        ),
      }));
      showToast(`${pending.length} 件を本文へ挿入しました`);
    }
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

  const handleSetFileProgress = (path: string, status: FileProgressStatus) => {
    setAppState((current) => {
      const nextProgress = { ...current.fileProgress };
      // "todo"（既定値）は保存せずキーを削除し、状態を肥大化させない。
      if (status === "todo") {
        if (!(path in nextProgress)) return current;
        delete nextProgress[path];
      } else {
        if (nextProgress[path] === status) return current;
        nextProgress[path] = status;
      }
      return { ...current, fileProgress: nextProgress };
    });
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

  const renderWorkspaceFolderTree = (
    entry: ProjectFolder | ProjectEntry,
    depth = 0,
  ) => {
    const folders = entry.children.filter((child) => child.kind === "folder");
    const isRoot = !("kind" in entry);
    const isCollapsed = collapsedWorkspaceFolderPaths.has(entry.path);
    const isActive = focusedFolderPath
      ? isSamePath(focusedFolderPath, entry.path)
      : isRoot;

    return (
      <div className="workspaceFolderTreeNode" key={entry.path}>
        <div className="workspaceFolderTreeRow" style={{ paddingLeft: `${depth * 14}px` }}>
          <button
            className="workspaceFolderDisclosure"
            type="button"
            aria-label={isCollapsed ? `${entry.name} を展開` : `${entry.name} を折りたたむ`}
            disabled={folders.length === 0}
            onClick={() => toggleWorkspaceFolderCollapse(entry.path)}
          >
            {folders.length > 0 ? (isCollapsed ? "›" : "⌄") : ""}
          </button>
          <button
            className={`workspaceFolderTreeButton ${
              isActive ? "activeWorkspaceFolderTreeButton" : ""
            }`}
            type="button"
            role="menuitem"
            title={entry.path}
            onClick={() => void handleWorkspaceFolderTreeSelect(entry.path)}
          >
            {isRoot ? (
              <AppIcon name="book" className="workspaceFolderTreeIcon" />
            ) : (
              <AppIcon name="folder" className="workspaceFolderTreeIcon" />
            )}
            <span>{entry.name}</span>
          </button>
        </div>
        {folders.length > 0 && !isCollapsed && (
          <div className="workspaceFolderTreeChildren">
            {folders.map((folder) => renderWorkspaceFolderTree(folder, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
      <main
        className="appShell"
        data-theme={settings.theme}
        data-writing-mode={settings.writingMode}
        style={
          {
            "--editor-font-family": settings.editorFontFamily,
            "--ui-font-family": settings.uiFontFamily,
            "--ui-font-scale": settings.uiFontScale,
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
                <AppIcon name="menu" className="topbarSvgIcon" />
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
                    onClick={() => closeFileMenuAndRun(handleOpenLinkedExport)}
                  >
                    エクスポート…
                  </button>
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
                <AppIcon name="panelLeft" className="topbarSvgIcon" />
              </button>
            )}
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
                            className={`breadcrumbFolderButton ${
                              index === 0 ? "workspaceSwitcherButton" : ""
                            }`}
                            type="button"
                            aria-label={
                              index === 0 ? "プロジェクトを切り替え" : `${crumb.name} の項目`
                            }
                            aria-expanded={
                              index === 0
                                ? isWorkspaceSwitcherOpen
                                : activeBreadcrumbPath === crumb.path
                            }
                            onClick={() => {
                              if (index === 0) {
                                setActiveBreadcrumbPath(null);
                                setIsWorkspaceSwitcherOpen((isOpen) => !isOpen);
                                return;
                              }
                              setIsWorkspaceSwitcherOpen(false);
                              setActiveBreadcrumbPath((path) =>
                                path === crumb.path ? null : crumb.path,
                              );
                            }}
                            onContextMenu={(event) => {
                              if (index === 0) return;
                              event.preventDefault();
                              setActiveBreadcrumbPath(crumb.path);
                            }}
                          >
                            {index === 0 && (
                              <AppIcon
                                name="book"
                                className="workspaceSwitcherBookIcon"
                              />
                            )}
                            <span>{crumb.name}</span>
                          </button>
                          {index === 0 && isWorkspaceSwitcherOpen && (
                            <div className="menuPopover workspaceSwitcherPopover" role="menu">
                              <div className="workspaceSwitcherHeader">
                                <span className="workspaceSwitcherTitle">{projectFolder.name}</span>
                                {settings.showWorkspacePaths && (
                                  <span className="workspaceSwitcherPath">{projectFolder.path}</span>
                                )}
                              </div>
                              <label className="workspaceSwitcherSearch">
                                <span aria-hidden="true">⌕</span>
                                <input
                                  value={workspaceSwitcherQuery}
                                  onChange={(event) =>
                                    setWorkspaceSwitcherQuery(event.target.value)
                                  }
                                  placeholder="プロジェクトを検索"
                                  type="search"
                                />
                              </label>
                              <span className="workspaceSwitcherSectionLabel">
                                現在のプロジェクト
                              </span>
                              <div className="workspaceFolderTree">
                                {renderWorkspaceFolderTree(projectFolder)}
                              </div>
                              <div className="menuDivider" role="separator" />
                              <span className="workspaceSwitcherSectionLabel">
                                最近開いたプロジェクト
                              </span>
                              <div className="workspaceSwitcherList">
                                {visibleRecentWorkspaces.length ? (
                                  visibleRecentWorkspaces.map((workspace) => {
                                    const isActive = workspace.path === projectFolder.path;
                                    return (
                                      <button
                                        key={workspace.path}
                                        className={
                                          isActive
                                            ? "workspaceRecordButton activeMenuItem"
                                            : "workspaceRecordButton"
                                        }
                                        type="button"
                                        role="menuitem"
                                        onClick={() =>
                                          closeBreadcrumbMenuAndRun(() =>
                                            isActive ? undefined : openWorkspace(workspace.path),
                                          )
                                        }
                                      >
                                        <AppIcon name="folder" className="menuSvgIcon" />
                                        <span className="workspaceRecordText">
                                          <span className="workspaceRecordName">
                                            {workspace.name}
                                          </span>
                                          {settings.showWorkspacePaths && (
                                            <span className="workspaceRecordPath">
                                              {workspace.path}
                                            </span>
                                          )}
                                        </span>
                                        {isActive && (
                                          <span className="workspaceRecordBadge">現在</span>
                                        )}
                                      </button>
                                    );
                                  })
                                ) : (
                                  <span className="emptyMenuMessage">
                                    一致するプロジェクトがありません
                                  </span>
                                )}
                              </div>
                              <div className="menuDivider" role="separator" />
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() =>
                                  closeBreadcrumbMenuAndRun(() => openWorkspace())
                                }
                              >
                                <AppIcon name="folder" className="menuSvgIcon" />
                                <span>別のフォルダを開く...</span>
                              </button>
                            </div>
                          )}
                          {index !== 0 && activeBreadcrumbPath === crumb.path && (
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
                                      <AppIcon
                                        name={entry.kind === "folder" ? "folder" : "file"}
                                        className="menuSvgIcon"
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
                    className="breadcrumbFolderButton workspaceSwitcherButton"
                    type="button"
                    aria-label="プロジェクトを切り替え"
                    aria-expanded={isWorkspaceSwitcherOpen}
                    onClick={() => {
                      setActiveBreadcrumbPath(null);
                      setIsWorkspaceSwitcherOpen((isOpen) => !isOpen);
                    }}
                  >
                    <AppIcon name="book" className="workspaceSwitcherBookIcon" />
                    <span>{scratchWorkspaceName}</span>
                  </button>
                  {isWorkspaceSwitcherOpen && (
                    <div className="menuPopover workspaceSwitcherPopover" role="menu">
                      <div className="workspaceSwitcherHeader">
                        <span className="workspaceSwitcherTitle">{scratchWorkspaceName}</span>
                      </div>
                      <label className="workspaceSwitcherSearch">
                        <span aria-hidden="true">⌕</span>
                        <input
                          value={workspaceSwitcherQuery}
                          onChange={(event) => setWorkspaceSwitcherQuery(event.target.value)}
                          placeholder="プロジェクトを検索"
                          type="search"
                        />
                      </label>
                      <span className="workspaceSwitcherSectionLabel">
                        最近開いたプロジェクト
                      </span>
                      <div className="workspaceSwitcherList">
                        {visibleRecentWorkspaces.length ? (
                          visibleRecentWorkspaces.map((workspace) => (
                            <button
                              key={workspace.path}
                              className="workspaceRecordButton"
                              type="button"
                              role="menuitem"
                              onClick={() =>
                                closeBreadcrumbMenuAndRun(() => openWorkspace(workspace.path))
                              }
                            >
                              <AppIcon name="folder" className="menuSvgIcon" />
                              <span className="workspaceRecordText">
                                <span className="workspaceRecordName">{workspace.name}</span>
                                {settings.showWorkspacePaths && (
                                  <span className="workspaceRecordPath">{workspace.path}</span>
                                )}
                              </span>
                            </button>
                          ))
                        ) : (
                          <span className="emptyMenuMessage">
                            一致するプロジェクトがありません
                          </span>
                        )}
                      </div>
                      <div className="menuDivider" role="separator" />
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => closeBreadcrumbMenuAndRun(() => openWorkspace())}
                      >
                        <AppIcon name="folder" className="menuSvgIcon" />
                        <span>別のフォルダを開く...</span>
                      </button>
                    </div>
                  )}
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
                  <AppIcon name="panelRight" className="topbarSvgIcon" />
                </button>
              )}
              <button
                className="iconButton"
                type="button"
                aria-label="エクスポート"
                title="エクスポート"
                onClick={() => void handleOpenLinkedExport()}
              >
                <AppIcon name="export" className="topbarSvgIcon" />
              </button>
              <button
                className={`iconButton ${settings.writingMode === "horizontal-tb" ? "activeIconButton" : ""}`}
                type="button"
                aria-label={settings.writingMode === "horizontal-tb" ? "縦書きに切り替え" : "横書きに切り替え"}
                title={settings.writingMode === "horizontal-tb" ? "縦書きに切り替え" : "横書きに切り替え"}
                onClick={() =>
                  updateSettings(
                    "writingMode",
                    settings.writingMode === "horizontal-tb" ? "vertical-rl" : "horizontal-tb",
                  )
                }
              >
                <AppIcon
                  name={settings.writingMode === "horizontal-tb" ? "horizontal" : "vertical"}
                  className="topbarSvgIcon"
                />
              </button>
              <button
                className="iconButton"
                type="button"
                aria-label="テーマを選択"
                title="テーマを選択"
                onClick={() => {
                  setShouldReturnToSettingsAfterThemePicker(false);
                  setIsThemePickerModalOpen(true);
                }}
              >
                <AppIcon name="theme" className="topbarSvgIcon" />
              </button>
              <button
                className="iconButton"
                type="button"
                aria-label="設定"
                title="設定"
                onClick={() => setIsSettingsModalOpen(true)}
              >
                <AppIcon name="settings" className="topbarSvgIcon" />
              </button>
            </div>
          </header>

          <div className="workspace">
            {!isLeftSidebarCollapsed && (
              <WorkspaceSidebar
                projectFolder={projectFolder}
                currentFilePath={currentFilePath}
                currentFileName={currentFileName}
                currentFileCharCount={countDisplayCharacters(editorText, settings.countWhitespace)}
                focusedFolderPath={focusedFolderPath}
                activeDocumentOutline={outlineItems}
                activeOutlineIds={activeOutlineIds}
                projectAst={projectAst}
                sidebarMode={settings.sidebarMode}
                navigatorPreviewLines={settings.navigatorPreviewLines}
                countWhitespace={settings.countWhitespace}
                fileProgress={appState.fileProgress}
                onSetFileProgress={handleSetFileProgress}
                projectSearchQuery={projectSearchQuery}
                projectSearchResults={workspaceSearchResults}
                searchScope={searchScope}
                projectReplaceValue={projectReplaceValue}
                isProjectReplacing={isProjectReplacing}
                isProjectSearchMode={isProjectSearchMode}
                onProjectSearchModeChange={setIsProjectSearchMode}
                onJumpOutline={jumpToOutlineItem}
                onJumpProjectOutline={(path, item) => void handleProjectOutlineJump(path, item)}
                onMoveHeading={(
                  sourcePath,
                  sourceLine,
                  sourceBlockId,
                  targetPath,
                  targetLine,
                  targetBlockId,
                  position,
                ) =>
                  void handleHeadingMove(
                    sourcePath,
                    sourceLine,
                    sourceBlockId,
                    targetPath,
                    targetLine,
                    targetBlockId,
                    position,
                  )
                }
                onProjectSearchQueryChange={setProjectSearchQuery}
                onSearchScopeChange={setSearchScope}
                onProjectReplaceValueChange={setProjectReplaceValue}
                onOpenProjectSearchResult={(result) => void handleProjectSearchResultOpen(result)}
                onReplaceInCurrentFile={handleReplaceInCurrentFile}
                onReplaceInProject={() => void handleReplaceInProject()}
                onOpenProjectFolder={handleOpenProjectFolder}
                onNewDocument={handleNewDocument}
                onCreateFile={(folderPath) => void handleCreateProjectFile(folderPath)}
                onCreateFolder={(folderPath) => void handleCreateProjectFolder(folderPath)}
                onSelectFile={(path) => void handleProjectFileSelect(path)}
                onSelectFolder={(path) => void handleProjectFolderSelect(path)}
                onOpenFileInNewTab={(path) => void handleProjectFileSelectInNewTab(path)}
                onRenameEntry={(entry) => void handleRenameProjectEntry(entry)}
                onDeleteEntry={(entry) => void handleDeleteProjectEntry(entry)}
                onReorderEntry={(folderPath, draggedPath, targetPath, position) =>
                  void handleSidebarEntryReorder(folderPath, draggedPath, targetPath, position)
                }
                onCollapse={() => setIsLeftSidebarCollapsed(true)}
              />
            )}
            <div className="editorColumn">
              <div className="editorFrame">
                <div
                  ref={editorShellRef}
                  className="editor"
                  onContextMenu={handleEditorContextMenu}
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
                            editorRevision={activeTab?.editorRevision ?? null}
                            writingMode={settings.writingMode}
                            typewriterOffset={settings.typewriterOffset}
                            showLineBreakMarks={settings.showLineBreakMarks}
                            initialSelectionOffset={initialSelectionOffset}
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
                  {editorContextMenu && (
                    <div
                      ref={editorContextMenuRef}
                      className="editorContextMenu"
                      role="menu"
                      style={{ left: editorContextMenu.x, top: editorContextMenu.y }}
                    >
                      <div className="contextMenuSection">
                        <button
                          type="button"
                          role="menuitem"
                          disabled={editorContextMenu.from === editorContextMenu.to}
                          onClick={() => void copyEditorSelection(editorContextMenu)}
                        >
                          コピー
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          disabled={editorContextMenu.from === editorContextMenu.to}
                          onClick={() => void cutEditorSelection(editorContextMenu)}
                        >
                          切り取り
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => void pasteIntoEditorSelection(editorContextMenu)}
                        >
                          貼り付け
                        </button>
                      </div>
                      <div className="contextMenuDivider" role="separator" />
                      <div className="contextMenuSection">
                        <span className="contextMenuLabel">独自記法</span>
                        <button
                          type="button"
                          role="menuitem"
                          disabled={!canWrapInlineSelection(editorContextMenu)}
                          title={customNotationSpecs[0].syntax}
                          onClick={() => openRubyNotationModal(editorContextMenu)}
                        >
                          ルビ...
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          disabled={!canWrapInlineSelection(editorContextMenu)}
                          title={customNotationSpecs[1].syntax}
                          onClick={() => {
                            if (applyInlineNotation(editorContextMenu, "tcy")) {
                              closeEditorContextMenu();
                            }
                          }}
                        >
                          縦中横
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          disabled={!canWrapInlineSelection(editorContextMenu)}
                          title={customNotationSpecs[2].syntax}
                          onClick={() => {
                            if (applyInlineNotation(editorContextMenu, "emphasis")) {
                              closeEditorContextMenu();
                            }
                          }}
                        >
                          圏点
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          title="選択範囲または行の独自記法を外します"
                          onClick={() => clearSelectionNotation(editorContextMenu)}
                        >
                          記法をクリア
                        </button>
                      </div>
                      <div className="contextMenuDivider" role="separator" />
                      <div className="contextMenuSection">
                        <span className="contextMenuLabel">行指示</span>
                        <button
                          type="button"
                          role="menuitem"
                          title={customNotationSpecs[3].syntax}
                          onClick={() => openDirectionNotationModal(editorContextMenu)}
                        >
                          文章方向...
                        </button>
                      </div>
                    </div>
                  )}
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
                      threads={snippets}
                      draggingId={draggingId}
                      onCapture={captureFragment}
                      onCreateThread={createIdeaThread}
                      onRenameThread={renameIdeaThread}
                      onToggleStar={toggleThreadStar}
                      onDeleteThread={deleteIdeaThread}
                      onAddFragment={addFragment}
                      onUpdateFragment={updateFragmentBody}
                      onToggleUsed={toggleFragmentUsed}
                      onDeleteFragment={deleteFragment}
                      onMoveFragment={moveFragment}
                      onInsertFragment={insertFragmentToEditor}
                      onInsertThread={insertThreadToEditor}
                      onFragmentDragStart={handleFragmentDragStart}
                      onFragmentDragEnd={handleFragmentDragEnd}
                    />
                  )}
                </div>
              </aside>
            )}
          </div>

          <div className={`toast ${toast ? "showToast" : ""}`} role="status">
            {toast}
          </div>

          {notationModal && (
            <div className="modalBackdrop" role="presentation">
              <section
                className="modal compactModal notationModal"
                aria-label={
                  notationModal.type === "ruby" ? "ルビを追加" : "行指示を選択"
                }
                role="dialog"
                aria-modal="true"
              >
                <header className="modalHeader">
                  <h2>{notationModal.type === "ruby" ? "ルビ" : "行指示"}</h2>
                  <button
                    className="modalClose"
                    type="button"
                    aria-label="閉じる"
                    onClick={() => setNotationModal(null)}
                  >
                    ×
                  </button>
                </header>
                {notationModal.type === "ruby" ? (
                  <form className="modalForm" onSubmit={submitRubyNotation}>
                    <label>
                      <span>対象</span>
                      <input value={notationModal.selection.text} readOnly />
                    </label>
                    <label>
                      <span>ルビ</span>
                      <input
                        autoFocus
                        value={notationModal.reading}
                        placeholder="読みを入力"
                        onChange={(event) =>
                          setNotationModal((current) =>
                            current?.type === "ruby"
                              ? { ...current, reading: event.target.value, error: "" }
                              : current,
                          )
                        }
                      />
                    </label>
                    <p className="notationSyntax">{customNotationSpecs[0].syntax}</p>
                    {notationModal.error && (
                      <p className="dialogError" role="alert">
                        {notationModal.error}
                      </p>
                    )}
                    <footer className="modalActions">
                      <button type="button" onClick={() => setNotationModal(null)}>
                        キャンセル
                      </button>
                      <button type="submit">反映</button>
                    </footer>
                  </form>
                ) : (
                  <div className="modalForm">
                    <div className="notationChoiceList">
                      {directionOptions.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className="notationChoiceButton"
                          onClick={() => chooseDirectionNotation(option.value)}
                        >
                          <span>{option.label}</span>
                          <small>{option.description}</small>
                        </button>
                      ))}
                    </div>
                    <p className="notationSyntax">{customNotationSpecs[3].syntax}</p>
                    <footer className="modalActions">
                      <button type="button" onClick={() => setNotationModal(null)}>
                        キャンセル
                      </button>
                    </footer>
                  </div>
                )}
              </section>
            </div>
          )}

          {appDialog && (
            <AppDialogModal
              dialog={appDialog}
              onClose={closeAppDialog}
              onSubmit={submitAppDialog}
              onValueChange={updateAppDialogValue}
              onChoice={chooseAppDialog}
            />
          )}

          {isCommandPaletteOpen && (
            <CommandPalette
              commands={buildPaletteCommands()}
              onClose={() => setIsCommandPaletteOpen(false)}
            />
          )}
          {isSettingsModalOpen && (
            <SettingsModal
              settings={settings}
              systemFonts={systemFonts}
              onClose={() => setIsSettingsModalOpen(false)}
              onOpenThemePicker={() => {
                setIsSettingsModalOpen(false);
                setShouldReturnToSettingsAfterThemePicker(true);
                setIsThemePickerModalOpen(true);
              }}
              onUpdateSettings={updateSettings}
              onSnippetStorageModeChange={(mode) =>
                void handleSnippetStorageModeChange(mode)
              }
            />
          )}
          {isThemePickerModalOpen && (
            <ThemePickerModal
              selectedTheme={settings.theme}
              onClose={() => {
                setIsThemePickerModalOpen(false);
                if (shouldReturnToSettingsAfterThemePicker) {
                  setShouldReturnToSettingsAfterThemePicker(false);
                  setIsSettingsModalOpen(true);
                }
              }}
              onSelect={(theme) => updateSettings("theme", theme)}
            />
          )}
        </section>
      </main>
  );
}
