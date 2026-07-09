import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
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
  hash16,
} from "./editor/ast/documentAst";
import {
  moveHeadingSection,
  type HeadingDropPosition,
} from "./editor/ast/headingMove";
import {
  collectProjectTextFiles,
  createProjectAstSkeleton,
  markProjectAstFileError,
  removeProjectAstPaths,
  searchProjectAst,
  upsertProjectAstDocument,
} from "./editor/ast/projectAst";
import {
  PlotPane,
  PlotPaneHeaderActions,
} from "./components/plot/PlotPane";
import {
  CANVAS_LIVE_DATA_EVENT,
  createCanvasDocument,
  createCanvasEdge,
  createCanvasGroupNode,
  createCanvasTextNode,
  createIdeaOriginRef,
  normalizeCanvasDocument,
  type CanvasBoardSummary,
  type CanvasCopyToIdeaRequest,
  type CanvasCopyToPlotRequest,
  type CanvasFocusIdeaRequest,
  type CanvasLiveDataEvent,
  type CanvasNode,
  type CanvasScope,
  type CanvasWindowPayload,
  type JsonCanvasDocument,
} from "./canvasTypes";
import {
  appendPlotChapter,
  appendPlotSection,
  renumberPlotCards,
  replacePlotReferencePath,
} from "./components/plot/plotCardUtils";
import { ReferenceLayer } from "./components/references/ReferenceLayer";
import { ReferencePane } from "./components/references/ReferencePane";
import { IdeaPane } from "./components/snippets/IdeaPane";
import { QuickIdeaModal } from "./components/snippets/QuickIdeaModal";
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
  DeleteProjectEntryPlan,
  DeleteProjectEntryResult,
  DocumentTab,
  EditorSettings,
  FileProgressStatus,
  FlatOutlineItem,
  FontOption,
  IdeaFragment,
  IdeaOriginRef,
  IdeaThread,
  ManuscriptSnapshot,
  ManuscriptSnapshotFile,
  OutlineItem,
  PlotCard,
  ProjectEntry,
  ProjectFolder,
  ReferenceCardState,
  ReferenceFileInfo,
  ReferenceKind,
  ReferenceLayout,
  ReferenceScope,
  SaveStatus,
  Snippet,
  TextDocument,
  WorkspaceAlert,
  WorkspaceRecord,
} from "./types";
import {
  appThemeValues,
  fileProgressStatuses,
  DEFAULT_EDITOR_MEASURE_PERCENT,
  DEFAULT_NAVIGATOR_PREVIEW_LINES,
  EDITOR_MEASURE_PERCENT_MAX,
  EDITOR_MEASURE_PERCENT_MIN,
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
  isPathSameOrInside,
  movePathInOrder,
  movePathToDropPosition,
  removeNestedRecentWorkspaces,
  replaceFolderChildren,
  upsertRecentWorkspace,
} from "./utils/projectTree";
import { logHeadingDnd } from "./utils/headingDndDiagnostics";
import { getScaledFixedMenuPosition } from "./utils/contextMenuPosition";
import {
  exportFontFamilies,
  type LoadedExportSource,
} from "./export/types";
import CanvasWindowApp from "./CanvasWindowApp";
import { LinkedExportScreen } from "./components/export/LinkedExportScreen";
import {
  exportDocxWithDialog,
  exportPdfWithVivliostyle,
} from "./export/exportHostActions";

const SNIPPET_DRAG_MIME = "application/x-brew-snippet-id";
const BREADCRUMB_ENTRY_DRAG_MIME = "application/x-brew-project-entry-path";
const STORAGE_KEY = "then.app-state.v1";
const LEGACY_STORAGE_KEY = "brew.app-state.v1";
const scratchFileName = "無題.txt";
const newTabName = "新しいタブ";
const scratchWorkspaceName = "一時ファイル";
const isTauriRuntime = () => "__TAURI_INTERNALS__" in window;
const EDITOR_CONTEXT_MENU_WIDTH = 236;
const EDITOR_CONTEXT_MENU_HEIGHT = 292;
const defaultReferenceLayout: ReferenceLayout = {
  version: 1,
  name: "default",
  cards: [],
  recent: [],
};
const PINNED_REFERENCE_Z_BASE = 10000;
const NORMAL_REFERENCE_Z_LIMIT = PINNED_REFERENCE_Z_BASE - 1;
const MAX_RECENT_REFERENCES = 30;
const CANVAS_NEW_THREAD_TARGET = "__new__";

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

type EditorFindMatch = {
  id: string;
  from: number;
  to: number;
  line: number;
  column: number;
  excerpt: string;
};

