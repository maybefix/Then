// 保存したデータを読み込んだときに、形と値を整える処理（App.tsx から移した。docs/APP_STATE_NORMALIZE_SEPARATION_PLAN.md）。
// アプリ全体の保存状態（AppState）と、作品のファイル（プロット・資料のレイアウト・校正の無視リスト）の両方を扱う。
import { DEFAULT_AI_SETTINGS, normalizeAiSettings } from "./ai/settings";
import { normalizeManuscriptSettings } from "./editor/manuscriptLayout";
import { hash16 } from "./editor/ast/documentAst";
import { normalizeWorkspaceDocumentTabs } from "./editor/workspaceDocumentTabs";
import { exportFontFamilies } from "./export/types";
import { defaultIdeaThreads, normalizeIdeaThreads } from "./ideaThreadModel";
import { normalizeLibraryWorkStats } from "./library/libraryData";
import { PROOFREAD_RULES } from "./proofread/rules";
import { normalizeProofreadTerms } from "./proofread/terms";
import { DEFAULT_PROOFREAD_OPTIONS } from "./proofread/types";
import { mergeReferenceFiles } from "./referenceFileKeys";
import { referenceKindFromPath, referenceNameFromPath } from "./referencePathModel";
import { normalizeAppTheme } from "./themes";
import type {
  AppState,
  BinderCardState,
  CursorPosition,
  EditorSettings,
  FileProgressStatus,
  IdeaBinderCardState,
  IdeaThreadLayout,
  ManuscriptSnapshot,
  ManuscriptSnapshotFile,
  OtherIdeaLayout,
  PlotCard,
  ProofreadSettings,
  ReferenceCardState,
  ReferenceFileInfo,
  ReferenceKind,
  ReferenceLayout,
  ReferenceScope,
  WorkspaceRecord,
} from "./types";
import {
  DEFAULT_EDITOR_MEASURE_PERCENT,
  DEFAULT_MANUSCRIPT_SETTINGS,
  EDITOR_MEASURE_PERCENT_MAX,
  EDITOR_MEASURE_PERCENT_MIN,
  UI_FONT_SCALE_MAX,
  UI_FONT_SCALE_MIN,
  fileProgressStatuses,
  isReferenceBinderCard,
} from "./types";
import { quoteCssFontFamily, unquoteSingleCssFontFamily } from "./utils/fontStack";
import { normalizeLeftSidebarCollapsed, normalizeLeftSidebarView } from "./utils/leftSidebarState";
import {
  normalizeRightSidebarCollapsed,
  normalizeRightSidebarTab,
  normalizeRightSidebarWide,
} from "./utils/rightSidebarState";

export const MAX_RECENT_REFERENCES = 30;

const documentData = {
  title: "剣士の目覚め",
};

export const initialMarkdown = `# ${documentData.title}

夜明け前の静寂の中、エリアスは汗ばんだ額を拭いながら起き上がった。また同じ夢だった。蒼穹の封印の扉、その向こうから響く無数の叫び声。

十七年間、一度も会ったことのない父の声も、その中に混じっているような気がした。

窓の外では、ハルト村の朝が静かに始まろうとしていた。鶏の鳴き声、パン屋の煙突から立ち上る煙。いつもと変わらぬ光景のはずなのに、今日は何かが違った。

壁に掛けてあった祖父の形見の剣が、微かに光を放っていた。

> 「また始まったか」
`;

const hiraginoCssFontFamilyAliases = new Map<string, string[]>([
  ["ヒラギノ角ゴ Pro W3", ["Hiragino Kaku Gothic Pro", "ヒラギノ角ゴ Pro"]],
  ["ヒラギノ角ゴ Pro W6", ["Hiragino Kaku Gothic Pro", "ヒラギノ角ゴ Pro"]],
  ["ヒラギノ角ゴ Std W8", ["Hiragino Kaku Gothic Std", "ヒラギノ角ゴ Std"]],
  ["ヒラギノ明朝 Pro W3", ["Hiragino Mincho Pro", "ヒラギノ明朝 Pro"]],
  ["ヒラギノ明朝 Pro W6", ["Hiragino Mincho Pro", "ヒラギノ明朝 Pro"]],
]);