type EditorFindState = {
  open: boolean;
  query: string;
  replaceValue: string;
  showReplace: boolean;
  activeIndex: number;
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

type MoveProjectEntryResult = {
  projectFolder: ProjectFolder;
  movedDocument: TextDocument | null;
  oldPath: string;
  newPath: string;
  oldParentPath: string;
  newParentPath: string;
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
  | "canvas"
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
    case "canvas":
      return (
        <svg {...common}>
          <rect x="4" y="5" width="7" height="6" rx="1.5" />
          <rect x="13" y="13" width="7" height="6" rx="1.5" />
          <path d="M11 8h3.5A2.5 2.5 0 0 1 17 10.5V13" />
          <path d="M13 16H9.5A2.5 2.5 0 0 1 7 13.5V11" />
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
const sampleIdeaThreadIds = new Set(["idea-sample-scene", "idea-sample-foreshadow"]);
const sampleIdeaFragmentBodies = new Set([
  "主人公が改札の前で一瞬立ち止まる描写を入れる。",
  "風呂のシーンはテンポよく、1分で終わらせる緊張感を持たせたい。",
  "夜明けの光が、山の稜線を白く縁どり始めた頃。",
  "主人公は決断する。しかしその足は、一歩踏み出すことを躊躇っていた。",
  "「お前には、まだ知らないことがある」老人は静かに言った。",
]);

let ideaIdCounter = 0;

function nextIdeaId(prefix: string): string {
  ideaIdCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${ideaIdCounter}`;
}

function normalizeIdeaOriginRef(value: unknown): IdeaOriginRef | undefined {
  if (!value || typeof value !== "object") return undefined;
  const origin = value as Partial<IdeaOriginRef>;
  if (origin.source !== "canvas") return undefined;
  if (typeof origin.sourceId !== "string" || typeof origin.sourceBoardId !== "string") {
    return undefined;
  }
  return {
    source: "canvas",
    sourceId: origin.sourceId,
    sourceBoardId: origin.sourceBoardId,
    sourceBoardScope: origin.sourceBoardScope === "global" ? "global" : "project",
    copiedAt: typeof origin.copiedAt === "number" ? origin.copiedAt : Date.now(),
  };
}

function makeIdeaFragment(
  body: string,
  used = false,
  originRef?: IdeaOriginRef,
): IdeaFragment {
  const now = Date.now();
  return {
    id: nextIdeaId("frag"),
    body,
    used,
    createdAt: now,
    updatedAt: now,
    originRef,
  };
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
  return [makeInboxThread()];
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
                originRef: normalizeIdeaOriginRef(
                  (fragment as Partial<IdeaFragment>).originRef,
                ),
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

  threads = threads
    .filter((thread) => !sampleIdeaThreadIds.has(thread.id))
    .map((thread) => ({
      ...thread,
      fragments: thread.fragments.filter(
        (fragment) => !sampleIdeaFragmentBodies.has(fragment.body.trim()),
      ),
    }));

  // インボックスを必ず1つ、先頭に置く。
  const inboxes = threads.filter((thread) => thread.kind === "inbox");
  const others = threads.filter((thread) => thread.kind !== "inbox");
  const inbox =
    inboxes.length > 0
      ? { ...inboxes[0], id: INBOX_THREAD_ID, fragments: inboxes.flatMap((t) => t.fragments) }
      : makeInboxThread();
  return [inbox, ...others];
}

function quoteCssFontFamily(family: string): string {
  const escaped = family.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

const hiraginoCssFontFamilyAliases = new Map<string, string[]>([
  ["ヒラギノ角ゴ Pro W3", ["Hiragino Kaku Gothic Pro", "ヒラギノ角ゴ Pro"]],
  ["ヒラギノ角ゴ Pro W6", ["Hiragino Kaku Gothic Pro", "ヒラギノ角ゴ Pro"]],
  ["ヒラギノ角ゴ Std W8", ["Hiragino Kaku Gothic Std", "ヒラギノ角ゴ Std"]],
  ["ヒラギノ明朝 Pro W3", ["Hiragino Mincho Pro", "ヒラギノ明朝 Pro"]],
  ["ヒラギノ明朝 Pro W6", ["Hiragino Mincho Pro", "ヒラギノ明朝 Pro"]],
]);

function unquoteSingleCssFontFamily(value: string): string | null {
  const trimmed = value.trim();
  const match = trimmed.match(/^"((?:\\.|[^"\\])*)"$/) ?? trimmed.match(/^'((?:\\.|[^'\\])*)'$/);
  return match ? match[1].replace(/\\(["'\\])/g, "$1").replace(/\\\\/g, "\\") : null;
}

function resolveCssFontFamilyAlias(family: string): string | null {
  const label = unquoteSingleCssFontFamily(family) ?? family.trim();
  const aliases = hiraginoCssFontFamilyAliases.get(label);
  return aliases ? aliases.map(quoteCssFontFamily).join(", ") : null;
}

function toCssFontFamilyValue(family: string): string {
  return resolveCssFontFamilyAlias(family) ?? quoteCssFontFamily(family.trim());
}

/**
 * 文字表示幅（百分率）の保存値を正規化する。範囲外は旧形式
 * （px 絶対値や null=最大）の名残とみなし、既定値へ戻す。
 */
function normalizeEditorMeasure(value: unknown): number {
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= EDITOR_MEASURE_PERCENT_MIN &&
    value <= EDITOR_MEASURE_PERCENT_MAX
  ) {
    return Math.round(value);
  }
  return DEFAULT_EDITOR_MEASURE_PERCENT;
}

function normalizeStoredFontFamily(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;

  const fontFamily = value.trim();
  if (!fontFamily) return fallback;
  const alias = resolveCssFontFamilyAlias(fontFamily);
  if (alias) return alias;
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

const defaultSettings: EditorSettings = {
  theme: "dark",
  editorFontFamily: toCssFontFamilyValue("Noto Serif JP"),
  uiFontFamily: toCssFontFamilyValue("Segoe UI"),
  uiFontScale: 1,
  exportFontFamily: "Noto Serif CJK JP",
  fontSize: 15,
  lineHeight: 1.82,
  editorMeasureHorizontal: DEFAULT_EDITOR_MEASURE_PERCENT,
  editorMeasureVertical: DEFAULT_EDITOR_MEASURE_PERCENT,
  writingMode: "vertical-rl",
  canvasDefaultWritingMode: "horizontal-tb",
  canvasDefaultFontSource: "ui",
  plotFontSource: "editor",
  headingFontSource: "body",
  headingFontFamily: toCssFontFamilyValue("Noto Sans JP"),
  typewriterScroll: true,
  typewriterOffset: 46,
  showLineBreakMarks: false,
  snippetStorageMode: "workspace",
  sidebarMode: "tree",
  showWorkspacePaths: true,
  zoneMode: false,
  zoneModeOpacity: 0.42,
  navigatorPreviewLines: DEFAULT_NAVIGATOR_PREVIEW_LINES,
  countWhitespace: true,
  checkpointSectionCollapsed: false,
  canvasOpensInWindow: false,
  exportOpensInWindow: false,
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

function retargetFilesystemPath(path: string, oldPath: string, newPath: string): string | null {
  const comparablePath = normalizePathForCompare(path);
  const comparableOldPath = normalizePathForCompare(oldPath);
  if (comparablePath === comparableOldPath) return newPath;
  if (!comparablePath.startsWith(`${comparableOldPath}\\`)) return null;

  const stablePath = path.replace(/[\\/]+/g, "\\").replace(/\\+$/, "");
  const stableOldPath = oldPath.replace(/[\\/]+/g, "\\").replace(/\\+$/, "");
  const suffix = stablePath.slice(stableOldPath.length);
  return `${newPath.replace(/[\\/]+$/, "")}${suffix}`;
}

function toProjectRelativePath(rootPath: string, path: string): string {
  const normalizedRoot = rootPath.replace(/[\\/]+/g, "/").replace(/\/+$/, "");
  const normalizedPath = path.replace(/[\\/]+/g, "/");
  if (normalizedPath.toLocaleLowerCase().startsWith(`${normalizedRoot.toLocaleLowerCase()}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1);
  }
  return normalizedPath;
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
    snapshots: [],
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

function documentAstToText(documentAst: DocumentAst): string {
  return documentAst.blocks.map((block) => block.source).join("\n");
}

function snapshotId(prefix = "snapshot"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const MAX_AUTO_SHELTER_SNAPSHOTS = 3;

function trimAutoShelterSnapshots(
  snapshots: ManuscriptSnapshot[],
  maxCount = MAX_AUTO_SHELTER_SNAPSHOTS,
): ManuscriptSnapshot[] {
  const shelterCountsByWorkspace = new Map<string, number>();
  return snapshots
    .slice()
    .sort((left, right) => right.createdAt - left.createdAt)
    .filter((snapshot) => {
      if (snapshot.reason !== "auto-before-restore") return true;
      const key = normalizePathForCompare(snapshot.workspacePath);
      const count = shelterCountsByWorkspace.get(key) ?? 0;
      if (count >= maxCount) return false;
      shelterCountsByWorkspace.set(key, count + 1);
      return true;
    });
}

function normalizeSnapshots(value: unknown): ManuscriptSnapshot[] {
  if (!Array.isArray(value)) return [];

  const normalized = value
    .filter((snapshot): snapshot is Partial<ManuscriptSnapshot> =>
      Boolean(snapshot) && typeof snapshot === "object",
    )
    .map((snapshot) => {
      const files = Array.isArray(snapshot.files)
        ? snapshot.files
            .filter((file) =>
              Boolean(file) &&
              typeof file === "object" &&
              typeof file.path === "string" &&
              typeof file.name === "string" &&
              typeof file.text === "string",
            )
            .map((file) => {
              const entry = file as Partial<ManuscriptSnapshotFile> & {
                path: string;
                name: string;
                text: string;
              };
              return {
                path: entry.path,
                name: entry.name,
                text: entry.text,
                textHash:
                  typeof entry.textHash === "string" ? entry.textHash : hash16(entry.text),
                semanticHash:
                  typeof entry.semanticHash === "string"
                    ? entry.semanticHash
                    : hash16(entry.text),
                lineCount:
                  typeof entry.lineCount === "number" && Number.isFinite(entry.lineCount)
                    ? entry.lineCount
                    : entry.text.split("\n").length,
                textLength:
                  typeof entry.textLength === "number" && Number.isFinite(entry.textLength)
                    ? entry.textLength
                    : Array.from(entry.text).length,
                visibleTextLength:
                  typeof entry.visibleTextLength === "number" &&
                  Number.isFinite(entry.visibleTextLength)
                    ? entry.visibleTextLength
                    : Array.from(entry.text.replace(WHITESPACE_PATTERN, "")).length,
                outlineCount:
                  typeof entry.outlineCount === "number" && Number.isFinite(entry.outlineCount)
                    ? entry.outlineCount
                    : 0,
              };
            })
        : [];

      const workspacePath =
        typeof snapshot.workspacePath === "string" ? snapshot.workspacePath : "";
      const workspaceName =
        typeof snapshot.workspaceName === "string" ? snapshot.workspaceName : "プロジェクト";

      return {
        id: typeof snapshot.id === "string" ? snapshot.id : snapshotId(),
        workspacePath,
        workspaceName,
        createdAt:
          typeof snapshot.createdAt === "number" && Number.isFinite(snapshot.createdAt)
            ? snapshot.createdAt
            : Date.now(),
        reason:
          snapshot.reason === "auto-before-restore" ? "auto-before-restore" : "manual",
        label:
          typeof snapshot.label === "string" && snapshot.label.trim()
            ? snapshot.label
            : "チェックポイント",
        memo: typeof snapshot.memo === "string" ? snapshot.memo : "",
        parentIds: Array.isArray(snapshot.parentIds)
          ? snapshot.parentIds.filter((id): id is string => typeof id === "string")
          : [],
        projectTree:
          snapshot.projectTree &&
          typeof snapshot.projectTree === "object" &&
          typeof snapshot.projectTree.path === "string" &&
          typeof snapshot.projectTree.name === "string" &&
          Array.isArray(snapshot.projectTree.children)
            ? snapshot.projectTree
            : { path: workspacePath, name: workspaceName, children: [] },
        files,
        fileCount:
          typeof snapshot.fileCount === "number" && Number.isFinite(snapshot.fileCount)
            ? snapshot.fileCount
            : files.length,
        totalTextLength:
          typeof snapshot.totalTextLength === "number" && Number.isFinite(snapshot.totalTextLength)
            ? snapshot.totalTextLength
            : files.reduce((sum, file) => sum + file.textLength, 0),
        totalVisibleTextLength:
          typeof snapshot.totalVisibleTextLength === "number" &&
          Number.isFinite(snapshot.totalVisibleTextLength)
            ? snapshot.totalVisibleTextLength
            : files.reduce((sum, file) => sum + file.visibleTextLength, 0),
      } satisfies ManuscriptSnapshot;
    })
    .filter((snapshot) => snapshot.workspacePath && snapshot.files.length > 0);

  return trimAutoShelterSnapshots(normalized);
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

function referenceKindFromPath(path: string): ReferenceKind {
  const extension = path.split(".").pop()?.toLocaleLowerCase();
  if (extension === "txt") return "text";
  if (extension === "md") return "markdown";
  if (extension === "png" || extension === "jpg" || extension === "jpeg" || extension === "webp") {
    return "image";
  }
  if (extension === "pdf") return "pdf";
  return "unknown";
}

function referenceNameFromPath(sourcePath: string): string {
  return sourcePath.split(/[\\/]/).filter(Boolean).pop() ?? sourcePath;
}

function normalizeReferenceScope(scope: unknown): ReferenceScope {
  return scope === "global" ? "global" : "project";
}

function referenceKey(sourcePath: string, scope: ReferenceScope = "project"): string {
  return `${scope}:${sourcePath.replace(/[\\]+/g, "/").toLocaleLowerCase()}`;
}

function referenceFileKey(file: Pick<ReferenceFileInfo, "sourcePath" | "scope">): string {
  return referenceKey(file.sourcePath, file.scope);
}

function referenceCardKey(card: Pick<ReferenceCardState, "sourcePath" | "scope">): string {
  return referenceKey(card.sourcePath, card.scope);
}

function isReferenceFileInfo(value: unknown): value is ReferenceFileInfo {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<Record<keyof ReferenceFileInfo, unknown>>;
  return (
    typeof record.sourcePath === "string" &&
    typeof record.name === "string" &&
    (record.kind === "text" ||
      record.kind === "markdown" ||
      record.kind === "image" ||
      record.kind === "pdf" ||
      record.kind === "unknown") &&
    typeof record.size === "number"
  );
}

function makeReferenceFileInfo(
  sourcePath: string,
  kind: ReferenceKind = referenceKindFromPath(sourcePath),
  scope: ReferenceScope = "project",
): ReferenceFileInfo {
  return {
    scope,
    sourcePath,
    name: referenceNameFromPath(sourcePath),
    kind,
    size: 0,
    imported: sourcePath.replace(/[\\]+/g, "/").startsWith(".then/references/imports/"),
  };
}

function mergeReferenceFiles(...groups: ReferenceFileInfo[][]): ReferenceFileInfo[] {
  const merged = new Map<string, ReferenceFileInfo>();
    for (const group of groups) {
    for (const file of group) {
      const key = referenceFileKey(file);
      if (!merged.has(key)) merged.set(key, file);
    }
  }
  return [...merged.values()];
}

function upsertRecentReference(
  layout: ReferenceLayout,
  file: ReferenceFileInfo,
): ReferenceLayout {
  const key = referenceFileKey(file);
  return {
    ...layout,
    recent: [
      file,
      ...layout.recent.filter((item) => referenceFileKey(item) !== key),
    ].slice(0, MAX_RECENT_REFERENCES),
  };
}

function retargetReferenceSourcePath(
  sourcePath: string,
  oldSourcePath: string,
  newSourcePath: string,
): string | null {
  const normalizedSourcePath = sourcePath.replace(/\\/g, "/");
  const normalizedOldPath = oldSourcePath.replace(/\\/g, "/");
  const normalizedNewPath = newSourcePath.replace(/\\/g, "/");
  if (!normalizedOldPath || !normalizedNewPath) return null;
  if (normalizedSourcePath === normalizedOldPath) return normalizedNewPath;
  if (normalizedSourcePath.startsWith(`${normalizedOldPath}/`)) {
    return `${normalizedNewPath}${normalizedSourcePath.slice(normalizedOldPath.length)}`;
  }
  return null;
}

function retargetReferenceFileInfo(
  file: ReferenceFileInfo,
  oldSourcePath: string,
  newSourcePath: string,
): ReferenceFileInfo {
  if (file.scope !== "project") return file;
  const sourcePath = retargetReferenceSourcePath(file.sourcePath, oldSourcePath, newSourcePath);
  if (!sourcePath) return file;
  return {
    ...file,
    sourcePath,
    name: referenceNameFromPath(sourcePath),
    kind: referenceKindFromPath(sourcePath),
  };
}

function retargetReferenceCard(
  card: ReferenceCardState,
  oldSourcePath: string,
  newSourcePath: string,
): ReferenceCardState {
  if (card.scope !== "project") return card;
  const sourcePath = retargetReferenceSourcePath(card.sourcePath, oldSourcePath, newSourcePath);
  if (!sourcePath) return card;
  return {
    ...card,
    sourcePath,
    kind: referenceKindFromPath(sourcePath),
  };
}

function referenceInitialSize(kind: ReferenceKind): Pick<ReferenceCardState, "width" | "height"> {
  if (kind === "image") return { width: 360, height: 260 };
  if (kind === "pdf") return { width: 320, height: 280 };
  return { width: 320, height: 420 };
}

function isReferenceCardRecord(
  value: unknown,
): value is Partial<ReferenceCardState> & { id: string; sourcePath: string } {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && typeof record.sourcePath === "string";
}

function clampReferenceCardToStage(
  card: ReferenceCardState,
  stageWidth: number,
  stageHeight: number,
): ReferenceCardState {
  const width = Math.max(220, Math.min(card.width, Math.max(240, stageWidth - 24)));
  const height = Math.max(140, Math.min(card.height, Math.max(180, stageHeight - 24)));
  return {
    ...card,
    width,
    height,
    x: Math.max(0, Math.min(card.x, Math.max(0, stageWidth - width - 12))),
    y: Math.max(0, Math.min(card.y, Math.max(0, stageHeight - height - 12))),
  };
}

function normalizeReferenceLayout(
  value: unknown,
  stageSize: { width: number; height: number } = { width: 1200, height: 800 },
): ReferenceLayout {
  const raw = value as Partial<ReferenceLayout> | null;
  const cards: unknown[] = Array.isArray(raw?.cards) ? raw.cards : [];
  const recent: unknown[] = Array.isArray(raw?.recent) ? raw.recent : [];
  const normalizedCards = cards
    .filter(isReferenceCardRecord)
    .map((card, index) => {
      const kind =
        card.kind === "text" ||
        card.kind === "markdown" ||
        card.kind === "image" ||
        card.kind === "pdf" ||
        card.kind === "unknown"
          ? card.kind
          : referenceKindFromPath(card.sourcePath);
      const size = referenceInitialSize(kind);
      return clampReferenceCardToStage(
        {
          id: card.id,
          scope: normalizeReferenceScope(card.scope),
          sourcePath: card.sourcePath,
          kind,
          x: typeof card.x === "number" ? card.x : 72 + index * 32,
          y: typeof card.y === "number" ? card.y : 96 + index * 32,
          width: typeof card.width === "number" ? card.width : size.width,
          height: typeof card.height === "number" ? card.height : size.height,
          zIndex: typeof card.zIndex === "number" ? card.zIndex : index + 1,
          collapsed: Boolean(card.collapsed),
          pinned: Boolean(card.pinned),
          scrollTop: typeof card.scrollTop === "number" ? card.scrollTop : undefined,
          zoom: typeof card.zoom === "number" ? card.zoom : undefined,
          page: typeof card.page === "number" ? card.page : undefined,
          editing: false,
        },
        stageSize.width,
        stageSize.height,
      );
    });
  const normalizedRecent = recent
    .filter(isReferenceFileInfo)
    .map((file) => ({
      ...file,
      scope: normalizeReferenceScope(file.scope),
      imported: Boolean(file.imported),
    }));
  return {
    version: 1,
    name: typeof raw?.name === "string" && raw.name.trim() ? raw.name : "default",
    recent: mergeReferenceFiles(
      normalizedRecent,
      normalizedCards.map((card) => makeReferenceFileInfo(card.sourcePath, card.kind, card.scope)),
    )
      .slice(0, MAX_RECENT_REFERENCES),
    cards: normalizedCards,
  };
}

function nextReferenceZIndex(cards: ReferenceCardState[], pinned: boolean): number {
  const maxZ = cards
    .filter((card) => (pinned ? card.pinned : !card.pinned))
    .reduce((max, card) => Math.max(max, card.zIndex), pinned ? PINNED_REFERENCE_Z_BASE : 0);
  return pinned
    ? Math.max(PINNED_REFERENCE_Z_BASE, maxZ + 1)
    : Math.min(NORMAL_REFERENCE_Z_LIMIT, maxZ + 1);
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

function collectEditorFindMatches(
  documentAst: DocumentAst,
  rawQuery: string,
  maxResults = 500,
): EditorFindMatch[] {
  const query = rawQuery.trim();
  if (!query) return [];

  const normalizedQuery = query.toLocaleLowerCase();
  const matches: EditorFindMatch[] = [];

  for (const block of documentAst.blocks) {
    const source = block.source;
    const normalizedSource = source.toLocaleLowerCase();
    let from = 0;
    let matchIndex = 0;

    while (from <= normalizedSource.length) {
      const index = normalizedSource.indexOf(normalizedQuery, from);
      if (index < 0) break;

      const absoluteFrom = block.from + index;
      matches.push({
        id: `editor-find:${block.lineIndex}:${index}:${matchIndex}:${normalizedQuery}`,
        from: absoluteFrom,
        to: absoluteFrom + query.length,
        line: block.lineIndex + 1,
        column: index + 1,
        excerpt: source,
      });

      if (matches.length >= maxResults) return matches;
      from = index + Math.max(1, normalizedQuery.length);
      matchIndex += 1;
    }
  }

  return matches;
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
      zoneMode:
        typeof settings.zoneMode === "boolean"
          ? settings.zoneMode
          : defaultSettings.zoneMode,
      zoneModeOpacity:
        typeof settings.zoneModeOpacity === "number" && Number.isFinite(settings.zoneModeOpacity)
          ? Math.min(0.85, Math.max(0, settings.zoneModeOpacity))
          : defaultSettings.zoneModeOpacity,
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
      checkpointSectionCollapsed:
        typeof settings.checkpointSectionCollapsed === "boolean"
          ? settings.checkpointSectionCollapsed
          : defaultSettings.checkpointSectionCollapsed,
      typewriterScroll:
        typeof settings.typewriterScroll === "boolean"
          ? settings.typewriterScroll
          : defaultSettings.typewriterScroll,
      typewriterOffset:
        typeof settings.typewriterOffset === "number" && Number.isFinite(settings.typewriterOffset)
          ? Math.min(65, Math.max(30, settings.typewriterOffset))
          : defaultSettings.typewriterOffset,
      writingMode:
        settings.writingMode === "horizontal-tb" || settings.writingMode === "vertical-rl"
          ? settings.writingMode
          : defaultSettings.writingMode,
      canvasDefaultWritingMode:
        settings.canvasDefaultWritingMode === "horizontal-tb" ||
        settings.canvasDefaultWritingMode === "vertical-rl"
          ? settings.canvasDefaultWritingMode
          : defaultSettings.canvasDefaultWritingMode,
      canvasDefaultFontSource:
        settings.canvasDefaultFontSource === "editor" || settings.canvasDefaultFontSource === "ui"
          ? settings.canvasDefaultFontSource
          : defaultSettings.canvasDefaultFontSource,
      plotFontSource:
        settings.plotFontSource === "editor" || settings.plotFontSource === "ui"
          ? settings.plotFontSource
          : defaultSettings.plotFontSource,
      editorMeasureHorizontal: normalizeEditorMeasure(settings.editorMeasureHorizontal),
      editorMeasureVertical: normalizeEditorMeasure(settings.editorMeasureVertical),
      headingFontSource:
        settings.headingFontSource === "custom" || settings.headingFontSource === "body"
          ? settings.headingFontSource
          : defaultSettings.headingFontSource,
      headingFontFamily: normalizeStoredFontFamily(
        settings.headingFontFamily,
        defaultSettings.headingFontFamily,
      ),
      canvasOpensInWindow:
        typeof settings.canvasOpensInWindow === "boolean"
          ? settings.canvasOpensInWindow
          : defaultSettings.canvasOpensInWindow,
      exportOpensInWindow:
        typeof settings.exportOpensInWindow === "boolean"
          ? settings.exportOpensInWindow
          : defaultSettings.exportOpensInWindow,
    },
    lastWorkspacePath:
      typeof value?.lastWorkspacePath === "string" ? value.lastWorkspacePath : null,
    lastFilePath: typeof value?.lastFilePath === "string" ? value.lastFilePath : null,
    recentWorkspaces,
    fileProgress: normalizeFileProgress(value?.fileProgress),
    cursorPositions: normalizeCursorPositions(value?.cursorPositions),
    snapshots: normalizeSnapshots(value?.snapshots),
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

async function loadReferenceLayout(folderPath: string): Promise<ReferenceLayout> {
  if (!isTauriRuntime()) return defaultReferenceLayout;
  const layout = await invoke<ReferenceLayout>("load_reference_layout", { rootPath: folderPath });
  return normalizeReferenceLayout(layout);
}

async function saveReferenceLayout(folderPath: string, layout: ReferenceLayout): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("save_reference_layout", { rootPath: folderPath, layout });
}

async function listReferenceCandidates(folderPath: string): Promise<ReferenceFileInfo[]> {
  if (!isTauriRuntime()) return [];
  return await invoke<ReferenceFileInfo[]>("list_reference_candidates", {
    rootPath: folderPath,
    scope: "all",
  });
}

async function listCanvasBoards(
  scope: CanvasScope,
  rootPath: string | null,
): Promise<CanvasBoardSummary[]> {
  if (!isTauriRuntime()) return [];
  return await invoke<CanvasBoardSummary[]>("list_canvas_boards", { scope, rootPath });
}

async function createCanvasBoard(
  scope: CanvasScope,
  rootPath: string | null,
  name: string,
): Promise<CanvasBoardSummary> {
  if (!isTauriRuntime()) {
    return {
      id: "browser-preview",
      name,
      path: "",
      scope,
      updatedAt: Date.now(),
      nodeCount: 0,
      edgeCount: 0,
    };
  }
  return await invoke<CanvasBoardSummary>("create_canvas_board", { scope, rootPath, name });
}

async function loadCanvasBoard(
  scope: CanvasScope,
  rootPath: string | null,
  boardId: string,
): Promise<JsonCanvasDocument> {
  if (!isTauriRuntime()) return createCanvasDocument("Idea Board", scope);
  const board = await invoke<unknown>("load_canvas_board", { scope, rootPath, boardId });
  return normalizeCanvasDocument(board, "Idea Board", scope);
}

async function saveCanvasBoard(
  scope: CanvasScope,
  rootPath: string | null,
  boardId: string,
  board: JsonCanvasDocument,
): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("save_canvas_board", { scope, rootPath, boardId, board });
}

async function ensureCanvasBoard(
  scope: CanvasScope,
  rootPath: string | null,
  name: string,
): Promise<CanvasBoardSummary> {
  const boards = await listCanvasBoards(scope, rootPath);
  if (boards.length > 0) return boards[0];
  return await createCanvasBoard(scope, rootPath, name);
}

function nextCanvasPlacement(board: JsonCanvasDocument) {
  const textNodes = board.nodes.filter((node) => node.type === "text");
  if (textNodes.length === 0) return { x: 120, y: 120 };
  const last = textNodes.reduce((rightmost, node) =>
    node.x + node.width > rightmost.x + rightmost.width ? node : rightmost,
  );
  return {
    x: last.x + 32,
    y: last.y + 32,
  };
}

export default function App() {
  const saveTimerRef = useRef<number | null>(null);
  const referenceSaveTimerRef = useRef<number | null>(null);
  const referenceLayoutLoadedRootRef = useRef<string | null>(null);
  const activeTabIdRef = useRef("initial-document-tab");
  const documentSaveQueuesRef = useRef<Map<string, DocumentSaveQueue>>(new Map());
  const headingMoveInProgressRef = useRef(false);
  const projectEntryPathChangeInProgressRef = useRef(false);
  const workspaceSwitchInProgressRef = useRef(false);
  const workspaceSwitchGenerationRef = useRef(0);
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
  const editorFindInputRef = useRef<HTMLInputElement | null>(null);
  const fileMenuRef = useRef<HTMLDivElement | null>(null);
  const breadcrumbMenuRef = useRef<HTMLDivElement | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
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
  const [editorFind, setEditorFind] = useState<EditorFindState>({
    open: false,
    query: "",
    replaceValue: "",
    showReplace: false,
    activeIndex: 0,
  });
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
  // ドロップ先インジケーターの位置（縦書きは left, 横書きは top の px）。
  const [dropIndicatorPos, setDropIndicatorPos] = useState<number | null>(null);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  /** エディタのスクロール領域の実測内寸。文字表示幅設定の上限算出に使う。 */
  const [editorViewportSize, setEditorViewportSize] = useState<{
    width: number;
    height: number;
    verticalPadding: number;
  } | null>(null);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isQuickIdeaModalOpen, setIsQuickIdeaModalOpen] = useState(false);
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
  /**
   * メイン画面のモード。write=本文（左右サイドバー）、canvas=キャンバス（右のみ）、
   * export=エクスポート（サイドバーなし）。canvas/export は設定により別ウィンドウ
   * 起動へ切り替わる。
   */
  const [appMode, setAppMode] = useState<"write" | "canvas" | "export">("write");
  const [canvasEmbedPayload, setCanvasEmbedPayload] = useState<CanvasWindowPayload | null>(null);
  const [exportEmbedPayload, setExportEmbedPayload] = useState<{
    requestId: string;
    title: string;
    sources: LoadedExportSource[];
    sourceError?: string;
  } | null>(null);
  const [rightSidebarTab, setRightSidebarTab] = useState<"idea" | "plot" | "reference">("plot");
  const [isPlotManagerOpen, setIsPlotManagerOpen] = useState(false);
  const [ideaFocusRequest, setIdeaFocusRequest] = useState<{
    threadId: string;
    fragmentId?: string;
    nonce: number;
  } | null>(null);
  const [referenceLayout, setReferenceLayout] =
    useState<ReferenceLayout>(() => defaultReferenceLayout);
  const [referenceCandidates, setReferenceCandidates] = useState<ReferenceFileInfo[]>([]);
  const [referenceQuery, setReferenceQuery] = useState("");

  const addPlotSection = useCallback(() => {
    setPlotCards((current) => appendPlotSection(current));
  }, []);

  const addPlotChapter = useCallback(() => {
    setPlotCards((current) => appendPlotChapter(current));
  }, []);

  const patchReferenceLayout = useCallback(
    (updater: (layout: ReferenceLayout) => ReferenceLayout) => {
      setReferenceLayout((current) => updater(current));
    },
    [],
  );

  const focusReferenceCard = useCallback((cardId: string) => {
    setReferenceLayout((current) => {
      const stage = workspaceRef.current?.getBoundingClientRect();
      return {
        ...current,
        cards: current.cards.map((card) => {
          if (card.id !== cardId) return card;
          const width = card.width;
          const height = card.height;
          return {
            ...card,
            collapsed: false,
            zIndex: nextReferenceZIndex(current.cards, card.pinned),
            x: stage ? Math.max(0, (stage.width - width) / 2) : card.x,
            y: stage ? Math.max(0, (stage.height - height) / 2) : card.y,
          };
        }),
      };
    });
  }, []);

  const closeReferenceCard = useCallback((cardId: string) => {
    setReferenceLayout((current) => ({
      ...current,
      cards: current.cards.filter((card) => card.id !== cardId),
    }));
  }, []);

  const pinReferenceCard = useCallback((cardId: string, pinned: boolean) => {
    setReferenceLayout((current) => ({
      ...current,
      cards: current.cards.map((card) =>
        card.id === cardId
          ? { ...card, pinned, zIndex: nextReferenceZIndex(current.cards, pinned) }
          : card,
      ),
    }));
  }, []);

  const openReferenceCard = useCallback(
    (
      sourcePath: string,
      fileInfo?: ReferenceFileInfo,
      options: { switchToReferenceTab?: boolean } = {},
    ) => {
      const { switchToReferenceTab = true } = options;
      if (!projectFolder) {
        showToast("先にフォルダを開いてください");
        return;
      }

      setReferenceLayout((current) => {
        const file = fileInfo ?? makeReferenceFileInfo(sourcePath);
        const nextLayout = upsertRecentReference(current, file);
        const fileKey = referenceFileKey(file);
        const existing = current.cards.find((card) => referenceCardKey(card) === fileKey);
        if (existing) {
          return {
            ...nextLayout,
            cards: nextLayout.cards.map((card) =>
              card.id === existing.id
                ? {
                    ...card,
                    zIndex: nextReferenceZIndex(nextLayout.cards, card.pinned),
                    collapsed: false,
                  }
                : card,
            ),
          };
        }

        const index = nextLayout.cards.length;
        const kind = file.kind;
        const size = referenceInitialSize(kind);
        const stageRect = workspaceRef.current?.getBoundingClientRect();
        const editorRect = editorShellRef.current?.getBoundingClientRect();
        const originX = editorRect && stageRect ? editorRect.left - stageRect.left : 0;
        const originY = editorRect && stageRect ? editorRect.top - stageRect.top : 0;
        const card = clampReferenceCardToStage(
          {
            id: `ref-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            scope: file.scope,
            sourcePath,
            kind,
            x: originX + 72 + index * 32,
            y: originY + 96 + index * 32,
            width: size.width,
            height: size.height,
            zIndex: nextReferenceZIndex(nextLayout.cards, false),
            collapsed: false,
            pinned: false,
            page: kind === "pdf" ? 1 : undefined,
            zoom: kind === "image" || kind === "pdf" ? 1 : undefined,
          },
          stageRect?.width ?? 1200,
          stageRect?.height ?? 800,
        );
        return { ...nextLayout, cards: [...nextLayout.cards, card] };
      });
      if (switchToReferenceTab) setRightSidebarTab("reference");
    },
    [projectFolder],
  );

  const handleAddReference = useCallback(async (scope: ReferenceScope = "project") => {
    if (scope === "project" && !projectFolder) {
      showToast("先にフォルダを開いてください");
      return;
    }
    if (!isTauriRuntime()) {
      showToast("資料の追加はTauri版で利用できます");
      return;
    }

    try {
      const file = await invoke<ReferenceFileInfo | null>("pick_reference_file", {
        rootPath: projectFolder?.path ?? null,
        scope,
      });
      if (!file) return;
      setReferenceCandidates((current) =>
        mergeReferenceFiles([file], current).sort((left, right) =>
          left.sourcePath.localeCompare(right.sourcePath),
        ),
      );
      openReferenceCard(file.sourcePath, file);
    } catch (error) {
      setLastError(String(error));
      showToast("資料を追加できませんでした");
    }
  }, [openReferenceCard, projectFolder]);

  const handleCreateReference = useCallback(async (scope: ReferenceScope = "project") => {
    if (scope === "project" && !projectFolder) {
      showToast("先にフォルダを開いてください");
      return;
    }
    if (!isTauriRuntime()) {
      showToast("資料の作成はTauri版で利用できます");
      return;
    }

    const name = await new Promise<string | null>((resolve) => {
      setAppDialog({
        type: "input",
        title: "資料を新規作成",
        label: "ファイル名（.txt / .md）",
        value: "新しい資料.md",
        confirmLabel: "作成",
        placeholder: "例: 世界観メモ.md",
        error: "",
        resolve,
      });
    });
    if (!name) return;

    try {
      const file = await invoke<ReferenceFileInfo>("create_reference_text_file", {
        rootPath: projectFolder?.path ?? null,
        scope,
        name,
      });
      setReferenceCandidates((current) =>
        mergeReferenceFiles([file], current).sort((left, right) =>
          left.sourcePath.localeCompare(right.sourcePath),
        ),
      );
      openReferenceCard(file.sourcePath, file);
    } catch (error) {
      setLastError(String(error));
      showToast("資料を作成できませんでした");
    }
  }, [openReferenceCard, projectFolder]);

  const handleDeleteImportedReference = useCallback(
    async (sourcePath: string, scope: ReferenceScope = "project") => {
      if (scope === "project" && !projectFolder) return;
      const fileName = sourcePath.split(/[\\/]/).filter(Boolean).pop() ?? sourcePath;
      const confirmed = await new Promise<boolean>((resolve) => {
        setAppDialog({
          type: "confirm",
          title: "資料を削除",
          message: `「${fileName}」を資料ライブラリから削除しますか？`,
          detail:
            "取り込んだコピーだけを削除します。元ファイルが別の場所にある場合、その元ファイルは削除されません。",
          confirmLabel: "削除",
          danger: true,
          resolve,
        });
      });
      if (!confirmed) return;

      try {
        await invoke("delete_imported_reference", {
          rootPath: projectFolder?.path ?? null,
          sourcePath,
          scope,
        });
        const deletedKey = referenceKey(sourcePath, scope);
        setReferenceLayout((current) => ({
          ...current,
          cards: current.cards.filter(
            (card) => referenceCardKey(card) !== deletedKey,
          ),
          recent: current.recent.filter(
            (file) => referenceFileKey(file) !== deletedKey,
          ),
        }));
        setReferenceCandidates((current) =>
          current.filter((file) => referenceFileKey(file) !== deletedKey),
        );
        showToast(`「${fileName}」を削除しました`);
      } catch (error) {
        setLastError(String(error));
        showToast("資料を削除できませんでした");
      }
    },
    [projectFolder],
  );

  const handleCopyReferenceToScope = useCallback(
    async (file: ReferenceFileInfo, targetScope: ReferenceScope) => {
      if (targetScope === "project" && !projectFolder) {
        showToast("先にフォルダを開いてください");
        return;
      }
      if (file.scope === targetScope) return;
      if (!isTauriRuntime()) {
        showToast("資料のコピーはTauri版で利用できます");
        return;
      }

      try {
        const copied = await invoke<ReferenceFileInfo>("copy_reference_to_scope", {
          rootPath: projectFolder?.path ?? null,
          sourcePath: file.sourcePath,
          sourceScope: file.scope,
          targetScope,
        });
        setReferenceCandidates((current) =>
          mergeReferenceFiles([copied], current).sort((left, right) =>
            left.sourcePath.localeCompare(right.sourcePath),
          ),
        );
        setReferenceLayout((current) => upsertRecentReference(current, copied));
        showToast(targetScope === "global" ? "共通資料へコピーしました" : "プロジェクト資料へコピーしました");
      } catch (error) {
        setLastError(String(error));
        showToast("資料をコピーできませんでした");
      }
    },
    [projectFolder],
  );

  const handleMoveReferenceToScope = useCallback(
    async (file: ReferenceFileInfo, targetScope: ReferenceScope) => {
      if (targetScope === "project" && !projectFolder) {
        showToast("先にフォルダを開いてください");
        return;
      }
      if (file.scope === targetScope) return;
      if (!file.imported) {
        showToast("取り込んだ資料だけ移転できます");
        return;
      }
      if (!isTauriRuntime()) {
        showToast("資料の移転はTauri版で利用できます");
        return;
      }

      const confirmed = await new Promise<boolean>((resolve) => {
        setAppDialog({
          type: "confirm",
          title: "資料を移転",
          message: `「${file.name}」を${targetScope === "global" ? "共通" : "プロジェクト"}へ移転しますか？`,
          detail: "移転元の取り込みコピーは削除され、開いている資料カードも移転先へ付け替えます。",
          confirmLabel: "移転",
          danger: false,
          resolve,
        });
      });
      if (!confirmed) return;

      try {
        const moved = await invoke<ReferenceFileInfo>("move_reference_to_scope", {
          rootPath: projectFolder?.path ?? null,
          sourcePath: file.sourcePath,
          sourceScope: file.scope,
          targetScope,
        });
        const oldKey = referenceFileKey(file);
        setReferenceCandidates((current) =>
          mergeReferenceFiles([moved], current.filter((item) => referenceFileKey(item) !== oldKey)).sort(
            (left, right) => left.sourcePath.localeCompare(right.sourcePath),
          ),
        );
        setReferenceLayout((current) => {
          const withoutOld = {
            ...current,
            recent: current.recent.filter((item) => referenceFileKey(item) !== oldKey),
          };
          const nextLayout = upsertRecentReference(withoutOld, moved);
          return {
            ...nextLayout,
            cards: nextLayout.cards.map((card) =>
              referenceCardKey(card) === oldKey
                ? {
                    ...card,
                    scope: moved.scope,
                    sourcePath: moved.sourcePath,
                    kind: moved.kind,
                  }
                : card,
            ),
          };
        });
        showToast("資料を移転しました");
      } catch (error) {
        setLastError(String(error));
        showToast("資料を移転できませんでした");
      }
    },
    [projectFolder],
  );

  const returnFocusToEditor = useCallback(() => {
    editorInstanceRef.current?.focus();
  }, []);

  const handleReferenceTextSaved = useCallback(
    (sourcePath: string, scope: ReferenceScope, text: string) => {
      if (!projectFolder || scope !== "project") return;
      const file = collectProjectTextFiles(projectFolder).find(
        (item) =>
          toProjectRelativePath(projectFolder.path, item.path).toLocaleLowerCase() ===
          sourcePath.toLocaleLowerCase(),
      );
      if (!file) return;

      setProjectAst((current) =>
        current && current.rootPath === projectFolder.path
          ? upsertProjectAstDocument(current, {
              path: file.path,
              name: file.name,
              text: parseFrontMatter(text).body,
            })
          : current,
      );

      setOpenTabs((current) =>
        current.map((tab) => {
          if (tab.path !== file.path) return tab;
          if (tab.id === activeTabIdRef.current) {
            lastSavedMarkdownRef.current = text;
            setAppState((state) => ({ ...state, markdown: text }));
          }
          return {
            ...tab,
            markdown: text,
            savedMarkdown: text,
            saveStatus: "saved",
            editorRevision: null,
          };
        }),
      );
    },
    [projectFolder],
  );

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
  const currentWorkspaceSnapshots = useMemo(() => {
    if (!projectFolder) return [];
    return appState.snapshots
      .filter((snapshot) => isSamePath(snapshot.workspacePath, projectFolder.path))
      .sort((left, right) => right.createdAt - left.createdAt);
  }, [appState.snapshots, projectFolder]);
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
  const editorFindMatches = useMemo(
    () => collectEditorFindMatches(activeDocumentAst, editorFind.query),
    [activeDocumentAst, editorFind.query],
  );
  const activeEditorFindIndex =
    editorFindMatches.length === 0
      ? -1
      : Math.min(editorFind.activeIndex, editorFindMatches.length - 1);
  useEffect(() => {
    if (!editorFind.open) return;
    if (editorFind.activeIndex < editorFindMatches.length) return;
    setEditorFind((current) => ({
      ...current,
      activeIndex: Math.max(0, editorFindMatches.length - 1),
    }));
  }, [editorFind.activeIndex, editorFind.open, editorFindMatches.length]);
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
  const sortedReferenceCandidates = useMemo(() => {
    const candidates = mergeReferenceFiles(referenceLayout.recent, referenceCandidates);
    const recentIndex = new Map(
      referenceLayout.recent.map((file, index) => [referenceFileKey(file), index]),
    );
    if (!projectFolder) return candidates;
    const manuscriptPaths = new Set(
      collectProjectTextFiles(projectFolder).map((file) =>
        toProjectRelativePath(projectFolder.path, file.path).toLocaleLowerCase(),
      ),
    );
    return candidates
      .filter((file) => file.scope !== "project" || !manuscriptPaths.has(file.sourcePath.toLocaleLowerCase()))
      .sort((left, right) => {
        const leftIsManuscript =
          left.scope === "project" && manuscriptPaths.has(left.sourcePath.toLocaleLowerCase());
        const rightIsManuscript =
          right.scope === "project" && manuscriptPaths.has(right.sourcePath.toLocaleLowerCase());
        if (leftIsManuscript !== rightIsManuscript) return leftIsManuscript ? 1 : -1;
        const leftRecentIndex = recentIndex.get(referenceFileKey(left));
        const rightRecentIndex = recentIndex.get(referenceFileKey(right));
        if (leftRecentIndex !== undefined && rightRecentIndex !== undefined) {
          return leftRecentIndex - rightRecentIndex;
        }
        if (leftRecentIndex !== undefined) return -1;
        if (rightRecentIndex !== undefined) return 1;
        if (left.scope !== right.scope) return left.scope === "global" ? -1 : 1;
        return left.sourcePath.localeCompare(right.sourcePath);
      });
  }, [projectFolder, referenceCandidates, referenceLayout.recent]);

  const openPlotReference = useCallback(
    (sourcePath: string, fileInfo: ReferenceFileInfo) => {
      const file =
        sortedReferenceCandidates.find(
          (item) =>
            item.scope === fileInfo.scope &&
            item.sourcePath.toLocaleLowerCase() === sourcePath.toLocaleLowerCase(),
        ) ?? fileInfo;
      openReferenceCard(file.sourcePath, file, { switchToReferenceTab: false });
    },
    [openReferenceCard, sortedReferenceCandidates],
  );

  useEffect(() => {
    if (!projectFolder) {
      projectAstBuildIdRef.current += 1;
      setProjectAst(null);
      setProjectSearchQuery("");
      referenceLayoutLoadedRootRef.current = null;
      setReferenceLayout(defaultReferenceLayout);
      setReferenceCandidates([]);
      setReferenceQuery("");
      return;
    }

    setProjectAst((current) => createProjectAstSkeleton(projectFolder, current));
  }, [projectFolder]);

  useEffect(() => {
    if (!isHydrated || !projectFolder) return;

    let isCancelled = false;
    const rootPath = projectFolder.path;
    referenceLayoutLoadedRootRef.current = null;

    const loadReferences = async () => {
      try {
        const rect = editorShellRef.current?.getBoundingClientRect();
        const [layout, candidates] = await Promise.all([
          loadReferenceLayout(rootPath),
          listReferenceCandidates(rootPath),
        ]);
        if (isCancelled) return;
        const normalizedLayout = normalizeReferenceLayout(layout, {
          width: rect?.width ?? 1200,
          height: rect?.height ?? 800,
        });
        setReferenceLayout(normalizedLayout);
        setReferenceCandidates(mergeReferenceFiles(normalizedLayout.recent, candidates));
        referenceLayoutLoadedRootRef.current = rootPath;
      } catch (error) {
        if (isCancelled) return;
        setReferenceLayout(defaultReferenceLayout);
        setReferenceCandidates([]);
        referenceLayoutLoadedRootRef.current = rootPath;
        setLastError(String(error));
      }
    };

    void loadReferences();

    return () => {
      isCancelled = true;
    };
  }, [isHydrated, projectFolder]);

  useEffect(() => {
    const rootPath = projectFolder?.path ?? null;
    if (!isHydrated || !rootPath || referenceLayoutLoadedRootRef.current !== rootPath) return;

    if (referenceSaveTimerRef.current) {
      window.clearTimeout(referenceSaveTimerRef.current);
    }

    referenceSaveTimerRef.current = window.setTimeout(() => {
      saveReferenceLayout(rootPath, referenceLayout)
        .catch((error) => {
          setLastError(String(error));
        })
        .finally(() => {
          referenceSaveTimerRef.current = null;
        });
    }, 700);

    return () => {
      if (referenceSaveTimerRef.current) {
        window.clearTimeout(referenceSaveTimerRef.current);
        referenceSaveTimerRef.current = null;
      }
    };
  }, [isHydrated, projectFolder?.path, referenceLayout]);

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
      referenceLayoutLoadedRootRef.current = null;
      setReferenceLayout(defaultReferenceLayout);
      setReferenceCandidates([]);
      setReferenceQuery("");
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
    if (workspaceSwitchInProgressRef.current) return;
    if (!currentFilePath || !activeWorkspaceRootPath) return;
    if (snippetWorkspacePath === activeWorkspaceRootPath && projectFolder?.path === activeWorkspaceRootPath) {
      return;
    }

    let isCancelled = false;
    const workspaceSwitchGeneration = workspaceSwitchGenerationRef.current;

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
        if (workspaceSwitchGeneration !== workspaceSwitchGenerationRef.current) return;
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
        if (workspaceSwitchGeneration !== workspaceSwitchGenerationRef.current) return;
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
    if (projectEntryPathChangeInProgressRef.current) return;
    if (markdown === lastSavedMarkdownRef.current) {
      setSaveStatus("saved");
      return;
    }

    setSaveStatus("dirty");
    const timer = window.setTimeout(() => {
      if (projectEntryPathChangeInProgressRef.current) return;
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
      setIsQuickIdeaModalOpen(false);
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

  const handleEditorViewportSizeChange = useCallback(
    (size: { width: number; height: number; verticalPadding: number } | null) => {
      setEditorViewportSize(size);
    },
    [],
  );

  /**
   * 文字表示幅 100% に相当する実測px。横書きは左右ガター 64px（App.css の
   * `calc(100% - 64px)` と対応）、縦書きは .pm-root の上下パディング実測値を
   * 引いた編集領域。設定 UI で百分率の実寸を表示するために使う。
   */
  const editorMeasureLimit = useMemo(() => {
    if (!editorViewportSize) return null;
    const available =
      settings.writingMode === "horizontal-tb"
        ? editorViewportSize.width - 64
        : editorViewportSize.height - editorViewportSize.verticalPadding;
    return Math.max(0, Math.floor(available));
  }, [editorViewportSize, settings.writingMode]);

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
    if (!settings.typewriterScroll) {
      if (typewriterScrollFrameRef.current) {
        window.cancelAnimationFrame(typewriterScrollFrameRef.current);
        typewriterScrollFrameRef.current = null;
      }
      return;
    }
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

  const openIdeaCanvasBoard = async (
    scope: CanvasScope = projectFolder ? "project" : "global",
    boardId?: string,
    selectNodeId?: string,
  ) => {
    if (scope === "project" && !projectFolder) {
      showToast("Project Canvas はプロジェクトを開いている時に利用できます");
      return;
    }

    const payload: CanvasWindowPayload = {
      requestId: String(Date.now()),
      rootPath: scope === "project" ? projectFolder?.path ?? null : null,
      workspaceName: scope === "project" ? projectFolder?.name ?? "Project" : "Global",
      scope,
      boardId,
      selectNodeId,
      theme: settings.theme,
      editorFontFamily: settings.editorFontFamily,
      uiFontFamily: settings.uiFontFamily,
      uiFontScale: settings.uiFontScale,
      canvasDefaultWritingMode: settings.canvasDefaultWritingMode,
      canvasDefaultFontSource: settings.canvasDefaultFontSource,
      ideaThreads: snippets.map((thread) => ({
        id: thread.id,
        kind: thread.kind,
        title: thread.title,
        fragments: thread.fragments.map((fragment) => ({
          id: fragment.id,
          body: fragment.body,
          used: fragment.used,
        })),
      })),
      referenceFiles: projectFolder ? sortedReferenceCandidates : [],
      rightSidebarVisible: !isRightSidebarCollapsed,
    };

    if (!settings.canvasOpensInWindow) {
      // メイン画面のキャンバスモードとして開く。
      setCanvasEmbedPayload(payload);
      setAppMode("canvas");
      return;
    }

    if (!isTauriRuntime()) {
      window.open("?view=canvas", "_blank", "noopener,noreferrer");
      return;
    }

    try {
      await invoke("open_canvas_window", { payload });
    } catch (error) {
      setLastError(String(error));
      showToast("Idea Board を開けませんでした");
    }
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
      x: event.clientX,
      y: event.clientY,
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

  const focusEditorFindInput = () => {
    window.requestAnimationFrame(() => {
      editorFindInputRef.current?.focus();
      editorFindInputRef.current?.select();
    });
  };

  const selectEditorFindMatch = (match: EditorFindMatch | null | undefined) => {
    const editor = editorInstanceRef.current;
    if (!editor || !match) return;
    editor.selectRange(match.from, match.to);
  };

  const openEditorFind = () => {
    const editor = editorInstanceRef.current;
    if (!editor) return;
    let nextQuery = editorFind.query;
    const selection = normalizeSelectionRange(editor.getSelection(), editor.getValue());
    if (selection.from !== selection.to && !selection.text.includes("\n")) {
      nextQuery = selection.text;
    }
    setEditorFind((current) => ({
      ...current,
      open: true,
      query: nextQuery,
      activeIndex: 0,
    }));
    focusEditorFindInput();
  };

  const closeEditorFind = () => {
    setEditorFind((current) => ({ ...current, open: false }));
    editorInstanceRef.current?.focus();
  };

  const moveEditorFindMatch = (delta: number) => {
    if (editorFindMatches.length === 0) return;
    const currentIndex = activeEditorFindIndex < 0 ? 0 : activeEditorFindIndex;
    const nextIndex =
      (currentIndex + delta + editorFindMatches.length) % editorFindMatches.length;
    setEditorFind((current) => ({ ...current, activeIndex: nextIndex }));
    selectEditorFindMatch(editorFindMatches[nextIndex]);
  };

  const replaceActiveEditorFindMatch = () => {
    const editor = editorInstanceRef.current;
    if (!editor || activeEditorFindIndex < 0) return;
    const match = editorFindMatches[activeEditorFindIndex];
    editor.replaceRange(
      match.from,
      match.to,
      editorFind.replaceValue,
      match.from + editorFind.replaceValue.length,
    );
    setEditorFind((current) => ({
      ...current,
      activeIndex: Math.min(current.activeIndex, Math.max(0, editorFindMatches.length - 2)),
    }));
  };

  const replaceAllEditorFindMatches = () => {
    const editor = editorInstanceRef.current;
    if (!editor || !editorFind.query.trim()) return;
    const currentText = editor.getValue();
    const result = replaceLiteralMatches(currentText, editorFind.query, editorFind.replaceValue);
    if (result.count === 0) {
      showToast("置換できる一致がありません");
      return;
    }
    editor.replaceRange(0, currentText.length, result.text, 0);
    setEditorFind((current) => ({ ...current, activeIndex: 0 }));
    showToast(`${result.count}件を置換しました`);
  };

  const handleEditorFindQueryChange = (value: string) => {
    setEditorFind((current) => ({ ...current, query: value, activeIndex: 0 }));
  };

  const handleEditorFindKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeEditorFind();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      moveEditorFindMatch(event.shiftKey ? -1 : 1);
    }
  };

  // 最新のクロージャを常に参照するため、ハンドラ本体は ref 経由で呼び出す。
  const editorShortcutHandlerRef = useRef<(event: KeyboardEvent) => void>(() => {});
  editorShortcutHandlerRef.current = (event: KeyboardEvent) => {
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key;

    // Ctrl+Alt+I：Idea ペインを開かずにメモを追加する。
    if (mod && event.altKey && !event.shiftKey && (key === "i" || key === "I")) {
      event.preventDefault();
      setIsCommandPaletteOpen(false);
      setIsQuickIdeaModalOpen(true);
      return;
    }

    if (mod && event.altKey && !event.shiftKey && (key === "b" || key === "B")) {
      event.preventDefault();
      setIsCommandPaletteOpen(false);
      void openIdeaCanvasBoard(projectFolder ? "project" : "global");
      return;
    }

    if (!mod || event.altKey) return;

    if (key === "f" || key === "F") {
      event.preventDefault();
      setIsCommandPaletteOpen(false);
      openEditorFind();
      return;
    }

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
        id: "idea-quick-capture",
        label: "Idea にメモを追加…",
        hint: "Ctrl+Alt+I",
        run: () => setIsQuickIdeaModalOpen(true),
      },
      {
        id: "idea-board-open",
        label: "Idea Board を開く",
        hint: "Ctrl+Alt+B",
        run: () => void openIdeaCanvasBoard(projectFolder ? "project" : "global"),
      },
      {
        id: "idea-board-project",
        label: "Project Canvas を開く",
        hint: "Canvas",
        disabledReason: projectFolder ? undefined : "プロジェクトを開いてください",
        run: () => void openIdeaCanvasBoard("project"),
      },
      {
        id: "idea-board-global",
        label: "Global Canvas を開く",
        hint: "Canvas",
        run: () => void openIdeaCanvasBoard("global"),
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
    optional = false,
  }: {
    title: string;
    label: string;
    initialValue: string;
    confirmLabel: string;
    placeholder?: string;
    optional?: boolean;
  }) =>
    new Promise<string | null>((resolve) => {
      setAppDialog({
        type: "input",
        title,
        label,
        value: initialValue,
        confirmLabel,
        placeholder,
        optional,
        error: "",
        resolve,
      });
    });

  const requestMultiInput = ({
    title,
    fields,
    confirmLabel,
  }: {
    title: string;
    fields: {
      id: string;
      label: string;
      initialValue: string;
      placeholder?: string;
      optional?: boolean;
      multiline?: boolean;
    }[];
    confirmLabel: string;
  }) =>
    new Promise<Record<string, string> | null>((resolve) => {
      setAppDialog({
        type: "multiInput",
        title,
        fields: fields.map((field) => ({
          id: field.id,
          label: field.label,
          value: field.initialValue,
          placeholder: field.placeholder,
          optional: field.optional,
          multiline: field.multiline,
        })),
        confirmLabel,
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
      } else if (current.type === "multiInput") {
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
      if (current.type === "multiInput") {
        const values: Record<string, string> = {};
        for (const field of current.fields) {
          const value = field.value.trim();
          if (!value && !field.optional) {
            return { ...current, error: `${field.label}を入力してください` };
          }
          values[field.id] = value;
        }
        current.resolve(values);
        return null;
      }

      const value = current.value.trim();
      if (!value && !current.optional) {
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

  const updateAppDialogFieldValue = (fieldId: string, value: string) => {
    setAppDialog((current) =>
      current?.type === "multiInput"
        ? {
            ...current,
            fields: current.fields.map((field) =>
              field.id === fieldId ? { ...field, value } : field,
            ),
            error: "",
          }
        : current,
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

  const buildManuscriptSnapshot = useCallback(
    (
      label: string,
      memo: string,
      reason: ManuscriptSnapshot["reason"],
      parentIds: string[] = [],
    ): ManuscriptSnapshot => {
      if (!projectFolder) {
        throw new Error("先にフォルダを開いてください");
      }

      const openTabsByPath = new Map(
        openTabs
          .filter((tab): tab is DocumentTab & { path: string } => Boolean(tab.path))
          .map((tab) => [tab.path, tab] as const),
      );
      const astFilesByPath = new Map(
        projectAst?.rootPath === projectFolder.path
          ? projectAst.files.map((file) => [file.path, file] as const)
          : [],
      );
      const missing: string[] = [];
      const files = collectProjectTextFiles(projectFolder).flatMap((file) => {
        const openTab = openTabsByPath.get(file.path);
        const documentAst = openTab
          ? createDocumentAst({
              path: file.path,
              name: openTab.name || file.name,
              text: parseFrontMatter(openTab.markdown).body,
            })
          : astFilesByPath.get(file.path)?.documentAst ?? null;

        if (!documentAst) {
          missing.push(file.name);
          return [];
        }

        return [
          {
            path: file.path,
            name: file.name,
            text: documentAstToText(documentAst),
            textHash: documentAst.textHash,
            semanticHash: documentAst.semanticHash,
            lineCount: documentAst.lineCount,
            textLength: documentAst.textLength,
            visibleTextLength: documentAst.visibleTextLength,
            outlineCount:
              astFilesByPath.get(file.path)?.outlineCount ?? documentAst.outline.length,
          } satisfies ManuscriptSnapshotFile,
        ];
      });

      if (missing.length > 0) {
        throw new Error(
          `チェックポイントを作るには原稿の解析完了が必要です: ${missing.slice(0, 3).join(", ")}${
            missing.length > 3 ? "..." : ""
          }`,
        );
      }
      if (files.length === 0) {
        throw new Error("保存できる原稿がありません");
      }

      return {
        id: snapshotId(reason === "manual" ? "snapshot" : "shelter"),
        workspacePath: projectFolder.path,
        workspaceName: projectFolder.name,
        createdAt: Date.now(),
        reason,
        label,
        memo,
        parentIds,
        projectTree: projectFolder,
        files,
        fileCount: files.length,
        totalTextLength: files.reduce((sum, file) => sum + file.textLength, 0),
        totalVisibleTextLength: files.reduce(
          (sum, file) => sum + file.visibleTextLength,
          0,
        ),
      };
    },
    [openTabs, projectAst, projectFolder],
  );

  const handleCreateManuscriptSnapshot = useCallback(async () => {
    if (!projectFolder) {
      showToast("先にフォルダを開いてください");
      return;
    }

    const now = new Date();
    const snapshotDraft = await requestMultiInput({
      title: "チェックポイントを作成",
      fields: [
        {
          id: "label",
          label: "タイトル",
          initialValue: `${now.toLocaleDateString("ja-JP")} ${now.toLocaleTimeString("ja-JP", {
            hour: "2-digit",
            minute: "2-digit",
          })}`,
          placeholder: "例: 終盤改稿前",
        },
        {
          id: "memo",
          label: "メモ",
          initialValue: "",
          placeholder: "例: 終盤の分岐前。会話のテンポを試す",
          optional: true,
          multiline: true,
        },
      ],
      confirmLabel: "作成",
    });
    if (!snapshotDraft) return;

    try {
      const snapshot = buildManuscriptSnapshot(
        snapshotDraft.label,
        snapshotDraft.memo ?? "",
        "manual",
        currentWorkspaceSnapshots[0] ? [currentWorkspaceSnapshots[0].id] : [],
      );
      setAppState((current) => ({
        ...current,
        snapshots: [snapshot, ...current.snapshots],
      }));
      showToast("チェックポイントを作成しました");
    } catch (error) {
      setLastError(String(error));
      showToast(error instanceof Error ? error.message : "チェックポイントを作成できませんでした");
    }
  }, [buildManuscriptSnapshot, currentWorkspaceSnapshots, projectFolder]);

  const handleDeleteManuscriptSnapshot = useCallback(
    async (snapshot: ManuscriptSnapshot) => {
      const shouldDelete = await requestConfirm({
        title: "チェックポイントを削除",
        message: `「${snapshot.label}」を削除しますか？`,
        detail: "削除したチェックポイントには戻れません。",
        confirmLabel: "削除",
        danger: true,
      });
      if (!shouldDelete) return;

      setAppState((current) => ({
        ...current,
        snapshots: current.snapshots.filter((item) => item.id !== snapshot.id),
      }));
      showToast("チェックポイントを削除しました");
    },
    [],
  );

  const handleRenameManuscriptSnapshot = useCallback(async (snapshot: ManuscriptSnapshot) => {
    const label = await requestInput({
      title: "タイトルを編集",
      label: "タイトル",
      initialValue: snapshot.label,
      confirmLabel: "変更",
      placeholder: "例: 終盤改稿前",
    });
    if (!label) return;
    if (label === snapshot.label) return;

    setAppState((current) => ({
      ...current,
      snapshots: current.snapshots.map((item) =>
        item.id === snapshot.id ? { ...item, label } : item,
      ),
    }));
    showToast("チェックポイントのタイトルを変更しました");
  }, []);

  const handleEditManuscriptSnapshotMemo = useCallback(async (snapshot: ManuscriptSnapshot) => {
    const result = await requestMultiInput({
      title: "メモを編集",
      fields: [
        {
          id: "memo",
          label: "メモ",
          initialValue: snapshot.memo,
          placeholder: "例: 終盤の分岐前。会話のテンポを試す",
          optional: true,
          multiline: true,
        },
      ],
      confirmLabel: "変更",
    });
    if (!result) return;
    const memo = result.memo ?? "";
    if (memo === snapshot.memo) return;

    setAppState((current) => ({
      ...current,
      snapshots: current.snapshots.map((item) =>
        item.id === snapshot.id ? { ...item, memo } : item,
      ),
    }));
    showToast("チェックポイントのメモを変更しました");
  }, []);

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

  const handleRestoreManuscriptSnapshot = useCallback(
    async (snapshot: ManuscriptSnapshot) => {
      if (!projectFolder || !isSamePath(snapshot.workspacePath, projectFolder.path)) {
        showToast("このチェックポイントのプロジェクトを開いてください");
        return;
      }
      if (!isTauriRuntime()) {
        showToast("チェックポイントへの復元はTauri版で利用できます");
        return;
      }

      const shouldRestore = await requestConfirm({
        title: "チェックポイントに戻す",
        message: `「${snapshot.label}」に戻しますか？`,
        detail: "現在の状態は「復元前の退避」として自動保存されます。",
        confirmLabel: "戻す",
      });
      if (!shouldRestore) return;

      try {
        const shelter = buildManuscriptSnapshot(
          "復元前の退避",
          "",
          "auto-before-restore",
          currentWorkspaceSnapshots[0] ? [currentWorkspaceSnapshots[0].id] : [],
        );
        const restoredDocuments: TextDocument[] = [];
        const snapshotPathKeys = new Set(
          snapshot.files.map((file) => normalizePathForCompare(file.path)),
        );
        const currentManuscriptFiles = collectProjectTextFiles(projectFolder);
        const filesToDelete = currentManuscriptFiles.filter(
          (file) => !snapshotPathKeys.has(normalizePathForCompare(file.path)),
        );

        await invoke("ensure_project_folder_tree", {
          rootPath: projectFolder.path,
          tree: snapshot.projectTree,
        });

        for (const file of snapshot.files) {
          let content = file.text;
          try {
            const currentDocument = await invoke<TextDocument>("read_text_file", {
              path: file.path,
            });
            content = composeMarkdown(
              parseFrontMatter(currentDocument.content).metadata,
              file.text,
            );
          } catch {
            content = file.text;
          }

          const document = await invoke<TextDocument>("save_text_file", {
            path: file.path,
            content,
          });
          restoredDocuments.push(document);
        }

        for (const file of filesToDelete) {
          try {
            await invoke("delete_project_entry_to_trash", {
              rootPath: projectFolder.path,
              path: file.path,
            });
          } catch (error) {
            if (!String(error).includes("entry does not exist")) {
              throw error;
            }
          }
        }

        const restoredByPath = new Map(
          restoredDocuments.map((document) => [document.path, document] as const),
        );
        const deletedPathKeys = new Set(
          filesToDelete.map((file) => normalizePathForCompare(file.path)),
        );
        setOpenTabs((current) =>
          current.flatMap((tab) => {
            if (!tab.path) return tab;
            if (deletedPathKeys.has(normalizePathForCompare(tab.path))) return [];
            const document = restoredByPath.get(tab.path);
            if (!document) return tab;
            return [{
              ...tab,
              name: document.name,
              markdown: document.content,
              savedMarkdown: document.content,
              saveStatus: "saved",
              editorRevision: null,
            }];
          }),
        );

        const activeRestored =
          (currentFilePath ? restoredByPath.get(currentFilePath) : null) ??
          restoredDocuments[0] ??
          null;
        if (activeRestored) {
          loadDocumentIntoEditor(activeRestored, { replaceActive: true });
        }

        setAppState((current) => ({
          ...current,
          snapshots: trimAutoShelterSnapshots([shelter, ...current.snapshots]),
          lastWorkspacePath: projectFolder.path,
          lastFilePath: activeRestored?.path ?? current.lastFilePath,
          markdown: activeRestored?.content ?? current.markdown,
        }));
        projectAstBuildIdRef.current += 1;
        const refreshedFolder = await refreshProjectFolder(projectFolder.path);
        setProjectAst((current) => {
          const base = refreshedFolder ? createProjectAstSkeleton(refreshedFolder, current) : current;
          if (!base) return base;
          return restoredDocuments.reduce(
            (next, document) =>
              upsertProjectAstDocument(next, {
                path: document.path,
                name: document.name,
                text: parseFrontMatter(document.content).body,
              }),
            base,
          );
        });
        showToast(
          filesToDelete.length > 0
            ? `チェックポイントに戻しました（追加ファイル${filesToDelete.length}件を削除）`
            : "チェックポイントに戻しました",
        );
      } catch (error) {
        setLastError(String(error));
        showToast(error instanceof Error ? error.message : "チェックポイントに戻せませんでした");
      }
    },
    [
      buildManuscriptSnapshot,
      currentFilePath,
      currentWorkspaceSnapshots,
      loadDocumentIntoEditor,
      projectFolder,
      refreshProjectFolder,
    ],
  );

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
    if (settings.exportOpensInWindow && !isTauriRuntime()) {
      showToast("エクスポート画面の別ウィンドウ表示はTauri版で利用できます");
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
      const payload = {
        requestId: String(Date.now()),
        title: workspaceTitle,
        sources,
        sourceError: readErrors.length > 0 ? readErrors.join("\n") : undefined,
      };
      if (!settings.exportOpensInWindow) {
        // メイン画面のエクスポートモードとして開く。
        setExportEmbedPayload(payload);
        setAppMode("export");
        return;
      }
      await invoke("open_export_window", { payload });
    } catch (error) {
      setLastError(String(error));
    }
  };

  /** 画面上部のモード切替。canvas/export は設定により別ウィンドウ起動になる。 */
  const switchAppMode = (mode: "write" | "canvas" | "export") => {
    if (mode === "write") {
      setAppMode("write");
      return;
    }
    if (mode === "canvas") {
      if (!settings.canvasOpensInWindow && canvasEmbedPayload) {
        // 前回のボード表示を保ったまま戻る。
        setAppMode("canvas");
        return;
      }
      void openIdeaCanvasBoard(projectFolder ? "project" : "global");
      return;
    }
    void handleOpenLinkedExport();
  };

  const openWorkspaceFolder = async (
    folder: ProjectFolder,
    options: { focusFolderPath?: string | null } = {},
  ) => {
    const switchGeneration = workspaceSwitchGenerationRef.current + 1;
    workspaceSwitchGenerationRef.current = switchGeneration;
    workspaceSwitchInProgressRef.current = true;

    const focusedPath = options.focusFolderPath ?? folder.path;
    const focusedEntry =
      focusedPath && !isSamePath(focusedPath, folder.path)
        ? findProjectEntry(folder.children, focusedPath)
        : null;
    const preferredFiles =
      focusedEntry?.kind === "folder" ? focusedEntry.children : folder.children;

    try {
      const restoredSnippets =
        settings.snippetStorageMode === "workspace"
          ? await loadWorkspaceSnippets(folder.path)
          : snippets;
      const restoredPlotCards = await loadWorkspacePlotCards(folder.path);
      const firstFile = findFirstTextFile(preferredFiles) ?? findFirstTextFile(folder.children);
      const firstDocument = firstFile
        ? await (async () => {
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
            return document;
          })()
        : null;

      setProjectFolder(folder);
      setWorkspaceAlert(null);
      setFocusedFolderPath(focusedPath);
      setWorkspaceSwitcherQuery("");
      setSnippetWorkspacePath(settings.snippetStorageMode === "workspace" ? folder.path : null);
      setPlotWorkspacePath(folder.path);
      setPlotCards(restoredPlotCards);

      const nextTab = firstDocument
        ? createFileDocumentTab(firstDocument)
        : createScratchDocumentTab("", {
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
        markdown: firstDocument?.content ?? "",
        lastWorkspacePath: folder.path,
        lastFilePath: firstDocument?.path ?? null,
        recentWorkspaces: upsertRecentWorkspace(
          removeNestedRecentWorkspaces(current.recentWorkspaces, folder.path),
          folder.path,
          folder.name,
        ),
      }));
    } finally {
      if (workspaceSwitchGenerationRef.current === switchGeneration) {
        workspaceSwitchInProgressRef.current = false;
      }
    }
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

  // プロジェクトを切り替えたら埋め込みモードの内容は古くなるため本文モードへ戻す。
  const projectPathForModeReset = projectFolder?.path ?? null;
  useEffect(() => {
    setCanvasEmbedPayload(null);
    setExportEmbedPayload(null);
    setAppMode("write");
  }, [projectPathForModeReset]);

  // 別ウィンドウのキャンバスへ Idea・資料の最新一覧を届ける。断片編集は
  // キーストロークごとに snippets が変わるためデバウンスする。ウィンドウが
  // 存在しない場合は誰も受け取らないだけで害はない（ボードの再読込もしない）。
  useEffect(() => {
    if (!isTauriRuntime()) return;
    const timer = window.setTimeout(() => {
      const payload: CanvasLiveDataEvent = {
        ideaThreads: snippets.map((thread) => ({
          id: thread.id,
          kind: thread.kind,
          title: thread.title,
          fragments: thread.fragments.map((fragment) => ({
            id: fragment.id,
            body: fragment.body,
            used: fragment.used,
          })),
        })),
        referenceFiles: projectFolder ? sortedReferenceCandidates : [],
      };
      emitTo("idea-canvas", CANVAS_LIVE_DATA_EVENT, payload).catch(() => {
        // 対象ウィンドウが無い・閉じた直後などは黙って捨てる
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [snippets, sortedReferenceCandidates, projectFolder]);

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
    const isFolderEntry = !("kind" in entry) || entry.kind === "folder";
    const name = await requestInput({
      title: "名前を変更",
      label: isFolderEntry ? "フォルダ名" : "テキストファイル名",
      initialValue: entry.name,
      confirmLabel: "変更",
    });
    if (!name || name.trim() === entry.name) return;

    projectEntryPathChangeInProgressRef.current = true;
    setSaveStatus("loading");
    try {
      const affectedTabs = openTabs.filter((tab) => {
        if (!tab.path) return false;
        return isFolderEntry
          ? isSamePath(tab.path, entry.path) || isPathInsideFolder(tab.path, entry.path)
          : isSamePath(tab.path, entry.path);
      });
      const activeWasDirty = activeTab ? isDirtyDocumentTab(activeTab) : false;
      const activeWillBeRetargeted = currentFilePath
        ? Boolean(retargetFilesystemPath(currentFilePath, entry.path, entry.path))
        : false;
      await Promise.all(
        affectedTabs
          .filter(isDirtyDocumentTab)
          .map((tab) =>
            enqueueDocumentSave({
              tabId: tab.id,
              path: tab.path!,
              content: tab.markdown,
            }),
          ),
      );

      const document = await invoke<TextDocument>("rename_project_entry", {
        path: entry.path,
        name,
      });
      const oldReferencePath = toProjectRelativePath(projectFolder.path, entry.path);
      const newReferencePath = toProjectRelativePath(projectFolder.path, document.path);
      if (oldReferencePath && newReferencePath) {
        setPlotCards((current) =>
          current.map((card) => ({
            ...card,
            body: replacePlotReferencePath(card.body, oldReferencePath, newReferencePath),
          })),
        );
        setReferenceLayout((current) => ({
          ...current,
          cards: current.cards.map((card) =>
            retargetReferenceCard(card, oldReferencePath, newReferencePath),
          ),
          recent: current.recent.map((file) =>
            retargetReferenceFileInfo(file, oldReferencePath, newReferencePath),
          ),
        }));
        setReferenceCandidates((current) =>
          current.map((file) =>
            retargetReferenceFileInfo(file, oldReferencePath, newReferencePath),
          ),
        );
      }
      const parentFolderPath =
        findContainingFolderPath(projectFolder, entry.path) ?? projectFolder.path;
      await refreshProjectFolder(parentFolderPath);

      const activeNewPath = currentFilePath
        ? retargetFilesystemPath(currentFilePath, entry.path, document.path)
        : null;
      if (activeNewPath) setActiveTabId(`file:${activeNewPath}`);
      setOpenTabs((current) =>
        current.map((tab) => {
          if (!tab.path) return tab;
          const nextPath = retargetFilesystemPath(tab.path, entry.path, document.path);
          if (!nextPath) return tab;
          const isRenamedFile = !isFolderEntry && isSamePath(nextPath, document.path);
          return {
            ...tab,
            id: `file:${nextPath}`,
            kind: "file",
            path: nextPath,
            name: isRenamedFile
              ? document.name
              : nextPath.split(/[\\/]/).pop() ?? tab.name,
            markdown: isRenamedFile ? document.content : tab.markdown,
            savedMarkdown: isRenamedFile ? document.content : tab.savedMarkdown,
            saveStatus: "saved",
            documentKey: nextPath,
          };
        }),
      );

      if (activeNewPath) {
        setAppState((current) => ({
          ...current,
          markdown: !isFolderEntry && isSamePath(activeNewPath, document.path)
            ? document.content
            : current.markdown,
          lastFilePath: activeNewPath,
        }));
        if (!isFolderEntry && isSamePath(activeNewPath, document.path)) {
          lastSavedMarkdownRef.current = document.content;
        }
      } else {
        setAppState((current) => ({
          ...current,
          lastFilePath: current.lastFilePath
            ? retargetFilesystemPath(current.lastFilePath, entry.path, document.path) ??
              current.lastFilePath
            : current.lastFilePath,
        }));
      }

      setAppState((current) => {
        const retargetRecord = <T,>(record: Record<string, T>): Record<string, T> => {
          const next: Record<string, T> = {};
          for (const [path, value] of Object.entries(record)) {
            next[retargetFilesystemPath(path, entry.path, document.path) ?? path] = value;
          }
          return next;
        };
        return {
          ...current,
          fileProgress: retargetRecord(current.fileProgress),
          cursorPositions: retargetRecord(current.cursorPositions),
        };
      });

      setFocusedFolderPath((current) =>
        current ? retargetFilesystemPath(current, entry.path, document.path) ?? current : current,
      );
      if (isFolderEntry) {
        setCollapsedWorkspaceFolderPaths((current) => {
          const next = new Set<string>();
          for (const path of current) {
            next.add(retargetFilesystemPath(path, entry.path, document.path) ?? path);
          }
          return next;
        });
      }
      projectAstBuildIdRef.current += 1;
      setProjectAst(null);
      setSaveStatus(
        currentFilePath
          ? activeWillBeRetargeted || !activeWasDirty
            ? "saved"
            : "dirty"
          : "dirty",
      );
      showToast(`「${entry.name}」をリネームしました`);
    } catch (error) {
      setLastError(String(error));
      setSaveStatus("error");
    } finally {
      projectEntryPathChangeInProgressRef.current = false;
    }
  };

  const handleDeleteProjectEntry = async (entry: ProjectEntry) => {
    if (!projectFolder) return;
    if (!isTauriRuntime()) {
      showToast("ファイル削除はTauri版で利用できます");
      return;
    }
    let plan: DeleteProjectEntryPlan;
    try {
      plan = await invoke<DeleteProjectEntryPlan>("plan_delete_project_entry", {
        rootPath: projectFolder.path,
        path: entry.path,
      });
    } catch (error) {
      setLastError(String(error));
      showToast("削除対象を確認できませんでした");
      return;
    }

    const affectedDirtyTabs = openTabs.filter(
      (tab) =>
        tab.path &&
        isPathSameOrInside(tab.path, entry.path) &&
        tab.saveStatus !== "saved",
    );
    const countSummary =
      plan.rootKind === "folder"
        ? `配下のテキストファイル ${plan.textFileCount} 件、その他ファイル ${plan.nonTextFileCount} 件、フォルダ ${Math.max(0, plan.folderCount - 1)} 件をThenのTrashへ移動します。`
        : "ファイルをThenのTrashへ移動します。";
    const dirtySummary =
      affectedDirtyTabs.length > 0
        ? ` 未保存のタブ ${affectedDirtyTabs.length} 件は閉じられ、未保存内容は破棄されます。`
        : "";
    const warningSummary =
      plan.warnings.length > 0 ? ` 注意: ${plan.warnings.slice(0, 2).join(" / ")}` : "";
    const shouldDelete = await requestConfirm({
      title: "項目を削除",
      message: `「${entry.name}」を削除しますか？`,
      detail: `${countSummary} チェックポイントには影響しません。${dirtySummary}${warningSummary}`,
      confirmLabel: "削除",
      danger: true,
    });
    if (!shouldDelete) return;

    setSaveStatus("loading");
    try {
      const result = await invoke<DeleteProjectEntryResult>("delete_project_entry_to_trash", {
        rootPath: projectFolder.path,
        path: entry.path,
      });
      projectAstBuildIdRef.current += 1;
      setProjectAst((current) =>
        current ? removeProjectAstPaths(current, result.deletedPaths) : current,
      );
      const parentFolderPath =
        findContainingFolderPath(projectFolder, entry.path) ?? projectFolder.path;
      const refreshed = await refreshProjectFolder(parentFolderPath);
      if (refreshed) {
        setProjectAst((current) => createProjectAstSkeleton(refreshed, current));
      }

      const activeWasDeleted = currentFilePath
        ? isPathSameOrInside(currentFilePath, entry.path)
        : false;
      const nextFocusedFolder =
        focusedFolderPath && isPathSameOrInside(focusedFolderPath, entry.path)
          ? getParentPath(entry.path) ?? projectFolder.path
          : focusedFolderPath;
      setFocusedFolderPath(nextFocusedFolder);
      setActiveBreadcrumbPath((path) =>
        path && isPathSameOrInside(path, entry.path)
          ? getParentPath(entry.path) ?? projectFolder.path
          : path,
      );

      setOpenTabs((current) =>
        current.filter((tab) => !tab.path || !isPathSameOrInside(tab.path, entry.path)),
      );
      setAppState((current) => {
        const nextCursorPositions = { ...current.cursorPositions };
        for (const path of Object.keys(nextCursorPositions)) {
          if (isPathSameOrInside(path, entry.path)) {
            delete nextCursorPositions[path];
          }
        }
        return {
          ...current,
          cursorPositions: nextCursorPositions,
          lastFilePath:
            current.lastFilePath && isPathSameOrInside(current.lastFilePath, entry.path)
              ? null
              : current.lastFilePath,
        };
      });

      if (activeWasDeleted) {
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
      showToast(
        result.fallbackUsed === "appTrash"
          ? `「${entry.name}」をThenのTrashへ移動しました`
          : `「${entry.name}」をゴミ箱へ移動しました`,
      );
    } catch (error) {
      setLastError(String(error));
      setSaveStatus("error");
      showToast("削除できませんでした");
    }
  };

  const handleMoveProjectEntryToFolder = async (
    sourcePath: string,
    targetFolderPath: string,
  ) => {
    if (!projectFolder) return;
    const sourceEntry = findProjectEntry(projectFolder.children, sourcePath);
    if (!sourceEntry) return;

    const sourceParentPath =
      findContainingFolderPath(projectFolder, sourcePath) ?? projectFolder.path;
    if (isSamePath(sourceParentPath, targetFolderPath)) return;
    if (
      sourceEntry.kind === "folder" &&
      (isSamePath(sourcePath, targetFolderPath) ||
        isPathInsideFolder(targetFolderPath, sourcePath))
    ) {
      showToast("フォルダを自分自身の中へ移動できません");
      return;
    }

    projectEntryPathChangeInProgressRef.current = true;
    setSaveStatus("loading");
    try {
      const affectedTabs = openTabs.filter((tab) => {
        if (!tab.path) return false;
        return sourceEntry.kind === "folder"
          ? isSamePath(tab.path, sourcePath) || isPathInsideFolder(tab.path, sourcePath)
          : isSamePath(tab.path, sourcePath);
      });
      await Promise.all(
        affectedTabs
          .filter(isDirtyDocumentTab)
          .map((tab) =>
            enqueueDocumentSave({
              tabId: tab.id,
              path: tab.path!,
              content: tab.markdown,
            }),
          ),
      );

      const result = await invoke<MoveProjectEntryResult>("move_project_entry", {
        rootPath: projectFolder.path,
        sourcePath,
        targetFolderPath,
      });
      const oldReferencePath = toProjectRelativePath(projectFolder.path, result.oldPath);
      const newReferencePath = toProjectRelativePath(projectFolder.path, result.newPath);
      if (oldReferencePath && newReferencePath) {
        setPlotCards((current) =>
          current.map((card) => ({
            ...card,
            body: replacePlotReferencePath(card.body, oldReferencePath, newReferencePath),
          })),
        );
        setReferenceLayout((current) => ({
          ...current,
          cards: current.cards.map((card) =>
            retargetReferenceCard(card, oldReferencePath, newReferencePath),
          ),
          recent: current.recent.map((file) =>
            retargetReferenceFileInfo(file, oldReferencePath, newReferencePath),
          ),
        }));
        setReferenceCandidates((current) =>
          current.map((file) =>
            retargetReferenceFileInfo(file, oldReferencePath, newReferencePath),
          ),
        );
      }

      const activeNewPath = currentFilePath
        ? retargetFilesystemPath(currentFilePath, result.oldPath, result.newPath)
        : null;
      const nextActiveTabId = activeNewPath ? `file:${activeNewPath}` : activeTabIdRef.current;
      setOpenTabs((current) =>
        current.map((tab) => {
          if (!tab.path) return tab;
          const nextPath = retargetFilesystemPath(tab.path, result.oldPath, result.newPath);
          if (!nextPath) return tab;
          const movedDocument =
            result.movedDocument && isSamePath(result.movedDocument.path, nextPath)
              ? result.movedDocument
              : null;
          return {
            ...tab,
            id: `file:${nextPath}`,
            kind: "file",
            path: nextPath,
            name: movedDocument?.name ?? nextPath.split(/[\\/]/).pop() ?? tab.name,
            markdown: movedDocument?.content ?? tab.markdown,
            savedMarkdown: movedDocument?.content ?? tab.savedMarkdown,
            saveStatus: "saved",
            documentKey: nextPath,
          };
        }),
      );
      if (activeNewPath) {
        setActiveTabId(nextActiveTabId);
        setAppState((current) => ({
          ...current,
          markdown: result.movedDocument?.content ?? current.markdown,
          lastFilePath: activeNewPath,
        }));
        lastSavedMarkdownRef.current =
          result.movedDocument?.content ?? activeTab?.savedMarkdown ?? lastSavedMarkdownRef.current;
      }

      setAppState((current) => {
        const retargetRecord = <T,>(record: Record<string, T>): Record<string, T> => {
          const next: Record<string, T> = {};
          for (const [path, value] of Object.entries(record)) {
            next[retargetFilesystemPath(path, result.oldPath, result.newPath) ?? path] = value;
          }
          return next;
        };
        return {
          ...current,
          fileProgress: retargetRecord(current.fileProgress),
          cursorPositions: retargetRecord(current.cursorPositions),
          lastFilePath: current.lastFilePath
            ? retargetFilesystemPath(current.lastFilePath, result.oldPath, result.newPath) ??
              current.lastFilePath
            : current.lastFilePath,
        };
      });
      setFocusedFolderPath(
        sourceEntry.kind === "folder" ? result.newPath : result.newParentPath,
      );
      if (sourceEntry.kind === "folder") {
        setCollapsedWorkspaceFolderPaths((current) => {
          const next = new Set<string>();
          for (const path of current) {
            next.add(retargetFilesystemPath(path, result.oldPath, result.newPath) ?? path);
          }
          return next;
        });
      }
      projectAstBuildIdRef.current += 1;
      setProjectAst(null);
      setProjectFolder(result.projectFolder);
      setLastError("");
      setSaveStatus(activeNewPath || currentFilePath ? "saved" : "dirty");
      showToast(`「${sourceEntry.name}」を移動しました`);
    } catch (error) {
      setLastError(String(error));
      setSaveStatus("error");
    } finally {
      projectEntryPathChangeInProgressRef.current = false;
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
    setDropIndicatorPos(null);
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
    event.dataTransfer.effectAllowed = "copyMove";
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
    if (!rect) return;

    const vertical = settings.writingMode.startsWith("vertical");
    const view = getEditorView();
    // 実際の挿入位置（キャレット座標）にインジケーターを合わせる。
    const pos = view?.positionFromPoint(event.clientX, event.clientY) ?? null;
    const coords = pos !== null ? view?.coordsAtPos(pos) ?? null : null;

    if (vertical) {
      setDropIndicatorPos((coords ? coords.left : event.clientX) - rect.left);
    } else {
      setDropIndicatorPos((coords ? coords.top : event.clientY) - rect.top);
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

  const reorderFragment = (
    threadId: string,
    fragmentId: string,
    targetFragmentId: string,
    position: "before" | "after",
  ) => {
    if (fragmentId === targetFragmentId) return;

    updateIdeaThreads((threads) =>
      threads.map((thread) => {
        if (thread.id !== threadId) return thread;

        const moving = thread.fragments.find((fragment) => fragment.id === fragmentId);
        if (!moving || !thread.fragments.some((fragment) => fragment.id === targetFragmentId)) {
          return thread;
        }

        const withoutMoving = thread.fragments.filter((fragment) => fragment.id !== fragmentId);
        const targetIndex = withoutMoving.findIndex(
          (fragment) => fragment.id === targetFragmentId,
        );
        if (targetIndex < 0) return thread;

        const insertIndex = position === "after" ? targetIndex + 1 : targetIndex;
        const fragments = [...withoutMoving];
        fragments.splice(insertIndex, 0, moving);

        const orderChanged = fragments.some(
          (fragment, index) => fragment.id !== thread.fragments[index]?.id,
        );
        return orderChanged ? { ...thread, fragments, updatedAt: Date.now() } : thread;
      }),
    );
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

  const openCanvasOrigin = (origin: IdeaOriginRef) => {
    void openIdeaCanvasBoard(origin.sourceBoardScope, origin.sourceBoardId, origin.sourceId);
  };

  const sendIdeaFragmentToCanvas = async (threadId: string, fragmentId: string) => {
    const thread = snippets.find((item) => item.id === threadId);
    const fragment = thread?.fragments.find((item) => item.id === fragmentId);
    if (!thread || !fragment) return;
    if (!isTauriRuntime()) {
      showToast("Canvas 送信はTauri版で利用できます");
      return;
    }

    const scope: CanvasScope = projectFolder ? "project" : "global";
    const rootPath = scope === "project" ? projectFolder?.path ?? null : null;
    try {
      const summary = await ensureCanvasBoard(
        scope,
        rootPath,
        scope === "project" ? `${projectFolder?.name ?? "Project"} Board` : "Global Idea Board",
      );
      const board = await loadCanvasBoard(scope, rootPath, summary.id);
      const position = nextCanvasPlacement(board);
      const node = createCanvasTextNode(fragment.body, {
        ...position,
        writingMode: settings.canvasDefaultWritingMode,
        fontSource: settings.canvasDefaultFontSource,
        thenOrigin: {
          source: "idea",
          sourceId: fragment.id,
          sourceThreadId: thread.id,
          sourceWorkspacePath: projectFolder?.path ?? "",
          copiedAt: Date.now(),
        },
      });
      await saveCanvasBoard(scope, rootPath, summary.id, {
        ...board,
        nodes: [...board.nodes, node],
      });
      showToast("Canvas へ送信しました");
      await openIdeaCanvasBoard(scope, summary.id, node.id);
    } catch (error) {
      setLastError(String(error));
      showToast("Canvas へ送信できませんでした");
    }
  };

  const sendIdeaThreadToCanvas = async (threadId: string) => {
    const thread = snippets.find((item) => item.id === threadId);
    if (!thread) return;
    if (!isTauriRuntime()) {
      showToast("Canvas 送信はTauri版で利用できます");
      return;
    }

    const scope: CanvasScope = projectFolder ? "project" : "global";
    const rootPath = scope === "project" ? projectFolder?.path ?? null : null;
    try {
      const summary = await ensureCanvasBoard(
        scope,
        rootPath,
        scope === "project" ? `${projectFolder?.name ?? "Project"} Board` : "Global Idea Board",
      );
      const board = await loadCanvasBoard(scope, rootPath, summary.id);
      const position = nextCanvasPlacement(board);
      const copiedAt = Date.now();
      const group = createCanvasGroupNode(thread.title, {
        x: position.x,
        y: position.y,
        width: Math.max(520, thread.fragments.length * 180),
        height: 310,
        thenOrigin: {
          source: "idea",
          sourceId: thread.id,
          sourceThreadId: thread.id,
          sourceWorkspacePath: projectFolder?.path ?? "",
          copiedAt,
        },
      });
      const nodes: CanvasNode[] = thread.fragments.map((fragment, index) =>
        createCanvasTextNode(fragment.body, {
          x: group.x + 28 + index * 210,
          y: group.y + 72,
          width: 180,
          height: 170,
          writingMode: settings.canvasDefaultWritingMode,
          fontSource: settings.canvasDefaultFontSource,
          thenOrigin: {
            source: "idea",
            sourceId: fragment.id,
            sourceThreadId: thread.id,
            sourceWorkspacePath: projectFolder?.path ?? "",
            copiedAt,
          },
        }),
      );
      const edges = nodes.slice(1).map((node, index) => createCanvasEdge(nodes[index].id, node.id));
      await saveCanvasBoard(scope, rootPath, summary.id, {
        ...board,
        nodes: [...board.nodes, group, ...nodes],
        edges: [...board.edges, ...edges],
      });
      showToast("Thread を Canvas へ送信しました");
      await openIdeaCanvasBoard(scope, summary.id, group.id);
    } catch (error) {
      setLastError(String(error));
      showToast("Thread を Canvas へ送信できませんでした");
    }
  };

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let unlistenCopy: (() => void) | null = null;
    let unlistenFocus: (() => void) | null = null;

    void listen<CanvasCopyToIdeaRequest>("then-canvas-copy-to-idea", (event) => {
      const request = event.payload;
      const items = request.items
        .map((item) => ({ ...item, text: item.text }))
        .filter((item) => item.text.trim().length > 0);
      if (items.length === 0) return;

      const copiedAt = Date.now();
      const newThreadId =
        request.targetThreadId === CANVAS_NEW_THREAD_TARGET ? nextIdeaId("thread") : null;
      updateIdeaThreads((threads) => {
        if (newThreadId) {
          const now = Date.now();
          const thread: IdeaThread = {
            id: newThreadId,
            kind: "thread",
            title: request.threadTitle?.trim() || request.boardName || "Canvas から",
            starred: false,
            createdAt: now,
            updatedAt: now,
            fragments: items.map((item) =>
              makeIdeaFragment(
                item.text,
                false,
                createIdeaOriginRef(request.boardScope, request.boardId, item.nodeId, copiedAt),
              ),
            ),
          };
          const inboxIndex = threads.findIndex((item) => item.kind === "inbox");
          const next = [...threads];
          next.splice(inboxIndex >= 0 ? inboxIndex + 1 : 0, 0, thread);
          return next;
        }

        const fallback = threads.find((thread) => thread.kind === "inbox") ?? threads[0];
        const targetId = threads.some((thread) => thread.id === request.targetThreadId)
          ? request.targetThreadId
          : fallback?.id;
        if (!targetId) return threads;
        return threads.map((thread) =>
          thread.id === targetId
            ? {
                ...thread,
                fragments: [
                  ...thread.fragments,
                  ...items.map((item) =>
                    makeIdeaFragment(
                      item.text,
                      false,
                      createIdeaOriginRef(
                        request.boardScope,
                        request.boardId,
                        item.nodeId,
                        copiedAt,
                      ),
                    ),
                  ),
                ],
                updatedAt: copiedAt,
              }
            : thread,
        );
      });
      setRightSidebarTab("idea");
      setIsRightSidebarCollapsed(false);
      if (newThreadId) setIdeaFocusRequest({ threadId: newThreadId, nonce: copiedAt });
      showToast(`${items.length} 件を Idea へ取り込みました`);
    }).then((unlisten) => {
      unlistenCopy = unlisten;
    });

    void listen<CanvasFocusIdeaRequest>("then-canvas-focus-idea", (event) => {
      setRightSidebarTab("idea");
      setIsRightSidebarCollapsed(false);
      setIdeaFocusRequest({
        threadId: event.payload.threadId,
        fragmentId: event.payload.fragmentId,
        nonce: Date.now(),
      });
    }).then((unlisten) => {
      unlistenFocus = unlisten;
    });

    let unlistenCopyToPlot: (() => void) | null = null;
    void listen<CanvasCopyToPlotRequest>("then-canvas-copy-to-plot", (event) => {
      const items = event.payload.items.filter((item) => item.text.trim().length > 0);
      if (items.length === 0) return;

      const stamp = Date.now().toString(36);
      setPlotCards((current) =>
        renumberPlotCards([
          ...current,
          ...items.map((item, index) => {
            // 複数行のカードは1行目をタイトル、残りを本文に。1行だけなら本文のみ。
            const lines = item.text.trim().split("\n");
            const [firstLine, ...rest] = lines;
            const title = lines.length > 1 ? firstLine.trim() : "";
            const body = lines.length > 1 ? rest.join("\n").trim() : firstLine.trim();
            return {
              id: `plot-${stamp}-${index}`,
              kind: "section" as const,
              num: "",
              title,
              body,
              expanded: false,
              managerCollapsed: false,
            };
          }),
        ]),
      );
      setRightSidebarTab("plot");
      setIsRightSidebarCollapsed(false);
      showToast(`${items.length} 件をプロットへ追加しました`);
    }).then((unlisten) => {
      unlistenCopyToPlot = unlisten;
    });

    return () => {
      unlistenCopy?.();
      unlistenFocus?.();
      unlistenCopyToPlot?.();
    };
  }, []);

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
        data-zone-mode={settings.zoneMode ? "true" : undefined}
        style={
          {
            "--editor-font-family": settings.editorFontFamily,
            "--ui-font-family": settings.uiFontFamily,
            "--plot-font-family":
              settings.plotFontSource === "ui"
                ? settings.uiFontFamily
                : settings.editorFontFamily,
            "--ui-font-scale": settings.uiFontScale,
            "--editor-font-size": `${settings.fontSize}px`,
            "--editor-line-height": settings.lineHeight,
            // 編集領域に対する比率（0〜1）。CSS 側で実寸に乗算する。
            "--editor-measure-h-ratio": settings.editorMeasureHorizontal / 100,
            "--editor-measure-v-ratio": settings.editorMeasureVertical / 100,
            "--editor-heading-font-family":
              settings.headingFontSource === "custom"
                ? settings.headingFontFamily
                : settings.editorFontFamily,
            "--typewriter-guide-position": `${settings.typewriterOffset}%`,
            "--zone-sidebar-opacity": settings.zoneModeOpacity,
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
            {isLeftSidebarCollapsed && appMode === "write" && (
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
              <div className="modeSwitcher" role="tablist" aria-label="画面モード">
                <button
                  className={appMode === "write" ? "isActiveMode" : ""}
                  type="button"
                  role="tab"
                  aria-selected={appMode === "write"}
                  title="本文モード"
                  onClick={() => switchAppMode("write")}
                >
                  本文
                </button>
                <button
                  className={appMode === "canvas" ? "isActiveMode" : ""}
                  type="button"
                  role="tab"
                  aria-selected={appMode === "canvas"}
                  title={
                    settings.canvasOpensInWindow
                      ? "キャンバスを別ウィンドウで開く"
                      : "キャンバスモード"
                  }
                  onClick={() => switchAppMode("canvas")}
                >
                  キャンバス
                </button>
                <button
                  className={appMode === "export" ? "isActiveMode" : ""}
                  type="button"
                  role="tab"
                  aria-selected={appMode === "export"}
                  title={
                    settings.exportOpensInWindow
                      ? "エクスポートを別ウィンドウで開く"
                      : "エクスポートモード"
                  }
                  onClick={() => switchAppMode("export")}
                >
                  エクスポート
                </button>
              </div>
              {isRightSidebarCollapsed && appMode !== "export" && (
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

          <div
            className={`workspace ${appMode === "export" ? "modeHiddenPane" : ""}`}
            ref={workspaceRef}
            data-app-mode={appMode}
          >
            {appMode === "write" && !isLeftSidebarCollapsed && (
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
                onMoveEntry={(sourcePath, targetFolderPath) =>
                  void handleMoveProjectEntryToFolder(sourcePath, targetFolderPath)
                }
                onReorderEntry={(folderPath, draggedPath, targetPath, position) =>
                  void handleSidebarEntryReorder(folderPath, draggedPath, targetPath, position)
                }
                snapshots={currentWorkspaceSnapshots}
                isSnapshotSectionCollapsed={settings.checkpointSectionCollapsed}
                onSnapshotSectionCollapsedChange={(collapsed) =>
                  updateSettings("checkpointSectionCollapsed", collapsed)
                }
                onCreateSnapshot={() => void handleCreateManuscriptSnapshot()}
                onRenameSnapshot={(snapshot) => void handleRenameManuscriptSnapshot(snapshot)}
                onEditSnapshotMemo={(snapshot) => void handleEditManuscriptSnapshotMemo(snapshot)}
                onRestoreSnapshot={(snapshot) => void handleRestoreManuscriptSnapshot(snapshot)}
                onDeleteSnapshot={(snapshot) => void handleDeleteManuscriptSnapshot(snapshot)}
                onCollapse={() => setIsLeftSidebarCollapsed(true)}
              />
            )}
            <div className={`editorColumn ${appMode !== "write" ? "modeHiddenPane" : ""}`}>
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
                            typewriterScroll={settings.typewriterScroll}
                            typewriterOffset={settings.typewriterOffset}
                            showLineBreakMarks={settings.showLineBreakMarks}
                            initialSelectionOffset={initialSelectionOffset}
                            onViewportSizeChange={handleEditorViewportSizeChange}
                            onReady={handleEditorReady}
                            onTextChange={handleTextChange}
                            onSelectionChange={handleSelectionChange}
                          />
                        )}
                        {editorFind.open && (
                          <section
                            className="editorFindPopover"
                            aria-label="ファイル内検索と置換"
                            onMouseDown={(event) => event.stopPropagation()}
                          >
                            <div className="editorFindRow">
                              <input
                                ref={editorFindInputRef}
                                value={editorFind.query}
                                type="search"
                                aria-label="検索語句"
                                placeholder="検索"
                                onChange={(event) => handleEditorFindQueryChange(event.target.value)}
                                onKeyDown={handleEditorFindKeyDown}
                              />
                              <span className="editorFindCount">
                                {editorFind.query.trim()
                                  ? editorFindMatches.length
                                    ? `${activeEditorFindIndex + 1}/${editorFindMatches.length}`
                                    : "0/0"
                                  : ""}
                              </span>
                              <button
                                type="button"
                                title="前の一致"
                                aria-label="前の一致"
                                disabled={editorFindMatches.length === 0}
                                onClick={() => moveEditorFindMatch(-1)}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                title="次の一致"
                                aria-label="次の一致"
                                disabled={editorFindMatches.length === 0}
                                onClick={() => moveEditorFindMatch(1)}
                              >
                                ↓
                              </button>
                              <button
                                type="button"
                                title={editorFind.showReplace ? "置換を隠す" : "置換を表示"}
                                aria-label={editorFind.showReplace ? "置換を隠す" : "置換を表示"}
                                aria-pressed={editorFind.showReplace}
                                onClick={() =>
                                  setEditorFind((current) => ({
                                    ...current,
                                    showReplace: !current.showReplace,
                                  }))
                                }
                              >
                                ≡
                              </button>
                              <button
                                type="button"
                                title="閉じる"
                                aria-label="閉じる"
                                onClick={closeEditorFind}
                              >
                                ×
                              </button>
                            </div>
                            {editorFind.showReplace && (
                              <div className="editorFindRow editorReplaceRow">
                                <input
                                  value={editorFind.replaceValue}
                                  aria-label="置換後"
                                  placeholder="置換"
                                  onChange={(event) =>
                                    setEditorFind((current) => ({
                                      ...current,
                                      replaceValue: event.target.value,
                                    }))
                                  }
                                  onKeyDown={(event) => {
                                    if (event.key === "Escape") {
                                      event.preventDefault();
                                      closeEditorFind();
                                    }
                                  }}
                                />
                                <button
                                  type="button"
                                  disabled={activeEditorFindIndex < 0}
                                  onClick={replaceActiveEditorFindMatch}
                                >
                                  置換
                                </button>
                                <button
                                  type="button"
                                  disabled={editorFindMatches.length === 0}
                                  onClick={replaceAllEditorFindMatches}
                                >
                                  すべて
                                </button>
                              </div>
                            )}
                          </section>
                        )}
                      </>
                    )}
                  </div>
                  <div
                    className={`dropIndicator ${
                      settings.writingMode.startsWith("vertical")
                        ? "verticalDropIndicator"
                        : "horizontalDropIndicator"
                    } ${dropIndicatorPos === null ? "" : "showDropIndicator"}`}
                    style={
                      dropIndicatorPos === null
                        ? undefined
                        : settings.writingMode.startsWith("vertical")
                          ? { left: dropIndicatorPos }
                          : { top: dropIndicatorPos }
                    }
                  />
                  {editorContextMenu && (
                    <div
                      ref={editorContextMenuRef}
                      className="editorContextMenu"
                      role="menu"
                      style={getScaledFixedMenuPosition(editorContextMenu.x, editorContextMenu.y, {
                        width: EDITOR_CONTEXT_MENU_WIDTH,
                        height: EDITOR_CONTEXT_MENU_HEIGHT,
                      })}
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

            {appMode === "canvas" && canvasEmbedPayload && (
              <div className="canvasEmbeddedHost">
                <CanvasWindowApp
                  embedded
                  embeddedPayload={canvasEmbedPayload}
                  liveIdeaThreads={snippets.map((thread) => ({
                    id: thread.id,
                    kind: thread.kind,
                    title: thread.title,
                  }))}
                  liveReferenceFiles={
                    projectFolder ? sortedReferenceCandidates : []
                  }
                />
              </div>
            )}

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
                      aria-label="Idea"
                      aria-selected={rightSidebarTab === "idea"}
                      title="Idea"
                      onClick={() => setRightSidebarTab("idea")}
                    >
                      <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
                        <path d="M9 18h6" />
                        <path d="M10 22h4" />
                        <path d="M8.4 14.6c-1.7-1.2-2.6-3-2.6-5.1A6.2 6.2 0 0 1 12 3.3a6.2 6.2 0 0 1 6.2 6.2c0 2.1-.9 3.9-2.6 5.1-.8.6-1.2 1.3-1.3 2.2H9.7c-.1-.9-.5-1.6-1.3-2.2Z" />
                      </svg>
                    </button>
                    <button
                      className={`rightTab ${rightSidebarTab === "plot" ? "activeRightTab" : ""}`}
                      type="button"
                      role="tab"
                      aria-label="Plot"
                      aria-selected={rightSidebarTab === "plot"}
                      title="Plot"
                      onClick={() => setRightSidebarTab("plot")}
                    >
                      <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
                        <path d="M4 5.5c2.3-.9 4.8-.6 8 1.1v12c-3.2-1.7-5.7-2-8-1.1v-12Z" />
                        <path d="M20 5.5c-2.3-.9-4.8-.6-8 1.1v12c3.2-1.7 5.7-2 8-1.1v-12Z" />
                        <path d="M12 6.6v12" />
                        <path d="M6.5 8.8c1.1-.1 2.2.1 3.4.7" />
                        <path d="M17.5 8.8c-1.1-.1-2.2.1-3.4.7" />
                      </svg>
                    </button>
                    <button
                      className={`rightTab ${rightSidebarTab === "reference" ? "activeRightTab" : ""}`}
                      type="button"
                      role="tab"
                      aria-label="資料"
                      aria-selected={rightSidebarTab === "reference"}
                      title="資料"
                      onClick={() => setRightSidebarTab("reference")}
                    >
                      <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
                        <path d="M7 3.5h7l3 3V20a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 6 20V5A1.5 1.5 0 0 1 7.5 3.5Z" />
                        <path d="M14 3.5V7h3.5" />
                        <path d="M9 11h6" />
                        <path d="M9 14h6" />
                        <path d="M9 17h4" />
                      </svg>
                    </button>
                  </div>
                  {rightSidebarTab === "plot" && (
                    <PlotPaneHeaderActions
                      onAddSection={addPlotSection}
                      onAddChapter={addPlotChapter}
                      onOpenManager={() => setIsPlotManagerOpen(true)}
                    />
                  )}
                  {rightSidebarTab === "idea" && (
                    <div className="plotPaneHeaderActions" aria-label="Idea 操作">
                      <button
                        className="sidebarIconButton plotHeaderActionButton"
                        type="button"
                        aria-label="Idea Board を開く"
                        title="Idea Board を開く"
                        onClick={() => void openIdeaCanvasBoard(projectFolder ? "project" : "global")}
                      >
                        <AppIcon name="canvas" />
                      </button>
                    </div>
                  )}
                  <div
                    className={`rightSidebarChromeActions ${
                      rightSidebarTab === "plot" || rightSidebarTab === "idea"
                        ? ""
                        : "pushRightSidebarChromeActions"
                    }`}
                  >
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
                </div>
                <div className="rightSidebarBody">
                  {rightSidebarTab === "plot" ? (
                    <PlotPane
                      cards={plotCards}
                      onCardsChange={setPlotCards}
                      referenceCandidates={sortedReferenceCandidates}
                      onOpenReference={openPlotReference}
                      onMissingReference={() => showToast("存在しないファイルです")}
                      isManagerOpen={isPlotManagerOpen}
                      onManagerOpenChange={setIsPlotManagerOpen}
                    />
                  ) : rightSidebarTab === "reference" ? (
                    <ReferencePane
                      rootPath={projectFolder?.path ?? null}
                      cards={referenceLayout.cards}
                      candidates={sortedReferenceCandidates}
                      query={referenceQuery}
                      onQueryChange={setReferenceQuery}
                      onAddReference={(scope) => void handleAddReference(scope)}
                      onCreateReference={(scope) => void handleCreateReference(scope)}
                      onOpenReference={(targetFile) => {
                        const file =
                          sortedReferenceCandidates.find(
                            (item) => referenceFileKey(item) === referenceFileKey(targetFile),
                          ) ?? targetFile;
                        openReferenceCard(file.sourcePath, file);
                      }}
                      onFocusReference={focusReferenceCard}
                      onCloseReference={closeReferenceCard}
                      onPinReference={pinReferenceCard}
                      onCopyReference={(file, targetScope) =>
                        void handleCopyReferenceToScope(file, targetScope)
                      }
                      onMoveReference={(file, targetScope) =>
                        void handleMoveReferenceToScope(file, targetScope)
                      }
                      onDeleteImportedReference={(file) =>
                        void handleDeleteImportedReference(file.sourcePath, file.scope)
                      }
                    />
                  ) : (
                    <IdeaPane
                      threads={snippets}
                      draggingId={draggingId}
                      focusRequest={ideaFocusRequest}
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
                      onReorderFragment={reorderFragment}
                      onInsertFragment={insertFragmentToEditor}
                      onInsertThread={insertThreadToEditor}
                      onSendFragmentToCanvas={(threadId, fragmentId) =>
                        void sendIdeaFragmentToCanvas(threadId, fragmentId)
                      }
                      onSendThreadToCanvas={(threadId) => void sendIdeaThreadToCanvas(threadId)}
                      onOpenCanvasOrigin={openCanvasOrigin}
                      onFragmentDragStart={handleFragmentDragStart}
                      onFragmentDragEnd={handleFragmentDragEnd}
                    />
                  )}
                </div>
              </aside>
            )}
            <ReferenceLayer
              rootPath={projectFolder?.path ?? null}
              layout={referenceLayout}
              onLayoutChange={patchReferenceLayout}
              onReturnFocusToEditor={returnFocusToEditor}
              onTextSaved={handleReferenceTextSaved}
            />
          </div>

          {appMode === "export" && exportEmbedPayload && (
            <div className="exportEmbeddedHost">
              <LinkedExportScreen
                key={exportEmbedPayload.requestId}
                embedded
                title={exportEmbedPayload.title}
                initialSources={exportEmbedPayload.sources}
                sourceError={exportEmbedPayload.sourceError}
                onClose={() => {
                  setAppMode("write");
                  setExportEmbedPayload(null);
                }}
                onOpenSource={(path) => {
                  setAppMode("write");
                  setExportEmbedPayload(null);
                  if (path) void handleProjectFileSelect(path);
                }}
                onExportPdf={exportPdfWithVivliostyle}
                onExportDocx={exportDocxWithDialog}
                onOpenResult={(path) => void invoke("open_export_location", { path })}
              />
            </div>
          )}

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
              onFieldValueChange={updateAppDialogFieldValue}
              onChoice={chooseAppDialog}
            />
          )}

          {isCommandPaletteOpen && (
            <CommandPalette
              commands={buildPaletteCommands()}
              onClose={() => setIsCommandPaletteOpen(false)}
            />
          )}
          {isQuickIdeaModalOpen && (
            <QuickIdeaModal
              threads={snippets}
              onCapture={captureFragment}
              onClose={() => setIsQuickIdeaModalOpen(false)}
            />
          )}
          {isSettingsModalOpen && (
            <SettingsModal
              settings={settings}
              systemFonts={systemFonts}
              editorMeasureLimit={editorMeasureLimit}
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