function resolveCssFontFamilyAlias(family: string): string | null {
  const label = unquoteSingleCssFontFamily(family) ?? family.trim();
  const aliases = hiraginoCssFontFamilyAliases.get(label);
  return aliases ? aliases.map(quoteCssFontFamily).join(", ") : null;
}

export function toCssFontFamilyValue(family: string): string {
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
  editorDisplayMode: "continuous",
  pageFlowDirection: "horizontal-rtl",
  manuscript: DEFAULT_MANUSCRIPT_SETTINGS,
  canvasDefaultWritingMode: "horizontal-tb",
  canvasDefaultFontSource: "ui",
  plotFontSource: "editor",
  startPageFontSource: "ui",
  headingFontSource: "body",
  headingFontFamily: toCssFontFamilyValue("Noto Sans JP"),
  typewriterScroll: true,
  showTypewriterGuide: true,
  typewriterOffset: 46,
  showLineBreakMarks: false,
  showLineNumbers: false,
  highlightCurrentLine: false,
  colorizeJapaneseQuotes: false,
  showComments: true,
  snippetStorageMode: "workspace",
  showWorkspacePaths: true,
  showStatusFilePath: false,
  showDocumentTabs: true,
  documentTabsDisplayMode: "always",
  skipStartupPortal: false,
  focusModeUsesNativeFullscreen: false,
  sidebarHoverMode: "none",
  zoneModeOpacity: 0.42,
  countWhitespace: true,
  countCode: true,
  showOutlineGuides: true,
  checkpointSectionCollapsed: false,
  showCheckpointSection: true,
  showCheckpointStatus: true,
  canvasOpensInWindow: false,
  exportOpensInWindow: false,
  proofread: { ...DEFAULT_PROOFREAD_OPTIONS, disabledRules: [] },
  ai: DEFAULT_AI_SETTINGS,
};

export function normalizePathForCompare(path: string): string {
  return path.replace(/[\\/]+/g, "\\").replace(/\\+$/, "").toLocaleLowerCase();
}

export function createDefaultState(): AppState {
  const threads = defaultIdeaThreads();
  return {
    markdown: initialMarkdown,
    snippets: threads,
    profileSnippets: threads,
    settings: defaultSettings,
    rightSidebarTab: "plot",
    rightSidebarCollapsed: false,
    rightSidebarWide: false,
    leftSidebarView: "files",
    leftSidebarCollapsed: false,
    lastWorkspacePath: null,
    lastFilePath: null,
    recentWorkspaces: [],
    collapsedFolderPathsByWorkspace: {},
    collapsedOutlinePathsByWorkspace: {},
    collapsedOutlineHeadingKeysByWorkspace: {},
    fileProgress: {},
    fileProgressMigrationVersions: {},
    checkpointMigrationVersions: {},
    cursorPositions: {},
    proofreadTerms: [],
    documentTabsByWorkspace: {},
    snapshots: [],
    libraryWorkStats: {},
  };
}

/** 空白文字（半角・全角スペース、タブ、改行など）を除いた文字（コードポイント）。 */
export const WHITESPACE_PATTERN = /[\s　]/g;

export function snapshotId(prefix = "snapshot"): string {
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

export function normalizeSnapshots(value: unknown): ManuscriptSnapshot[] {
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
        revision:
          typeof snapshot.revision === "number" &&
          Number.isInteger(snapshot.revision) &&
          snapshot.revision > 0
            ? snapshot.revision
            : 1,
        storageHash: typeof snapshot.storageHash === "string" ? snapshot.storageHash : "",
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

export function normalizePlotCards(value: unknown): PlotCard[] {
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

function normalizeReferenceScope(scope: unknown): ReferenceScope {
  return scope === "global" ? "global" : "project";
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

export function makeReferenceFileInfo(
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

export function referenceInitialSize(kind: ReferenceKind): Pick<ReferenceCardState, "width" | "height"> {
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

function isIdeaCardRecord(
  value: unknown,
): value is Partial<BinderCardState> & { id: string; sourceType: "idea"; threadId: string; fragmentId: string } {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record.sourceType === "idea" &&
    typeof record.id === "string" &&
    typeof record.threadId === "string" &&
    typeof record.fragmentId === "string"
  );
}

export function clampReferenceCardToStage<T extends BinderCardState>(
  card: T,
  stageWidth: number,
  stageHeight: number,
): T {
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

/**
 * Fits the shown cards into the stage. The reader does not know the stage, so this runs once the
 * stage has been measured. A layout whose cards already fit comes back as the same object.
 */
export function fitReferenceLayoutToStage<T extends Pick<ReferenceLayout, "cards">>(
  layout: T,
  stageSize: { width: number; height: number },
): T {
  let changed = false;
  const cards = layout.cards.map((card) => {
    const fitted = clampReferenceCardToStage(card, stageSize.width, stageSize.height);
    if (
      fitted.x === card.x &&
      fitted.y === card.y &&
      fitted.width === card.width &&
      fitted.height === card.height
    ) {
      return card;
    }
    changed = true;
    return fitted;
  });
  return changed ? { ...layout, cards } : layout;
}

export function normalizeReferenceLayout(value: unknown): ReferenceLayout {
  const raw = value as Partial<ReferenceLayout> | null;
  const cards: unknown[] = Array.isArray(raw?.cards) ? raw.cards : [];
  const recent: unknown[] = Array.isArray(raw?.recent) ? raw.recent : [];
  const toIdeaThreadLayouts = (value: unknown): IdeaThreadLayout[] =>
    Array.isArray(value)
      ? value.filter(
          (layout): layout is IdeaThreadLayout =>
            Boolean(layout) &&
            typeof layout === "object" &&
            typeof (layout as IdeaThreadLayout).threadId === "string" &&
            Array.isArray((layout as IdeaThreadLayout).items),
        )
      : [];
  const toIdeaCard = (card: unknown, index: number): IdeaBinderCardState => {
    if (!isIdeaCardRecord(card)) throw new Error("unreachable Idea card");
    return {
      id: card.id,
      sourceType: "idea",
      threadId: card.threadId,
      fragmentId: card.fragmentId,
      x: typeof card.x === "number" ? card.x : 72 + index * 32,
      y: typeof card.y === "number" ? card.y : 96 + index * 32,
      width: typeof card.width === "number" ? card.width : 320,
      height: typeof card.height === "number" ? card.height : 300,
      zIndex: typeof card.zIndex === "number" ? card.zIndex : index + 1,
      collapsed: Boolean(card.collapsed),
      pinned: Boolean(card.pinned),
    };
  };
  const ideaThreads = toIdeaThreadLayouts(raw?.ideaThreads);
  const isStorageMode = (mode: unknown): mode is EditorSettings["snippetStorageMode"] =>
    mode === "workspace" || mode === "profile";
  const ideaThreadsMode = isStorageMode(raw?.ideaThreadsMode) ? raw.ideaThreadsMode : undefined;
  const rawOther = raw?.otherIdea as Partial<OtherIdeaLayout> | undefined;
  const otherIdea: OtherIdeaLayout | undefined =
    ideaThreadsMode && rawOther && isStorageMode(rawOther.mode) && rawOther.mode !== ideaThreadsMode
      ? {
          mode: rawOther.mode,
          ideaThreads: toIdeaThreadLayouts(rawOther.ideaThreads),
          cards: (Array.isArray(rawOther.cards) ? (rawOther.cards as unknown[]) : [])
            .filter(isIdeaCardRecord)
            .map(toIdeaCard),
        }
      : undefined;
  const normalizedCards = cards
    .filter(
      (card) =>
        isIdeaCardRecord(card)
        || (isReferenceCardRecord(card) && card.scope !== "global"),
    )
    .map((card, index): BinderCardState => {
      if (isIdeaCardRecord(card)) {
        return toIdeaCard(card, index);
      }
      if (!isReferenceCardRecord(card)) throw new Error("unreachable binder card");
      const kind =
        card.kind === "text" ||
        card.kind === "markdown" ||
        card.kind === "image" ||
        card.kind === "pdf" ||
        card.kind === "unknown"
          ? card.kind
          : referenceKindFromPath(card.sourcePath);
      const size = referenceInitialSize(kind);
      return {
        id: card.id,
        sourceType: "reference",
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
      };
    });
  const normalizedRecent = recent
    .filter((file): file is ReferenceFileInfo => isReferenceFileInfo(file) && file.scope !== "global")
    .map((file) => ({
      ...file,
      scope: normalizeReferenceScope(file.scope),
      imported: Boolean(file.imported),
    }));
  return {
    version: 3,
    name: typeof raw?.name === "string" && raw.name.trim() ? raw.name : "default",
    recent: mergeReferenceFiles(
      normalizedRecent,
      normalizedCards
        .filter(isReferenceBinderCard)
        .map((card) => makeReferenceFileInfo(card.sourcePath, card.kind, card.scope)),
    )
      .slice(0, MAX_RECENT_REFERENCES),
    cards: normalizedCards,
    ideaThreads,
    ...(ideaThreadsMode ? { ideaThreadsMode } : {}),
    ...(otherIdea ? { otherIdea } : {}),
  };
}

function normalizeCollapsedPathListsByWorkspace(
  value: unknown,
): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const normalized: Record<string, string[]> = {};
  for (const [workspacePath, folderPaths] of Object.entries(value)) {
    if (!workspacePath || !Array.isArray(folderPaths)) continue;
    normalized[workspacePath] = Array.from(
      new Set(folderPaths.filter((path): path is string => typeof path === "string" && path.length > 0)),
    );
  }
  return normalized;
}

const knownProofreadRuleIds = new Set(PROOFREAD_RULES.map((rule) => rule.id));
const knownProofreadCheckIds = new Set(
  PROOFREAD_RULES.flatMap((rule) => rule.checks?.map((check) => check.id) ?? []),
);

/**
 * 校正設定の復元。しきい値は入力欄と同じ範囲へ丸め、無くなったルールIDは捨てる。
 * ルールを削除・改名しても、保存済みの設定が指摘を丸ごと止めてしまわないようにする。
 */
function normalizeProofreadSettings(value: unknown): ProofreadSettings {
  const fallback: ProofreadSettings = { ...DEFAULT_PROOFREAD_OPTIONS, disabledRules: [] };
  if (!value || typeof value !== "object") return fallback;

  const stored = value as Partial<ProofreadSettings>;
  const clamp = (input: unknown, min: number, max: number, fallbackValue: number) =>
    typeof input === "number" && Number.isFinite(input)
      ? Math.min(max, Math.max(min, Math.round(input)))
      : fallbackValue;

  return {
    maxSentenceLength: clamp(stored.maxSentenceLength, 20, 200, fallback.maxSentenceLength),
    maxCommasPerSentence: clamp(stored.maxCommasPerSentence, 1, 12, fallback.maxCommasPerSentence),
    skipDialogue:
      typeof stored.skipDialogue === "boolean" ? stored.skipDialogue : fallback.skipDialogue,
    disabledChecks: Array.isArray(stored.disabledChecks)
      ? Array.from(
          new Set(
            stored.disabledChecks.filter(
              (checkId): checkId is string =>
                typeof checkId === "string" && knownProofreadCheckIds.has(checkId),
            ),
          ),
        )
      : [],
    disabledRules: Array.isArray(stored.disabledRules)
      ? Array.from(
          new Set(
            stored.disabledRules.filter(
              (ruleId): ruleId is string =>
                typeof ruleId === "string" && knownProofreadRuleIds.has(ruleId),
            ),
          ),
        )
      : [],
  };
}

export function normalizeState(value: Partial<AppState> | null | undefined): AppState {
  const rawSettings = (value?.settings ?? {}) as Partial<EditorSettings> & {
    /** v0.6.1以前の保存形式。trueは左右ともホバー表示。 */
    zoneMode?: unknown;
  };
  const { zoneMode: legacyZoneMode, ...settings } = rawSettings;
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
      fontSize:
        typeof settings.fontSize === "number" && Number.isFinite(settings.fontSize)
          ? Math.min(24, Math.max(12, settings.fontSize))
          : defaultSettings.fontSize,
      lineHeight:
        typeof settings.lineHeight === "number" && Number.isFinite(settings.lineHeight)
          ? Math.min(2.4, Math.max(1.4, settings.lineHeight))
          : defaultSettings.lineHeight,
      snippetStorageMode:
        settings.snippetStorageMode === "profile" ? "profile" : "workspace",
      showWorkspacePaths:
        typeof settings.showWorkspacePaths === "boolean"
          ? settings.showWorkspacePaths
          : defaultSettings.showWorkspacePaths,
      showStatusFilePath:
        typeof settings.showStatusFilePath === "boolean"
          ? settings.showStatusFilePath
          : defaultSettings.showStatusFilePath,
      showDocumentTabs:
        typeof settings.showDocumentTabs === "boolean"
          ? settings.showDocumentTabs
          : defaultSettings.showDocumentTabs,
      documentTabsDisplayMode:
        settings.documentTabsDisplayMode === "hover" ||
        settings.documentTabsDisplayMode === "always"
          ? settings.documentTabsDisplayMode
          : defaultSettings.documentTabsDisplayMode,
      skipStartupPortal:
        typeof settings.skipStartupPortal === "boolean"
          ? settings.skipStartupPortal
          : defaultSettings.skipStartupPortal,
      focusModeUsesNativeFullscreen:
        typeof settings.focusModeUsesNativeFullscreen === "boolean"
          ? settings.focusModeUsesNativeFullscreen
          : defaultSettings.focusModeUsesNativeFullscreen,
      sidebarHoverMode:
        settings.sidebarHoverMode === "both"
        || settings.sidebarHoverMode === "left"
        || settings.sidebarHoverMode === "right"
        || settings.sidebarHoverMode === "none"
          ? settings.sidebarHoverMode
          : legacyZoneMode === true
            ? "both"
            : defaultSettings.sidebarHoverMode,
      zoneModeOpacity:
        typeof settings.zoneModeOpacity === "number" && Number.isFinite(settings.zoneModeOpacity)
          ? Math.min(0.85, Math.max(0, settings.zoneModeOpacity))
          : defaultSettings.zoneModeOpacity,
      theme: normalizeAppTheme(settings.theme),
      countWhitespace:
        typeof settings.countWhitespace === "boolean"
          ? settings.countWhitespace
          : defaultSettings.countWhitespace,
      countCode:
        typeof settings.countCode === "boolean"
          ? settings.countCode
          : defaultSettings.countCode,
      showOutlineGuides:
        typeof settings.showOutlineGuides === "boolean"
          ? settings.showOutlineGuides
          : defaultSettings.showOutlineGuides,
      checkpointSectionCollapsed:
        typeof settings.checkpointSectionCollapsed === "boolean"
          ? settings.checkpointSectionCollapsed
          : defaultSettings.checkpointSectionCollapsed,
      showCheckpointSection:
        typeof settings.showCheckpointSection === "boolean"
          ? settings.showCheckpointSection
          : defaultSettings.showCheckpointSection,
      showCheckpointStatus:
        typeof settings.showCheckpointStatus === "boolean"
          ? settings.showCheckpointStatus
          : defaultSettings.showCheckpointStatus,
      typewriterScroll:
        typeof settings.typewriterScroll === "boolean"
          ? settings.typewriterScroll
          : defaultSettings.typewriterScroll,
      showTypewriterGuide:
        typeof settings.showTypewriterGuide === "boolean"
          ? settings.showTypewriterGuide
          : defaultSettings.showTypewriterGuide,
      showLineBreakMarks:
        typeof settings.showLineBreakMarks === "boolean"
          ? settings.showLineBreakMarks
          : defaultSettings.showLineBreakMarks,
      showLineNumbers:
        typeof settings.showLineNumbers === "boolean"
          ? settings.showLineNumbers
          : defaultSettings.showLineNumbers,
      highlightCurrentLine:
        typeof settings.highlightCurrentLine === "boolean"
          ? settings.highlightCurrentLine
          : defaultSettings.highlightCurrentLine,
      colorizeJapaneseQuotes:
        typeof settings.colorizeJapaneseQuotes === "boolean"
          ? settings.colorizeJapaneseQuotes
          : defaultSettings.colorizeJapaneseQuotes,
      showComments:
        typeof settings.showComments === "boolean"
          ? settings.showComments
          : defaultSettings.showComments,
      typewriterOffset:
        typeof settings.typewriterOffset === "number" && Number.isFinite(settings.typewriterOffset)
          ? Math.min(65, Math.max(30, settings.typewriterOffset))
          : defaultSettings.typewriterOffset,
      writingMode:
        settings.writingMode === "horizontal-tb" || settings.writingMode === "vertical-rl"
          ? settings.writingMode
          : defaultSettings.writingMode,
      editorDisplayMode:
        settings.editorDisplayMode === "paged" ? "paged" : "continuous",
      pageFlowDirection:
        settings.pageFlowDirection === "vertical" ? "vertical" : "horizontal-rtl",
      manuscript: normalizeManuscriptSettings(settings.manuscript, settings.fontSize),
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
      startPageFontSource:
        settings.startPageFontSource === "editor" || settings.startPageFontSource === "ui"
          ? settings.startPageFontSource
          : defaultSettings.startPageFontSource,
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
      proofread: normalizeProofreadSettings(settings.proofread),
      ai: normalizeAiSettings(settings.ai),
    },
    rightSidebarTab: normalizeRightSidebarTab(value?.rightSidebarTab),
    rightSidebarCollapsed: normalizeRightSidebarCollapsed(value?.rightSidebarCollapsed),
    rightSidebarWide: normalizeRightSidebarWide(value?.rightSidebarWide),
    leftSidebarView: normalizeLeftSidebarView(value?.leftSidebarView),
    leftSidebarCollapsed: normalizeLeftSidebarCollapsed(value?.leftSidebarCollapsed),
    lastWorkspacePath:
      typeof value?.lastWorkspacePath === "string" ? value.lastWorkspacePath : null,
    lastFilePath: typeof value?.lastFilePath === "string" ? value.lastFilePath : null,
    recentWorkspaces,
    collapsedFolderPathsByWorkspace: normalizeCollapsedPathListsByWorkspace(
      value?.collapsedFolderPathsByWorkspace,
    ),
    collapsedOutlinePathsByWorkspace: normalizeCollapsedPathListsByWorkspace(
      value?.collapsedOutlinePathsByWorkspace,
    ),
    collapsedOutlineHeadingKeysByWorkspace: normalizeCollapsedPathListsByWorkspace(
      value?.collapsedOutlineHeadingKeysByWorkspace,
    ),
    fileProgress: normalizeFileProgress(value?.fileProgress),
    fileProgressMigrationVersions: normalizeFileProgressMigrationVersions(
      value?.fileProgressMigrationVersions,
    ),
    checkpointMigrationVersions: normalizeFileProgressMigrationVersions(
      value?.checkpointMigrationVersions,
    ),
    cursorPositions: normalizeCursorPositions(value?.cursorPositions),
    proofreadTerms: normalizeProofreadTerms(value?.proofreadTerms, "global"),
    documentTabsByWorkspace: normalizeWorkspaceDocumentTabs(
      value?.documentTabsByWorkspace,
    ),
    snapshots: normalizeSnapshots(value?.snapshots),
    libraryWorkStats: normalizeLibraryWorkStats(value?.libraryWorkStats),
  };
}

function normalizeFileProgressMigrationVersions(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, number> = {};
  for (const [workspace, version] of Object.entries(value as Record<string, unknown>)) {
    if (workspace && typeof version === "number" && Number.isInteger(version) && version > 0) {
      result[workspace] = version;
    }
  }
  return result;
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

export function normalizeFileProgress(
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

/** 無視した指摘。ワークスペース内の相対パスごとに保つ。 */
export type ProofreadIgnoredByPath = Record<string, string[]>;

export function normalizeProofreadIgnored(value: unknown): ProofreadIgnoredByPath {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const normalized: ProofreadIgnoredByPath = {};
  for (const [path, keys] of Object.entries(value as Record<string, unknown>)) {
    if (!path || !Array.isArray(keys)) continue;
    const kept = Array.from(
      new Set(keys.filter((key): key is string => typeof key === "string" && key.length > 0)),
    );
    if (kept.length) normalized[path] = kept;
  }
  return normalized;
}
